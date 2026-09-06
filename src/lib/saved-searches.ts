export type SavedSearch = { id: string; name: string; state: string; minScore: number; maxBid: number; createdAt: string };

export function matchesSavedSearch(listing: { state?: string; dealScore?: number | null; openingBid?: number | null }, search: SavedSearch) {
  if (search.state !== "All" && listing.state !== search.state) return false;
  if (search.minScore > 0 && (typeof listing.dealScore !== "number" || !Number.isFinite(listing.dealScore) || listing.dealScore < search.minScore)) return false;
  if (search.maxBid > 0 && (typeof listing.openingBid !== "number" || !Number.isFinite(listing.openingBid) || listing.openingBid > search.maxBid)) return false;
  return true;
}

export function parseSavedSearches(raw: string | null): SavedSearch[] {
  if (!raw || raw.length > 128_000) return [];
  try {
    const value = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value.filter((item) => item && typeof item.id === "string" && item.id.length <= 100
      && typeof item.name === "string" && item.name.length <= 80
      && typeof item.state === "string" && /^(All|[A-Z]{2})$/.test(item.state)
      && Number.isFinite(item.minScore) && item.minScore >= 0 && item.minScore <= 100
      && Number.isFinite(item.maxBid) && item.maxBid >= 0 && item.maxBid <= 50_000_000
      && typeof item.createdAt === "string").slice(0, 50);
  } catch { return []; }
}
