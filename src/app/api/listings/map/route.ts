import { proxyPropertyApi } from "@/lib/property-api";

/**
 * Viewport bounded GeoJSON discovery endpoint. The canonical API performs
 * clustering; this route intentionally contains no map or catalog fallback.
 */
export const GET = (request: Request) => proxyPropertyApi(request);
