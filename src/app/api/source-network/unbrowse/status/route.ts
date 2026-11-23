import { proxyPrivatePropertyApi } from "@/lib/workspace-proxy";

export const maxDuration = 60;

// Operator-only Unbrowse install diagnostics. Never executes Unbrowse.
export const GET = (request: Request) => proxyPrivatePropertyApi(request);
