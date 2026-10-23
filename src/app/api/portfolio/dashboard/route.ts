import { proxyMemberPropertyApi } from "@/lib/workspace-proxy";

export const GET = (request: Request) => proxyMemberPropertyApi(request);
