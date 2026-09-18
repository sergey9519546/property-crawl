import { proxyPrivatePropertyApi } from "@/lib/workspace-proxy";

// Document review is operator-only on the listing API.
export const GET = (request: Request) => proxyPrivatePropertyApi(request);
export const POST = (request: Request) => proxyPrivatePropertyApi(request);
