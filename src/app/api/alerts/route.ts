import { proxyPrivatePropertyApi } from "@/lib/workspace-proxy";

export const GET = (request: Request) => proxyPrivatePropertyApi(request);
export const POST = GET;
export const DELETE = GET;
