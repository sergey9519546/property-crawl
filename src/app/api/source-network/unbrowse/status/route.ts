import { proxyPrivatePropertyApi } from "@/lib/workspace-proxy";

// Operator-only Unbrowse install diagnostics. Never executes Unbrowse.
export const GET = (request: Request) => proxyPrivatePropertyApi(request);
