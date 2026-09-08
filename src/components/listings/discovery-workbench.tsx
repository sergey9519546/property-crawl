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

type Facet = { value: string; count: number };
type Payload = {
  listings: PropertyListing[];
  total: number;
  revision?: string;
  page?: { nextCursor?: string | null; hasMore?: boolean };
  facets?: Record<string, Facet[]>;
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
};
const filterLabels: Record<string, string> = {
  q: "Search", state: "State", county: "County", source: "Source", type: "Property type",
  program: "Program", lifecycle: "Sale status", occupancy: "Occupancy", freshness: "Freshness",
  saleFrom: "From", saleTo: "Until", maxBid: "Max opening amount", minScore: "Min score",
  minEquity: "Min spread", hasDocuments: "Documents", seniorLien: "Senior lien", redemption: "Redemption",
};
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
  const [queryDraft, setQueryDraft] = React.useState(filters.q || "");
  const [moreFiltersOpen, setMoreFiltersOpen] = React.useState(false);
  const requestRef = React.useRef<{ controller: AbortController; id: number } | null>(null);
  const pendingSaves = React.useRef(new Set<string>());
  const [savingIds, setSavingIds] = React.useState<Set<string>>(new Set());
  const [watchlistError, setWatchlistError] = React.useState("");
  React.useEffect(() => setQueryDraft(filters.q || ""), [filters.q]);
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
    void refresh();
    return () => requestRef.current?.controller.abort();
  }, [refresh]);
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
  const toggleSaved = async (id: string) => {
    if (!session.authenticated) {
      session.requestUnlock();
      return;
    }
    if (pendingSaves.current.has(id)) return;
    pendingSaves.current.add(id);
    setSavingIds(new Set(pendingSaves.current));
    setWatchlistError("");
    const wasSaved = saved.has(id);
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
  };
  const facets = payload?.facets || {};
  const facetOptions = (field: keyof DiscoveryFilters) => {
    const options = facets[field] || [];
    const selected = filters[field];
    return selected && selected !== "all" && !options.some((option) => option.value === selected)
      ? [{ value: selected, count: payload ? 0 : null }, ...options] : options;
  };
  const hasFilters = Object.entries(filters).some(
    ([key, value]) => key !== "view" && key !== "sort" && value,
  );
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
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            setFilters({ q: queryDraft.trim() || undefined });
          }}
        >
          <label className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-slate-300 px-3 focus-within:border-slate-500">
            <span className="sr-only">Search properties</span>
            <Search size={17} className="text-slate-400" />
            <input
              value={queryDraft}
              onChange={(event) => setQueryDraft(event.target.value)}
              placeholder="Address, parcel, court case, or keyword"
              className="min-w-0 flex-1 bg-transparent py-3 text-sm outline-none"
            />
          </label>
          <button type="submit" className="rounded-xl bg-slate-950 px-5 py-3 text-sm font-bold text-white">Search</button>
        </form>
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
            <label className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold">Sale from<input type="date" value={filters.saleFrom || ""} onChange={(event) => setFilters({ saleFrom: event.target.value || undefined })} className="mt-1 block w-full bg-transparent text-sm outline-none" /></label>
            <label className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold">Sale to<input type="date" value={filters.saleTo || ""} onChange={(event) => setFilters({ saleTo: event.target.value || undefined })} className="mt-1 block w-full bg-transparent text-sm outline-none" /></label>
            <label className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold">Max published amount<input inputMode="numeric" value={filters.maxBid || ""} onChange={(event) => setFilters({ maxBid: event.target.value || undefined })} placeholder="$" className="mt-1 block w-full bg-transparent text-sm outline-none" /></label>
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
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold text-slate-500">
            {loading || (!payload && !error)
              ? "Updating results…"
              : payload ? `${payload.total.toLocaleString()} ${payload.total === 1 ? "property" : "properties"}` : "Results unavailable"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <select
            aria-label="Sort results"
            value={filters.sort || "score"}
            onChange={(event) => setFilters({ sort: event.target.value })}
            className="min-h-10 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold"
          >
            <option value="score">Modeled score</option>
            <option value="date">Sale date</option>
            <option value="bid-asc">Opening amount</option>
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
          listings={payload?.listings || []}
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
          ) : !payload?.listings.length ? (
            <div className="mt-5 rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center">
              <SlidersHorizontal className="mx-auto text-slate-400" />
              <h2 className="mt-4 text-lg font-bold">
                No listings match your filters.
              </h2>
              <p className="mt-2 text-sm text-slate-600">
                Try a different location or fewer filters.
              </p>
              <Link
                href="/sources"
                className="mt-4 inline-block text-sm font-semibold text-slate-900 underline"
              >
                View source coverage
              </Link>
            </div>
          ) : (
            <div aria-busy={loading} className={`mt-5 grid gap-5 sm:grid-cols-2 xl:grid-cols-3 ${loading ? "pointer-events-none opacity-50" : ""}`}>
              {payload.listings.map((listing) => (
                <DiscoveryCard
                  key={listing.id}
                  listing={listing}
                  href={`/listings/${encodeURIComponent(listing.id)}?returnTo=${encodeURIComponent(discoveryUrl(filters))}`}
                  saved={saved.has(listing.id)}
                  saving={savingIds.has(listing.id)}
                  onSave={() => void toggleSaved(listing.id)}
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
    const day = listing.saleDate || "Date not published";
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
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([date, items]) => (
            <article
              key={date}
              className="rounded-xl border border-slate-200 p-4"
            >
              <h3 className="flex items-center gap-2 font-semibold">
                <CalendarDays size={15} />
                {date === "Date not published" ? date : displayDate(date)}
              </h3>
              <div className="mt-3 space-y-2">
                {items.map((listing) => (
                  <Link
                    key={listing.id}
                    href={`/listings/${encodeURIComponent(listing.id)}?returnTo=${encodeURIComponent(discoveryUrl(filters))}`}
                    className="block rounded-lg bg-slate-50 p-3 text-sm hover:bg-slate-100"
                  >
                    <strong className="block">{listing.address}</strong>
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
