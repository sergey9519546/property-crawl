/**
 * Shared terminal filter/view store.
 * Pure reducer + selectors so grid and map always consume one source of truth.
 * Pattern follows the Redux tutorials in build-your-own-x: immutable state,
 * pure updates, derived data computed from state + inventory only.
 *
 * Keep this module free of `@/` and `@server` imports so Node tests can load it.
 */

export type TerminalSort = "score" | "equity" | "bid" | "date" | "images";
export type TerminalView = "grid" | "map" | "parser";

export type TerminalFilters = {
  searchQuery: string;
  selectedState: string;
  selectedSource: string;
  observedOnly: boolean;
  sortBy: TerminalSort;
  minDealScore: number;
  minEquity: number;
  maxOpeningBid: number | null;
  propertyType: string;
  occupancy: string;
  seniorLienFilter: string;
  redemptionFilter: string;
  activeView: TerminalView;
};

export type FilterableListing = {
  id: string;
  source: string;
  state: string;
  county?: string | null;
  city?: string | null;
  zip?: string | null;
  address: string;
  propType?: string | null;
  occupancy?: string | null;
  openingBid?: number | null;
  equity?: number | null;
  dealScore?: number | null;
  saleDate?: string | null;
  plaintiff?: string | null;
  defendant?: string | null;
  attorney?: string | null;
  redemptionDays?: number | null;
  seniorLienRisk?: string;
  images?: string[] | null;
};

function knownNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

export const DEFAULT_TERMINAL_FILTERS: TerminalFilters = {
  searchQuery: "",
  selectedState: "all",
  selectedSource: "all",
  observedOnly: false,
  sortBy: "date",
  minDealScore: 0,
  minEquity: 0,
  maxOpeningBid: null,
  propertyType: "all",
  occupancy: "all",
  seniorLienFilter: "all",
  redemptionFilter: "all",
  activeView: "grid",
};

export type TerminalFilterAction =
  | { type: "patch"; patch: Partial<TerminalFilters> }
  | { type: "set"; key: keyof TerminalFilters; value: TerminalFilters[keyof TerminalFilters] }
  | { type: "toggleObservedOnly" }
  | { type: "setView"; view: TerminalView }
  | { type: "setSearch"; query: string; view?: TerminalView }
  | { type: "toggleMinDealScore"; score: number }
  | { type: "resetFilters" }
  | { type: "hydrateFromSearch"; search: string }
  | { type: "applySavedSearch"; patch: Partial<TerminalFilters> };

export function terminalFilterReducer(
  state: TerminalFilters,
  action: TerminalFilterAction,
): TerminalFilters {
  switch (action.type) {
    case "patch":
      return { ...state, ...action.patch };
    case "set":
      return { ...state, [action.key]: action.value };
    case "toggleObservedOnly":
      return { ...state, observedOnly: !state.observedOnly };
    case "setView":
      return state.activeView === action.view ? state : { ...state, activeView: action.view };
    case "setSearch": {
      const view = action.view ?? state.activeView;
      if (state.searchQuery === action.query && state.activeView === view) return state;
      return { ...state, searchQuery: action.query, activeView: view };
    }
    case "toggleMinDealScore":
      return {
        ...state,
        minDealScore: state.minDealScore === action.score ? 0 : action.score,
      };
    case "resetFilters":
      return { ...DEFAULT_TERMINAL_FILTERS, activeView: state.activeView };
    case "hydrateFromSearch":
      return parseTerminalQuery(action.search, state);
    case "applySavedSearch":
      return { ...state, ...action.patch, activeView: "grid" };
    default:
      return state;
  }
}

export function createTerminalFilterStore(initial?: Partial<TerminalFilters>) {
  return { ...DEFAULT_TERMINAL_FILTERS, ...initial };
}

