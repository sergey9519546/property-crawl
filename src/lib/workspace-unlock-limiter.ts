export type WorkspaceUnlockDecision = { allowed: boolean; retryAfterSeconds: number };

type WorkspaceUnlockState = { failures: number; resetAt: number };

export type ClientIpRequest =
  | Request
  | {
      headers?: Headers | Record<string, string | string[] | undefined>;
      socket?: { remoteAddress?: string | null };
    };

function readHeader(request: ClientIpRequest, name: string): string {
  const headers = request?.headers;
  if (!headers) return "";
  if (typeof (headers as Headers).get === "function") {
    return String((headers as Headers).get(name) || "");
  }
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(headers as Record<string, unknown>)) {
    if (key.toLowerCase() !== target) continue;
    if (Array.isArray(value)) return String(value[0] || "");
    return String(value || "");
  }
  return "";
}

function normalizeIp(raw: unknown): string {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return "";
  const mappedV4 = trimmed.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  return mappedV4 ? mappedV4[1] : trimmed;
}

/**
 * Resolve the client IP safely without trusting caller-controlled forwarding headers
 * unless `TRUSTED_PROXY_COUNT > 0`. Falls back to `socket.remoteAddress` when
 * available, and otherwise `"unknown"`.
 */
export function extractClientIp(
  request: ClientIpRequest,
  env: Record<string, string | undefined> = process.env,
): string {
  const count = Math.max(0, Math.floor(Number(env?.TRUSTED_PROXY_COUNT || 0) || 0));
  if (count > 0) {
    const forwarded = readHeader(request, "x-forwarded-for")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const idx = forwarded.length - count;
    if (idx >= 0 && forwarded[idx]) {
      const resolved = normalizeIp(forwarded[idx]);
      if (resolved) return resolved;
    }
  }
  const socketIp = normalizeIp(
    (request as { socket?: { remoteAddress?: string | null } } | null | undefined)?.socket?.remoteAddress,
  );
  return socketIp || "unknown";
}

export class WorkspaceUnlockLimiter {
  private readonly attempts = new Map<string, WorkspaceUnlockState>();
  private readonly maxFailures: number;
  private readonly windowMs: number;
  private readonly now: () => number;
  private readonly maxEntries: number;

  constructor(maxFailures = 5, windowMs = 5 * 60_000, now: () => number = Date.now, maxEntries = 10_000) {
    this.maxFailures = maxFailures;
    this.windowMs = windowMs;
    this.now = now;
    this.maxEntries = maxEntries;
  }

  private pruneExpired(timestamp: number) {
    for (const [key, state] of this.attempts) {
      if (timestamp >= state.resetAt) this.attempts.delete(key);
    }
  }

  check(bucket = "ip:unknown"): WorkspaceUnlockDecision {
    const timestamp = this.now();
    const state = this.attempts.get(bucket);
    if (!state || timestamp >= state.resetAt) {
      if (state) this.attempts.delete(bucket);
      return { allowed: true, retryAfterSeconds: 0 };
    }
    return state.failures >= this.maxFailures
      ? { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((state.resetAt - timestamp) / 1000)) }
      : { allowed: true, retryAfterSeconds: 0 };
  }

  recordFailure(bucket = "ip:unknown") {
    const timestamp = this.now();
    const current = this.attempts.get(bucket);
    if (!current && this.attempts.size >= this.maxEntries) {
      this.pruneExpired(timestamp);
      if (this.attempts.size >= this.maxEntries) {
        const oldestKey = this.attempts.keys().next().value;
        if (oldestKey !== undefined) this.attempts.delete(oldestKey);
      }
    }
    const state = !current || timestamp >= current.resetAt
      ? { failures: 0, resetAt: timestamp + this.windowMs }
      : current;
    state.failures += 1;
    // Refresh insertion order for bounded LRU eviction.
    this.attempts.delete(bucket);
    this.attempts.set(bucket, state);
  }

  reset(bucket = "ip:unknown") {
    this.attempts.delete(bucket);
  }
}

/**
 * Key unlock failures by validated client IP (`ip:<addr>`). Untrusted forwarding
 * headers and arbitrary client headers (e.g. `x-unlock-sid`) are ignored unless
 * `TRUSTED_PROXY_COUNT > 0`, collapsing unresolvable requests into `ip:unknown`
 * so attackers cannot mint unlimited buckets to brute-force operator secrets.
 */
export function workspaceUnlockBucket(
  request: ClientIpRequest,
  env: Record<string, string | undefined> = process.env,
): string {
  return `ip:${extractClientIp(request, env)}`;
}

export const workspaceUnlockLimiter = new WorkspaceUnlockLimiter();
