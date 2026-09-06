import { proxyPropertyApi } from "@/lib/property-api";

// Readiness reflects the listing backend, never an unrelated local snapshot.
export const GET = (request: Request) => proxyPropertyApi(request);
