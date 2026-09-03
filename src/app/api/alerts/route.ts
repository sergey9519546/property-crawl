import { adapt } from "@/lib/next-adapter";
import handleAlerts from "@/lib/server-routes/alerts";

export const GET = adapt(handleAlerts, { securityHeaders: true, cors: true });
export const POST = GET;
export const DELETE = GET;
