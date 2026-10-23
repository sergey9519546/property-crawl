import { accountsApi, issueMemberSession, serializeMemberSession, type MemberAccount } from "@/lib/member-account";
import { workspaceMutationAllowed } from "@/lib/workspace-session";

const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

// POST only: mail scanners that prefetch GET links cannot spend the token.
export async function POST(request: Request) {
  if (!workspaceMutationAllowed(request)) return Response.json({ error: "Same-origin request required" }, { status: 403, headers });
  let body: { token?: unknown };
  try { body = await request.json(); } catch { return Response.json({ error: "Invalid JSON body" }, { status: 400, headers }); }
  const consumed = await accountsApi<{ account?: MemberAccount; error?: string }>("/consume", { method: "POST", body: { token: body.token } });
  const account = consumed.data.account;
  if (!consumed.ok || !account) {
    return Response.json({ error: consumed.data.error || "This sign-in link is invalid or expired" }, { status: consumed.status === 401 ? 401 : 503, headers });
  }
  const session = issueMemberSession(account.id);
  if (!session) return Response.json({ error: "Sign-in is not configured" }, { status: 503, headers });
  return Response.json({ signedIn: true, entitled: account.entitled }, { headers: { ...headers, "Set-Cookie": serializeMemberSession(session, request) } });
}
