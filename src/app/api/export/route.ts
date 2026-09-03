import { adapt } from "@/lib/next-adapter";
import handleExport from "@/lib/server-routes/export";

export const GET = adapt(handleExport, { securityHeaders: true, cors: true });
export const POST = GET;
