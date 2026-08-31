"use client";
import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { INITIAL_LISTINGS, PropertyListing, SOURCES } from "./property-data";
import { PropertyDrawer } from "./property-drawer";
import { NoticeParser } from "./notice-parser";
import { WatchlistModal } from "./watchlist-modal";
import { MarketMap } from "./market-map";
import { Search, Bookmark, Calendar, Sparkles, LayoutGrid, ArrowRight, Map as MapIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const STATE_LABELS: Record<string, string> = {
  AZ: "Arizona",
  FL: "Florida",
  GA: "Georgia",
  IL: "Illinois",
  NJ: "New Jersey",
  NV: "Nevada",
  OH: "Ohio",
  PA: "Pennsylvania",
  TX: "Texas",
};

export function InteractiveTerminal() {
  const [listings, setListings] = useState<PropertyListing[]>(INITIAL_LISTINGS);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [watchlistHydrated, setWatchlistHydrated] = useState(false);
  const [selectedListing, setSelectedListing] = useState<PropertyListing | null>(null);
  const [isWatchlistOpen, setIsWatchlistOpen] = useState(false);
  const [activeView, setActiveView] = useState<"grid" | "map" | "parser">("grid");

  // Filter states
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedState, setSelectedState] = useState("all");
  const [selectedSource, setSelectedSource] = useState("all");
  const [sortBy, setSortBy] = useState<"score" | "equity" | "bid" | "date">("score");
  const [syncStatus, setSyncStatus] = useState<"loading" | "ready" | "refreshing" | "error">("loading");
  const [syncCount, setSyncCount] = useState(0);

  const loadListings = useCallback(async (refresh = false) => {
    setSyncStatus(refresh ? "refreshing" : "loading");
    try {
      const response = await fetch("/api/listings", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok || !Array.isArray(payload?.listings)) {
        throw new Error(payload?.error || `Listings request failed with HTTP ${response.status}`);
      }

      setListings(payload.listings);
      setSyncCount(payload.listings.length);
      setSyncStatus("ready");
    } catch {
      setSyncStatus("error");
      setSyncCount(INITIAL_LISTINGS.length);
    }
  }, []);

  useEffect(() => {
    void loadListings();
  }, [loadListings]);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem("perfectproperty:saved-listings");
      const ids = stored ? JSON.parse(stored) : [];
      if (Array.isArray(ids)) {
        setSavedIds(new Set(ids.filter((id): id is string => typeof id === "string")));
      }
    } catch {
      setSavedIds(new Set());
    } finally {
      setWatchlistHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!watchlistHydrated) return;
    window.localStorage.setItem(
      "perfectproperty:saved-listings",
      JSON.stringify(Array.from(savedIds)),
    );
  }, [savedIds, watchlistHydrated]);

  useEffect(() => {
    const handleHeroSearch = (event: Event) => {
      const detail = (event as CustomEvent<{ query?: string }>).detail;
      if (typeof detail?.query !== "string") return;
      const query = detail.query.trim();

      setSearchQuery(query);
      setActiveView("grid");
    };

    window.addEventListener("perfectproperty:search", handleHeroSearch);
    return () => window.removeEventListener("perfectproperty:search", handleHeroSearch);
  }, []);

  const toggleSave = (id: string) => {
    setSavedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleAddParsedListing = (newListing: PropertyListing) => {
    setListings((prev) => [newListing, ...prev]);
    setSavedIds((prev) => new Set(prev).add(newListing.id));
    setActiveView("grid");
    setSelectedListing(newListing);
  };

  const filtered = listings.filter((l) => {
    if (selectedState !== "all" && l.state !== selectedState) return false;
    if (selectedSource !== "all" && l.source !== selectedSource) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const hay = [l.address, l.city, l.county, l.state, l.zip, l.plaintiff, l.defendant, l.attorney].join(" ").toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  if (sortBy === "equity") filtered.sort((a, b) => b.equity - a.equity);
  else if (sortBy === "bid") filtered.sort((a, b) => a.openingBid - b.openingBid);
  else if (sortBy === "date") filtered.sort((a, b) => new Date(a.saleDate).getTime() - new Date(b.saleDate).getTime());
  else filtered.sort((a, b) => b.dealScore - a.dealScore);

  const savedListings = listings.filter((l) => savedIds.has(l.id));
  const availableStates = Array.from(
    new Set(listings.map((listing) => listing.state).filter(Boolean)),
  ).sort((a, b) => (STATE_LABELS[a] ?? a).localeCompare(STATE_LABELS[b] ?? b));

  return (
    <section id="live-feed" className="py-20 bg-[#F5F6F7] border-t border-[#E5E7EB]" aria-label="Live property feed">
      <div className="mx-auto max-w-[1200px] px-4">
        {/* Terminal Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-8">
          <div>
            <span className="text-[11px] font-extrabold uppercase tracking-wider text-[#16A34A]">
              LIVE TRIAGE TERMINAL
            </span>
            <h2 className="text-3xl font-bold text-[#111827]">Property Intelligence Engine</h2>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setActiveView("grid")}
              aria-pressed={activeView === "grid"}
              className={cn(
                "px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-1.5",
                activeView === "grid"
                  ? "bg-[#0F172A] text-white shadow-sm"
                  : "bg-white text-[#374151] border border-[#E5E7EB] hover:bg-[#F5F6F7]"
              )}
            >
              <LayoutGrid className="w-4 h-4" />
              <span>Deal Grid ({filtered.length})</span>
            </button>

            <button
              onClick={() => setActiveView("map")}
              aria-pressed={activeView === "map"}
              className={cn(
                "px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-1.5",
                activeView === "map"
                  ? "bg-[#0F172A] text-white shadow-sm"
                  : "bg-white text-[#374151] border border-[#E5E7EB] hover:bg-[#F5F6F7]"
              )}
            >
              <MapIcon className="w-4 h-4" />
              <span>Map ({filtered.length})</span>
            </button>

            <button
              onClick={() => setActiveView("parser")}
              aria-pressed={activeView === "parser"}
              className={cn(
                "px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-1.5",
                activeView === "parser"
                  ? "bg-[#0F172A] text-white shadow-sm"
                  : "bg-white text-[#374151] border border-[#E5E7EB] hover:bg-[#F5F6F7]"
              )}
            >
              <Sparkles className="w-4 h-4 text-[#FDBC15] fill-[#FDBC15]" />
              <span>Notice Parser</span>
            </button>

            <button
              onClick={() => setIsWatchlistOpen(true)}
              className="px-4 py-2 bg-white border border-[#E5E7EB] hover:border-[#16A34A] text-[#111827] text-xs font-bold rounded-xl transition flex items-center gap-1.5 shadow-sm"
            >
              <Bookmark className="w-4 h-4 text-[#16A34A] fill-[#16A34A]" />
              <span>Watchlist ({savedIds.size})</span>
            </button>
          </div>
        </div>

        {activeView === "parser" ? (
          <NoticeParser onSaveToWatchlist={handleAddParsedListing} />
        ) : (
          <>
            {/* Live Scraper Ingestion Banner */}
            <div className="mb-4 px-4 py-2.5 bg-[#0F172A] rounded-2xl border border-slate-700 text-white flex flex-wrap items-center justify-between gap-3 text-xs shadow-md">
              <div className="flex items-center gap-2">
                <span className={cn("w-2 h-2 rounded-full", syncStatus === "error" ? "bg-amber-400" : "bg-[#22C55E]")} />
                <span className={cn("font-bold", syncStatus === "error" ? "text-amber-300" : "text-[#22C55E]")}>
                  {syncStatus === "error" ? "Demo fallback — data API unavailable" : "Connected to live data API"}
                </span>
                <span className="text-slate-400 hidden sm:inline">· scraper execution runs separately on the backend</span>
              </div>
              <div className="flex items-center gap-3 font-mono text-[11px] text-slate-300">
                {syncStatus === "ready" && <span className="text-[#22C55E] font-bold">{syncCount} properties loaded</span>}
                {syncStatus === "loading" && <span>Connecting to property API…</span>}
                {syncStatus === "error" && <span>{syncCount} demo properties loaded</span>}
                <button
                  disabled={syncStatus === "loading" || syncStatus === "refreshing"}
                  onClick={() => void loadListings(true)}
                  className="bg-[#22C55E] hover:bg-[#16a34a] disabled:opacity-60 text-black font-bold px-3 py-1 rounded-lg text-[10px] uppercase transition tracking-wider flex items-center gap-1"
                >
                  {syncStatus === "refreshing" ? (
                    <><span className="w-2.5 h-2.5 border-2 border-black/40 border-t-black rounded-full animate-spin inline-block" />Refreshing…</>
                  ) : "Refresh live feed"}
                </button>
              </div>
            </div>

            {/* Filter Bar */}
            <div className="p-4 bg-white rounded-2xl border border-[#E5E7EB] shadow-sm mb-6 flex flex-wrap items-center gap-3">
              {/* Search */}
              <div className="relative flex-1 min-w-[240px]">
                <Search className="w-4 h-4 text-[#9CA3AF] absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  aria-label="Search listings"
                  placeholder="Search address, county, court docket..."
                  className="w-full pl-9 pr-4 py-2 text-xs rounded-xl border border-[#D1D5DB] bg-white focus:outline-none focus:border-[#0F172A]"
                />
              </div>

              {/* State Filter */}
              <select
                value={selectedState}
                onChange={(e) => setSelectedState(e.target.value)}
                aria-label="State filter"
                className="px-3 py-2 text-xs font-semibold rounded-xl border border-[#D1D5DB] bg-white text-[#374151]"
              >
                <option value="all">All States</option>
                {availableStates.map((state) => (
                  <option key={state} value={state}>
                    {STATE_LABELS[state] ? `${STATE_LABELS[state]} (${state})` : state}
                  </option>
                ))}
              </select>

              {/* Source Filter */}
              <select
                value={selectedSource}
                onChange={(e) => setSelectedSource(e.target.value)}
                aria-label="Source filter"
                className="px-3 py-2 text-xs font-semibold rounded-xl border border-[#D1D5DB] bg-white text-[#374151]"
              >
                <option value="all">All Sources</option>
                {Object.values(SOURCES).map((s) => (
                  <option key={s.key} value={s.key}>{s.label}</option>
                ))}
              </select>

              {/* Sort By */}
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as any)}
                aria-label="Sort listings"
                className="px-3 py-2 text-xs font-semibold rounded-xl border border-[#D1D5DB] bg-white text-[#374151]"
              >
                <option value="score">Deal Score (Highest)</option>
                <option value="equity">Built-in Equity (Highest)</option>
                <option value="bid">Opening Bid (Lowest)</option>
                <option value="date">Auction Date (Soonest)</option>
              </select>
            </div>

            {activeView === "map" ? (
              <MarketMap listings={filtered} onUnderwrite={setSelectedListing} />
            ) : (
            /* Listings Grid */
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {filtered.map((listing) => {
                const src = SOURCES[listing.source] || SOURCES.sheriff;
                const isSaved = savedIds.has(listing.id);

                return (
                  <div
                    key={listing.id}
                    className="bg-white rounded-2xl border border-[#E5E7EB] overflow-hidden shadow-sm hover:shadow-lg transition duration-200 flex flex-col justify-between group"
                  >
                    <div>
                      {/* Photo + Tags */}
                      <div className="relative h-48 w-full bg-[#F5F6F7] overflow-hidden">
                        <img
                          src={listing.photo}
                          alt={listing.address}
                          className="w-full h-full object-cover group-hover:scale-105 transition duration-300"
                        />
                        <div className="absolute top-3 left-3 flex items-center gap-1.5">
                          <span
                            className="text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-md text-white shadow-sm"
                            style={{ backgroundColor: src.color }}
                          >
                            {src.label}
                          </span>
                        </div>
                        <button
                          onClick={(e) => { e.stopPropagation(); toggleSave(listing.id); }}
                          aria-label={isSaved ? `Remove ${listing.address} from watchlist` : `Add ${listing.address} to watchlist`}
                          aria-pressed={isSaved}
                          className="absolute top-3 right-3 p-1.5 rounded-full bg-white/90 backdrop-blur-md text-[#374151] hover:text-[#16A34A] shadow"
                        >
                          <Bookmark className={cn("w-4 h-4", isSaved && "fill-[#16A34A] text-[#16A34A]")} />
                        </button>
                      </div>

                      {/* Card Content */}
                      <div className="p-5 space-y-3">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <h3 className="font-bold text-base text-[#111827] line-clamp-1">{listing.address}</h3>
                            <p className="text-xs text-[#6B7280]">{listing.city}, {listing.state} · {listing.county} Co.</p>
                          </div>
                          <span className="text-xs font-extrabold px-2.5 py-1 rounded-md bg-[#16A34A]/10 text-[#16A34A] shrink-0">
                            {listing.dealScore}/100
                          </span>
                        </div>

                        {/* Metric Row */}
                        <div className="grid grid-cols-2 gap-2 pt-2 border-t border-[#E5E7EB] text-xs">
                          <div>
                            <span className="text-[#6B7280] block">Opening Bid:</span>
                            <span data-testid="listing-opening-bid" className="font-bold text-[#111827] text-sm">${listing.openingBid.toLocaleString()}</span>
                          </div>
                          <div>
                            <span className="text-[#16A34A] font-semibold block">Est. Equity Spread:</span>
                            <span className="font-bold text-[#16A34A] text-sm">+${listing.equity.toLocaleString()}</span>
                          </div>
                        </div>

                        <p className="text-xs text-[#6B7280] flex items-center gap-1 pt-1">
                          <Calendar className="w-3.5 h-3.5 text-[#9CA3AF]" />
                          Auction: <span className="font-semibold text-[#111827]">{listing.saleDate}</span>
                        </p>
                      </div>
                    </div>

                    {/* Card Action */}
                    <div className="grid grid-cols-2 gap-2 px-5 pb-5 pt-1">
                      <button
                        onClick={() => setSelectedListing(listing)}
                        className="w-full inline-flex h-10 items-center justify-center rounded-xl bg-[#0F172A] text-white text-xs font-bold hover:bg-[#1E293B] transition gap-1 shadow-sm"
                      >
                        <span>Underwrite Deal</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                      <Link
                        href={`/listings/${encodeURIComponent(listing.id)}`}
                        data-testid="listing-detail-link"
                        aria-label={`Open listing page for ${listing.address}`}
                        className="w-full inline-flex h-10 items-center justify-center rounded-xl border border-[#D1D5DB] bg-white text-[#0F172A] text-xs font-bold hover:bg-[#F3F4F6] transition gap-1 shadow-sm"
                      >
                        <span>Listing page</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
            )}
          </>
        )}
      </div>

      {/* Slide-over Detail Drawer */}
      <PropertyDrawer
        listing={selectedListing}
        onClose={() => setSelectedListing(null)}
        isSaved={selectedListing ? savedIds.has(selectedListing.id) : false}
        onToggleSave={toggleSave}
      />

      {/* Watchlist Modal */}
      <WatchlistModal
        isOpen={isWatchlistOpen}
        onClose={() => setIsWatchlistOpen(false)}
        savedListings={savedListings}
        onRemove={toggleSave}
        onSelectListing={setSelectedListing}
      />
    </section>
  );
}
