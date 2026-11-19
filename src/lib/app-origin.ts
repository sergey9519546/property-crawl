import serverOrigin from "../../server/app-origin.js";

// Safe public origin for email sign-in links and Stripe return/cancel URLs.
// In production this must come from PUBLIC_APP_ORIGIN so proxy or attacker
// Host headers cannot redirect victims or members onto a wrong origin.
export function appOrigin(request: Request): string | null {
  const configured = String(process.env.PUBLIC_APP_ORIGIN || "").trim().replace(/\/$/, "");
  if (configured) return configured;
  return process.env.NODE_ENV === "production" ? null : new URL(request.url).origin;
}

export const DEFAULT_CANONICAL_ORIGIN: string = serverOrigin.DEFAULT_CANONICAL_ORIGIN;
export const DEFAULT_APP_HOST: string = serverOrigin.DEFAULT_APP_HOST;
export const DEFAULT_ALERTS_FROM: string = serverOrigin.DEFAULT_ALERTS_FROM;

export function getCanonicalOrigin(explicitOrigin?: string | null): string {
  return serverOrigin.getCanonicalOrigin(explicitOrigin);
}
