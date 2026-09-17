import { proxyPrivatePropertyApi } from "@/lib/workspace-proxy";

// Public analytics surface (no workspace auth required on server).
// We still proxy so the Next app can reach the Node API uniformly in all envs.
export const GET = (request: Request) => proxyPrivatePropertyApi(request);
