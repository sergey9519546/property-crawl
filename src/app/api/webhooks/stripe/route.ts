import { getSubscription, subscriptionState, verifyStripeWebhook, stripeWebhookConfigured } from "@server/billing/stripe-checkout";
import { accountsApi } from "@/lib/member-account";

const MAX_STRIPE_WEBHOOK_BYTES = 512 * 1024;
const responseHeaders = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

export async function GET() {
  return Response.json(
    { configured: stripeWebhookConfigured() },
    { headers: responseHeaders }
  );
}

export async function POST(request: Request) {
  const contentLength = Number(request.headers.get("content-length") || "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_STRIPE_WEBHOOK_BYTES) {
    return Response.json(
      { error: "Webhook payload exceeds maximum allowed size." },
      { status: 413, headers: responseHeaders }
    );
  }

  const signatureHeader = request.headers.get("stripe-signature") || "";
  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return Response.json(
      { error: "Could not read request body." },
      { status: 400, headers: responseHeaders }
    );
  }

  if (Buffer.byteLength(rawBody, "utf8") > MAX_STRIPE_WEBHOOK_BYTES) {
    return Response.json(
      { error: "Webhook payload exceeds maximum allowed size." },
      { status: 413, headers: responseHeaders }
    );
  }

  const result = verifyStripeWebhook({
    signatureHeader,
    rawBody,
  });

  if (!result.configured) {
    return Response.json(
      { error: "Stripe webhook is not configured." },
      { status: 503, headers: responseHeaders }
    );
  }

  if (!result.valid) {
    return Response.json(
      { error: "Invalid signature.", reason: result.reason },
      { status: result.status || 400, headers: responseHeaders }
    );
  }

  // Record the subscription state on the member account. That state is the
  // entitlement: the API checks it before serving hunts, saved searches,
  // portfolio and alerts, and before sending any member alert.
  const event = result.event;
  const eventId = typeof event?.id === "string" ? event.id : null;
  const eventType = typeof event?.type === "string" ? event.type : null;

  // Claim the event atomically (INSERT ... ON CONFLICT DO NOTHING / locked file
  // write) before applying it, so two simultaneous deliveries cannot both run.
  // A failure below releases the claim so Stripe's retry is processed.
  if (eventId) {
    const claim = await accountsApi<{ duplicate?: boolean }>("/webhook-event", { method: "POST", body: { id: eventId, type: eventType } });
    if (!claim.ok) {
      return Response.json({ error: "Webhook ledger unavailable" }, { status: 503, headers: responseHeaders });
    }
    if (claim.data?.duplicate) {
      return Response.json(
        { received: true, id: eventId, type: eventType, duplicate: true, applied: false },
        { status: 200, headers: responseHeaders }
      );
    }
  }
  const release = async () => {
    if (eventId) await accountsApi(`/webhook-event/${encodeURIComponent(eventId)}`, { method: "DELETE" });
  };
  const retryLater = async (error: string, status: number) => {
    await release();
    return Response.json({ error }, { status, headers: responseHeaders });
  };

  const object = event?.data?.object || {};
  let state: ReturnType<typeof subscriptionState> = null;
  if (event?.type === "checkout.session.completed" && object.mode === "subscription") {
    state = subscriptionState(await getSubscription(object.subscription));
    if (!state) return retryLater("Subscription lookup failed", 502);
    if (!state.accountId) state.accountId = object.client_reference_id || null;
  } else if (typeof event?.type === "string" && event.type.startsWith("customer.subscription.")) {
    // Events can arrive out of order; the live subscription is the truth.
    state = subscriptionState((await getSubscription(object.id)) || object);
  }

  if (!state) {
    return Response.json({ received: true, id: event?.id, type: event?.type, applied: false }, { status: 200, headers: responseHeaders });
  }

  const applied = await accountsApi("/subscription", { method: "POST", body: state });
  if (applied.status === 404) {
    console.warn(`[Stripe Webhook] ${event?.id}: no account for customer ${state.customerId}`);
    return Response.json({ received: true, id: event?.id, applied: false }, { status: 200, headers: responseHeaders });
  }
  if (!applied.ok) return retryLater("Account update failed", 503);

  return Response.json({ received: true, id: event?.id, type: event?.type, applied: true }, { status: 200, headers: responseHeaders });
}
