/**
 * Best-effort client IP for Next.js route handlers.
 *
 * A Next `Request` does not expose `socket.remoteAddress`, so without a
 * configured trusted edge we cannot identify a per-caller address and fall
 * back to a single shared bucket (the pre-existing behaviour). With
 * `TRUSTED_PROXY_COUNT > 0` we parse `X-Forwarded-For` from the right, taking
 * the address at position `length - TRUSTED_PROXY_COUNT` — the client address
 * as seen by the innermost trusted proxy. Forwarded headers are caller
 * controlled, so they are never trusted unless a count is configured.
 */
export function getClientIp(request: Request): string {
  const count = Math.max(0, Math.floor(Number(process.env.TRUSTED_PROXY_COUNT || 0) || 0));
  if (count > 0) {
    const forwarded = String(request.headers.get('x-forwarded-for') || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const idx = forwarded.length - count;
    return (idx >= 0 && forwarded[idx]) || 'unknown';
  }
  return 'unknown';
}

export function rateLimitKey(kind: string, request: Request, extra?: string): string {
  const ip = getClientIp(request);
  return extra ? `form:${kind}:${ip}:${extra}` : `form:${kind}:${ip}`;
}