export function terminalQuery(filters: TerminalFilters): string {
  const params = new URLSearchParams();
  if (filters.searchQuery) params.set("q", filters.searchQuery);
  if (filters.selectedState !== "all") params.set("state", filters.selectedState);
  if (filters.selectedSource !== "all") params.set("source", filters.selectedSource);
  if (filters.observedOnly) params.set("observed", "1");
  if (filters.sortBy !== "date") params.set("sort", filters.sortBy);
  if (filters.minDealScore > 0) params.set("minScore", String(filters.minDealScore));
  if (filters.minEquity > 0) params.set("minSpread", String(filters.minEquity));
  if (filters.maxOpeningBid !== null) params.set("maxBid", String(filters.maxOpeningBid));
  if (filters.propertyType !== "all") params.set("type", filters.propertyType);
  if (filters.occupancy !== "all") params.set("occupancy", filters.occupancy);
  if (filters.seniorLienFilter !== "all") params.set("lien", filters.seniorLienFilter);
  if (filters.redemptionFilter !== "all") params.set("redemption", filters.redemptionFilter);
  if (filters.activeView !== "grid") params.set("view", filters.activeView);
  return params.toString();
}

const SORT_VALUES: TerminalSort[] = ["score", "equity", "bid", "date", "images"];
const VIEW_VALUES: TerminalView[] = ["grid", "map", "parser"];

function numberParam(params: URLSearchParams, name: string): number {
  const value = Number(params.get(name));
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

export function parseTerminalQuery(
  search: string,
  fallback: TerminalFilters = DEFAULT_TERMINAL_FILTERS,
): TerminalFilters {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const sort = params.get("sort");
  const view = params.get("view");
  return {
    searchQuery: params.get("q") || "",
    selectedState: params.get("state") || "all",
    selectedSource: params.get("source") || "all",
    observedOnly: params.get("observed") === "1",
    sortBy: sort && SORT_VALUES.includes(sort as TerminalSort) ? (sort as TerminalSort) : fallback.sortBy,
    minDealScore: numberParam(params, "minScore"),
    minEquity: numberParam(params, "minSpread"),
    maxOpeningBid: params.has("maxBid") ? numberParam(params, "maxBid") : null,
    propertyType: params.get("type") || "all",
    occupancy: params.get("occupancy") || "all",
    seniorLienFilter: params.get("lien") || "all",
    redemptionFilter: params.get("redemption") || "all",
    activeView: view && VIEW_VALUES.includes(view as TerminalView) ? (view as TerminalView) : fallback.activeView,
  };
}

export function countActiveFilters(filters: TerminalFilters): number {
  return (
    (filters.observedOnly ? 1 : 0) +
    (filters.searchQuery ? 1 : 0) +
    (filters.selectedState !== "all" ? 1 : 0) +
    (filters.selectedSource !== "all" ? 1 : 0) +
    (filters.minDealScore > 0 ? 1 : 0) +
    (filters.minEquity > 0 ? 1 : 0) +
    (filters.maxOpeningBid !== null ? 1 : 0) +
    (filters.propertyType !== "all" ? 1 : 0) +
    (filters.occupancy !== "all" ? 1 : 0) +
    (filters.seniorLienFilter !== "all" ? 1 : 0) +
    (filters.redemptionFilter !== "all" ? 1 : 0)
  );
}

export type ExactSearchField = "county" | "city" | "state" | "zip";

export function findExactSearchField<T extends FilterableListing>(
  inventory: T[],
  searchQuery: string,
): ExactSearchField | undefined {
  const normalizedQuery = searchQuery.toLowerCase().trim();
  if (!normalizedQuery) return undefined;
  return (["county", "city", "state", "zip"] as const).find((field) =>
    inventory.some((item) => {
      const value = item[field];
      return typeof value === "string" && value.toLowerCase() === normalizedQuery;
    }),
  );
}

function compareKnown(a: number | null, b: number | null, direction: "asc" | "desc"): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return direction === "asc" ? a - b : b - a;
}

