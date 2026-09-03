import { adapt } from "@/lib/next-adapter";
import handleEnrich from "@/lib/server-routes/enrich";

export const POST = adapt(handleEnrich, { securityHeaders: true, cors: true });
export const GET = POST;
