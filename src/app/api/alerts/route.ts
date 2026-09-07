import { proxyWatchlistPropertyApi } from "@/lib/workspace-proxy";

export const GET = (request: Request) => proxyWatchlistPropertyApi(request);
export const POST = GET;
export const DELETE = GET;
