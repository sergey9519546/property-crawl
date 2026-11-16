import { proxyPrivatePropertyApi } from "@/lib/workspace-proxy";

export async function POST(request: Request) {
  return proxyPrivatePropertyApi(request);
}
