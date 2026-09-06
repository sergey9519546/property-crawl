import "server-only";

import { proxyPropertyApi } from "@/lib/property-api";
import { readWorkspaceSession, workspaceMutationAllowed, workspaceSessionConfiguration } from "@/lib/workspace-session";

function error(status: number, message: string) {
  return Response.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function proxyPrivatePropertyApi(request: Request) {
  if (!["GET", "HEAD"].includes(request.method) && !workspaceMutationAllowed(request)) {
    return error(403, "Same-origin workspace request required");
  }
  const configuration = workspaceSessionConfiguration();
  if (!configuration.configured) return error(503, "Operator access is not configured on this workspace");
  if (!readWorkspaceSession(request).authenticated) return error(401, "Unlock the private workspace to continue");
  return proxyPropertyApi(request, { operatorToken: configuration.credential });
}

