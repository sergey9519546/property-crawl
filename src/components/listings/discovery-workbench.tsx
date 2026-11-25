"use client";

import Link from "next/link";
import * as React from "react";
import {
  Bookmark,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  FileText,
  Filter,
  ListFilter,
  Loader2,
  Map as MapIcon,
  RefreshCw,
  Search,
  ShieldAlert,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useWorkspaceSession } from "@/components/workspace/workspace-shell";
import { DiscoveryCard } from "@/components/listings/discovery-card";
import { CompareTray, useCompareSelection } from "@/components/listings/listing-compare";
import { COMPARE_LIMIT } from "@/lib/compare-selection.js";
import { DiscoveryMap } from "@/components/listings/discovery-map";
import { TriageChips } from "@/components/listings/triage-chips";
import { SaveSearchButton } from "@/components/hunts/save-search-button";
import {
  SOURCES,
  type PropertyListing,
} from "@/components/terminal/property-data";
import {
  displayDate,
  displayMoney,
} from "@/lib/listing-display";
import {
  getAuctionCalendar,
  getNeighborhoodDetail,
  listNeighborhoods,
  calendarDatedTotal,
  type AuctionCalendarResponse,
  type NeighborhoodBucket,
  type NeighborhoodDetailResponse,
  type NeighborhoodsResponse,
} from "@/lib/intelligence-client";
import {
  discoverySearchParams,
  discoveryUrl,
  readDiscoveryFilters,
  type DiscoveryFilters,
} from "@/lib/discovery-query";
import { sourceDisplayText } from "@/lib/source-display";
import { summarizeInventoryHonesty } from "@/lib/inventory-honesty";
import { useLocale } from "@/components/i18n/locale-provider";
import { localizeDisplayDate } from "@/lib/i18n/domain";
import { formatLocaleNumber } from "@/lib/i18n/translator";

