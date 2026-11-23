import { proxyMemberPropertyApi, proxyPrivatePropertyApi } from "@/lib/workspace-proxy";

function dispatchWorkspaceProxy(request: Request, method: "GET" | "POST" | "PATCH" | "DELETE") {
  try {
    const pathname = new URL(request.url).pathname;
    if (pathname.startsWith("/api/workspace/cases")) {
      return proxyMemberPropertyApi(request, {
        permission: method === "GET" ? "canViewWorkspace" : "canManageHunts",
      });
    }
  } catch {
    // Fall through to private operator proxy
  }
  return proxyPrivatePropertyApi(request);
}

export const GET = (request: Request) => dispatchWorkspaceProxy(request, "GET");
export const POST = (request: Request) => dispatchWorkspaceProxy(request, "POST");
export const PATCH = (request: Request) => dispatchWorkspaceProxy(request, "PATCH");
export const DELETE = (request: Request) => dispatchWorkspaceProxy(request, "DELETE");

