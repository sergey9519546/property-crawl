import { proxyPropertyApi } from "@/lib/property-api";

export const POST = (request: Request) => proxyPropertyApi(request);
export const GET = POST;
