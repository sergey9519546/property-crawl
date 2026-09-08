export type WorkspaceUnlockDecision = { allowed: boolean; retryAfterSeconds: number };

type WorkspaceUnlockState = { failures: number; resetAt: number };

export class WorkspaceUnlockLimiter {
  private readonly attempts = new Map<string, WorkspaceUnlockState>();
  private readonly maxFailures: number;
  private readonly windowMs: number;
  private readonly now: () => number;

  constructor(maxFailures = 8, windowMs = 60_000, now: () => number = Date.now) {
    this.maxFailures = maxFailures;
    this.windowMs = windowMs;
    this.now = now;
  }

  check(bucket = "global"): WorkspaceUnlockDecision {
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

  recordFailure(bucket = "global") {
    const timestamp = this.now();
    const current = this.attempts.get(bucket);
    const state = !current || timestamp >= current.resetAt
      ? { failures: 0, resetAt: timestamp + this.windowMs }
      : current;
    state.failures += 1;
    this.attempts.set(bucket, state);
  }

  reset(bucket = "global") {
    this.attempts.delete(bucket);
  }
}

// A Web Request does not expose a trustworthy socket address. Forwarded IP
// headers are caller-controlled unless a deployment proxy guarantees otherwise,
// so the default limiter intentionally uses one bounded workspace-wide bucket.
export function workspaceUnlockBucket(_request: Request) {
  return "global";
}

export const workspaceUnlockLimiter = new WorkspaceUnlockLimiter();