import { proxyPropertyApi } from "@/lib/property-api";

// Public analytics surface (single-neighborhood and nested lookup paths).
export const GET = (request: Request) => proxyPropertyApi(request);
