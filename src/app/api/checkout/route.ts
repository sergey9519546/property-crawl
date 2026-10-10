import { checkFormRateLimit } from "@/lib/form-rate-limit";
import { createCheckoutSession } from "@server/billing/stripe-checkout";

const responseHeaders = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

function pageUrl(request: Request, status: string) {
  const url = new URL(request.url);
  return `${url.origin}/checkout?status=${status}`;
}

export async function GET() {
  const { checkoutConfigured } = await import("@server/billing/stripe-checkout");
  return Response.json({ configured: checkoutConfigured() }, { headers: responseHeaders });
}

export async function POST(request: Request) {
  const rate = checkFormRateLimit("checkout");
  if (!rate.allowed) {
    return Response.json(
      { error: "Too many checkout attempts. Retry later." },
      { status: 429, headers: { ...responseHeaders, "Retry-After": String(rate.retryAfterSeconds) } },
    );
  }
  const result = await createCheckoutSession({
    successUrl: pageUrl(request, "returned"),
    cancelUrl: pageUrl(request, "cancelled"),
  });
  if (!result.configured) {
    return Response.json(
      { configured: false, error: "Checkout is not configured." },
      { status: 503, headers: responseHeaders },
    );
  }
  if (!result.url) {
    return Response.json(
      { configured: true, error: "Stripe did not return a checkout URL." },
      { status: result.status || 502, headers: responseHeaders },
    );
  }
  return Response.json({ configured: true, url: result.url }, { headers: responseHeaders });
}
