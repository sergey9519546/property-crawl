import { proxyPrivatePropertyApi } from "@/lib/workspace-proxy";

// Operator-only Unbrowse route-candidate intake. Validates then hands off to source intake.
export const GET = (request: Request) => proxyPrivatePropertyApi(request);
export const POST = (request: Request) => proxyPrivatePropertyApi(request);
