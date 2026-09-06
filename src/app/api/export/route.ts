import { proxyPropertyApi } from "@/lib/property-api";
import { proxyPrivatePropertyApi } from "@/lib/workspace-proxy";

export const GET = (request: Request) => {
  const query = new URL(request.url).searchParams;
  return query.get("saved") === "true" || query.has("userId") || request.headers.has("x-user-id")
    ? proxyPrivatePropertyApi(request) : proxyPropertyApi(request);
};
