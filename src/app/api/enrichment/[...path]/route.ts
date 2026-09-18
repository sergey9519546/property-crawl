import { proxyPrivatePropertyApi } from "@/lib/workspace-proxy";

// Enrichment reads parcel-linked evidence; refresh mutates operator state.
export const GET = (request: Request) => proxyPrivatePropertyApi(request);
export const POST = (request: Request) => proxyPrivatePropertyApi(request);
