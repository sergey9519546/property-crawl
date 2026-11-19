import { proxyPropertyApi } from "@/lib/property-api";

export const maxDuration = 60;

// Public analytics surface (no workspace auth required on server).
// We still proxy so the Next app can reach the Node API uniformly in all envs.
export const GET = (request: Request) => proxyPropertyApi(request);
