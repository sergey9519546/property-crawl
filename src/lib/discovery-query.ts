export type DiscoveryFilters = {
  q?: string; state?: string; county?: string; source?: string; type?: string;
  program?: string; lifecycle?: string; saleFrom?: string; saleTo?: string;
  maxBid?: string; occupancy?: string; freshness?: string; hasDocuments?: string;
  minScore?: string; minEquity?: string; seniorLien?: string; redemption?: string;
  sort?: string; view?: string;
};

const keys = ["q", "state", "county", "source", "type", "program", "lifecycle", "saleFrom", "saleTo", "maxBid", "minScore", "minEquity", "occupancy", "freshness", "hasDocuments", "seniorLien", "redemption", "sort", "view"] as const;

export function readDiscoveryFilters(params: URLSearchParams): DiscoveryFilters {
  const result: DiscoveryFilters = {};
  for (const key of keys) {
    const value = params.get(key);
    if (value) result[key] = value;
  }
  return result;
}

export function discoverySearchParams(filters: DiscoveryFilters, extras: Record<string, string | number | boolean | undefined> = {}) {
  const params = new URLSearchParams();
  for (const key of keys) {
    const value = filters[key];
    if (value && !(key === "view" && value === "grid")) params.set(key, value);
  }
  for (const [key, value] of Object.entries(extras)) if (value !== undefined && value !== "" && value !== false) params.set(key, String(value));
  return params;
}

export function discoveryUrl(filters: DiscoveryFilters) {
  const query = discoverySearchParams(filters).toString();
  return query ? `/listings?${query}` : "/listings";
}
