export type MarketSuggestion = {
  id: string;
  label: string;
  query: string;
  kind: "address" | "city" | "county" | "state" | "area" | "country";
  description: string;
};

export type ListingMarket = {
  id: string;
  address?: string | null;
  city?: string | null;
  county?: string | null;
  state?: string | null;
  zip?: string | null;
};

export const STATE_NAMES: Record<string, string> = {
  AK: "Alaska",
  AL: "Alabama",
  AR: "Arkansas",
  AZ: "Arizona",
  CA: "California",
  CO: "Colorado",
  CT: "Connecticut",
  DC: "District of Columbia",
  DE: "Delaware",
  FL: "Florida",
  GA: "Georgia",
  HI: "Hawaii",
  IA: "Iowa",
  ID: "Idaho",
  IL: "Illinois",
  IN: "Indiana",
  KS: "Kansas",
  KY: "Kentucky",
  LA: "Louisiana",
  MA: "Massachusetts",
  MD: "Maryland",
  ME: "Maine",
  MI: "Michigan",
  MN: "Minnesota",
  MO: "Missouri",
  MS: "Mississippi",
  MT: "Montana",
  NC: "North Carolina",
  ND: "North Dakota",
  NE: "Nebraska",
  NH: "New Hampshire",
  NJ: "New Jersey",
  NM: "New Mexico",
  NV: "Nevada",
  NY: "New York",
  OH: "Ohio",
  OK: "Oklahoma",
  OR: "Oregon",
  PA: "Pennsylvania",
  PR: "Puerto Rico",
  RI: "Rhode Island",
  SC: "South Carolina",
  SD: "South Dakota",
  TN: "Tennessee",
  TX: "Texas",
  UT: "Utah",
  VA: "Virginia",
  VT: "Vermont",
  WA: "Washington",
  WI: "Wisconsin",
  WV: "West Virginia",
  WY: "Wyoming",
};

const KIND_ORDER: MarketSuggestion["kind"][] = [
  "city",
  "county",
  "state",
  "area",
  "address",
  "country",
];

function cleanField(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Merges incoming catalog rows into suggestion cache without duplicating ids. */
export function mergeMarketListings(prev: ListingMarket[], incoming: ListingMarket[]): ListingMarket[] {
  const seen = new Set(prev.map((item) => item.id));
  const additions = incoming.filter((item) => item?.id && !seen.has(item.id));
  return additions.length > 0 ? [...prev, ...additions] : prev;
}

/** Builds normalized market and address autocomplete suggestions across static US states and loaded listings. */
export function buildMarketSuggestions(
  rawQuery: string,
  marketListings: ListingMarket[],
  limit = 8,
): MarketSuggestion[] {
  const trimmed = cleanField(rawQuery);
  if (trimmed.length < 2 || /^https?:\/\//i.test(trimmed)) {
    return [];
  }

  const normalizedQuery = trimmed.toLowerCase();
  const markets = new Map<string, MarketSuggestion>();

  markets.set("country:united states", {
    id: "country:US",
    label: "United States",
    query: "",
    kind: "country",
    description: "Country coverage",
  });

  // Seed all US state/territory entries statically so queries like "New Jer" or
  // "NJ" resolve immediately even before /api/listings autocomplete responds.
  for (const [code, name] of Object.entries(STATE_NAMES)) {
    markets.set(`state:${name.toLowerCase()}`, {
      id: `state:${code}`,
      label: name,
      query: code,
      kind: "state",
      description: "State",
    });
  }

  for (const listing of marketListings) {
    if (!listing || !listing.id) continue;
    const address = cleanField(listing.address);
    const city = cleanField(listing.city);
    const countyRaw = cleanField(listing.county);
    const countyBase = countyRaw.replace(/\s+county\s*$/i, "").trim();
    const state = cleanField(listing.state).toUpperCase();
    const zip = cleanField(listing.zip);

    const suggestionsForListing: MarketSuggestion[] = [];
    if (address) {
      suggestionsForListing.push({
        id: `address:${listing.id}`,
        label: address,
        query: city || address,
        kind: "address",
        description: city ? `Address nearby ${city}` : "Property address",
      });
    }
    if (city && state) {
      suggestionsForListing.push({
        id: `city:${city}:${state}`,
        label: `${city}, ${state}`,
        query: city,
        kind: "city",
        description: "City market",
      });
    }
    if (countyBase && state) {
      // Publishers are inconsistent: some send "Camden", others "Bergen County".
      suggestionsForListing.push({
        id: `county:${countyRaw}:${state}`,
        label: `${countyBase} County, ${state}`,
        query: countyRaw,
        kind: "county",
        description: "County market",
      });
    }
    if (state) {
      const stateName = STATE_NAMES[state] || state;
      suggestionsForListing.push({
        id: `state:${state}`,
        label: stateName,
        query: state,
        kind: "state",
        description: "State",
      });
    }
    if (city && /^\d{5}$/.test(zip) && zip !== "00000") {
      suggestionsForListing.push({
        id: `area:${zip}:${city}`,
        label: `${zip} \u2014 ${city} area`,
        query: zip,
        kind: "area",
        description: "ZIP area",
      });
    }

    for (const suggestion of suggestionsForListing) {
      if (!suggestion.label || !suggestion.query || /\b(?:unknown|undefined|null)\b/i.test(suggestion.label)) {
        continue;
      }
      // Dedupe on normalized label so publisher case variations ("HADDON TOWNSHIP"
      // vs "Haddon Township") collapse to a single market option.
      markets.set(`${suggestion.kind}:${suggestion.label.toLowerCase()}`, suggestion);
    }
  }

  return Array.from(markets.values())
    .filter((market) =>
      market.label.toLowerCase().includes(normalizedQuery) ||
      (market.kind === "state" && normalizedQuery.length === 2 && market.query.toLowerCase() === normalizedQuery),
    )
    .sort((a, b) => {
      const aStarts = a.label.toLowerCase().startsWith(normalizedQuery) ? 0 : 1;
      const bStarts = b.label.toLowerCase().startsWith(normalizedQuery) ? 0 : 1;
      return aStarts - bStarts || KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.label.localeCompare(b.label);
    })
    .slice(0, limit);
}
