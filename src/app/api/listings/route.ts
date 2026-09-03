import { adapt } from "@/lib/next-adapter";
import handleListings from "@/lib/server-routes/listings";

export const GET = adapt(handleListings, { securityHeaders: true, cors: true });
export const POST = GET;
