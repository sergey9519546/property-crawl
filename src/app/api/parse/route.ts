import { proxyPrivatePropertyApi } from "@/lib/workspace-proxy";

export const POST = (request: Request) => proxyPrivatePropertyApi(request);