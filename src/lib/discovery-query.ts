export type DiscoveryFilters = {
  q?: string; state?: string; county?: string; source?: string; type?: string;
  program?: string; lifecycle?: string; saleFrom?: string; saleTo?: string;
  maxBid?: string; occupancy?: string; freshness?: string; hasDocuments?: string;
  minScore?: string; minEquity?: string; seniorLien?: string; redemption?: string;
  distressStage?: string; minQuality?: string;
  sort?: string; view?: string;
};

const keys = ["q", "state", "county", "source", "type", "program", "lifecycle", "saleFrom", "saleTo", "maxBid", "minScore", "minEquity", "occupancy", "freshness", "hasDocuments", "seniorLien", "redemption", "distressStage", "minQuality", "sort", "view"] as const;

// The server is the authority for this vocabulary; this mirrors it and must not
// invent values. server/discovery/query.js raises a 400 for an unrecognised
// freshness, hasDocuments or sort value, and its matcher and SQL builder only
// branch on a fixed set of seniorLien and redemption values. A bookmarked or
// hand-edited URL can carry a value this build no longer sends, so an
// unrecognised value is dropped and the filter degrades to "no filter" instead
// of turning the results page into an error.
//
// Values are matched exactly after trimming, because the server folds case only
// for `freshness`; an exact test can never be more permissive than the server.
// Absent on purpose: state/county/source/type/program/lifecycle/occupancy are
// facet values derived from the data and so have no enumerable vocabulary,
// `view` is client-only UI state the server never reads, and distressStage and
// minQuality are not parsed by the discovery query at all.
export const DISCOVERY_FILTER_VALUES = Object.freeze({
  freshness: Object.freeze(["all", "observed", "unverified"]),
  hasDocuments: Object.freeze(["true", "false", "unknown"]),
  sort: Object.freeze(["score", "quality", "opportunity", "date", "bid-asc", "equity", "bid"]),
  seniorLien: Object.freeze(["all", "clean", "risk"]),
  redemption: Object.freeze(["all", "immediate", "redemption_active"]),
});

const acceptedValues: Readonly<Record<string, readonly string[]>> = DISCOVERY_FILTER_VALUES;

function acceptsValue(key: string, value: string) {
  const allowed = acceptedValues[key];
  return allowed ? allowed.includes(value.trim()) : true;
}

export function readDiscoveryFilters(params: URLSearchParams): DiscoveryFilters {
  const result: DiscoveryFilters = {};
  for (const key of keys) {
    const value = params.get(key);
    if (value && acceptsValue(key, value)) result[key] = value;
  }
  return result;
}

export function discoverySearchParams(filters: DiscoveryFilters, extras: Record<string, string | number | boolean | undefined> = {}) {
  const params = new URLSearchParams();
  for (const key of keys) {
    const value = filters[key];
    if (value && acceptsValue(key, value) && !(key === "view" && value === "grid")) params.set(key, value);
  }
  for (const [key, value] of Object.entries(extras)) if (value !== undefined && value !== "" && value !== false) params.set(key, String(value));
  return params;
}

export function discoveryUrl(filters: DiscoveryFilters) {
  const query = discoverySearchParams(filters).toString();
  return query ? `/listings?${query}` : "/listings";
}
