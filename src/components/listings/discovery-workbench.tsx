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
import { CaseAction } from "@/components/research/case-action";
import { useWorkspaceSession } from "@/components/workspace/workspace-shell";
import { ListingThumbnail } from "@/components/listings/listing-thumbnail";
import { DiscoveryMap } from "@/components/listings/discovery-map";
import {
  SOURCES,
  type PropertyListing,
} from "@/components/terminal/property-data";
import {
  displayDate,
  displayMoney,
  displayText,
  knownNumber,
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
  source: "All sources",
  type: "All property types",
  program: "All programs",
  lifecycle: "All lifecycle states",
  occupancy: "All occupancy",
  freshness: "Any freshness",
};
const filterFields = [
  "state",
  "source",
  "type",
  "program",
  "lifecycle",
  "occupancy",
  "freshness",
] as const;

function observed(listing: PropertyListing) {
  return (
    listing.provenance?.origin === "live" &&
    listing.provenance?.observed === true
  );
}
function docs(listing: PropertyListing) {
  const media = listing.provenance?.media;
  return Boolean(
    media &&
    typeof media === "object" &&
    (media as Record<string, unknown>).documents,
  );
}

export function DiscoveryWorkbench() {
  const router = useRouter();
  const session = useWorkspaceSession();
  const pathname = usePathname();
  const search = useSearchParams();
  const filters = React.useMemo(
    () => readDiscoveryFilters(new URLSearchParams(search.toString())),
    [search],
  );
  const [payload, setPayload] = React.useState<Payload | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");
  const [cursorStack, setCursorStack] = React.useState<string[]>([]);
  const [cursor, setCursor] = React.useState<string | undefined>();
  const [saved, setSaved] = React.useState<Set<string>>(new Set());

  const setFilters = React.useCallback(
    (change: Partial<DiscoveryFilters>) => {
      setCursor(undefined);
      setCursorStack([]);
      router.replace(discoveryUrl({ ...filters, ...change }));
    },
    [filters, router],
  );
  const refresh = React.useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = discoverySearchParams(filters, {
        limit: 48,
        facets: true,
        cursor,
      });
      const response = await fetch(`/api/listings?${params}`, {
        cache: "no-store",
      });
      const result = (await response.json()) as Payload;
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
      setPayload(result);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Discovery records could not be loaded.",
      );
    } finally {
      setLoading(false);
    }
  }, [filters, cursor]);
  React.useEffect(() => {
    void refresh();
  }, [refresh]);
  React.useEffect(() => {
    if (!session.authenticated) {
      setSaved(new Set());
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
        if (active) setSaved(new Set(ids));
      })
      .catch(() => {
        if (active) setSaved(new Set());
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
    const wasSaved = saved.has(id);
    try {
      const response = await fetch("/api/alerts", {
        method: wasSaved ? "DELETE" : "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listingId: id }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error || "Watchlist could not be updated.");
      setSaved((items) => {
        const next = new Set(items);
        wasSaved ? next.delete(id) : next.add(id);
        return next;
      });
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Watchlist could not be updated.",
      );
    }
  };
  const facets = payload?.facets || {};
  const hasFilters = Object.entries(filters).some(
    ([key, value]) => key !== "view" && value,
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
  const openMapListing = (id: string) =>
    router.push(
      `/listings/${encodeURIComponent(id)}?returnTo=${encodeURIComponent(`${pathname}?${search}`)}`,
    );
  const exportCurrent = () => {
    const params = discoverySearchParams(filters, { format: "csv" });
    window.location.assign(`/api/export?${params}`);
  };

  return (
    <section className="mx-auto max-w-[1440px] px-4 py-7 sm:px-6 lg:px-8">
      <div className="rounded-3xl bg-slate-950 px-6 py-8 text-white shadow-xl sm:px-9">
        <p className="text-xs font-bold uppercase tracking-[.18em] text-slate-400">
          Property Evidence Directory
        </p>
        <h1 className="mt-3 text-3xl font-bold tracking-tight sm:text-5xl">
          Distressed property records, without hidden assumptions
        </h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300">
          Publisher-observed records and labeled demonstrations stay separate.
          PerfectProperty helps you decide what to verify; it does not operate
          auctions or accept bids.
        </p>
      </div>
      <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row">
          <label className="flex flex-1 items-center gap-2 rounded-xl border border-slate-300 px-3">
            <Search size={17} className="text-slate-400" />
            <input
              value={filters.q || ""}
              onChange={(event) =>
                setFilters({ q: event.target.value || undefined })
              }
              placeholder="Address, parcel, court case, or keyword"
              className="min-w-0 flex-1 bg-transparent py-3 text-sm outline-none"
            />
          </label>
          <label className="flex items-center gap-2 rounded-xl border border-slate-300 px-3 text-xs font-semibold">
            Sale window{" "}
            <input
              type="date"
              value={filters.saleFrom || ""}
              onChange={(event) =>
                setFilters({ saleFrom: event.target.value || undefined })
              }
              className="bg-transparent py-2 outline-none"
            />{" "}
            <span>to</span>{" "}
            <input
              type="date"
              value={filters.saleTo || ""}
              onChange={(event) =>
                setFilters({ saleTo: event.target.value || undefined })
              }
              className="bg-transparent py-2 outline-none"
            />
          </label>
          <label className="flex items-center gap-2 rounded-xl border border-slate-300 px-3 text-xs font-semibold">
            Max published amount{" "}
            <input
              inputMode="numeric"
              value={filters.maxBid || ""}
              onChange={(event) =>
                setFilters({ maxBid: event.target.value || undefined })
              }
              placeholder="$"
              className="w-24 bg-transparent py-3 outline-none"
            />
          </label>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {filterFields.map((field) => (
            <select
              key={field}
              aria-label={field}
              value={filters[field] || "all"}
              onChange={(event) => selectValue(field, event.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs"
            >
              <option value="all">{defaults[field]}</option>
              {(facets[field] || []).map((facet) => (
                <option key={facet.value} value={facet.value}>
                  {sourceDisplayText(facet.value)} ({facet.count})
                </option>
              ))}
            </select>
          ))}
          <button
            type="button"
            aria-pressed={filters.hasDocuments === "true"}
            onClick={() =>
              setFilters({
                hasDocuments:
                  filters.hasDocuments === "true" ? undefined : "true",
              })
            }
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold"
          >
            <FileText size={14} />
            Documents
          </button>
          <select
            aria-label="Sort results"
            value={filters.sort || "score"}
            onChange={(event) => setFilters({ sort: event.target.value })}
            className="rounded-lg border border-slate-200 px-3 py-2 text-xs"
          >
            <option value="score">Modeled score</option>
            <option value="date">Sale date</option>
            <option value="bid">Opening amount</option>
          </select>
        </div>
        {hasFilters && (
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
            <Filter size={14} className="text-slate-500" />
            {Object.entries(filters)
              .filter(([key, value]) => key !== "view" && value)
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
                  {key}: {sourceDisplayText(value!)}
                  <X size={12} />
                </button>
              ))}
            <button
              onClick={() => setFilters({})}
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
            {loading
              ? "Updating evidence…"
              : `${payload?.total ?? 0} matching records`}{" "}
            {payload?.revision ? `· Revision ${payload.revision}` : ""}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Unknown and stale values remain visible for review.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/hunts"
            className="inline-flex items-center gap-1 rounded-lg border px-3 py-2 text-xs font-semibold"
          >
            Save or review hunts
          </Link>
          <Link
            href="/sources"
            className="inline-flex items-center gap-1 rounded-lg border px-3 py-2 text-xs font-semibold"
          >
            Change inbox
          </Link>
          <button
            onClick={() => setFilters({ view: "grid" })}
            aria-pressed={(filters.view || "grid") === "grid"}
            className="inline-flex items-center gap-1 rounded-lg border px-3 py-2 text-xs font-semibold"
          >
            <ListFilter size={14} />
            <span>Deal Grid ({payload?.total ?? 0} records)</span>
          </button>
          <button
            onClick={() => setFilters({ view: "map" })}
            aria-pressed={filters.view === "map"}
            className="inline-flex items-center gap-1 rounded-lg border px-3 py-2 text-xs font-semibold"
          >
            <MapIcon size={14} />
            Map
          </button>
          <button
            onClick={() => setFilters({ view: "calendar" })}
            aria-pressed={filters.view === "calendar"}
            className="inline-flex items-center gap-1 rounded-lg border px-3 py-2 text-xs font-semibold"
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
      {filters.view === "map" ? (
        <div className="mt-5">
          <DiscoveryMap filters={filters} onOpenListing={openMapListing} />
        </div>
      ) : filters.view === "calendar" ? (
        <DiscoveryCalendar
          listings={payload?.listings || []}
          filters={filters}
        />
      ) : (
        <>
          {loading && !payload ? (
            <div className="mt-5 grid place-items-center rounded-2xl border border-slate-200 bg-white p-16 text-sm text-slate-500">
              <Loader2 className="mb-3 animate-spin" />
              Loading a bounded result page…
            </div>
          ) : !payload?.listings.length ? (
            <div className="mt-5 rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center">
              <SlidersHorizontal className="mx-auto text-slate-400" />
              <h2 className="mt-4 text-lg font-bold">
                No records match this evidence query.
              </h2>
              <p className="mt-2 text-sm text-slate-600">
                Broaden a filter or review source coverage for records that have
                not been observed yet.
              </p>
              <Link
                href="/sources"
                className="mt-4 inline-block text-sm font-semibold text-slate-900 underline"
              >
                Inspect source coverage
              </Link>
            </div>
          ) : (
            <div className="mt-5 grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
              {payload.listings.map((listing) => (
                <article
                  key={listing.id}
                  className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
                >
                  <div className="relative h-44 bg-slate-100">
                    <ListingThumbnail
                      listingId={listing.id}
                      address={listing.address}
                      photo={listing.photo}
                      observed={observed(listing)}
                    />
                    <div className="absolute left-3 top-3 flex gap-1">
                      <span className="rounded bg-slate-950/90 px-2 py-1 text-[10px] font-bold text-white">
                        {sourceDisplayText(
                          SOURCES[listing.source]?.label || listing.source,
                        )}
                      </span>
                      <span
                        className={`rounded px-2 py-1 text-[10px] font-bold ${observed(listing) ? "bg-emerald-50 text-emerald-900" : "bg-amber-50 text-amber-950"}`}
                      >
                        {observed(listing) ? "Observed" : "Demo / unverified"}
                      </span>
                    </div>
                    <button
                      onClick={() => toggleSaved(listing.id)}
                      aria-pressed={saved.has(listing.id)}
                      className="absolute right-3 top-3 rounded-full bg-white p-2 shadow"
                    >
                      <Bookmark
                        size={15}
                        className={
                          saved.has(listing.id)
                            ? "fill-slate-900 text-slate-900"
                            : ""
                        }
                      />
                    </button>
                  </div>
                  <div className="p-5">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h2 className="font-bold text-slate-950">
                          {listing.address}
                        </h2>
                        <p className="mt-1 text-xs text-slate-500">
                          {displayText(listing.city)}, {listing.state} ·{" "}
                          {displayText(listing.county, "County not published")}
                        </p>
                      </div>
                      <span className="rounded-lg bg-emerald-50 px-2 py-1 text-xs font-bold text-emerald-800">
                        {knownNumber(listing.dealScore) === null
                          ? "Not modeled"
                          : `${listing.dealScore}/100`}
                      </span>
                    </div>
                    <div className="mt-4 grid grid-cols-2 gap-3 border-y border-slate-100 py-3 text-xs">
                      <div>
                        <p className="text-slate-500">Published amount</p>
                        <p className="mt-1 font-bold">
                          {displayMoney(listing.openingBid)}
                        </p>
                      </div>
                      <div>
                        <p className="text-slate-500">Sale date</p>
                        <p className="mt-1 font-bold">
                          {displayDate(listing.saleDate)}
                        </p>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-1.5 text-[10px]">
                      {listing.program || listing.auctionProgram ? (
                        <span className="rounded bg-slate-100 px-2 py-1">
                          Program:{" "}
                          {sourceDisplayText(
                            listing.program || listing.auctionProgram || "",
                          )}
                        </span>
                      ) : (
                        <span className="rounded bg-amber-50 px-2 py-1 text-amber-900">
                          Program not captured
                        </span>
                      )}
                      {listing.lifecycle || listing.lifecycleStatus ? (
                        <span className="rounded bg-slate-100 px-2 py-1">
                          {sourceDisplayText(
                            listing.lifecycle || listing.lifecycleStatus || "",
                          )}
                        </span>
                      ) : (
                        <span className="rounded bg-amber-50 px-2 py-1 text-amber-900">
                          Lifecycle not captured
                        </span>
                      )}
                      {docs(listing) && (
                        <span className="rounded bg-emerald-50 px-2 py-1 text-emerald-900">
                          Publisher documents
                        </span>
                      )}
                      <span className="rounded bg-slate-100 px-2 py-1 text-slate-700">
                        {sourceDisplayText(
                          listing.discoveryStatus ||
                            "Discovery status not established",
                        )}
                      </span>
                    </div>
                    <p className="mt-3 text-[11px] text-slate-500">
                      {listing.sourceObservedAt
                        ? `Observed ${displayDate(listing.sourceObservedAt)}`
                        : "Observation time not established"}
                    </p>
                    <div className="mt-4 grid grid-cols-2 gap-2">
                      <Link
                        href={`/listings/${encodeURIComponent(listing.id)}?returnTo=${encodeURIComponent(discoveryUrl(filters))}`}
                        className="inline-flex h-10 items-center justify-center rounded-xl bg-slate-950 px-3 text-xs font-bold text-white"
                      >
                        Review dossier
                      </Link>
                      <CaseAction listingId={listing.id} label="Open case" />
                    </div>
                  </div>
                </article>
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
              Cursor pagination · no full inventory download
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
}: {
  listings: PropertyListing[];
  filters: DiscoveryFilters;
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
