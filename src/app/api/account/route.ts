import { clearMemberSession, currentMember } from "@/lib/member-account";
import { workspaceMutationAllowed } from "@/lib/workspace-session";

const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

export async function GET(request: Request) {
  const account = await currentMember(request);
  return Response.json({ account: account && {
    email: account.email,
    entitled: account.entitled,
    subscriptionStatus: account.subscriptionStatus,
    currentPeriodEnd: account.currentPeriodEnd,
    hasBilling: Boolean(account.stripeCustomerId),
  } }, { headers });
}

// Sign out.
export async function DELETE(request: Request) {
  if (!workspaceMutationAllowed(request)) return Response.json({ error: "Same-origin request required" }, { status: 403, headers });
  return Response.json({ account: null }, { headers: { ...headers, "Set-Cookie": clearMemberSession(request) } });
}
