import { adapt } from "@/lib/next-adapter";
import handleParse from "@/lib/server-routes/parse";

export const POST = adapt(handleParse, { securityHeaders: true, cors: true });
export const GET = POST;
