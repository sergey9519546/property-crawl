import { proxyPrivatePropertyApi } from "@/lib/workspace-proxy";

export const dynamic = "force-dynamic";

export const GET = (request: Request) => proxyPrivatePropertyApi(request, { permission: "canExportDossier" });
export const POST = (request: Request) => proxyPrivatePropertyApi(request, { permission: "canExportDossier" });
