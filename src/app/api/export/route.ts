import { proxyMemberPropertyApi, proxyPrivatePropertyApi } from "@/lib/workspace-proxy";

// Export of a member's own saved watchlist (?saved=true) is available to paid
// members and workspace operators; unfiltered discovery exports remain operator-only.
export const GET = (request: Request) => {
  const isSavedOnly = new URL(request.url).searchParams.get("saved") === "true";
  return isSavedOnly
    ? proxyMemberPropertyApi(request, { permission: "canExportDossier" })
    : proxyPrivatePropertyApi(request);
};
