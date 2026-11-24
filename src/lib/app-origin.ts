import serverOrigin from "../../server/app-origin.js";

function parseSafeOrigin(
  raw: unknown,
  { requireHttps }: { requireHttps: boolean },
): string | null {
  const trimmed = String(raw || "").trim();
  if (!trimmed || trimmed.includes("*")) return null;
  try {
    const parsed = new URL(trimmed);
    if (!parsed.hostname || parsed.origin === "null") return null;
    if (parsed.username || parsed.password) return null;
    if (requireHttps) {
      if (parsed.protocol !== "https:") return null;
    } else if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
}

// Safe public origin for email sign-in links and Stripe return/cancel URLs.
// In production this must come from PUBLIC_APP_ORIGIN (or a validated https://
// NEXT_PUBLIC_APP_URL fallback) so proxy or attacker Host headers cannot
// redirect victims or members onto a wrong origin.
export function appOrigin(
  request: Request,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const isProduction = env.NODE_ENV === "production";
  const configured = parseSafeOrigin(env.PUBLIC_APP_ORIGIN, { requireHttps: false });
  if (configured) return configured;

  const fallback = parseSafeOrigin(env.NEXT_PUBLIC_APP_URL, { requireHttps: isProduction });
  if (fallback) return fallback;

  if (isProduction) return null;
  try {
    return new URL(request.url).origin;
  } catch {
    return null;
  }
}

export const DEFAULT_CANONICAL_ORIGIN: string = serverOrigin.DEFAULT_CANONICAL_ORIGIN;
export const DEFAULT_APP_HOST: string = serverOrigin.DEFAULT_APP_HOST;
export const DEFAULT_ALERTS_FROM: string = serverOrigin.DEFAULT_ALERTS_FROM;

export function getCanonicalOrigin(explicitOrigin?: string | null): string {
  return serverOrigin.getCanonicalOrigin(explicitOrigin);
}
