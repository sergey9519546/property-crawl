// server/media/provider-cache.js
//
// Tiny TTL cache for imagery-provider lookups. The point is to dedupe
// concurrent requests for the same point and to avoid burning a per-request
// upstream call when a route has been hit seconds earlier. This is NOT a
// durable cache and not meant to replace persistence — it lives in process
// memory and is wiped on restart, on purpose, so cache poisoning from a
// transient upstream error cannot survive across deploys.
//
// Key shape: `${provider}:${latBucket}:${lngBucket}:${radius}`. Bucketing
// rounds lat/lng to 5 decimal places (~1 m precision) so neighbouring
// requests from the same listing collapse into the same bucket even when
// the geocoder returned a sub-meter jitter.
//
// Each entry stores:
//   { value, expiresAt }
// where expiresAt is a millisecond timestamp. Lookup returns the cached
// value only if expiresAt > now; otherwise the entry is considered stale
// and removed on access.
//
// The module is dependency-free; tests inject `now` and `ttlMs` so we can
// drive time without timers.

const DEFAULT_TTL_MS = 60 * 1000; // 1 minute
const DEFAULT_BUCKET_DIGITS = 5;
const DEFAULT_MAX_ENTRIES = 1000;

function bucket(value, digits) {
  const factor = 10 ** digits;
  return String(Math.round(value * factor) / factor);
}

function buildKey({ provider, lat, lng, radius, digits = DEFAULT_BUCKET_DIGITS }) {
  return `${provider}:${bucket(lat, digits)}:${bucket(lng, digits)}:${radius}`;
}

function createProviderCache({
  ttlMs = DEFAULT_TTL_MS,
  now = () => Date.now(),
  maxEntries = DEFAULT_MAX_ENTRIES,
  clock = { now }
} = {}) {
  const entries = new Map();

  function get(key) {
    const entry = entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= clock.now()) {
      entries.delete(key);
      return undefined;
    }
    // Re-insert to refresh LRU order; cheap because Map preserves insertion
    // order and the lookup is O(1).
    entries.delete(key);
    entries.set(key, entry);
    return entry.value;
  }

  function set(key, value) {
    if (entries.size >= maxEntries) {
      // Drop the oldest entry; Map iteration order is insertion order, so
      // the first key returned is the least recently touched.
      const oldest = entries.keys().next().value;
      if (oldest !== undefined) entries.delete(oldest);
    }
    entries.set(key, { value, expiresAt: clock.now() + ttlMs });
  }

  function delete_(key) {
    entries.delete(key);
  }

  function clear() {
    entries.clear();
  }

  function stats() {
    let live = 0;
    let expired = 0;
    const nowMs = clock.now();
    for (const entry of entries.values()) {
      if (entry.expiresAt > nowMs) live += 1;
      else expired += 1;
    }
    return { total: entries.size, live, expired, maxEntries, ttlMs };
  }

  function getOrLoad(key, loader) {
    const hit = get(key);
    if (hit !== undefined) return hit;
    const value = loader();
    set(key, value);
    return value;
  }

  return { get, set, delete: delete_, clear, stats, getOrLoad, buildKey };
}

module.exports = {
  DEFAULT_TTL_MS,
  DEFAULT_BUCKET_DIGITS,
  DEFAULT_MAX_ENTRIES,
  bucket,
  buildKey,
  createProviderCache
};
