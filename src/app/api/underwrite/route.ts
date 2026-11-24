import { proxyPropertyApi } from "@/lib/property-api";

export const maxDuration = 60;

export const POST = (request: Request) => proxyPropertyApi(request);
