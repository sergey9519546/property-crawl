import { proxyPrivatePropertyApi } from "@/lib/workspace-proxy";
import { proxyPropertyApi } from "@/lib/property-api";

export async function GET(request: Request) {
  return proxyPropertyApi(request);
}

export async function POST(request: Request) {
  return proxyPrivatePropertyApi(request);
}
