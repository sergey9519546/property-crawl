import { proxyPropertyApi } from "@/lib/property-api";

export const dynamic = "force-dynamic";

export const GET = (request: Request) => proxyPropertyApi(request);
export const POST = (request: Request) => proxyPropertyApi(request);
