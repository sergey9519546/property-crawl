import { extractClientIp, type ClientIpRequest } from "./workspace-unlock-limiter";

/**
 * Best-effort client IP for Next.js route handlers.
 *
 * With `TRUSTED_PROXY_COUNT > 0` we parse `X-Forwarded-For` from the right, taking
 * the address at position `length - TRUSTED_PROXY_COUNT` — the client address
 * as seen by the innermost trusted proxy. When `TRUSTED_PROXY_COUNT` is unset or 0,
 * forwarded headers are never trusted; we use `socket.remoteAddress` if present
 * and otherwise fall back to `'unknown'`.
 */
export function getClientIp(
  request: ClientIpRequest,
  env: Record<string, string | undefined> = process.env,
): string {
  return extractClientIp(request, env);
}

export function rateLimitKey(
  kind: string,
  request: ClientIpRequest,
  extra?: string,
  env: Record<string, string | undefined> = process.env,
): string {
  const ip = getClientIp(request, env);
  return extra ? `form:${kind}:${ip}:${extra}` : `form:${kind}:${ip}`;
}