type Facet = { value: string; count: number };
export type DiscoveryPayload = {
  listings: PropertyListing[];
  total: number;
  revision?: string;
  page?: { nextCursor?: string | null; hasMore?: boolean };
  facets?: Record<string, Facet[]>;
  intelligence?: {
    sort?: string | null;
    minQuality?: number;
    note?: string;
    /** Server-declared: `total` counts this page, not the whole search. */
    totalIsPageScoped?: boolean;
    pageScope?: { evaluated: number; matched: number };
  };
  error?: string;
};
type Payload = DiscoveryPayload;
const defaults: Record<string, string> = {
  state: "All states",
  county: "All counties",
  source: "All sources",
  type: "All property types",
  program: "All programs",
  lifecycle: "Any sale status",
  occupancy: "Any occupancy",
  freshness: "Any freshness",
  distressStage: "All sale types",
};
const filterLabels: Record<string, string> = {
  q: "Search", state: "State", county: "County", source: "Source", type: "Property type",
  program: "Program", lifecycle: "Sale status", occupancy: "Occupancy", freshness: "Freshness",
  saleFrom: "From", saleTo: "Until", maxBid: "Max opening bid", minScore: "Min Deal Score",
  minEquity: "Min equity (value minus bid)", hasDocuments: "Documents", hasPhoto: "Photos", seniorLien: "Senior lien", redemption: "Redemption period",
  distressStage: "Sale type", minQuality: "Min listing detail", enrolledOnly: "Assessor corridor",
};
// The search box owns the text being typed. While it lived in
// DiscoveryWorkbench, every keystroke re-rendered the whole workbench and
// therefore every result card on it. Typing a query meant re-deriving the
// address, score band, number formatting and date formatting for all 48 cards
// already on screen, to update one input.
//
// `q` and `onSearch` are both stable between searches, so this component
// re-renders alone while the parent stays put.
// The rendered output is unchanged: same elements, same classes, same order.
//
// Measured, production build, full stack, 48 cards on screen, three runs each
// side, swapping only the two files this change touches.
//
// An earlier version of this measurement awaited two requestAnimationFrame
// callbacks per character. That is a 33.4 ms floor PER KEYSTROKE -- 634.6 ms
// across 19 characters, which is the entire time that harness reported. It was
// measuring its own frame waits, not this app. The instrument below dispatches
// every input event in one synchronous loop, so nothing waits for a frame, and
// it verifies itself against a known 120 ms block before reporting.
//
//     before   301 / 305 / 300 ms   mean 302.0   15.9 ms per keystroke
//     after    311 / 335 / 304 ms   mean 316.7   16.7 ms per keystroke
//
// So: no measurable effect. The memoised side is if anything marginally slower,
// which is noise in the unhelpful direction, and 16 ms per keystroke with 48
// cards is the number that actually matters.
//
// That is the honest result, and it is a different claim from the one this
// comment used to make. The sequence of numbers that have been attached to
// this change, in order: "2.2 s of blocking at 108 ms per keystroke" (never
// reproducible, roughly an order of magnitude too high, and measured with a
// harness carrying a 33 ms-per-keystroke floor); then "647 -> 604 ms, about
// 6%" (withdrawn -- measured across two states that differed in more than
// this change); and now this.
//
// Where the ~16 ms goes was checked rather than guessed. Same page, same
// synchronous loop, control-validated:
//
//     TYPE    325 ms   17.09 ms each   value changes, event dispatched
//     NO-OP     0 ms    0.02 ms each   event dispatched, value unchanged
//     BARE      0 ms    0.00 ms each   property write, no event
//
// So it is real work rather than harness overhead -- but it is not the 48
// cards either, since memoizing them changed nothing. It is React committing a
// state update per character, which this harness forces by dispatching
// synthetic events from outside React's own handler and so getting no batching.
// Nobody typing at five characters a second incurs that.
//
// And there is nothing here to optimise regardless: 16 ms is roughly 8x inside
// the 200 ms INP threshold. Written down so the next person does not spend an
// afternoon chasing a number that is already comfortable.
//
// The mechanism is still correct and the code still stays: the draft state is
// no longer in this component, so a keystroke cannot re-derive 48 cards, and
// the cards are memoised on props that are pure functions of the listing. That
// ceiling is real, it is just not what the frame budget is going on here.
const DiscoverySearchField = React.memo(function DiscoverySearchField({
  q,
  onSearch,
}: {
  q?: string;
  onSearch: (draft: string) => void;
}) {
  const { messages: searchMessages } = useLocale();
  const [draft, setDraft] = React.useState(q || "");
  // Re-sync when the committed search changes underneath the box (a filter
  // chip removed, "Clear all"), so the input never shows a stale query.
  React.useEffect(() => setDraft(q || ""), [q]);
  return (
    <form
      className="flex gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        onSearch(draft);
      }}
    >
      <label className="flex min-w-0 flex-1 items-center gap-2 rounded-control border border-line-strong bg-card px-3 focus-within:border-yours focus-within:ring-2 focus-within:ring-yours/20">
        <span className="sr-only">Search properties</span>
        <Search size={17} className="text-ink-3" />
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={searchMessages.listingsUi.searchPlaceholder}
          className="min-w-0 flex-1 bg-transparent py-3 text-sm outline-none focus-visible:shadow-none"
        />
      </label>
      <button type="submit" className="rounded-xl bg-ink px-5 py-3 text-sm font-bold text-white">{searchMessages.listingsUi.searchBtn}</button>
    </form>
  );
});
export function DiscoveryWorkbench({ initialPayload = null }: { initialPayload?: DiscoveryPayload | null }) {
  const { locale, intlLocale, messages: m, format } = useLocale();
  const lUi = m.listingsUi;
  const localizedDefaults: Record<string, string> = locale === "en" ? defaults : {
    state: lUi.allStates,
    county: lUi.allCounties,
    source: lUi.allSources,
    type: lUi.allPropTypes,
    program: lUi.allPrograms,
    lifecycle: lUi.anySaleStatus,
    occupancy: lUi.anyOccupancy,
    freshness: lUi.anyFreshness,
    distressStage: lUi.allSaleTypes,
  };
  const localizedFilterLabels: Record<string, string> = locale === "en" ? filterLabels : {
    ...filterLabels,
    q: lUi.searchBtn,
    type: m.detailUi.typeLabel,
    maxBid: lUi.openingAmountLabel,
    hasDocuments: lUi.documentsLabel,
    distressStage: lUi.allSaleTypes,
  };
  const router = useRouter();
  const session = useWorkspaceSession();
  const pathname = usePathname();
  const search = useSearchParams();
  const filters = React.useMemo(
    () => readDiscoveryFilters(new URLSearchParams(search.toString())),
    [search],
  );
  const queryKey = discoverySearchParams(filters).toString();
  const [loadedResult, setLoadedResult] = React.useState<{ key: string; payload: Payload } | null>(null);
  const [loading, setLoading] = React.useState(initialPayload == null);
  const [error, setError] = React.useState("");
  const [cursorStack, setCursorStack] = React.useState<string[]>([]);
  const [paging, setPaging] = React.useState<{ key: string; cursor?: string }>({ key: queryKey });
  const cursor = paging.key === queryKey ? paging.cursor : undefined;
  const setCursor = React.useCallback((value?: string) => setPaging({ key: queryKey, cursor: value }), [queryKey]);
  const requestKey = `${queryKey}\n${cursor || ""}`;
  // The server already loaded this URL. Keep those rows in the first HTML
  // response, including a county filter, before the browser refetch lands.
  const payload = loadedResult?.key === requestKey ? loadedResult.payload : loadedResult ? null : initialPayload;

  const compare = useCompareSelection();
  const compareLabels = React.useMemo(() => {
    const labels: Record<string, string> = {};
    for (const listing of payload?.listings ?? []) {
      if (typeof listing?.id === "string" && listing.address) labels[listing.id] = listing.address;
    }
    return labels;
  }, [payload]);
  const [saved, setSaved] = React.useState<Set<string>>(new Set());
  // `saved` is read inside toggleSaved, which must keep a stable identity so
  // that memoized cards are not re-rendered by an unrelated state change.
  // The ref carries the current value; the state drives the chips.
  const savedRef = React.useRef(saved);
  savedRef.current = saved;
  const [moreFiltersOpen, setMoreFiltersOpen] = React.useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = React.useState(false);
  const moreMenuRef = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    if (!moreMenuOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (moreMenuRef.current && !moreMenuRef.current.contains(event.target as Node)) {
        setMoreMenuOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMoreMenuOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [moreMenuOpen]);
  const [showSavedOnly, setShowSavedOnly] = React.useState(false);
  const [watchlistListings, setWatchlistListings] = React.useState<PropertyListing[] | null>(null);
  const [watchlistLoading, setWatchlistLoading] = React.useState(false);

  const watchlistFilterKey = React.useMemo(
    () => discoverySearchParams({ ...filters, view: undefined }).toString(),
    [filters],
  );
  const watchlistFiltersRef = React.useRef(filters);
  watchlistFiltersRef.current = filters;

  React.useEffect(() => {
    if (!showSavedOnly) {
      setWatchlistListings(null);
      setWatchlistLoading(false);
      return;
    }
    const activeFilters = watchlistFiltersRef.current;
    const savedIds = Array.from(saved).slice(0, 100);
    if (savedIds.length === 0) {
      setWatchlistListings([]);
      setWatchlistLoading(false);
      return;
    }
    const controller = new AbortController();
    let active = true;
    setWatchlistLoading(true);

    const matchesActiveFilters = (listing: PropertyListing) => {
      if (activeFilters.state && String(listing.state || "").toUpperCase() !== activeFilters.state.toUpperCase()) return false;
      if (activeFilters.county && !String(listing.county || "").toLowerCase().includes(activeFilters.county.toLowerCase())) return false;
      if (activeFilters.source && String(listing.source || "").toLowerCase() !== activeFilters.source.toLowerCase()) return false;
      if (activeFilters.type && String(listing.propType || "").toLowerCase() !== activeFilters.type.toLowerCase()) return false;
      if (activeFilters.program && activeFilters.program !== "all" && String(listing.program || listing.auctionProgram || "").toLowerCase() !== activeFilters.program.toLowerCase()) return false;
      if (activeFilters.lifecycle && activeFilters.lifecycle !== "all" && String(listing.lifecycle || listing.lifecycleStatus || "").toLowerCase() !== activeFilters.lifecycle.toLowerCase()) return false;
      if (activeFilters.occupancy && activeFilters.occupancy !== "all" && String(listing.occupancy || "").toLowerCase() !== activeFilters.occupancy.toLowerCase()) return false;
      if (activeFilters.hasDocuments === "true" && listing.hasDocuments !== true && !listing.triage?.hasDocs) return false;
      if (activeFilters.hasDocuments === "false" && listing.hasDocuments !== false) return false;
      if (activeFilters.hasDocuments === "unknown" && listing.hasDocuments !== null && listing.hasDocuments !== undefined) return false;
      if (activeFilters.hasPhoto === "true" && !listing.photo && !(Array.isArray(listing.images) && listing.images.length > 0)) return false;
      if (activeFilters.hasPhoto === "false" && (listing.photo || (Array.isArray(listing.images) && listing.images.length > 0))) return false;
      if (activeFilters.maxBid && Number(activeFilters.maxBid) > 0) {
        if (typeof listing.openingBid !== "number" || listing.openingBid > Number(activeFilters.maxBid)) return false;
      }
      if (activeFilters.minScore && Number(activeFilters.minScore) > 0) {
        if (typeof listing.dealScore !== "number" || listing.dealScore < Number(activeFilters.minScore)) return false;
      }
      if (activeFilters.minEquity && Number(activeFilters.minEquity) > 0) {
        if (typeof listing.equity !== "number" || listing.equity < Number(activeFilters.minEquity)) return false;
      }
      if (activeFilters.saleFrom && (!listing.saleDate || listing.saleDate < activeFilters.saleFrom)) return false;
      if (activeFilters.saleTo && (!listing.saleDate || listing.saleDate > activeFilters.saleTo)) return false;
      if (activeFilters.distressStage && activeFilters.distressStage !== "all" && (listing.triage?.distressStage || "unknown") !== activeFilters.distressStage) return false;
      if (activeFilters.isNew === "true" && !listing.triage?.isNew) return false;
      if (activeFilters.priceDropped === "true" && !listing.triage?.priceDropped) return false;
      if (activeFilters.occupancyKnown === "true" && !listing.triage?.occupancyKnown) return false;
      if (activeFilters.enrolledOnly === "true" && !(listing as PropertyListing & { enrolledAssessor?: boolean }).enrolledAssessor) return false;
      if (activeFilters.enrolledOnly === "false" && (listing as PropertyListing & { enrolledAssessor?: boolean }).enrolledAssessor) return false;
      if (activeFilters.stale === "true") {
        const isStale = listing.sourceFreshness?.status
          ? listing.sourceFreshness.status === "stale"
          : Boolean((listing.triage?.staleDays ?? 0) > 30);
        if (!isStale) return false;
      }
      if (activeFilters.q) {
        const hay = `${listing.id} ${listing.address || ""} ${listing.city || ""} ${listing.county || ""} ${listing.state || ""} ${listing.zip || ""}`.toLowerCase();
        if (!hay.includes(activeFilters.q.toLowerCase())) return false;
      }
      return true;
    };

    const loadWatchlist = async () => {
      try {
        const params = discoverySearchParams(activeFilters, {
          limit: Math.max(48, Math.min(200, savedIds.length)),
          facets: "state,county,source,type,program,lifecycle,occupancy,freshness",
        });
        params.delete("view");
        params.set("ids", savedIds.join(","));
        const res = await fetch(`/api/listings?${params.toString()}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const data = (await res.json().catch(() => null)) as Payload | null;
        if (!active || controller.signal.aborted) return;

        const returned = Array.isArray(data?.listings) ? data.listings : [];
        const byId = new Map<string, PropertyListing>();
        for (const item of returned) {
          if (item && typeof item.id === "string" && saved.has(item.id)) {
            byId.set(item.id, item);
          }
        }
        // When the backend ignores `ids=` (returns non-watchlist rows or more pages exist), hydrate missing saved IDs directly.
        const ignoredIdsParam =
          returned.some((item) => item && typeof item.id === "string" && !saved.has(item.id))
          || (Boolean(data?.page?.hasMore) && savedIds.some((id) => !byId.has(id)));
        const missingIds = savedIds.filter((id) => !byId.has(id));
        if (ignoredIdsParam && missingIds.length > 0) {
          for (let i = 0; i < missingIds.length; i += 6) {
            if (!active || controller.signal.aborted) break;
            const chunk = missingIds.slice(i, i + 6);
            const resolved = await Promise.all(
              chunk.map(async (id) => {
                try {
                  const itemRes = await fetch(`/api/listings/${encodeURIComponent(id)}`, {
                    cache: "no-store",
                    signal: controller.signal,
                  });
                  if (!itemRes.ok) return null;
                  const itemData = await itemRes.json();
                  return itemData && typeof itemData.id === "string" ? (itemData as PropertyListing) : null;
                } catch {
                  return null;
                }
              }),
            );
            for (const item of resolved) {
              if (item && matchesActiveFilters(item)) {
                byId.set(item.id, item);
              }
            }
          }
        }
        if (res.ok && data && Array.isArray(data.listings)) {
          setWatchlistListings(Array.from(byId.values()));
        }
      } catch {
        // Retain current page filtering on transient failure
      } finally {
        if (active) setWatchlistLoading(false);
      }
    };

    void loadWatchlist();
    return () => {
      active = false;
      controller.abort();
    };
  }, [showSavedOnly, saved, watchlistFilterKey]);
  const requestRef = React.useRef<{ controller: AbortController; id: number } | null>(null);
  const pendingSaves = React.useRef(new Set<string>());
  const [savingIds, setSavingIds] = React.useState<Set<string>>(new Set());
  const [watchlistError, setWatchlistError] = React.useState("");
  const triageFilters = React.useMemo(
    () => ({
      isNew: filters.isNew === "true",
      priceDropped: filters.priceDropped === "true",
      hasDocs: filters.hasDocuments === "true",
      stale: filters.stale === "true",
      occupancyKnown: filters.occupancyKnown === "true",
      enrolledOnly: filters.enrolledOnly === "true",
    }),
    [filters.isNew, filters.priceDropped, filters.hasDocuments, filters.stale, filters.occupancyKnown, filters.enrolledOnly],
  );
  React.useEffect(() => setCursorStack([]), [queryKey]);

  const setFilters = React.useCallback(
    (change: Partial<DiscoveryFilters>) => {
      setCursor(undefined);
      setCursorStack([]);
      router.replace(discoveryUrl({ ...filters, ...change }));
    },
    [filters, router, setCursor],
  );
  const refresh = React.useCallback(async () => {
    requestRef.current?.controller.abort();
    const request = { controller: new AbortController(), id: (requestRef.current?.id || 0) + 1 };
    requestRef.current = request;
    setLoading(true);
    setError("");
    try {
      const params = discoverySearchParams(filters, {
        limit: filters.view === "calendar" ? 1000 : 24,
        facets: "state,county,source,type,program,lifecycle,occupancy,freshness",
        cursor,
      });
      const response = await fetch(`/api/listings?${params}`, {
        cache: "no-store",
        signal: request.controller.signal,
      });
      const result = (await response.json()) as Payload;
      if (request.controller.signal.aborted || requestRef.current?.id !== request.id) return;
      if (response.status === 401) {
        session.requestUnlock();
        throw new Error("We couldn't load listings right now. Try again in a minute.");
      }
      if (response.status === 409) {
        setCursor(undefined);
        setCursorStack([]);
        throw new Error(
          "The results changed while you were paging. We refreshed them. Choose Next again.",
        );
      }
      if (!response.ok || !Array.isArray(result.listings))
        throw new Error(
          result.error || "We couldn't load listings right now. Try again in a minute.",
        );
      if (requestRef.current?.id === request.id) setLoadedResult({ key: requestKey, payload: result });
    } catch (caught) {
      if (request.controller.signal.aborted) return;
      setError(
        caught instanceof TypeError
          ? "Property search could not be reached. Try again."
          : caught instanceof Error ? caught.message : "We couldn't load listings right now. Try again in a minute.",
      );
    } finally {
      if (requestRef.current?.id === request.id) setLoading(false);
    }
  }, [filters, cursor, requestKey, setCursor]);
  React.useEffect(() => {
    // Always revalidate on mount so client route state stays live.
    const delay = filters.q ? 250 : 0;
    const timer = window.setTimeout(() => void refresh(), delay);
    return () => {
      window.clearTimeout(timer);
      requestRef.current?.controller.abort();
    };
  }, [refresh, filters.q, filters.view]);
  React.useEffect(() => {
    if (!session.memberTools) {
      const readLocalSaved = () => {
        try {
          const stored = window.localStorage.getItem("perfectproperty:saved-listings");
          const ids = stored ? JSON.parse(stored) : [];
          if (Array.isArray(ids)) {
            setSaved(new Set(ids.filter((id): id is string => typeof id === "string")));
          } else {
            setSaved(new Set());
          }
        } catch {
          setSaved(new Set());
        }
      };
      readLocalSaved();
      setWatchlistError("");
      const onStorage = (event: StorageEvent) => {
        if (event.key === "perfectproperty:saved-listings") readLocalSaved();
      };
      window.addEventListener("storage", onStorage);
      return () => {
        window.removeEventListener("storage", onStorage);
      };
    }
    let active = true;
    // Carry properties saved while signed out into the server watchlist, then
    // drop only the ids the server accepted.
    let localIds: string[] = [];
    try {
      const stored = window.localStorage.getItem("perfectproperty:saved-listings");
      const parsed = stored ? JSON.parse(stored) : [];
      localIds = Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
    } catch {}
    void Promise.all(localIds.map((listingId) =>
      fetch("/api/alerts", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listingId }),
      }).then((response) => (response.ok ? listingId : null), () => null),
    ))
      .then((merged) => {
        const accepted = new Set(merged.filter(Boolean));
        if (accepted.size) {
          try {
            const left = localIds.filter((id) => !accepted.has(id));
            if (left.length) window.localStorage.setItem("perfectproperty:saved-listings", JSON.stringify(left));
            else window.localStorage.removeItem("perfectproperty:saved-listings");
          } catch {}
        }
      })
      .then(() => fetch("/api/alerts", { credentials: "same-origin", cache: "no-store" }))
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok)
          throw new Error(result.error || "We couldn't load your watchlist.");
        const ids = Array.isArray(result.deals)
          ? result.deals
              .map((deal: unknown) =>
                typeof deal === "string"
                  ? deal
                  : (deal as { listingId?: string; id?: string })?.listingId ||
                    (deal as { listingId?: string; id?: string })?.id,
              )
              .filter((id: unknown): id is string => typeof id === "string")
          : [];
        if (active) { setSaved(new Set(ids)); setWatchlistError(""); }
      })
      .catch(() => {
        if (active) {
          if (localIds.length > 0) {
            setSaved((prev) => (prev.size > 0 ? prev : new Set(localIds)));
          }
          setWatchlistError("We couldn't check your saved properties. Your watchlist is unchanged.");
        }
      });
    return () => {
      active = false;
    };
  }, [session.memberTools]);
  // Typed characters are held inside DiscoverySearchField, not here. Holding
  // the draft in this component made every keystroke re-render all 48 result
  // cards (~4,600 nodes) to change one input's value.
  const onSearch = React.useCallback(
    (draft: string) => setFilters({ q: draft.trim() || undefined }),
    [setFilters],
  );
  const toggleSaved = React.useCallback(async (id: string) => {
    const wasSaved = savedRef.current.has(id);
    if (!session.memberTools) {
      try {
        const stored = window.localStorage.getItem("perfectproperty:saved-listings");
        const ids: string[] = stored ? JSON.parse(stored) : [];
        const nextIds = wasSaved ? ids.filter((item) => item !== id) : Array.from(new Set([...ids, id]));
        window.localStorage.setItem("perfectproperty:saved-listings", JSON.stringify(nextIds));
        setSaved((items) => {
          const next = new Set(items);
          wasSaved ? next.delete(id) : next.add(id);
          return next;
        });
        setWatchlistError("");
      } catch {
        setWatchlistError("Your browser is blocking saved properties, so the watchlist was not updated.");
      }
      return;
    }
    if (pendingSaves.current.has(id)) return;
    pendingSaves.current.add(id);
    setSavingIds(new Set(pendingSaves.current));
    setWatchlistError("");
    try {
      const response = await fetch("/api/alerts", {
        method: wasSaved ? "DELETE" : "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listingId: id }),
      });
      const result = await response.json();
      if (response.status === 401) {
        void session.refresh();
        session.requestUnlock();
      }
      if (!response.ok)
        throw new Error(result.error || "We couldn't update your watchlist. Try again.");
      setSaved((items) => {
        const next = new Set(items);
        wasSaved ? next.delete(id) : next.add(id);
        return next;
      });
    } catch (caught) {
      setWatchlistError(
        caught instanceof Error
          ? caught.message
          : "We couldn't update your watchlist. Try again.",
      );
    } finally {
      pendingSaves.current.delete(id);
      setSavingIds(new Set(pendingSaves.current));
    }
  }, [session]);
  const facets = payload?.facets || {};
  const filteredListings = React.useMemo(() => {
    if (!showSavedOnly && !payload?.listings) return [];
    const sourceListings = showSavedOnly && watchlistListings !== null ? watchlistListings : (payload?.listings || []);
    if (!showSavedOnly) return sourceListings;
    return sourceListings.filter((listing) => saved.has(listing.id));
  }, [payload?.listings, watchlistListings, showSavedOnly, saved]);
  const normalizeFacetKey = (field: keyof DiscoveryFilters, value: string) => {
    const trimmed = String(value || "").trim().toLowerCase();
    if (!trimmed || trimmed === "unknown" || (field === "type" && ["n/a", "none", "-"].includes(trimmed))) return "unknown";
    if (field === "county") return trimmed.replace(/\s+(?:county|parish|borough)$/, "").trim() || "unknown";
    if (field === "type" && ["single family", "single-family", "single family residence", "single family residential", "sfr"].includes(trimmed)) {
      return "single family home";
    }
    if (field === "type" && ["multi-family", "multi family dwelling", "multi-family dwelling"].includes(trimmed)) {
      return "multi family";
    }
    if (field === "type" && ["townhouse", "town home", "townhome"].includes(trimmed)) {
      return "town house";
    }
    return trimmed;
  };
  const preferredFacetValue = (field: keyof DiscoveryFilters, raw: string, existing?: string) => {
    const key = normalizeFacetKey(field, raw);
    if (key === "unknown") return "unknown";
    if (field === "type" && key === "single family home") return "Single Family Home";
    if (field === "type" && key === "multi family") return "Multi Family";
    if (field === "type" && key === "town house") return "Town House";
    if (field === "county") {
      const stripped = raw.trim().replace(/\s+(?:county|parish|borough)$/i, "").trim();
      const base = stripped || raw.trim();
      if (existing && !/\b(?:county|parish|borough)$/i.test(existing) && existing !== existing.toUpperCase()) return existing;
      return base;
    }
    if (!existing) return raw.trim();
    const isAllCaps = (text: string) => text.length > 2 && text === text.toUpperCase();
    return isAllCaps(existing) && !isAllCaps(raw.trim()) ? raw.trim() : existing;
  };
  const facetOptions = (field: keyof DiscoveryFilters) => {
    const rawOptions = facets[field] || [];
    const merged = new Map<string, { value: string; count: number | null }>();
    for (const option of rawOptions) {
      const key = normalizeFacetKey(field, option.value);
      const current = merged.get(key);
      const nextCount = typeof option.count === "number" ? option.count : null;
      if (!current) {
        merged.set(key, {
          value: preferredFacetValue(field, option.value),
          count: nextCount,
        });
      } else {
        merged.set(key, {
          value: preferredFacetValue(field, option.value, current.value),
          count: current.count !== null && nextCount !== null ? current.count + nextCount : current.count ?? nextCount,
        });
      }
    }
    const options = Array.from(merged.values()).sort(
      (a, b) => (b.count ?? 0) - (a.count ?? 0) || a.value.localeCompare(b.value),
    );
    const selected = filters[field];
    if (selected && selected !== "all") {
      const selectedKey = normalizeFacetKey(field, selected);
      if (!options.some((option) => normalizeFacetKey(field, option.value) === selectedKey)) {
        return [{ value: selected, count: payload ? 0 : null }, ...options];
      }
    }
    return options;
  };
  const selectedFacetValue = (field: keyof DiscoveryFilters) => {
    const selected = filters[field];
    if (!selected || selected === "all") return "all";
    const key = normalizeFacetKey(field, selected);
    const options = facetOptions(field);
    return options.find((option) => normalizeFacetKey(field, option.value) === key)?.value || selected;
  };
  const hasFilters = Object.entries(filters).some(
    ([key, value]) => key !== "view" && key !== "sort" && value,
  );
  const pageLength = payload?.listings?.length ?? 0;
  // Triage chips (isNew, priceDropped, hasDocuments, stale, occupancyKnown)
  // and distressStage filter server-side across the full catalog; only
  // Saved-watchlist narrowing happens locally on the loaded page.
  const localFilterActive = showSavedOnly;
  // A minimum on a DERIVED field (deal score, bid spread) excludes every record
  // that lacks one. When the inventory carries none, the filter can only ever
  // return nothing, and the empty state has to say so.
  const derivedFloorActive = Boolean(
    (filters.minScore && Number(filters.minScore) > 0)
    || (filters.minEquity && Number(filters.minEquity) > 0),
  );
  // `total` is a whole-search count, except once the post-annotation
  // intelligence view is active (quality/opportunity sort, or any minQuality):
  // there the server reports the length of the page it just built, so the number
  // is a page count wearing the label of a search count. The server now declares
  // this outright; the checks below are the fallbacks for a response that
  // predates the field — its own `intelligence` object first, then the shape a
  // capped total always has (a count no larger than the page carrying it while
  // more pages are still available).
  const totalIsPageScoped = Boolean(
    payload
      && (payload.intelligence?.totalIsPageScoped === true
        || payload.intelligence?.sort
        || (payload.intelligence?.minQuality || 0) > 0
        || (payload.page?.hasMore === true && payload.total <= pageLength)),
  );
  // How many listings the server actually loaded and examined, which is not the
  // same as how many the search holds once ranking/thresholds run after the
  // page is built. Falls back to the page length for a response without the field.
  const evaluated =
    payload?.intelligence?.pageScope?.evaluated ?? pageLength;
  const clearLocalFilters = React.useCallback(() => {
    setShowSavedOnly(false);
    setFilters({
      isNew: undefined,
      priceDropped: undefined,
      hasDocuments: undefined,
      stale: undefined,
      occupancyKnown: undefined,
      distressStage: undefined,
      enrolledOnly: undefined,
    });
  }, [setFilters]);
  const next = () => {
    const n = payload?.page?.nextCursor;
    if (!n) return;
    setCursorStack((items) => [...items, cursor || ""]);
    setCursor(n);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const previous = () => {
    const previousCursor = cursorStack.at(-1);
    setCursorStack((items) => items.slice(0, -1));
    setCursor(previousCursor || undefined);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const selectValue = (field: string, value: string) =>
    setFilters({
      [field]: value === "all" ? undefined : value,
    } as Partial<DiscoveryFilters>);
  const openMapListing = React.useCallback((id: string) =>
    router.push(
      `/listings/${encodeURIComponent(id)}?returnTo=${encodeURIComponent(discoveryUrl(filters))}`,
    ), [router, filters]);
  const exportCurrent = (format: "csv" | "json" = "csv") => {
    if (showSavedOnly) {
      if (!session.memberTools) {
        session.requestUnlock();
        return;
      }
      const params = discoverySearchParams(filters, { format });
      params.set("saved", "true");
      window.location.assign(`/api/export?${params}`);
      return;
    }
    if (!session.authenticated) {
      session.requestUnlock();
      return;
    }
    const params = discoverySearchParams(filters, { format });
    window.location.assign(`/api/export?${params}`);
  };
  // Same words as the sort menu below, never the raw URL key ("bid-asc").


  const sortLabel = locale === "en"
    ? `Sorted by ${({
        score: "Deal Score, highest first",
        opportunity: "opportunity rank",
        triage: "triage research priority",
        equity: "bid spread",
        quality: "most complete listing",
        date: "sale date",
        "bid-asc": "opening bid, low to high",
        images: "most photos",
      } as Record<string, string>)[filters.sort ?? ""] ?? "triage research priority"}.`
    : format(lUi.sortByPrefix, {
        label: ({
          score: lUi.sortOptions.score,
          opportunity: lUi.sortOptions.opportunity,
          triage: lUi.sortOptions.triage,
          equity: lUi.sortOptions.equity,
          quality: lUi.sortOptions.quality,
          date: lUi.sortOptions.date,
          "bid-asc": lUi.sortOptions.bidAsc,
          images: lUi.sortOptions.images,
        } as Record<string, string>)[filters.sort ?? ""] ?? lUi.sortOptions.triage,
      });

  const isMapView = filters.view === "map";
  const watchlistWholeCatalogActive = showSavedOnly && watchlistListings !== null && !isMapView;
  const honestyListings = watchlistWholeCatalogActive ? filteredListings : payload?.listings;
  const honestySummary = !(showSavedOnly && watchlistLoading && !isMapView) && honestyListings
    ? summarizeInventoryHonesty(honestyListings)
    : null;
  const honestyLoadedLabel = honestySummary
    ? `${formatLocaleNumber(locale, honestySummary.openingBidPublished)} of ${formatLocaleNumber(locale, honestySummary.shown)} ${watchlistWholeCatalogActive ? "saved listings" : "on this page"} list an opening bid`
    : null;

  return (
    <section className="mx-auto max-w-[1440px] px-4 py-7 sm:px-6 lg:px-8">
      <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">{lUi.title}</h1>
          <p className="mt-1 text-sm text-ink-3">{lUi.subtitle}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs font-semibold">
          <Link
            href="/underwrite"
            className="rounded-control border border-line-strong bg-card px-3 py-1.5 text-ink transition hover:border-line hover:bg-paper"
          >
            {lUi.underwriteQuickLink}
          </Link>
          <Link
            href="/bid-sheet"
            className="rounded-control border border-line-strong bg-card px-3 py-1.5 text-ink transition hover:border-line hover:bg-paper"
          >
            {lUi.bidSheetQuickLink}
          </Link>
        </div>
      </header>
      <div className="rounded-2xl border border-line bg-card p-4 shadow-sm">
        <DiscoverySearchField q={filters.q} onSearch={onSearch} />
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {(["state", "county", "type"] as const).map((field) => (
            <select
              key={field}
              aria-label={localizedFilterLabels[field]}
              value={selectedFacetValue(field)}
              onChange={(event) => selectValue(field, event.target.value)}
              className={`min-h-10 w-full rounded-lg border border-line-strong bg-card px-3 py-2 text-sm ${field === "type" ? "col-span-2 sm:col-span-1" : ""}`}
            >
              <option value="all">{localizedDefaults[field]}</option>
              {facetOptions(field).map((facet) => (
                <option key={facet.value} value={facet.value}>
                  {facet.value === "unknown" ? "Unknown" : sourceDisplayText(facet.value).replace(/_/g, " ")}{facet.count !== null ? ` (${facet.count})` : ""}
                </option>
              ))}
            </select>
          ))}
        </div>
        <button type="button" aria-expanded={moreFiltersOpen} onClick={() => setMoreFiltersOpen((open) => !open)} className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-lg border border-line-strong px-3 text-sm font-semibold">
          <SlidersHorizontal size={15} /> More filters
        </button>
        {moreFiltersOpen && (
          <div className="mt-3 grid max-w-full gap-3 overflow-x-hidden rounded-xl bg-paper p-3 sm:grid-cols-2 lg:grid-cols-4">
            {(["source", "program", "lifecycle", "occupancy", "freshness"] as const).map((field) => (
              <select key={field} aria-label={filterLabels[field]} value={selectedFacetValue(field)} onChange={(event) => selectValue(field, event.target.value)} className="min-h-10 rounded-lg border border-line-strong bg-card px-3 text-sm">
                <option value="all">{localizedDefaults[field]}</option>
                {facetOptions(field).map((facet) => <option key={facet.value} value={facet.value}>{facet.value === "unknown" ? "Unknown" : sourceDisplayText(facet.value).replace(/_/g, " ")}{facet.count !== null ? ` (${facet.count})` : ""}</option>)}
              </select>
            ))}
            <select aria-label="Sale type" value={filters.distressStage || "all"} onChange={(event) => selectValue("distressStage", event.target.value)} className="min-h-10 rounded-lg border border-line-strong bg-card px-3 text-sm">
              <option value="all">All sale types</option>
              <option value="reo">Bank-owned (REO)</option>
              <option value="pre_foreclosure">Pre-foreclosure</option>
              <option value="scheduled">Auction scheduled</option>
              <option value="tax_sale">Tax sale</option>
              <option value="unknown">Not stated</option>
            </select>
            <label className="rounded-control border border-line-strong bg-card px-3 py-2 text-xs font-semibold focus-within:border-yours focus-within:ring-2 focus-within:ring-yours/20">Sale from<input type="date" value={filters.saleFrom || ""} onChange={(event) => setFilters({ saleFrom: event.target.value || undefined })} className="mt-1 block w-full bg-transparent text-sm outline-none focus-visible:shadow-none" /></label>
            <label className="rounded-control border border-line-strong bg-card px-3 py-2 text-xs font-semibold focus-within:border-yours focus-within:ring-2 focus-within:ring-yours/20">Sale to<input type="date" value={filters.saleTo || ""} onChange={(event) => setFilters({ saleTo: event.target.value || undefined })} className="mt-1 block w-full bg-transparent text-sm outline-none focus-visible:shadow-none" /></label>
            <label className="rounded-control border border-line-strong bg-card px-3 py-2 text-xs font-semibold focus-within:border-yours focus-within:ring-2 focus-within:ring-yours/20">Max opening bid<input inputMode="numeric" value={filters.maxBid || ""} onChange={(event) => setFilters({ maxBid: event.target.value || undefined })} placeholder="$" className="mt-1 block w-full bg-transparent text-sm outline-none focus-visible:shadow-none" /></label>
            <label className="rounded-control border border-line-strong bg-card px-3 py-2 text-xs font-semibold focus-within:border-yours focus-within:ring-2 focus-within:ring-yours/20">Min deal score<input type="number" min={0} max={99} value={filters.minScore || ""} onChange={(event) => setFilters({ minScore: event.target.value || undefined })} placeholder="0" className="mt-1 block w-full bg-transparent text-sm outline-none focus-visible:shadow-none" /></label>
            <label className="rounded-control border border-line-strong bg-card px-3 py-2 text-xs font-semibold focus-within:border-yours focus-within:ring-2 focus-within:ring-yours/20">Min equity (value minus bid) ($)<input type="number" min={0} value={filters.minEquity || ""} onChange={(event) => setFilters({ minEquity: event.target.value || undefined })} placeholder="0" className="mt-1 block w-full bg-transparent text-sm outline-none focus-visible:shadow-none" /></label>
            <select aria-label="Documents" value={filters.hasDocuments || "all"} onChange={(event) => selectValue("hasDocuments", event.target.value)} className="min-h-10 rounded-lg border border-line-strong bg-card px-3 text-sm">
              <option value="all">Any documents</option><option value="true">Documents available</option><option value="false">No documents posted</option><option value="unknown">Not stated</option>
            </select>
            <select aria-label="Property photos" value={filters.hasPhoto || "all"} onChange={(event) => selectValue("hasPhoto", event.target.value)} className="min-h-10 rounded-lg border border-line-strong bg-card px-3 text-sm">
              <option value="all">Any photo status</option><option value="true">Has publisher photo</option><option value="false">No publisher photo</option>
            </select>
            <select aria-label="Senior lien risk" value={filters.seniorLien || "all"} onChange={(event) => selectValue("seniorLien", event.target.value)} className="min-h-10 rounded-lg border border-line-strong bg-card px-3 text-sm">
              <option value="all">Any senior lien status</option><option value="clean">No senior-lien flag posted</option><option value="risk">High senior lien risk</option>
            </select>
            <select aria-label="Redemption period" value={filters.redemption || "all"} onChange={(event) => selectValue("redemption", event.target.value)} className="min-h-10 rounded-lg border border-line-strong bg-card px-3 text-sm">
              <option value="all">Any redemption timeline</option><option value="immediate">Immediate deed (0 days)</option><option value="redemption_active">Active redemption period</option>
            </select>
          </div>
        )}
        {hasFilters && (
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
            <Filter size={14} className="text-ink-3" />
            {Object.entries(filters)
              .filter(([key, value]) => key !== "view" && key !== "sort" && value)
              .map(([key, value]) => (
                <button
                  key={key}
                  onClick={() =>
                    setFilters({
                      [key]: undefined,
                    } as Partial<DiscoveryFilters>)
                  }
                  className="inline-flex items-center gap-1 rounded-full bg-line px-2.5 py-1 text-label font-semibold text-ink"
                >
                  {filterLabels[key] || key}: {key === "hasDocuments" ? value === "true" ? "Available" : value === "false" ? "None posted" : "Not stated" : key === "hasPhoto" ? value === "true" ? "Has photo" : "No photo" : key === "seniorLien" ? value === "clean" ? "No senior-lien flag" : "High risk" : key === "redemption" ? value === "immediate" ? "Immediate deed" : "Active redemption" : key === "enrolledOnly" ? value === "true" ? "Enrolled counties only" : "Unenrolled counties" : sourceDisplayText(value!).replace(/_/g, " ")}
                  <X size={12} />
                </button>
              ))}
            <button
              onClick={() => {
                setCursor(undefined);
                setCursorStack([]);
                router.replace(pathname);
              }}
              className="text-xs font-semibold text-ink-3 underline"
            >
              Clear all
            </button>
          </div>
        )}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2" role="group" aria-label="Triage filters">
        {([
          { key: "isNew" as const, label: "New" },
          { key: "priceDropped" as const, label: "Price dropped" },
          { key: "hasDocs" as const, label: "Has documents" },
          { key: "stale" as const, label: "Refresh due / Stale" },
          { key: "occupancyKnown" as const, label: "Occupancy stated" },
          { key: "enrolledOnly" as const, label: "Enrolled assessor" },
        ]).map(({ key, label: chipLabel }) => (
          <button
            key={key}
            type="button"
            aria-pressed={triageFilters[key]}
            onClick={() => {
              if (key === "hasDocs") {
                setFilters({ hasDocuments: filters.hasDocuments === "true" ? undefined : "true" });
              } else {
                setFilters({ [key]: filters[key] === "true" ? undefined : "true" } as Partial<DiscoveryFilters>);
              }
            }}
            className={`inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
              triageFilters[key]
                ? "border-ink bg-ink text-white"
                : "border-line bg-card text-ink-2 hover:border-ink-3"
            }`}
          >
            {chipLabel}
          </button>
        ))}
        {localFilterActive && !isMapView ? (
          <span className="text-xs text-ink-3" data-testid="watchlist-filter-count">
            {watchlistLoading
              ? "Loading watchlist…"
              : watchlistListings !== null
                ? `${formatLocaleNumber(locale, filteredListings.length)} of ${formatLocaleNumber(locale, saved.size)} saved${saved.size > 100 ? " (first 100)" : ""}`
                : `${formatLocaleNumber(locale, filteredListings.length)} of ${formatLocaleNumber(locale, pageLength)} shown on this page`}
          </span>
        ) : null}
      </div>
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        {/* min-w-0 flex-1, so this column takes the width left over rather than
            the width its text happens to need. Both honesty lines are reserved
            and one line tall in every state, so their heights were already
            stable -- but the loaded message is far longer than its placeholder,
            which widened this column enough to push the filter controls past the
            container and wrap them onto a second row. That added 52px of shift
            from a block that had not changed height at all.

            Layout must not be a function of how long a sentence is. */}
        <div className="min-w-0 flex-1">
          {/* A loaded payload keeps its count during a refetch. "Updating
              results…" is only the empty state, so the server-rendered total
              cannot disappear while the browser request is in flight. The
              page-scoped qualifier stops a capped count from reading as the
              whole search. */}
          <p className="text-xs font-semibold text-ink-3" data-testid="inventory-page-count">
            {isMapView
              ? showSavedOnly
                ? `Map shows all matching viewport records · ${formatLocaleNumber(locale, saved.size)} in watchlist (${watchlistLoading ? "loading…" : `${formatLocaleNumber(locale, filteredListings.length)} match filters`})`
                : payload
                  ? `Map view · ${
                      typeof payload.total === "number"
                        ? `${formatLocaleNumber(locale, payload.total)} match this search${
                            totalIsPageScoped ? ", counted on this page only" : ""
                          }`
                        : `${formatLocaleNumber(locale, pageLength)} on this page`
                    }`
                  : loading || !error
                    ? "Updating results…"
                    : "Results unavailable right now"
              : showSavedOnly
                ? watchlistLoading
                  ? "Loading watchlist…"
                  : watchlistListings !== null
                    ? `${formatLocaleNumber(locale, filteredListings.length)} of ${formatLocaleNumber(locale, saved.size)} saved${hasFilters ? " match this search" : " in your watchlist"}`
                    : `${formatLocaleNumber(locale, filteredListings.length)} of ${formatLocaleNumber(locale, pageLength)} on this page in your watchlist`
                : payload
                  ? `${formatLocaleNumber(locale, pageLength)} on this page${
                      typeof payload.total === "number"
                        ? ` · ${formatLocaleNumber(locale, payload.total)} match this search${
                            totalIsPageScoped ? ", counted on this page only" : ""
                          }`
                        : ""
                    }`
                  : loading || !error
                    ? "Updating results…"
                    : "Results unavailable right now"}
          </p>
          {/* Always rendered, never popped in. This line used to be
              conditional on `payload`, so it appeared from nothing once the
              results landed and pushed the pagination bar 20px down the page:
              measured as a 0.066 layout shift, the largest on /listings. The
              placeholder is honest -- it really is checking -- and occupies the
              same single line, so the block's height is stable from the first
              paint. */}
          <p className="mt-1 text-xs text-ink-3" data-testid="inventory-honesty">
            {honestyLoadedLabel || (locale === "en" ? "Checking published amounts…" : lUi.checkingPublishedAmounts)}
          </p>
          {/* "Modeled score" is the default sort, and it orders by a value the
              API withholds unless a record has both an opening amount and an
              estimated range. While no record carries one, every row ties and
              the order is decided by the id tie-break - so the page looks
              ranked by deal quality while ranking nothing. The empty state
              covers the minScore filter but cannot help here, because this
              returns results. Counted from the records in hand, same as the
              line above; never a catalog-wide claim.

              Always rendered, with placeholder text, for the same reason as the
              line above. It was conditional on `payload`, so it appeared from
              nothing when results landed and pushed everything below it down.

              The placeholder is text rather than null, and that distinction is
              the whole fix: an empty <p> reserves its 4px margin and nothing
              else, so the block still grew by one 16px line when the message
              arrived. That extra 16px was enough to push the filter controls
              past the container width and make them wrap onto a second row,
              adding 52px. Both the real message and its placeholder occupy a
              single line at desktop width, so the height is now identical in
              both states -- which is the property the sibling line's guard
              already checks for the banner. */}
          <p className="mt-1 text-xs text-ink-3" data-testid="score-sort-honesty">
            {honestyListings
              && (filters.sort || "triage") === "triage"
              && summarizeInventoryHonesty(honestyListings).dealScorePresent === 0
              && honestyListings.length > 0
              ? "No listing on this page has a Deal Score yet; ranking prioritizes soonest upcoming auction sales and research triage signals."
              : honestyListings
                ? sortLabel
                : "Checking which listings have a Deal Score…"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <select
            aria-label="Sort results"
            value={filters.sort || "triage"}
            onChange={(event) => setFilters({ sort: event.target.value })}
            className="min-h-10 rounded-lg border border-line-strong bg-card px-3 text-xs font-semibold"
          >
            <option value="score">Deal Score</option>
            <option value="quality">{lUi.sortOptions.quality}</option>
            <option value="opportunity">{lUi.sortOptions.opportunity}</option>
            <option value="triage">{lUi.sortOptions.triage}</option>
            <option value="equity">{lUi.sortOptions.equity}</option>
            <option value="date">{lUi.sortOptions.date}</option>
            <option value="bid-asc">{lUi.sortOptions.bidAsc}</option>
            <option value="images">{lUi.sortOptions.images}</option>
          </select>
          <select
            aria-label="Minimum listing detail"
            value={filters.minQuality || ""}
            onChange={(event) => setFilters({ minQuality: event.target.value || undefined })}
            className="min-h-10 rounded-lg border border-line-strong bg-card px-3 text-xs font-semibold"
          >
            <option value="">{lUi.detailAny}</option>
            <option value="25">{lUi.detail25}</option>
            <option value="50">{lUi.detail50}</option>
            <option value="75">{lUi.detail75}</option>
          </select>
          <SaveSearchButton filters={filters} />
          <div ref={moreMenuRef} className="relative">
            <button
              type="button"
              aria-expanded={moreMenuOpen}
              aria-haspopup="menu"
              onClick={() => setMoreMenuOpen((prev) => !prev)}
              className="flex min-h-10 cursor-pointer items-center rounded-lg border border-line-strong bg-card px-3 text-xs font-semibold text-ink hover:bg-paper"
            >
              {lUi.moreBtn}
            </button>
            {moreMenuOpen ? (
              <div role="menu" className="absolute right-0 top-full z-20 mt-2 w-56 rounded-xl border border-line bg-card p-2 shadow-lg">
                <Link role="menuitem" href="/hunts" onClick={() => setMoreMenuOpen(false)} className="block rounded-lg px-3 py-3 text-xs font-semibold hover:bg-paper">{lUi.huntsAlertsMenu}</Link>
                <button type="button" role="menuitem" onClick={() => { setMoreMenuOpen(false); exportCurrent("csv"); }} className="inline-flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-xs font-semibold hover:bg-paper"><FileText size={14} /> {lUi.exportCsvMenu}</button>
                <button type="button" role="menuitem" onClick={() => { setMoreMenuOpen(false); exportCurrent("json"); }} className="inline-flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-xs font-semibold hover:bg-paper"><FileText size={14} /> {lUi.exportJsonMenu}</button>
              </div>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2" role="group" aria-label={lUi.resultViewsAria}>
          <button
            type="button"
            onClick={() => setShowSavedOnly((prev) => !prev)}
            aria-pressed={showSavedOnly}
            className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold aria-pressed:border-ink aria-pressed:bg-ink aria-pressed:text-white"
          >
            <Bookmark size={14} className={showSavedOnly ? "fill-white text-white" : ""} />
            <span>{format(lUi.watchlistCount, { count: formatLocaleNumber(locale, saved.size) })}</span>
          </button>
          <button
            type="button"
            onClick={() => setFilters({ view: "grid" })}
            aria-pressed={(filters.view || "grid") === "grid"}
            className="inline-flex items-center gap-1 rounded-lg border px-3 py-2 text-xs font-semibold aria-pressed:bg-ink aria-pressed:text-white"
          >
            <ListFilter size={14} />
            <span>{lUi.gridView}</span>
          </button>
          <button
            type="button"
            onClick={() => setFilters({ view: "map" })}
            aria-pressed={filters.view === "map"}
            className="inline-flex items-center gap-1 rounded-lg border px-3 py-2 text-xs font-semibold aria-pressed:bg-ink aria-pressed:text-white"
          >
            <MapIcon size={14} />
            {lUi.mapView}
          </button>
          <button
            type="button"
            onClick={() => setFilters({ view: "calendar" })}
            aria-pressed={filters.view === "calendar"}
            className="inline-flex items-center gap-1 rounded-lg border px-3 py-2 text-xs font-semibold aria-pressed:bg-ink aria-pressed:text-white"
          >
            <CalendarDays size={14} />
            {lUi.calendarView}
          </button>
          <button
            type="button"
            onClick={() => void refresh()}
            className="inline-flex items-center gap-1 rounded-lg border px-3 py-2 text-xs font-semibold"
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            {lUi.refreshBtn}
          </button>
          </div>
        </div>
      </div>
      {error && (
        <div
          role="alert"
          className="mt-5 flex flex-wrap items-center gap-3 rounded-xl bg-catch-wash p-4 text-sm text-catch-ink"
        >
          <ShieldAlert size={18} />
          {error}
          <button
            onClick={() => void refresh()}
            className="font-bold underline"
          >
            Retry
          </button>
        </div>
      )}
      {error && payload ? <p role="status" className="mt-3 text-sm text-ink-3">{lUi.staleBannerNote}</p> : null}
      {watchlistError ? <p role="alert" className="mt-3 rounded-xl bg-catch-wash p-3 text-sm text-catch-ink">{watchlistError}</p> : null}
      <CompareTray ids={compare.ids} labels={compareLabels} onRemove={compare.remove} onMakeTarget={compare.makeTarget} onClear={compare.clear} />
      {filters.view === "map" ? (
        <div className="mt-5">
          {showSavedOnly ? (
            <div
              role="status"
              data-testid="map-watchlist-indicator"
              className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-paper px-4 py-2.5 text-xs text-ink-2"
            >
              <span>
                Map view shows all viewport records matching your search filters ({watchlistLoading ? "loading watchlist…" : `${formatLocaleNumber(locale, filteredListings.length)} of ${formatLocaleNumber(locale, saved.size)} saved match`}; watchlist filtering applies to Grid and Calendar views).
              </span>
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => setFilters({ view: "grid" })}
                  className="font-semibold text-ink underline"
                >
                  Show watchlist in Grid
                </button>
                <button
                  type="button"
                  onClick={() => setShowSavedOnly(false)}
                  className="font-semibold text-ink-3 underline hover:text-ink"
                >
                  Turn off watchlist
                </button>
              </div>
            </div>
          ) : null}
          <DiscoveryMap filters={filters} onOpenListing={openMapListing} onCompare={compare.toggle} compareIds={compare.ids} compareFull={compare.full} />
        </div>
      ) : !payload && error ? null : filters.view === "calendar" && payload ? (
        <DiscoveryCalendar
          listings={filteredListings}
          filters={filters}
          truncated={watchlistWholeCatalogActive ? false : Boolean(payload?.page?.hasMore)}
          compareIds={compare.ids}
          onCompare={compare.toggle}
          pageNumber={watchlistWholeCatalogActive ? 1 : cursorStack.length + 1}
          hasPrev={watchlistWholeCatalogActive ? false : cursorStack.length > 0}
          hasMore={watchlistWholeCatalogActive ? false : Boolean(payload?.page?.hasMore)}
          loading={showSavedOnly ? watchlistLoading : loading}
          onPrevious={previous}
          onNext={next}
        />
      ) : (
        <>
          {!payload || (showSavedOnly && watchlistLoading) ? (
            <div className="mt-5 grid min-h-screen place-items-center rounded-2xl border border-line bg-card p-16 text-sm text-ink-3">
              {/* min-h-screen, not a fixed pixel value: this placeholder was 185px tall
                  while the grid that replaces it renders ~12,400px of cards, so the
                  filter row above and the pagination below both moved inside the
                  viewport -- CLS 0.419 against a 0.1 threshold. Reserving a full
                  viewport keeps everything below the fold for the whole load. It also
                  scales with the viewport, which a pixel reservation does not. */}
              <Loader2 className="mb-3 animate-spin" />
              {locale === "en" ? "Loading listings…" : lUi.loadingListings}
            </div>
          ) : !filteredListings.length ? (
            <div className="mt-5 rounded-2xl border border-dashed border-line-strong bg-card p-12 text-center">
              <SlidersHorizontal className="mx-auto text-ink-3" />
              {showSavedOnly && (watchlistListings !== null || saved.size === 0) ? (
                <>
                  <h2 className="mt-4 text-lg font-bold">
                    {saved.size === 0 ? lUi.emptyWatchlistEmptyTitle : lUi.emptyWatchlistFilteredTitle}
                  </h2>
                  <p className="mt-2 text-sm text-ink-3">
                    {saved.size === 0 ? lUi.emptyWatchlistEmptyBody : lUi.emptyWatchlistFilteredBody}
                  </p>
                  <button
                    type="button"
                    onClick={() => setShowSavedOnly(false)}
                    className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-ink px-3.5 py-2 text-xs font-semibold text-white hover:bg-ink-2"
                  >
                    {lUi.showAllListings}
                  </button>
                </>
              ) : localFilterActive && pageLength > 0 ? (
                <>
                  <h2 className="mt-4 text-lg font-bold">
                    {locale === "en" ? "No listings on this page match this filter." : lUi.emptyPageTitle}
                  </h2>
                  <p className="mt-2 text-sm text-ink-3">
                    The filter above is applied to this page only, not to the search.{" "}
                    {typeof payload.total === "number"
                      ? totalIsPageScoped
                        // `total` is what survived on the loaded page, not what
                        // the search holds. Reading it as a search count here
                        // states an unproven negative: live, minQuality=95
                        // emptied a 20-row page over a store of 9,798, and this
                        // line would have claimed "this search returns 0
                        // matching listings". Say what was actually examined.
                        ? `This page loaded ${formatLocaleNumber(locale, evaluated)} ${evaluated === 1 ? "listing" : "listings"}, and none of them met the ranking or quality threshold applied here. Later pages have not been loaded, so matches may be on them.`
                        : `This search returns ${payload.total.toLocaleString(intlLocale)} matching listing${
                            payload.total === 1 ? "" : "s"
                          }, but only ${formatLocaleNumber(locale, pageLength)} ${pageLength === 1 ? "is" : "are"} loaded here. Later pages have not been loaded, so matches may be on them.`
                      : `Only ${formatLocaleNumber(locale, pageLength)} ${pageLength === 1 ? "listing is" : "listings are"} loaded here. Later pages have not been loaded, so matches may be on them.`}
                  </p>
                  <button
                    onClick={clearLocalFilters}
                    className="mt-4 text-sm font-semibold text-ink underline"
                  >
                    {locale === "en" ? "Clear this filter" : lUi.clearFilter}
                  </button>
                </>
              ) : (
                <>
                  <h2 className="mt-4 text-lg font-bold">
                    {locale === "en" ? "No listings match your filters." : lUi.emptyFilterTitle}
                  </h2>
                  <p className="mt-2 text-sm text-ink-3">
                    {/* Deal score and bid spread are derived, not published. A
                        minimum on either excludes every record that does not
                        carry one, so with none in the inventory the filter
                        matches nothing — and suggesting a different LOCATION
                        sends the user to tune a filter that was never the
                        problem. */}
                    {locale === "en" ? (derivedFloorActive ? "A minimum deal score or equity filter skips listings without those numbers. They're derived values, not published by the source: we work them out from the opening bid and value range. Try removing the filter." : "Try a different location or fewer filters.") : derivedFloorActive ? lUi.emptyFilterDerived : lUi.emptyFilterLocation}
                  </p>
                  <Link
                    href="/sources"
                    className="mt-4 inline-block text-sm font-semibold text-ink underline"
                  >
                    {locale === "en" ? "View source coverage" : lUi.viewSourceCoverage}
                  </Link>
                </>
              )}
            </div>
          ) : (
            <div aria-busy={loading} className={`mt-5 grid gap-5 sm:grid-cols-2 xl:grid-cols-3 ${loading ? "pointer-events-none opacity-50" : ""}`}>
              {filteredListings.map((listing) => (
                <DiscoveryCard
                  key={listing.id}
                  listing={listing}
                  href={`/listings/${encodeURIComponent(listing.id)}?returnTo=${encodeURIComponent(discoveryUrl(filters))}`}
                  saved={saved.has(listing.id)}
                  saving={savingIds.has(listing.id)}
                  onSave={toggleSaved}
                  compared={compare.ids.includes(listing.id)}
                  compareFull={compare.full}
                  onCompare={compare.toggle}
                />
              ))}
            </div>
          )}
          {!watchlistWholeCatalogActive ? (
            <div className="mt-7 flex items-center justify-between rounded-xl border border-line bg-card p-3">
              <button
                type="button"
                aria-label="Previous page"
                disabled={!cursorStack.length || loading}
                onClick={previous}
                className="inline-flex items-center gap-1 rounded-lg px-3 py-2 text-xs font-bold disabled:opacity-40"
              >
                <ChevronLeft size={15} />
                {lUi.previousBtn}
              </button>
              <span className="text-xs text-ink-3">
                {format(lUi.pageNumber, { page: cursorStack.length + 1 })}
              </span>
              <button
                type="button"
                aria-label="Next page"
                disabled={!payload?.page?.hasMore || loading}
                onClick={next}
                className="inline-flex items-center gap-1 rounded-lg bg-ink px-3 py-2 text-xs font-bold text-white disabled:opacity-40"
              >
                {lUi.nextBtn}
                <ChevronRight size={15} />
              </button>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

// The calendar groups by raw saleDate, with one sentinel standing in for every
// listing whose publisher published no date. Sorting those raw keys left the
// unknown bucket wherever the platform collation happened to put the string
// "Date not published" — below ISO dates only because ICU orders digits before
// letters, and above any date a publisher wrote in words, which displayDate
// passes through unchanged. An unknown date is not an early date; it sorts last
// by this component's decision, and real dates keep the localeCompare order
// they had.
const UNKNOWN_SALE_DATE = "Date not published";
function compareSaleDateGroups(a: string, b: string) {
  const aUnknown = a === UNKNOWN_SALE_DATE;
  const bUnknown = b === UNKNOWN_SALE_DATE;
  if (aUnknown !== bUnknown) return aUnknown ? 1 : -1;
  return a.localeCompare(b);
}

function normalizeSaleDateKey(raw?: string | null): string {
  if (!raw || typeof raw !== "string") return UNKNOWN_SALE_DATE;
  const trimmed = raw.trim();
  if (!trimmed) return UNKNOWN_SALE_DATE;
  const isoMatch = trimmed.match(/^(\d{4}-\d{2}-\d{2})/);
  if (isoMatch) return isoMatch[1];
  const parsed = Date.parse(trimmed);
  if (Number.isFinite(parsed)) {
    return new Date(parsed).toISOString().slice(0, 10);
  }
  return trimmed;
}

function DiscoveryCalendar({
  listings,
  filters,
  truncated,
  compareIds,
  onCompare,
  pageNumber,
  hasPrev,
  hasMore,
  loading,
  onPrevious,
  onNext,
}: {
  listings: PropertyListing[];
  filters: DiscoveryFilters;
  truncated: boolean;
  compareIds: string[];
  onCompare: (id: string) => void;
  pageNumber: number;
  hasPrev: boolean;
  hasMore: boolean;
  loading: boolean;
  onPrevious: () => void;
  onNext: () => void;
}) {
  const [calendarRollup, setCalendarRollup] = React.useState<AuctionCalendarResponse | null>(null);
  const { locale, messages: m, format, plural } = useLocale();
  const cUi = m.listingsUi;
  const [neighborhoodRollup, setNeighborhoodRollup] = React.useState<NeighborhoodsResponse | null>(null);
  const [rollupLoading, setRollupLoading] = React.useState<boolean>(true);
  const [selectedMarketLabel, setSelectedMarketLabel] = React.useState<string | null>(null);
  const [marketDetail, setMarketDetail] = React.useState<NeighborhoodDetailResponse | null>(null);
  const [marketDetailLoading, setMarketDetailLoading] = React.useState<boolean>(false);
  const [marketDetailError, setMarketDetailError] = React.useState<string | null>(null);

  const loadMarketDrilldown = React.useCallback(async (label: string, kind: "zip" | "city" | "county", key: string) => {
    setSelectedMarketLabel(label);
    setMarketDetailLoading(true);
    setMarketDetailError(null);
    try {
      const detail = await getNeighborhoodDetail(kind, key);
      setMarketDetail(detail);
    } catch (err) {
      setMarketDetail(null);
      setMarketDetailError(err instanceof Error ? err.message : "Area drilldown unavailable.");
    } finally {
      setMarketDetailLoading(false);
    }
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    setRollupLoading(true);
    Promise.all([
      getAuctionCalendar({
        windowDays: 60,
        states: filters.state || undefined,
        county: filters.county || undefined,
        source: filters.source || undefined,
        type: filters.type || undefined,
        q: filters.q || undefined,
        maxBid: filters.maxBid ? Number(filters.maxBid) : undefined,
        saleFrom: filters.saleFrom || undefined,
        saleTo: filters.saleTo || undefined,
      }).catch(() => null),
      listNeighborhoods({
        state: filters.state || undefined,
        county: filters.county || undefined,
        source: filters.source || undefined,
        type: filters.type || undefined,
        q: filters.q || undefined,
        maxBid: filters.maxBid ? Number(filters.maxBid) : undefined,
        saleFrom: filters.saleFrom || undefined,
        saleTo: filters.saleTo || undefined,
        limit: 12,
      }).catch(() => null),
    ]).then(([cal, hoods]) => {
      if (cancelled) return;
      setCalendarRollup(cal);
      setNeighborhoodRollup(hoods);
      setRollupLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [
    filters.state,
    filters.county,
    filters.source,
    filters.type,
    filters.q,
    filters.maxBid,
    filters.saleFrom,
    filters.saleTo,
  ]);

  const groups = new Map<string, PropertyListing[]>();
  for (const listing of listings) {
    const day = normalizeSaleDateKey(listing.saleDate);
    const items = groups.get(day) || [];
    items.push(listing);
    groups.set(day, items);
  }
  return (
    <section
      className="mt-5 rounded-2xl border border-line bg-card p-5 shadow-sm"
      aria-label={cUi.calendarAria}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-ink-3">
            {cUi.calendarEyebrow}
          </p>
          <h2 className="mt-1 text-xl font-bold">{cUi.calendarTitle}</h2>
        </div>
        <span className="text-xs text-ink-3">
          {locale === "en" ? "Dated sales are ordered chronologically; undated records are grouped below." : cUi.calendarSubtitle}
        </span>
      </div>

      {/* Store-wide 60-day auction calendar & neighborhood market rollups */}
      <div className="mt-5 grid gap-4 lg:grid-cols-2" data-testid="calendar-market-rollups">
        <div className="rounded-xl border border-line bg-paper/70 p-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-xs font-bold uppercase tracking-wider text-ink-2">
              {cUi.auctionsNext60Title}
            </h3>
            <span className="text-xs font-semibold text-ink-3">
              {rollupLoading
                ? "Loading…"
                : calendarRollup
                  ? format(cUi.datedAuctionsCount, { count: formatLocaleNumber(locale, calendarDatedTotal(calendarRollup)) })
                  : cUi.notAvailableNow}
            </span>
          </div>
          {calendarRollup && calendarRollup.weeks.length > 0 ? (
            <div className="mt-3 space-y-2">
              {calendarRollup.weeks.map((week) => (
                <div
                  key={week.weekStart}
                  className="flex items-center justify-between rounded-lg border border-line bg-card px-3 py-2 text-xs"
                >
                  <div>
                    <span className="font-semibold text-ink">
                      {displayDate(week.weekStart)} – {displayDate(week.weekEnd)}
                    </span>
                    <span className="ml-2 text-ink-3">
                      ({plural(week.count, cUi.saleCount, { count: formatLocaleNumber(locale, week.count) })})
                    </span>
                  </div>
                  <span className="font-bold text-ink-2">
                    {cUi.medianPrefix}{" "}
                    {week.medianOpeningBid !== null
                      ? displayMoney(week.medianOpeningBid)
                      : "Not published"}
                  </span>
                </div>
              ))}
            </div>
          ) : !rollupLoading ? (
            <p className="mt-2 text-xs text-ink-3">
              {cUi.noDatedAuctions60}
            </p>
          ) : null}
        </div>

        <div className="rounded-xl border border-line bg-paper/70 p-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-xs font-bold uppercase tracking-wider text-ink-2">
              {cUi.typicalPricesTitle}
              {filters.state && filters.county ? (
                <button
                  type="button"
                  onClick={() =>
                    void loadMarketDrilldown(
                      `${filters.county}, ${filters.state}`,
                      "county",
                      `${filters.state}-${filters.county}`,
                    )
                  }
                  className="ml-2 rounded-md border border-line bg-card px-2 py-0.5 text-xs font-semibold normal-case tracking-normal text-ink-2 hover:bg-paper"
                >
                  {cUi.countyStatsBtn}
                </button>
              ) : null}
            </h3>
            <span className="text-xs font-semibold text-ink-3">
              {rollupLoading
                ? "Loading…"
                : neighborhoodRollup
                  ? (neighborhoodRollup.bucketsTruncated && typeof neighborhoodRollup.bucketsTotal === "number" ? `Top ${formatLocaleNumber(locale, neighborhoodRollup.count)} of ${formatLocaleNumber(locale, neighborhoodRollup.bucketsTotal)} markets` : `${formatLocaleNumber(locale, neighborhoodRollup.count)} markets`)
                  : cUi.notAvailableNow}
            </span>
          </div>
          {neighborhoodRollup && neighborhoodRollup.neighborhoods.length > 0 ? (
            <div className="mt-3 space-y-2">
              {neighborhoodRollup.neighborhoods.map((bucket) => (
                <div
                  key={bucket.key}
                  className="flex items-center justify-between rounded-lg border border-line bg-card px-3 py-2 text-xs"
                >
                  <div className="min-w-0">
                    <button
                      type="button"
                      onClick={() =>
                        void loadMarketDrilldown(
                          bucket.label,
                          bucket.kind === "city"
                            ? "city"
                            : bucket.kind === "county"
                              ? "county"
                              : "zip",
                          bucket.key,
                        )
                      }
                      className="font-semibold text-ink underline decoration-line-strong underline-offset-2 hover:text-ink-2"
                    >
                      {bucket.label}
                    </button>
                    <span className="ml-2 text-ink-3">
                      {formatLocaleNumber(locale, bucket.count)} {cUi.activeWord}
                      {bucket.medianSqft !== null ? ` · ${formatLocaleNumber(locale, bucket.medianSqft)} sqft` : ""}
                    </span>
                  </div>
                  <div className="shrink-0 text-right">
                    <span className="font-bold text-ink-2">
                      {bucket.medianOpeningBid !== null
                        ? displayMoney(bucket.medianOpeningBid)
                        : cUi.openingBidNotPublished}
                    </span>
                    {bucket.medianDealScore !== null && (
                      <span className="ml-2 rounded-control bg-line px-1.5 py-0.5 text-label font-bold text-ink-2">
                        Score {bucket.medianDealScore}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : !rollupLoading ? (
            <p className="mt-2 text-xs text-ink-3">
              {cUi.notEnoughAreaData}
            </p>
          ) : null}
        </div>
      </div>

      {selectedMarketLabel && (
        <div className="mt-4 rounded-xl border border-line bg-paper/70 p-4 text-xs" data-testid="market-drilldown-panel">
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold text-ink">
              {format(cUi.areaBreakdownTitle, { label: selectedMarketLabel })}
            </span>
            <button
              type="button"
              onClick={() => {
                setSelectedMarketLabel(null);
                setMarketDetail(null);
                setMarketDetailError(null);
              }}
              className="text-ink-3 underline hover:text-ink"
            >
              {cUi.closeBtn}
            </button>
          </div>
          {marketDetailLoading ? (
            <p className="mt-2 text-ink-3">{cUi.loadingAreaStats}</p>
          ) : marketDetailError ? (
            <p className="mt-2 text-catch-ink">{marketDetailError}</p>
          ) : marketDetail ? (() => {
            const bucket = marketDetail.neighborhood ?? marketDetail.bucket ?? marketDetail;
            return (
              <div className="mt-3 grid grid-cols-2 gap-3 text-ink-2 sm:grid-cols-4">
                <div>
                  <span className="block text-label font-bold uppercase text-ink-3">{cUi.activeListingsLabel}</span>
                  <strong className="mt-0.5 block text-sm text-ink">
                    {typeof bucket.count === "number" ? formatLocaleNumber(locale, bucket.count) : "—"}
                  </strong>
                </div>
                <div>
                  <span className="block text-label font-bold uppercase text-ink-3">{cUi.medianBidLabel}</span>
                  <strong className="mt-0.5 block text-sm text-ink">
                    {typeof bucket.medianOpeningBid === "number"
                      ? displayMoney(bucket.medianOpeningBid)
                      : "Not published"}
                  </strong>
                </div>
                <div>
                  <span className="block text-label font-bold uppercase text-ink-3">{cUi.medianSqftLabel}</span>
                  <strong className="mt-0.5 block text-sm text-ink">
                    {typeof bucket.medianSqft === "number"
                      ? `${formatLocaleNumber(locale, bucket.medianSqft)} sqft`
                      : "Not published"}
                  </strong>
                </div>
                <div>
                  <span className="block text-label font-bold uppercase text-ink-3">{cUi.medianScoreLabel}</span>
                  <strong className="mt-0.5 block text-sm text-ink">
                    {typeof bucket.medianDealScore === "number" ? bucket.medianDealScore : "—"}
                  </strong>
                </div>
              </div>
            );
          })() : null}
        </div>
      )}

      <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {truncated && (
          <p className="rounded-xl border border-line-strong bg-paper p-4 text-sm text-ink-2 md:col-span-2 xl:col-span-3">
            {cUi.tooManyCalendar}
          </p>
        )}
        {[...groups.entries()]
          .sort(([a], [b]) => compareSaleDateGroups(a, b))
          .map(([date, items]) => (
            <article
              key={date}
              className="rounded-xl border border-line p-4"
            >
              <h3 className="flex items-center gap-2 font-semibold">
                <CalendarDays size={15} />
                {date === UNKNOWN_SALE_DATE ? cUi.dateNotPublished : localizeDisplayDate(date, locale, cUi.dateNotPublished)}
              </h3>
              <div className="mt-3 space-y-2">
                {items.map((listing) => {
                  const selected = compareIds.includes(listing.id);
                  const compareFull = compareIds.length >= COMPARE_LIMIT && !selected;
                  return (
                  <div key={listing.id} className="rounded-lg bg-paper p-3 text-sm">
                    <Link
                      href={`/listings/${encodeURIComponent(listing.id)}?returnTo=${encodeURIComponent(discoveryUrl(filters))}`}
                      prefetch={false}
                      className="block hover:underline"
                    >
                      <strong className="block">{listing.address}</strong>
                      <TriageChips listing={listing} className="mt-1.5" />
                      <span className="mt-1 block text-xs text-ink-3">
                        {sourceDisplayText(
                          SOURCES[listing.source]?.label || listing.source,
                        )}{" "}
                        · {listing.discoveryStatus || "status not stated"}
                      </span>
                    </Link>
                    <button type="button" aria-pressed={selected} aria-label={`${selected ? "Remove from" : "Add to"} compare: ${listing.address}`} disabled={compareFull} onClick={() => onCompare(listing.id)} className="mt-2 inline-flex min-h-11 items-center rounded-lg border border-line-strong bg-card px-3 text-xs font-semibold text-ink-2 hover:bg-paper disabled:cursor-not-allowed disabled:opacity-50">
                      {selected ? cUi.inCompareBtn : compareFull ? cUi.compareFullBtn : cUi.compareBtn}
                    </button>
                  </div>
                  );
                })}
              </div>
            </article>
          ))}
      </div>
      {(hasPrev || hasMore) && (
        <div className="mt-6 flex items-center justify-between rounded-xl border border-line bg-paper p-3">
          <button
            type="button"
            aria-label="Previous calendar page"
            disabled={!hasPrev || loading}
            onClick={onPrevious}
            className="inline-flex min-h-11 items-center gap-1 rounded-lg px-3 py-2 text-xs font-bold disabled:opacity-40"
          >
            <ChevronLeft size={15} />
            {cUi.previousBtn}
          </button>
          <span className="text-xs text-ink-3">
            {format(cUi.pageNumber, { page: pageNumber })}
          </span>
          <button
            type="button"
            aria-label="Next calendar page"
            disabled={!hasMore || loading}
            onClick={onNext}
            className="inline-flex min-h-11 items-center gap-1 rounded-lg bg-ink px-3 py-2 text-xs font-bold text-white disabled:opacity-40"
          >
            {cUi.nextBtn}
            <ChevronRight size={15} />
          </button>
        </div>
      )}
    </section>
  );
}
