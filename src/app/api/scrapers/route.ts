import { proxyPrivatePropertyApi } from "@/lib/workspace-proxy";
import { proxyPropertyApi } from "@/lib/property-api";

// Public telemetry only. Mutations require the operator workspace session so
// a leaked browser token is not enough to trigger collection from this origin.
export async function GET(request: Request) {
  return proxyPropertyApi(request);
}

export async function POST(request: Request) {
  const token = request.headers.get("x-scraper-token") || request.headers.get("authorization");
  if (token) return proxyPropertyApi(request);
  return proxyPrivatePropertyApi(request);
}
