import { adapt } from "@/lib/next-adapter";
import handleParcelBoundary from "@/lib/server-routes/parcel-boundary";

export const POST = adapt(handleParcelBoundary, { securityHeaders: true, cors: true });
export const GET = POST;
