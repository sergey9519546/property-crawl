type RecordIdentity = { id: string };

type InventoryResult<T> = { listings: T[]; total: number; truncated: boolean };

// How long a settled load is reused before a fresh one is started. Long enough
// for the components on the same page to share one pass, short enough that a
// refresh is never showing yesterday's inventory.
const SHARED_WINDOW_MS = 20_000;

// The hero and the grid both load the whole inventory on mount, and the
// inventory is ~10,000 records over 10 sequential pages. Without sharing, the
// home page fetched all of it twice and nothing on the page was usable - not
// even the hero's market suggestions - until both passes finished.
//
// Keyed on the fetch implementation so a caller supplying its own fetch (tests,
// isolated runs) never receives another implementation's result.
const shared = new WeakMap<typeof fetch, { result: Promise<InventoryResult<any>>; settledAt: number }>();

// Load every bounded API page before replacing the visible inventory. A failed
// refresh must not silently replace an already useful feed with demo records.
async function loadPages<T extends RecordIdentity>(fetchImpl: typeof fetch, signal?: AbortSignal): Promise<InventoryResult<T>> {
  const records = new Map<string, T>();
  const pageSize = 1000;
  const maxPages = 10;
  let total = 0;
  let offset = 0;
  for (let page = 0; page < maxPages; page++) {
    const response = await fetchImpl(`/api/listings?limit=${pageSize}&offset=${offset}`, {
      cache: "no-store", signal: signal || AbortSignal.timeout(15_000),
    });
    const payload = await response.json();
    if (!response.ok || !Array.isArray(payload?.listings)) throw new Error("Inventory could not be refreshed. Your last loaded records are retained.");
    total = Number.isSafeInteger(payload.total) && payload.total >= 0 ? payload.total : payload.listings.length;
    for (const record of payload.listings) {
      if (!record || typeof record.id !== "string" || !record.id) throw new Error("Invalid inventory record");
      records.set(record.id, record as T);
    }
    offset += payload.listings.length;
    if (offset >= total) return { listings: [...records.values()], total, truncated: false };
    if (!payload.listings.length) throw new Error("Inventory changed during pagination. Refresh to retry.");
  }
  return { listings: [...records.values()], total, truncated: true };
}

export async function loadListingInventory<T extends RecordIdentity>(
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
  options: { forceRefresh?: boolean } = {},
) {
  const existing = shared.get(fetchImpl);
  if (!options.forceRefresh && existing && Date.now() - existing.settledAt < SHARED_WINDOW_MS) {
    return existing.result as Promise<InventoryResult<T>>;
  }
  const result = loadPages<T>(fetchImpl, signal).then((value) => {
    shared.set(fetchImpl, { result: Promise.resolve(value), settledAt: Date.now() });
    return value;
  });
  if (!options.forceRefresh) {
    // Publish the in-flight promise so a concurrent second caller joins this
    // pass instead of starting its own. The stamp is "now", not zero: the
    // freshness check below reads it, and zero would read as long expired.
    shared.set(fetchImpl, { result, settledAt: Date.now() });
  }
  // A rejected pass must not be shared: the next caller has to be able to try
  // again rather than inherit the failure for the rest of the window.
  return result.catch((error) => {
    if (shared.get(fetchImpl)?.result === result) shared.delete(fetchImpl);
    throw error;
  }) as unknown as Promise<InventoryResult<T>>;
}