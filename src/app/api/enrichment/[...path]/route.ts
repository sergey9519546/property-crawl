import { proxyPropertyApi } from "@/lib/property-api";
import { proxyPrivatePropertyApi } from "@/lib/workspace-proxy";

// Enrichment reads are public on the Node API (server/routes/enrichment.js);
// refresh triggers outbound adapter requests and requires an operator session.
export const GET = (request: Request) => proxyPropertyApi(request);
export const POST = (request: Request) => proxyPrivatePropertyApi(request);
