type CachedHealth = {
  promise: Promise<Record<string, unknown>>;
  fetchedAt: number;
};

const HEALTH_TTL_MS = 5_000;
let cachedHealth: CachedHealth | null = null;

/**
 * Share a single in-flight / short-TTL /api/health probe across components mounted
 * on the same page (SocialProof, DataModeBanner) without caching failures.
 */
export function fetchHealthSnapshot(forceRefresh = false): Promise<Record<string, unknown>> {
  const now = Date.now();
  if (!forceRefresh && cachedHealth && now - cachedHealth.fetchedAt < HEALTH_TTL_MS) {
    return cachedHealth.promise;
  }
  const promise = fetch("/api/health", { cache: "no-store", credentials: "same-origin" })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`health ${r.status}`))))
    .then((data) => {
      if (cachedHealth?.promise === promise) {
        cachedHealth.fetchedAt = Date.now();
      }
      return data as Record<string, unknown>;
    })
    .catch((err) => {
      if (cachedHealth?.promise === promise) cachedHealth = null;
      throw err;
    });
  cachedHealth = { promise, fetchedAt: now };
  return promise;
}
