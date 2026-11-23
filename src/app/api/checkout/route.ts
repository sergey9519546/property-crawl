import { checkFormRateLimit } from "@/lib/form-rate-limit";
import { accountsApi, currentMember } from "@/lib/member-account";
import { rateLimitKey } from "@/lib/client-ip";
import { workspaceMutationAllowed } from "@/lib/workspace-session";
import { appOrigin } from "@/lib/app-origin";
import { checkoutConfigured, createCheckoutSession, createCustomer, getPrice } from "@server/billing/stripe-checkout";

const responseHeaders = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

function accountUrl(origin: string, status: string) {
  return `${origin}/account?checkout=${status}`;
}

// Whether checkout is set up, and the plan price from Stripe itself.
export async function GET(request?: Request) {
  let tier: string | null = null;
  if (request?.url) {
    try {
      tier = new URL(request.url).searchParams.get("tier");
    } catch {
      tier = null;
    }
  }
  const configured = checkoutConfigured(process.env, tier);
  return Response.json({ configured, price: configured ? await getPrice({ tier }) : null }, { headers: responseHeaders });
}

export async function POST(request: Request) {
  if (!workspaceMutationAllowed(request)) return Response.json({ error: "Same-origin request required" }, { status: 403, headers: responseHeaders });
  const rate = checkFormRateLimit("checkout", { key: rateLimitKey("checkout", request) });
  if (!rate.allowed) {
    return Response.json(
      { error: "Too many checkout attempts. Retry later." },
      { status: 429, headers: { ...responseHeaders, "Retry-After": String(rate.retryAfterSeconds) } },
    );
  }
  let requestedTier: string | null = null;
  try {
    const contentType = request.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const parsed = await request.json();
      if (parsed && typeof parsed.tier === "string") requestedTier = parsed.tier;
    }
  } catch {
    // Empty or malformed JSON body falls back to default tier.
  }
  if (!checkoutConfigured(process.env, requestedTier)) {
    return Response.json({ configured: false, error: "Checkout is not configured." }, { status: 503, headers: responseHeaders });
  }
  const member = await currentMember(request);
  if (!member) return Response.json({ error: "Sign in before subscribing", signIn: "/account" }, { status: 401, headers: responseHeaders });
  if (member.entitled) return Response.json({ error: "This account already has an active subscription" }, { status: 409, headers: responseHeaders });
  const origin = appOrigin(request);
  if (!origin) return Response.json({ error: "Checkout requires PUBLIC_APP_ORIGIN on this deployment" }, { status: 503, headers: responseHeaders });

  // One Stripe customer per account, created on first checkout.
  let customerId = member.stripeCustomerId;
  if (!customerId) {
    customerId = await createCustomer({ email: member.email, accountId: member.id });
    if (!customerId) return Response.json({ error: "Stripe could not create a customer" }, { status: 502, headers: responseHeaders });
    const linked = await accountsApi(`/${member.id}/customer`, { method: "POST", body: { customerId } });
    if (!linked.ok) return Response.json({ error: "The billing account could not be saved" }, { status: 503, headers: responseHeaders });
  }
  const result = await createCheckoutSession({
    successUrl: accountUrl(origin, "success"),
    cancelUrl: accountUrl(origin, "cancelled"),
    customerId,
    accountId: member.id,
    tier: requestedTier,
  });
  if (!result.url) {
    return Response.json(
      { configured: true, error: "Stripe did not return a checkout URL." },
      { status: result.status || 502, headers: responseHeaders },
    );
  }
  return Response.json({ configured: true, url: result.url }, { headers: responseHeaders });
}