function parsedDate(value: string | null | undefined): number | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function deadlineOrder(value: string | null | undefined): { bucket: number; value: number } {
  const timestamp = parsedDate(value);
  if (timestamp === null) return { bucket: 1, value: Number.MAX_SAFE_INTEGER };
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  if (timestamp >= startOfToday.getTime()) return { bucket: 0, value: timestamp };
  return { bucket: 2, value: -timestamp };
}

export function listingMatchesFilters<T extends FilterableListing>(
  listing: T,
  filters: TerminalFilters,
  options: {
    exactSearchField?: ExactSearchField | undefined;
    isObserved?: (listing: T) => boolean;
  } = {},
): boolean {
  if (filters.observedOnly && options.isObserved && !options.isObserved(listing)) return false;
  if (filters.selectedState !== "all" && listing.state !== filters.selectedState) return false;
  if (filters.selectedSource !== "all" && listing.source !== filters.selectedSource) return false;

  const dealScore = knownNumber(listing.dealScore);
  const equity = knownNumber(listing.equity);
  const openingBid = knownNumber(listing.openingBid);
  if (filters.minDealScore > 0 && (dealScore === null || dealScore < filters.minDealScore)) return false;
  if (filters.minEquity > 0 && (equity === null || equity < filters.minEquity)) return false;
  if (filters.maxOpeningBid !== null && (openingBid === null || openingBid > filters.maxOpeningBid)) return false;
  if (filters.propertyType !== "all" && listing.propType?.toLowerCase() !== filters.propertyType.toLowerCase()) {
    return false;
  }
  if (filters.occupancy !== "all" && listing.occupancy?.toLowerCase() !== filters.occupancy.toLowerCase()) {
    return false;
  }
  if (filters.seniorLienFilter === "clean" && listing.seniorLienRisk !== "low") return false;
  if (filters.seniorLienFilter === "risk" && listing.seniorLienRisk !== "high") return false;
  if (filters.redemptionFilter === "immediate" && listing.redemptionDays !== 0) return false;
  if (filters.redemptionFilter === "redemption_active" && (!listing.redemptionDays || listing.redemptionDays === 0)) {
    return false;
  }

  if (filters.searchQuery.trim()) {
    const q = filters.searchQuery.toLowerCase().trim();
    if (options.exactSearchField) {
      const exact = listing[options.exactSearchField];
      return typeof exact === "string" && exact.toLowerCase() === q;
    }
    const hay = [listing.address, listing.city, listing.county, listing.state, listing.zip, listing.plaintiff, listing.defendant, listing.attorney]
      .join(" ")
      .toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

export function sortListings<T extends FilterableListing>(listings: T[], sortBy: TerminalSort): T[] {
  const filtered = [...listings];
  if (sortBy === "equity") {
    filtered.sort((a, b) => compareKnown(knownNumber(a.equity), knownNumber(b.equity), "desc"));
  } else if (sortBy === "bid") {
    filtered.sort((a, b) => compareKnown(knownNumber(a.openingBid), knownNumber(b.openingBid), "asc"));
  } else if (sortBy === "date") {
    filtered.sort((a, b) => {
      const left = deadlineOrder(a.saleDate);
      const right = deadlineOrder(b.saleDate);
      return left.bucket - right.bucket || left.value - right.value || a.id.localeCompare(b.id);
    });
  } else if (sortBy === "images") {
    filtered.sort((a, b) => (b.images?.length || 0) - (a.images?.length || 0));
  } else {
    filtered.sort((a, b) => compareKnown(knownNumber(a.dealScore), knownNumber(b.dealScore), "desc"));
  }
  return filtered;
}

export function selectFilteredListings<T extends FilterableListing>(
  inventory: T[],
  filters: TerminalFilters,
  options: {
    isObserved?: (listing: T) => boolean;
  } = {},
): T[] {
  const exactSearchField = findExactSearchField(inventory, filters.searchQuery);
  const matched = inventory.filter((listing) =>
    listingMatchesFilters(listing, filters, { exactSearchField, isObserved: options.isObserved }),
  );
  return sortListings(matched, filters.sortBy);
}
