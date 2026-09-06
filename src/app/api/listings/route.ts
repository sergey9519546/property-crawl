import { proxyPropertyApi } from "@/lib/property-api";

// Listing ingestion happens inside the scraper scheduler through the database
// layer. The public HTTP surface is deliberately read-only so an unauthenticated
// caller cannot manufacture records that later appear to be source-backed.
export const GET = (request: Request) => proxyPropertyApi(request);
