const inflight = new Map<string, Promise<any | null>>();
const resolved = new Map<string, any | null>();
const MAX_ENTRIES = 64;

function prune() {
  if (resolved.size <= MAX_ENTRIES) return;
  const oldest = resolved.keys().next().value;
  if (oldest !== undefined) resolved.delete(oldest);
}

/**
 * Shared client-side cache for `/api/parcel-boundary` lookups so
 * `ListingMedia` and `Parcel3DVisualizer` on the same detail page do not fire
 * duplicate requests for the same parcel.
 */
export async function fetchParcelBoundaryCached(
  url: string,
  cacheKey: string,
): Promise<any | null> {
  if (resolved.has(cacheKey)) {
    return resolved.get(cacheKey) ?? null;
  }
  const existing = inflight.get(cacheKey);
  if (existing) return existing;

  const promise = fetch(url)
    .then(async (res) => {
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        return { __error: body?.error || `HTTP ${res.status}`, __status: res.status };
      }
      return body;
    })
    .then((data) => {
      inflight.delete(cacheKey);
      resolved.set(cacheKey, data);
      prune();
      return data;
    })
    .catch((err) => {
      inflight.delete(cacheKey);
      throw err;
    });

  inflight.set(cacheKey, promise);
  return promise;
}
