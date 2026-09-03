import { adapt } from "@/lib/next-adapter";
import handleVerifyDocket from "@/lib/server-routes/verify-docket";

export const POST = adapt(handleVerifyDocket, { securityHeaders: true, cors: true });
export const GET = POST;
