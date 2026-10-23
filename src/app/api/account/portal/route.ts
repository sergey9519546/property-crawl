import { currentMember } from "@/lib/member-account";
import { workspaceMutationAllowed } from "@/lib/workspace-session";
import { createPortalSession } from "@server/billing/stripe-checkout";

const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

// Stripe's hosted billing portal: change card, cancel, view invoices.
export async function POST(request: Request) {
  if (!workspaceMutationAllowed(request)) return Response.json({ error: "Same-origin request required" }, { status: 403, headers });
  const member = await currentMember(request);
  if (!member) return Response.json({ error: "Sign in to continue" }, { status: 401, headers });
  if (!member.stripeCustomerId) return Response.json({ error: "No billing account yet" }, { status: 409, headers });
  const url = await createPortalSession({ customerId: member.stripeCustomerId, returnUrl: `${new URL(request.url).origin}/account` });
  if (!url) return Response.json({ error: "The billing portal is unavailable" }, { status: 502, headers });
  return Response.json({ url }, { headers });
}
