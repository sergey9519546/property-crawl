import "server-only";

import { proxyPropertyApi } from "@/lib/property-api";
import { readWorkspaceSession, workspaceMutationAllowed, workspaceSessionConfiguration } from "@/lib/workspace-session";
import { currentMember } from "@/lib/member-account";

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

// Per-user tools (hunts, saved searches, portfolio, price drops): the operator
// workspace, or a signed-in member with an active subscription. The API scopes
// every read and write to that member's account.
export async function proxyMemberPropertyApi(request: Request) {
  if (!["GET", "HEAD"].includes(request.method) && !workspaceMutationAllowed(request)) {
    return error(403, "Same-origin request required");
  }
  const configuration = workspaceSessionConfiguration();
  if (!configuration.configured) return error(503, "Accounts are not configured on this workspace");
  if (readWorkspaceSession(request).authenticated) return proxyPropertyApi(request, { operatorToken: configuration.credential });
  const member = await currentMember(request);
  if (!member) return error(401, "Sign in to continue");
  if (!member.entitled) {
    return Response.json({ error: "An active subscription is required", upgrade: "/account" }, { status: 402, headers: { "Cache-Control": "no-store" } });
  }
  return proxyPropertyApi(request, { operatorToken: configuration.credential, accountId: member.id });
}

// Watchlists are readable/writable by an anonymous device (server-issued
// HttpOnly cookie), and move to the member account or operator workspace when
// one is signed in.
export async function proxyWatchlistPropertyApi(request: Request) {
  if (!["GET", "HEAD"].includes(request.method) && !workspaceMutationAllowed(request)) {
    return error(403, "Same-origin request required");
  }
  const configuration = workspaceSessionConfiguration();
  if (configuration.configured && readWorkspaceSession(request).authenticated) {
    return proxyPropertyApi(request, { operatorToken: configuration.credential });
  }
  const member = configuration.configured ? await currentMember(request) : null;
  if (member?.entitled) return proxyPropertyApi(request, { operatorToken: configuration.credential, accountId: member.id });
  return proxyPropertyApi(request);
}

