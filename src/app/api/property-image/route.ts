import { proxyPropertyApi } from "@/lib/property-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return proxyPropertyApi(request);
}
