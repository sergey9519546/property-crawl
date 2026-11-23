import { proxyPrivatePropertyApi } from "@/lib/workspace-proxy";

export const maxDuration = 60;

export const dynamic = "force-dynamic";

// Operator-only Unbrowse route-candidate intake. Validates then hands off to source intake.
export const POST = (request: Request) => proxyPrivatePropertyApi(request);
