import { proxyPropertyApi } from "@/lib/property-api";

export const maxDuration = 60;

// Public analytics surface (single-neighborhood and nested lookup paths).
export const GET = (request: Request) => proxyPropertyApi(request);
