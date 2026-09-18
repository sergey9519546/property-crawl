const buckets = new Map<string, { count: number; resetAt: number }>();

export type FormRateDecision = { allowed: boolean; retryAfterSeconds: number };

function prune(now: number) {
  if (buckets.size < 200) return;
  for (const [key, record] of buckets) {
    if (now > record.resetAt) buckets.delete(key);
  }
}

/** Shared in-memory ceiling for unauthenticated marketing form posts. */
export function checkFormRateLimit(
  kind: "contact" | "newsletter",
  options: { maxPerWindow?: number; windowMs?: number; now?: number } = {},
): FormRateDecision {
  const now = options.now ?? Date.now();
  const max = options.maxPerWindow ?? (kind === "contact" ? 8 : 12);
  const windowMs = options.windowMs ?? 10 * 60_000;
  prune(now);
  const key = `form:${kind}`;
  const current = buckets.get(key);
  const state = !current || now > current.resetAt ? { count: 0, resetAt: now + windowMs } : current;
  if (state.count >= max) {
    buckets.set(key, state);
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((state.resetAt - now) / 1000)) };
  }
  state.count += 1;
  buckets.set(key, state);
  return { allowed: true, retryAfterSeconds: 0 };
}

export function _resetFormRateLimitsForTests() {
  buckets.clear();
}
