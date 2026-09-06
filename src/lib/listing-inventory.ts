type RecordIdentity = { id: string };

// Load every bounded API page before replacing the visible inventory. A failed
// refresh must not silently replace an already useful feed with demo records.
export async function loadListingInventory<T extends RecordIdentity>(fetchImpl: typeof fetch = fetch, signal?: AbortSignal) {
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
