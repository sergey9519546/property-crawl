import { workspaceUnlockBucket, workspaceUnlockLimiter } from "@/lib/workspace-unlock-limiter";
import {
  clearWorkspaceSession,
  issueWorkspaceSession,
  readWorkspaceSession,
  serializeWorkspaceSession,
  verifyOperatorCredential,
  workspaceMutationAllowed,
  workspaceSessionConfiguration,
} from "@/lib/workspace-session";

const responseHeaders = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

export async function GET(request: Request) {
  const config = workspaceSessionConfiguration();
  return Response.json({ configured: config.configured, ...readWorkspaceSession(request) }, { headers: responseHeaders });
}

export async function POST(request: Request) {
  if (!workspaceMutationAllowed(request)) return Response.json({ error: "Same-origin workspace request required" }, { status: 403, headers: responseHeaders });
  if (Number(request.headers.get("content-length")) > 8192) return Response.json({ error: "Request body too large" }, { status: 413, headers: responseHeaders });
  const config = workspaceSessionConfiguration();
  if (!config.configured) return Response.json({ error: "Set SCRAPER_ADMIN_TOKEN on both application processes before unlocking the workspace" }, { status: 503, headers: responseHeaders });
  const bucket = workspaceUnlockBucket(request);
  let body: { credential?: unknown };
  try { body = await request.json(); }
  catch {
    const decision = workspaceUnlockLimiter.check(bucket);
    if (!decision.allowed) return Response.json({ error: "Too many unlock attempts. Retry later." }, { status: 429, headers: { ...responseHeaders, "Retry-After": String(decision.retryAfterSeconds) } });
    workspaceUnlockLimiter.recordFailure(bucket);
    return Response.json({ error: "A workspace credential is required" }, { status: 400, headers: responseHeaders });
  }
  const decision = workspaceUnlockLimiter.check(bucket);
  if (!decision.allowed) return Response.json({ error: "Too many unlock attempts. Retry later." }, { status: 429, headers: { ...responseHeaders, "Retry-After": String(decision.retryAfterSeconds) } });
  if (!verifyOperatorCredential(body?.credential)) {
    workspaceUnlockLimiter.recordFailure(bucket);
    return Response.json({ error: "Workspace credential was not accepted" }, { status: 401, headers: responseHeaders });
  }
  workspaceUnlockLimiter.reset(bucket);
  const session = issueWorkspaceSession();
  if (!session) return Response.json({ error: "Workspace session could not be created" }, { status: 503, headers: responseHeaders });
  return Response.json(
    { authenticated: true, configured: true, expiresAt: session.expiresAt },
    { headers: { ...responseHeaders, "Set-Cookie": serializeWorkspaceSession(session.value, request) } },
  );
}

export async function DELETE(request: Request) {
  if (!workspaceMutationAllowed(request)) return Response.json({ error: "Same-origin workspace request required" }, { status: 403, headers: responseHeaders });
  return Response.json(
    { authenticated: false, configured: workspaceSessionConfiguration().configured, expiresAt: null },
    { headers: { ...responseHeaders, "Set-Cookie": clearWorkspaceSession(request) } },
  );
}
