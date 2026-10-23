import { checkFormRateLimit } from "@/lib/form-rate-limit";
import { accountsApi, currentMember } from "@/lib/member-account";
import { workspaceMutationAllowed } from "@/lib/workspace-session";
import { checkoutConfigured, createCheckoutSession, createCustomer, getPrice } from "@server/billing/stripe-checkout";

const responseHeaders = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

function accountUrl(request: Request, status: string) {
  return `${new URL(request.url).origin}/account?checkout=${status}`;
}

// Whether checkout is set up, and the plan price from Stripe itself.
export async function GET() {
  const configured = checkoutConfigured();
  return Response.json({ configured, price: configured ? await getPrice() : null }, { headers: responseHeaders });
}

export async function POST(request: Request) {
  if (!workspaceMutationAllowed(request)) return Response.json({ error: "Same-origin request required" }, { status: 403, headers: responseHeaders });
  const rate = checkFormRateLimit("checkout");
  if (!rate.allowed) {
    return Response.json(
      { error: "Too many checkout attempts. Retry later." },
      { status: 429, headers: { ...responseHeaders, "Retry-After": String(rate.retryAfterSeconds) } },
    );
  }
  if (!checkoutConfigured()) {
    return Response.json({ configured: false, error: "Checkout is not configured." }, { status: 503, headers: responseHeaders });
  }
  const member = await currentMember(request);
  if (!member) return Response.json({ error: "Sign in before subscribing", signIn: "/sign-in" }, { status: 401, headers: responseHeaders });
  if (member.entitled) return Response.json({ error: "This account already has an active subscription" }, { status: 409, headers: responseHeaders });

  // One Stripe customer per account, created on first checkout.
  let customerId = member.stripeCustomerId;
  if (!customerId) {
    customerId = await createCustomer({ email: member.email, accountId: member.id });
    if (!customerId) return Response.json({ error: "Stripe could not create a customer" }, { status: 502, headers: responseHeaders });
    const linked = await accountsApi(`/${member.id}/customer`, { method: "POST", body: { customerId } });
    if (!linked.ok) return Response.json({ error: "The billing account could not be saved" }, { status: 503, headers: responseHeaders });
  }
  const result = await createCheckoutSession({
    successUrl: accountUrl(request, "success"),
    cancelUrl: accountUrl(request, "cancelled"),
    customerId,
    accountId: member.id,
  });
  if (!result.url) {
    return Response.json(
      { configured: true, error: "Stripe did not return a checkout URL." },
      { status: result.status || 502, headers: responseHeaders },
    );
  }
  return Response.json({ configured: true, url: result.url }, { headers: responseHeaders });
}
