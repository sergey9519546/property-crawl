import { proxyPrivatePropertyApi } from "@/lib/workspace-proxy";

export const maxDuration = 60;

export async function POST(request: Request) {
  return proxyPrivatePropertyApi(request);
}
