import { verifyStripeWebhook, stripeWebhookConfigured } from "@server/billing/stripe-checkout";

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

  // Event successfully verified.
  // Note: Receipt is acknowledged without creating fake accounts or issuing tokens.
  const event = result.event;
  console.log(`[Stripe Webhook] Verified event ${event?.id} (${event?.type})`);

  return Response.json(
    { received: true, id: event?.id, type: event?.type },
    { status: 200, headers: responseHeaders }
  );
}
