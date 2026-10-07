"use client";

import Link from "next/link";
import * as React from "react";
import {
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
import { DiscoveryMap } from "@/components/listings/discovery-map";
import { TriageChips } from "@/components/listings/triage-chips";
import { SaveSearchButton } from "@/components/hunts/save-search-button";
import {
  SOURCES,
  type PropertyListing,
} from "@/components/terminal/property-data";
import {
  displayDate,
} from "@/lib/listing-display";
import {
  discoverySearchParams,
  discoveryUrl,
  readDiscoveryFilters,
  type DiscoveryFilters,
} from "@/lib/discovery-query";
import { sourceDisplayText } from "@/lib/source-display";
import { summarizeInventoryHonesty } from "@/lib/inventory-honesty";

type Facet = { value: string; count: number };
type Payload = {
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
const defaults: Record<string, string> = {
  state: "All states",
  county: "All counties",
  source: "All sources",
  type: "All property types",
  program: "All programs",
  lifecycle: "All lifecycle states",
  occupancy: "All occupancy",
  freshness: "Any freshness",
  distressStage: "All distress stages",
};
const filterLabels: Record<string, string> = {
  q: "Search", state: "State", county: "County", source: "Source", type: "Property type",
  program: "Program", lifecycle: "Sale status", occupancy: "Occupancy", freshness: "Freshness",
  saleFrom: "From", saleTo: "Until", maxBid: "Max opening amount", minScore: "Min score",
  minEquity: "Min spread", hasDocuments: "Documents", seniorLien: "Senior lien", redemption: "Redemption",
  distressStage: "Distress stage", minQuality: "Min evidence quality",
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
      <label className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-slate-300 px-3 focus-within:border-slate-500">
        <span className="sr-only">Search properties</span>
        <Search size={17} className="text-slate-400" />
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Address, parcel, court case, or keyword"
          className="min-w-0 flex-1 bg-transparent py-3 text-sm outline-none"
        />
      </label>
      <button type="submit" className="rounded-xl bg-slate-950 px-5 py-3 text-sm font-bold text-white">Search</button>
    </form>
  );
});
export function DiscoveryWorkbench() {
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
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");
  const [cursorStack, setCursorStack] = React.useState<string[]>([]);
  const [paging, setPaging] = React.useState<{ key: string; cursor?: string }>({ key: queryKey });
  const cursor = paging.key === queryKey ? paging.cursor : undefined;
  const setCursor = React.useCallback((value?: string) => setPaging({ key: queryKey, cursor: value }), [queryKey]);
  const requestKey = `${queryKey}\n${cursor || ""}`;
  const payload = loadedResult?.key === requestKey ? loadedResult.payload : null;
  const [saved, setSaved] = React.useState<Set<string>>(new Set());
  // `saved` is read inside toggleSaved, which must keep a stable identity so
  // that memoized cards are not re-rendered by an unrelated state change.
  // The ref carries the current value; the state drives the chips.
  const savedRef = React.useRef(saved);
  savedRef.current = saved;
  const [moreFiltersOpen, setMoreFiltersOpen] = React.useState(false);
  const requestRef = React.useRef<{ controller: AbortController; id: number } | null>(null);
  const pendingSaves = React.useRef(new Set<string>());
  const [savingIds, setSavingIds] = React.useState<Set<string>>(new Set());
  const [watchlistError, setWatchlistError] = React.useState("");
  const [triageFilters, setTriageFilters] = React.useState({
    isNew: false,
    priceDropped: false,
    hasDocs: false,
    stale: false,
    occupancyKnown: false,
  });
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
        limit: filters.view === "calendar" ? 1000 : 48,
        facets: "state,county,source,type,program,lifecycle,occupancy,freshness",
        cursor,
      });
      const response = await fetch(`/api/listings?${params}`, {
        cache: "no-store",
        signal: request.controller.signal,
      });
      const result = (await response.json()) as Payload;
      if (request.controller.signal.aborted || requestRef.current?.id !== request.id) return;
      if (response.status === 409) {
        setCursor(undefined);
        setCursorStack([]);
        throw new Error(
          "Results changed while paging. Refreshed the search; choose Next again.",
        );
      }
      if (!response.ok || !Array.isArray(result.listings))
        throw new Error(
          result.error || "Discovery records could not be loaded.",
        );
      if (requestRef.current?.id === request.id) setLoadedResult({ key: requestKey, payload: result });
    } catch (caught) {
      if (request.controller.signal.aborted) return;
      setError(
        caught instanceof TypeError
          ? "Property search could not be reached. Try again."
          : caught instanceof Error ? caught.message : "Properties could not be loaded.",
      );
    } finally {
      if (requestRef.current?.id === request.id) setLoading(false);
    }
  }, [filters, cursor, requestKey, setCursor]);
  React.useEffect(() => {
    const delay = filters.q ? 250 : 0;
    const timer = window.setTimeout(() => void refresh(), delay);
    return () => {
      window.clearTimeout(timer);
      requestRef.current?.controller.abort();
    };
  }, [refresh, filters.q]);
  React.useEffect(() => {
    if (!session.authenticated) {
      setSaved(new Set());
      setWatchlistError("");
      return;
    }
    let active = true;
    void fetch("/api/alerts", { credentials: "same-origin", cache: "no-store" })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok)
          throw new Error(result.error || "Watchlist could not be loaded.");
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
        if (active) setWatchlistError("Saved properties could not be checked. Your watchlist has not been changed.");
      });
    return () => {
      active = false;
    };
  }, [session.authenticated]);
  // Typed characters are held inside DiscoverySearchField, not here. Holding
  // the draft in this component made every keystroke re-render all 48 result
  // cards (~4,600 nodes) to change one input's value.
  const onSearch = React.useCallback(
    (draft: string) => setFilters({ q: draft.trim() || undefined }),
    [setFilters],
  );
  const toggleSaved = React.useCallback(async (id: string) => {
    if (!session.authenticated) {
      session.requestUnlock();
      return;
    }
    if (pendingSaves.current.has(id)) return;
    pendingSaves.current.add(id);
    setSavingIds(new Set(pendingSaves.current));
    setWatchlistError("");
    const wasSaved = savedRef.current.has(id);
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
        throw new Error(result.error || "Watchlist could not be updated.");
      setSaved((items) => {
        const next = new Set(items);
        wasSaved ? next.delete(id) : next.add(id);
        return next;
      });
    } catch (caught) {
      setWatchlistError(
        caught instanceof Error
          ? caught.message
          : "Watchlist could not be updated.",
      );
    } finally {
      pendingSaves.current.delete(id);
      setSavingIds(new Set(pendingSaves.current));
    }
  }, [session]);
  const facets = payload?.facets || {};
  const anyTriageActive = Object.values(triageFilters).some(Boolean);
  const distressStageFilter = filters.distressStage;
  const filteredListings = React.useMemo(() => {
    if (!payload?.listings) return [];
    return payload.listings.filter((listing) => {
      if (distressStageFilter && distressStageFilter !== "all") {
        if ((listing.triage?.distressStage || "unknown") !== distressStageFilter) return false;
      }
      if (!anyTriageActive) return true;
      const t = listing.triage;
      if (!t) return false;
      if (triageFilters.isNew && !t.isNew) return false;
      if (triageFilters.priceDropped && !t.priceDropped) return false;
      if (triageFilters.hasDocs && !t.hasDocs) return false;
      if (triageFilters.stale && !(t.staleDays > 30)) return false;
      if (triageFilters.occupancyKnown && !t.occupancyKnown) return false;
      return true;
    });
  }, [payload?.listings, triageFilters, anyTriageActive, distressStageFilter]);
  const facetOptions = (field: keyof DiscoveryFilters) => {
    const options = facets[field] || [];
    const selected = filters[field];
    return selected && selected !== "all" && !options.some((option) => option.value === selected)
      ? [{ value: selected, count: payload ? 0 : null }, ...options] : options;
  };
  const hasFilters = Object.entries(filters).some(
    ([key, value]) => key !== "view" && key !== "sort" && value,
  );
  const pageLength = payload?.listings?.length ?? 0;
  // The triage chips and distressStage are applied by this page only, never by
  // the search: the server does not parse either (see discovery-query.ts), so
  // they run against the records already in payload.listings.
  const localFilterActive = anyTriageActive
    || Boolean(distressStageFilter && distressStageFilter !== "all");
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
    setTriageFilters({
      isNew: false,
      priceDropped: false,
      hasDocs: false,
      stale: false,
      occupancyKnown: false,
    });
    setFilters({ distressStage: undefined });
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
  const exportCurrent = () => {
    if (!session.authenticated) {
      session.requestUnlock();
      return;
    }
    const params = discoverySearchParams(filters, { format: "csv" });
    window.location.assign(`/api/export?${params}`);
  };

  return (
    <section className="mx-auto max-w-[1440px] px-4 py-7 sm:px-6 lg:px-8">
      <header className="mb-4">
        <h1 className="text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">Find properties</h1>
        <p className="mt-1 text-sm text-slate-600">Search by address, parcel, publisher ID, or keyword.</p>
      </header>
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <DiscoverySearchField q={filters.q} onSearch={onSearch} />
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {(["state", "county", "type"] as const).map((field) => (
            <select
              key={field}
              aria-label={filterLabels[field]}
              value={filters[field] || "all"}
              onChange={(event) => selectValue(field, event.target.value)}
              className={`min-h-10 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm ${field === "type" ? "col-span-2 sm:col-span-1" : ""}`}
            >
              <option value="all">{defaults[field]}</option>
              {facetOptions(field).map((facet) => (
                <option key={facet.value} value={facet.value}>
                  {facet.value === "unknown" ? "Unknown" : sourceDisplayText(facet.value).replace(/_/g, " ")}{facet.count !== null ? ` (${facet.count})` : ""}
                </option>
              ))}
            </select>
          ))}
        </div>
        <button type="button" aria-expanded={moreFiltersOpen} onClick={() => setMoreFiltersOpen((open) => !open)} className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-200 px-3 text-sm font-semibold">
          <SlidersHorizontal size={15} /> More filters
        </button>
        {moreFiltersOpen && (
          <div className="mt-3 grid gap-3 rounded-xl bg-slate-50 p-3 sm:grid-cols-2 lg:grid-cols-4">
            {(["source", "program", "lifecycle", "occupancy", "freshness"] as const).map((field) => (
              <select key={field} aria-label={filterLabels[field]} value={filters[field] || "all"} onChange={(event) => selectValue(field, event.target.value)} className="min-h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm">
                <option value="all">{defaults[field]}</option>
                {facetOptions(field).map((facet) => <option key={facet.value} value={facet.value}>{facet.value === "unknown" ? "Unknown" : sourceDisplayText(facet.value).replace(/_/g, " ")}{facet.count !== null ? ` (${facet.count})` : ""}</option>)}
              </select>
            ))}
            <select aria-label="Distress stage" value={filters.distressStage || "all"} onChange={(event) => selectValue("distressStage", event.target.value)} className="min-h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm">
              <option value="all">All distress stages</option>
              <option value="reo">REO</option>
              <option value="pre_foreclosure">Pre-foreclosure</option>
              <option value="scheduled">Scheduled</option>
              <option value="tax_sale">Tax sale</option>
              <option value="unknown">Unknown</option>
            </select>
            <label className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold">Sale from<input type="date" value={filters.saleFrom || ""} onChange={(event) => setFilters({ saleFrom: event.target.value || undefined })} className="mt-1 block w-full bg-transparent text-sm outline-none" /></label>
            <label className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold">Sale to<input type="date" value={filters.saleTo || ""} onChange={(event) => setFilters({ saleTo: event.target.value || undefined })} className="mt-1 block w-full bg-transparent text-sm outline-none" /></label>
            <label className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold">Max published amount<input inputMode="numeric" value={filters.maxBid || ""} onChange={(event) => setFilters({ maxBid: event.target.value || undefined })} placeholder="$" className="mt-1 block w-full bg-transparent text-sm outline-none" /></label>
            <label className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold">Min deal score<input type="number" min={0} max={99} value={filters.minScore || ""} onChange={(event) => setFilters({ minScore: event.target.value || undefined })} placeholder="0" className="mt-1 block w-full bg-transparent text-sm outline-none" /></label>
            <label className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold">Min equity ($)<input type="number" min={0} value={filters.minEquity || ""} onChange={(event) => setFilters({ minEquity: event.target.value || undefined })} placeholder="0" className="mt-1 block w-full bg-transparent text-sm outline-none" /></label>
            <select aria-label="Documents" value={filters.hasDocuments || "all"} onChange={(event) => selectValue("hasDocuments", event.target.value)} className="min-h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm">
              <option value="all">Any document status</option><option value="true">Documents available</option><option value="false">No documents reported</option><option value="unknown">Document status unknown</option>
            </select>
          </div>
        )}
        {hasFilters && (
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
            <Filter size={14} className="text-slate-500" />
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
                  className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-900"
                >
                  {filterLabels[key] || key}: {key === "hasDocuments" ? value === "true" ? "Available" : value === "false" ? "None reported" : "Unknown" : sourceDisplayText(value!).replace(/_/g, " ")}
                  <X size={12} />
                </button>
              ))}
            <button
              onClick={() => {
                setCursor(undefined);
                setCursorStack([]);
                router.replace(pathname);
              }}
              className="text-xs font-semibold text-slate-600 underline"
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
          { key: "hasDocs" as const, label: "Has docs" },
          { key: "stale" as const, label: "Stale >30d" },
          { key: "occupancyKnown" as const, label: "Occupancy known" },
        ]).map(({ key, label: chipLabel }) => (
          <button
            key={key}
            type="button"
            aria-pressed={triageFilters[key]}
            onClick={() => setTriageFilters((prev) => ({ ...prev, [key]: !prev[key] }))}
            className={`inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
              triageFilters[key]
                ? "border-slate-900 bg-slate-900 text-white"
                : "border-slate-200 bg-white text-slate-700 hover:border-slate-400"
            }`}
          >
            {chipLabel}
          </button>
        ))}
        {localFilterActive ? (
          <span className="text-xs text-slate-500">
            {filteredListings.length} of {pageLength.toLocaleString()} shown on this page
          </span>
        ) : null}
      </div>
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold text-slate-600" data-testid="inventory-page-count">
            {loading || (!payload && !error)
              ? "Updating results…"
              : payload
                ? `${pageLength.toLocaleString()} on this page${
                    typeof payload.total === "number"
                      ? ` · ${payload.total.toLocaleString()} match this search${
                          // Without this qualifier the capped intelligence count
                          // reads as a whole-search total: "12 match" on a
                          // search the user knows returns thousands.
                          totalIsPageScoped ? ", counted on this page only" : ""
                        }`
                      : ""
                  }`
                : "Results unavailable"}
          </p>
          {/* Always rendered, never popped in. This line used to be
              conditional on `payload`, so it appeared from nothing once the
              results landed and pushed the pagination bar 20px down the page:
              measured as a 0.066 layout shift, the largest on /listings. The
              placeholder is honest -- it really is checking -- and occupies the
              same single line, so the block's height is stable from the first
              paint. */}
          <p className="mt-1 text-xs text-slate-600" data-testid="inventory-honesty">
            {payload?.listings
              ? (() => {
                  const honesty = summarizeInventoryHonesty(payload.listings);
                  return `${honesty.openingBidPublished} of ${honesty.shown} on this page publish an opening amount`;
                })()
              : "Checking published amounts…"}
          </p>
          {/* "Modeled score" is the default sort, and it orders by a value the
              API withholds unless a record has both an opening amount and an
              estimated range. While no record carries one, every row ties and
              the order is decided by the id tie-break - so the page looks
              ranked by deal quality while ranking nothing. The empty state
              covers the minScore filter but cannot help here, because this
              returns results. Counted from the records in hand, same as the
              line above; never a catalog-wide claim. */}
          {payload?.listings
            && (filters.sort || "score") === "score"
            && summarizeInventoryHonesty(payload.listings).dealScorePresent === 0
            && payload.listings.length > 0 ? (
              <p className="mt-1 text-xs text-slate-600" data-testid="score-sort-honesty">
                No listing on this page carries a modeled score yet, so this order is not ranking by score. Scores need a published opening amount and an estimated range.
              </p>
            ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <select
            aria-label="Sort results"
            value={filters.sort || "score"}
            onChange={(event) => setFilters({ sort: event.target.value })}
            className="min-h-10 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold"
          >
            <option value="score">Modeled score</option>
            <option value="quality">Evidence quality</option>
            <option value="opportunity">Opportunity rank</option>
            <option value="date">Sale date</option>
            <option value="bid-asc">Opening amount</option>
          </select>
          <select
            aria-label="Minimum evidence quality"
            value={filters.minQuality || ""}
            onChange={(event) => setFilters({ minQuality: event.target.value || undefined })}
            className="min-h-10 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold"
          >
            <option value="">Any evidence</option>
            <option value="25">Evidence ≥ 25</option>
            <option value="50">Evidence ≥ 50</option>
            <option value="75">Evidence ≥ 75</option>
          </select>
          <SaveSearchButton filters={filters} />
          <details className="relative">
            <summary className="flex min-h-10 cursor-pointer items-center rounded-lg border border-slate-200 px-3 text-xs font-semibold">More</summary>
            <div className="absolute right-0 top-full z-20 mt-2 w-56 rounded-xl border border-slate-200 bg-white p-2 shadow-lg">
              <Link href="/hunts" className="block rounded-lg px-3 py-3 text-xs font-semibold hover:bg-slate-50">Saved searches &amp; changes</Link>
              <button onClick={exportCurrent} className="inline-flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-xs font-semibold hover:bg-slate-50"><FileText size={14} /> Export results</button>
            </div>
          </details>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Result views">
          <button
            onClick={() => setFilters({ view: "grid" })}
            aria-pressed={(filters.view || "grid") === "grid"}
            className="inline-flex items-center gap-1 rounded-lg border px-3 py-2 text-xs font-semibold aria-pressed:bg-slate-950 aria-pressed:text-white"
          >
            <ListFilter size={14} />
            <span>Grid</span>
          </button>
          <button
            onClick={() => setFilters({ view: "map" })}
            aria-pressed={filters.view === "map"}
            className="inline-flex items-center gap-1 rounded-lg border px-3 py-2 text-xs font-semibold aria-pressed:bg-slate-950 aria-pressed:text-white"
          >
            <MapIcon size={14} />
            Map
          </button>
          <button
            onClick={() => setFilters({ view: "calendar" })}
            aria-pressed={filters.view === "calendar"}
            className="inline-flex items-center gap-1 rounded-lg border px-3 py-2 text-xs font-semibold aria-pressed:bg-slate-950 aria-pressed:text-white"
          >
            <CalendarDays size={14} />
            Calendar
          </button>
          <button
            onClick={() => void refresh()}
            className="inline-flex items-center gap-1 rounded-lg border px-3 py-2 text-xs font-semibold"
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            Refresh
          </button>
          </div>
        </div>
      </div>
      {error && (
        <div
          role="alert"
          className="mt-5 flex flex-wrap items-center gap-3 rounded-xl bg-amber-50 p-4 text-sm text-amber-950"
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
      {error && payload ? <p role="status" className="mt-3 text-sm text-slate-600">Showing previously loaded results. Refresh to check for updates.</p> : null}
      {watchlistError ? <p role="alert" className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-950">{watchlistError}</p> : null}
      {filters.view === "map" ? (
        <div className="mt-5">
          <DiscoveryMap filters={filters} onOpenListing={openMapListing} />
        </div>
      ) : !payload && error ? null : filters.view === "calendar" && payload ? (
        <DiscoveryCalendar
          listings={filteredListings}
          filters={filters}
          truncated={Boolean(payload?.page?.hasMore)}
        />
      ) : (
        <>
          {!payload ? (
            <div className="mt-5 grid place-items-center rounded-2xl border border-slate-200 bg-white p-16 text-sm text-slate-500">
              <Loader2 className="mb-3 animate-spin" />
              Loading properties…
            </div>
          ) : !filteredListings.length ? (
            <div className="mt-5 rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center">
              <SlidersHorizontal className="mx-auto text-slate-400" />
              {localFilterActive && pageLength > 0 ? (
                <>
                  <h2 className="mt-4 text-lg font-bold">
                    No listings on this page match this filter.
                  </h2>
                  <p className="mt-2 text-sm text-slate-600">
                    The filter above is applied to this page only, not to the search.{" "}
                    {typeof payload.total === "number"
                      ? totalIsPageScoped
                        // `total` is what survived on the loaded page, not what
                        // the search holds. Reading it as a search count here
                        // states an unproven negative: live, minQuality=95
                        // emptied a 20-row page over a store of 9,798, and this
                        // line would have claimed "this search returns 0
                        // matching listings". Say what was actually examined.
                        ? `This page loaded ${evaluated.toLocaleString()} ${evaluated === 1 ? "listing" : "listings"}, and none of them met the ranking or quality threshold applied here. Later pages have not been loaded, so matches may be on them.`
                        : `This search returns ${payload.total.toLocaleString()} matching listing${
                            payload.total === 1 ? "" : "s"
                          }, but only ${pageLength.toLocaleString()} ${pageLength === 1 ? "is" : "are"} loaded here. Later pages have not been loaded, so matches may be on them.`
                      : `Only ${pageLength.toLocaleString()} ${pageLength === 1 ? "listing is" : "listings are"} loaded here. Later pages have not been loaded, so matches may be on them.`}
                  </p>
                  <button
                    onClick={clearLocalFilters}
                    className="mt-4 text-sm font-semibold text-slate-900 underline"
                  >
                    Clear this filter
                  </button>
                </>
              ) : (
                <>
                  <h2 className="mt-4 text-lg font-bold">
                    No listings match your filters.
                  </h2>
                  <p className="mt-2 text-sm text-slate-600">
                    {/* Deal score and bid spread are derived, not published. A
                        minimum on either excludes every record that does not
                        carry one, so with none in the inventory the filter
                        matches nothing — and suggesting a different LOCATION
                        sends the user to tune a filter that was never the
                        problem. */}
                    {derivedFloorActive
                      ? "A minimum deal score or minimum spread only matches records that carry one. These are derived values, not published ones — if the inventory has none yet, that filter matches nothing."
                      : "Try a different location or fewer filters."}
                  </p>
                  <Link
                    href="/sources"
                    className="mt-4 inline-block text-sm font-semibold text-slate-900 underline"
                  >
                    View source coverage
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
                />
              ))}
            </div>
          )}
          <div className="mt-7 flex items-center justify-between rounded-xl border border-slate-200 bg-white p-3">
            <button
              disabled={!cursorStack.length || loading}
              onClick={previous}
              className="inline-flex items-center gap-1 rounded-lg px-3 py-2 text-xs font-bold disabled:opacity-40"
            >
              <ChevronLeft size={15} />
              Previous
            </button>
            <span className="text-xs text-slate-500">
              Page {cursorStack.length + 1}
            </span>
            <button
              disabled={!payload?.page?.hasMore || loading}
              onClick={next}
              className="inline-flex items-center gap-1 rounded-lg bg-slate-950 px-3 py-2 text-xs font-bold text-white disabled:opacity-40"
            >
              Next
              <ChevronRight size={15} />
            </button>
          </div>
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

function DiscoveryCalendar({
  listings,
  filters,
  truncated,
}: {
  listings: PropertyListing[];
  filters: DiscoveryFilters;
  truncated: boolean;
}) {
  const groups = new Map<string, PropertyListing[]>();
  for (const listing of listings) {
    const day = listing.saleDate || UNKNOWN_SALE_DATE;
    const items = groups.get(day) || [];
    items.push(listing);
    groups.set(day, items);
  }
  return (
    <section
      className="mt-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
      aria-label="Sale date calendar"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-emerald-700">
            Publisher sale dates
          </p>
          <h2 className="mt-1 text-xl font-bold">Calendar view</h2>
        </div>
        <span className="text-xs text-slate-500">
          Only dates published by a source are placed on the calendar.
        </span>
      </div>
      <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {truncated && (
          <p className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950 md:col-span-2 xl:col-span-3">
            More than 1,000 records match this calendar. Narrow the sale window or other filters to review every matching date.
          </p>
        )}
        {[...groups.entries()]
          .sort(([a], [b]) => compareSaleDateGroups(a, b))
          .map(([date, items]) => (
            <article
              key={date}
              className="rounded-xl border border-slate-200 p-4"
            >
              <h3 className="flex items-center gap-2 font-semibold">
                <CalendarDays size={15} />
                {date === UNKNOWN_SALE_DATE ? date : displayDate(date)}
              </h3>
              <div className="mt-3 space-y-2">
                {items.map((listing) => (
                  <Link
                    key={listing.id}
                    href={`/listings/${encodeURIComponent(listing.id)}?returnTo=${encodeURIComponent(discoveryUrl(filters))}`}
                    prefetch={false}
                    className="block rounded-lg bg-slate-50 p-3 text-sm hover:bg-slate-100"
                  >
                    <strong className="block">{listing.address}</strong>
                    <TriageChips listing={listing} className="mt-1.5" />
                    <span className="mt-1 block text-xs text-slate-500">
                      {sourceDisplayText(
                        SOURCES[listing.source]?.label || listing.source,
                      )}{" "}
                      · {listing.discoveryStatus || "status not established"}
                    </span>
                  </Link>
                ))}
              </div>
            </article>
          ))}
      </div>
    </section>
  );
}
