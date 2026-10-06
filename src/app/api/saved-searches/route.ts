import { proxyPrivatePropertyApi } from "@/lib/workspace-proxy";

// The saved-searches handlers live in the `[...path]` catch-all, which in the
// App Router does NOT match the bare segment - a catch-all needs at least one
// segment. The client lists and creates through `/api/saved-searches` with no
// trailing path, so every one of those calls 404'd and the whole feature was
// unreachable from the modal. Same proxy, same verbs, one more entry point.
export const GET = (request: Request) => proxyPrivatePropertyApi(request);
export const POST = GET;
export const PATCH = GET;
export const DELETE = GET;