import { adapt } from "@/lib/next-adapter";
import handleScrapers from "@/lib/server-routes/scrapers";

export const GET = adapt(handleScrapers, { securityHeaders: true, cors: true });
export const POST = GET;
