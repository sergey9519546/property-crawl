import "server-only";

import { proxyPropertyApi } from "@/lib/property-api";
import { hasPermission, readWorkspaceSession, workspaceMutationAllowed, workspaceSessionConfiguration, type Permission } from "@/lib/workspace-session";
import { currentMember } from "@/lib/member-account";

function error(status: number, message: string, extra?: Record<string, unknown>) {
  return Response.json(extra ? { error: message, ...extra } : { error: message }, { status, headers: { "Cache-Control": "no-store" } });
}

function inferPrivatePermission(request: Request): Permission {
  try {
    const pathname = new URL(request.url).pathname;
    if (
      pathname.startsWith("/api/scrapers") ||
      pathname.startsWith("/api/sources/") ||
      pathname.startsWith("/api/source-network") ||
      pathname.startsWith("/api/parse") ||
      pathname.startsWith("/api/enrichment") ||
      pathname.startsWith("/api/workspace/import")
    ) {
      return "canRunScrapers";
    }
    if (
      pathname.startsWith("/api/export") ||
      /^\/api\/listings\/[^/]+\/packet$/.test(pathname)
    ) {
      return "canExportDossier";
    }
    if (
      pathname.startsWith("/api/document-review") ||
      pathname.startsWith("/api/property-intelligence") ||
      /^\/api\/listings\/[^/]+\/assessor$/.test(pathname)
    ) {
      return "canReviewDocuments";
    }
    if (pathname.startsWith("/api/workspace")) {
      return ["GET", "HEAD"].includes(request.method) ? "canViewWorkspace" : "canReviewDocuments";
    }
  } catch {
    // Fall through to strict operator-only default
  }
  return "canRunScrapers";
}

export async function proxyPrivatePropertyApi(request: Request, options: { permission?: Permission } = {}) {
  if (!["GET", "HEAD"].includes(request.method) && !workspaceMutationAllowed(request)) {
    return error(403, "Same-origin workspace request required");
  }
  const configuration = workspaceSessionConfiguration();
  if (!configuration.configured) return error(503, "Operator access is not configured on this workspace");
  const session = readWorkspaceSession(request);
  if (!session.authenticated) return error(401, "Unlock the private workspace to continue");
  const requiredPermission = options.permission ?? inferPrivatePermission(request);
  if (requiredPermission && !hasPermission(session.role, requiredPermission)) {
    return error(403, `Forbidden: ${requiredPermission} permission is required`, {
      code: "PERMISSION_DENIED",
      role: session.role,
    });
  }
  return proxyPropertyApi(request, { operatorToken: configuration.credential });
}

// Per-user tools (hunts, saved searches, portfolio, price drops): the operator
// workspace, or a signed-in member with an active subscription. The API scopes
// every read and write to that member's account.
export async function proxyMemberPropertyApi(request: Request, options: { permission?: Permission } = {}) {
  if (!["GET", "HEAD"].includes(request.method) && !workspaceMutationAllowed(request)) {
    return error(403, "Same-origin request required");
  }
  const configuration = workspaceSessionConfiguration();
  if (!configuration.configured) return error(503, "Accounts are not configured on this workspace");
  const session = readWorkspaceSession(request);
  if (session.authenticated) {
    const isRead = ["GET", "HEAD"].includes(request.method);
    const requiredPermission = options.permission ?? (isRead ? "canViewWorkspace" : "canManageHunts");
    if (!hasPermission(session.role, requiredPermission)) {
      return error(403, `Forbidden: ${requiredPermission} permission is required`, {
        code: "PERMISSION_DENIED",
        role: session.role,
      });
    }
    return proxyPropertyApi(request, { operatorToken: configuration.credential });
  }
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
  const session = configuration.configured ? readWorkspaceSession(request) : null;
  if (configuration.configured && session?.authenticated) {
    if (!hasPermission(session.role, "canManageHunts")) {
      if (!["GET", "HEAD"].includes(request.method)) {
        return error(403, "Forbidden: canManageHunts permission is required", {
          code: "PERMISSION_DENIED",
          role: session.role,
        });
      }
      // Read-only viewer sessions stay isolated from operator watchlist credentials.
      return proxyPropertyApi(request);
    }
    return proxyPropertyApi(request, { operatorToken: configuration.credential });
  }
  const member = configuration.configured ? await currentMember(request) : null;
  if (member?.entitled) return proxyPropertyApi(request, { operatorToken: configuration.credential, accountId: member.id });
  return proxyPropertyApi(request);
}

