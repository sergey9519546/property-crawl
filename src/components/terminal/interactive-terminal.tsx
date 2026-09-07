"use client";
import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { INITIAL_LISTINGS, PropertyListing, SOURCES } from "./property-data";
import { PropertyDrawer } from "./property-drawer";
import { NoticeParser } from "./notice-parser";
import { WatchlistModal } from "./watchlist-modal";
import { AlertsModal } from "./alerts-modal";
import { MarketMap } from "./market-map";
import { ListingThumbnail } from "@/components/listings/listing-thumbnail";
import {
  Search,
  Bookmark,
  Bell,
  Calendar,
  Sparkles,
  LayoutGrid,
  ArrowRight,
  Map as MapIcon,
  SlidersHorizontal,
  RotateCcw,
  X as CloseIcon,
  TrendingUp,
  ShieldCheck,
  ShieldAlert,
  ChevronDown,
  Building2,
  Filter,
  Scale,
  Crosshair,
  Radio
} from "lucide-react";
import { cn } from "@/lib/utils";
import { displayDate, displayMoney, displayText, knownNumber } from "@/lib/listing-display";
import { getExactSourceListingUrl } from "@/lib/listing-links";
import { loadListingInventory } from "@/lib/listing-inventory";
import { sourceRecordCountsAtAddress } from "@/lib/listing-record-groups";
import { inspectPublisherPhoto } from "@/lib/scrapers/media-policy";
import { inspectSecondaryMedia } from "@/lib/scrapers/secondary-property-media";
import { sourceDisplayText } from "@/lib/source-display";
import type { SavedSearch } from "@/lib/saved-searches";
import { CaseAction } from "@/components/research/case-action";

type TerminalFilters = {
  searchQuery: string; selectedState: string; selectedSource: string; observedOnly: boolean;
  sortBy: "score" | "equity" | "bid" | "date" | "images"; minDealScore: number; minEquity: number;
  maxOpeningBid: number | null; propertyType: string; occupancy: string;
  seniorLienFilter: string; redemptionFilter: string; activeView: "grid" | "map" | "parser";
};

function terminalQuery(filters: TerminalFilters) {
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

function isObservedSourceRecord(listing: PropertyListing) {
  const provenance = listing.provenance;
  if (!provenance || typeof provenance !== "object") return false;
  const observedAt = listing.sourceObservedAt ?? provenance.observedAt;
  const publisher = typeof provenance.publisher === "string" ? provenance.publisher.trim() : "";
  const recordId = typeof provenance.recordId === "string" || typeof provenance.recordId === "number"
    ? String(provenance.recordId).trim()
    : "";
  return provenance.origin === "live"
    && provenance.observed === true
    && provenance.recordKind === "source_record"
    && publisher.length > 0
    && recordId.length > 0
    && typeof observedAt === "string"
    && Number.isFinite(Date.parse(observedAt))
    && getExactSourceListingUrl(listing, SOURCES[listing.source]?.websiteUrl) !== null;
}

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
  const [isAlertsOpen, setIsAlertsOpen] = useState(false);
  const [activeView, setActiveView] = useState<"grid" | "map" | "parser">("grid");

  // Filter states
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedState, setSelectedState] = useState("all");
  const [selectedSource, setSelectedSource] = useState("all");
  const [observedOnly, setObservedOnly] = useState(false);
  const [sortBy, setSortBy] = useState<"score" | "equity" | "bid" | "date" | "images">("date");
  const [minDealScore, setMinDealScore] = useState<number>(0);
  const [minEquity, setMinEquity] = useState<number>(0);
  const [maxOpeningBid, setMaxOpeningBid] = useState<number | null>(null);
  const [propertyType, setPropertyType] = useState<string>("all");
  const [occupancy, setOccupancy] = useState<string>("all");
  const [seniorLienFilter, setSeniorLienFilter] = useState<string>("all");
  const [redemptionFilter, setRedemptionFilter] = useState<string>("all");
  const [isAdvancedOpen, setIsAdvancedOpen] = useState<boolean>(false);
  const [syncStatus, setSyncStatus] = useState<"loading" | "ready" | "refreshing" | "error">("loading");
  const [syncCount, setSyncCount] = useState(0);
  const [observedCount, setObservedCount] = useState(0);
  const [inventoryNotice, setInventoryNotice] = useState("");
  const [workspaceRecords, setWorkspaceRecords] = useState<PropertyListing[]>([]);
  const workspaceRecordsRef = React.useRef<PropertyListing[]>([]);
  const refreshGeneration = React.useRef(0);
  const [urlReady, setUrlReady] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setSearchQuery(params.get("q") || "");
    setSelectedState(params.get("state") || "all");
    setSelectedSource(params.get("source") || "all");
    setObservedOnly(params.get("observed") === "1");
    const sort = params.get("sort");
    if (sort && ["score", "equity", "bid", "date"].includes(sort)) setSortBy(sort as "score" | "equity" | "bid" | "date");
    const numberParam = (name: string) => { const value = Number(params.get(name)); return Number.isFinite(value) && value >= 0 ? value : 0; };
    setMinDealScore(numberParam("minScore"));
    setMinEquity(numberParam("minSpread"));
    setMaxOpeningBid(params.has("maxBid") ? numberParam("maxBid") : null);
    setPropertyType(params.get("type") || "all");
    setOccupancy(params.get("occupancy") || "all");
    setSeniorLienFilter(params.get("lien") || "all");
    setRedemptionFilter(params.get("redemption") || "all");
    const view = params.get("view");
    if (view && ["grid", "map", "parser"].includes(view)) setActiveView(view as "grid" | "map" | "parser");
    setUrlReady(true);
  }, []);

  const loadListings = useCallback(async (refresh = false) => {
    const generation = ++refreshGeneration.current;
    setSyncStatus(refresh ? "refreshing" : "loading");
    try {
      const payload = await loadListingInventory<PropertyListing>();
      if (generation !== refreshGeneration.current) return;
      const nextListings = payload.listings;
      setListings(nextListings);
      try {
        window.sessionStorage.setItem("perfectproperty:inventory-cache", JSON.stringify(nextListings));
      } catch {}
      window.dispatchEvent(new CustomEvent("perfectproperty:inventory", { detail: nextListings }));
      setSyncCount(payload.listings.length);
      setObservedCount(nextListings.filter(isObservedSourceRecord).length);
      setInventoryNotice(payload.truncated ? `Showing ${nextListings.length} of ${payload.total} records. The local inventory safety limit was reached.` : "");
      setSyncStatus("ready");
    } catch {
      if (generation !== refreshGeneration.current) return;
      setSyncStatus("error");
      setInventoryNotice("Refresh failed. Last loaded records remain available; source freshness has not been confirmed.");
    }
  }, []);

  useEffect(() => {
    void loadListings();
  }, [loadListings]);

  useEffect(() => {
    try {
      const cached = window.sessionStorage.getItem("perfectproperty:inventory-cache");
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setListings(parsed);
          setSyncCount(parsed.length);
          setObservedCount(parsed.filter(isObservedSourceRecord).length);
        }
      }
    } catch {}
    try {
      const stored = window.localStorage.getItem("perfectproperty:saved-listings");
      const ids = stored ? JSON.parse(stored) : [];
      if (Array.isArray(ids)) {
        setSavedIds(new Set(ids.filter((id): id is string => typeof id === "string")));
      }
      const rawRecords = window.localStorage.getItem("perfectproperty:research-records:v1");
      const records = rawRecords && rawRecords.length < 2_000_000 ? JSON.parse(rawRecords) : [];
      if (Array.isArray(records)) {
        const valid = records.filter((item) => item && typeof item.id === "string" && typeof item.address === "string" && typeof item.source === "string" && typeof item.state === "string").slice(0, 100);
        workspaceRecordsRef.current = valid;
        setWorkspaceRecords(valid);
      }
    } catch {
      setSavedIds(new Set());
    } finally {
      setWatchlistHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!watchlistHydrated) return;
    try { window.localStorage.setItem(
      "perfectproperty:saved-listings",
      JSON.stringify(Array.from(savedIds)),
    ); } catch { setInventoryNotice("Browser storage is unavailable. Watchlist changes will last only for this session."); }
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
    const next = [newListing, ...workspaceRecordsRef.current.filter((item) => item.id !== newListing.id)].slice(0, 100);
    workspaceRecordsRef.current = next;
    setWorkspaceRecords(next);
    try { window.localStorage.setItem("perfectproperty:research-records:v1", JSON.stringify(next)); }
    catch { setInventoryNotice("This research record could not be saved to browser storage. Export it before closing this session."); }
    setSavedIds((prev) => new Set([...prev, newListing.id]));
    setActiveView("grid");
    setSelectedListing(newListing);
  };

  const handleDeepCheckAddress = (addressQuery: string) => {
    const parts = addressQuery.split(",").map((p) => p.trim());
    const address = parts[0] || addressQuery;
    const city = parts[1] || null;
    const stateZip = parts[2]?.trim().split(/\s+/) || [];
    const state = stateZip[0] || "";
    const zip = stateZip[1] || null;

    const customListing: PropertyListing = {
      id: `custom-${Date.now()}`,
      address,
      city,
      county: null,
      state: state.toUpperCase(),
      zip,
      lat: null,
      lng: null,
      beds: null,
      baths: null,
      sqft: null,
      year: null,
      openingBid: null,
      estLow: null,
      estHigh: null,
      assessed: null,
      mid: null,
      ratio: null,
      equity: null,
      dealScore: null,
      saleDate: null,
      source: "manual",
      propType: null,
      occupancy: null,
      deposit: null,
      photo: null,
      images: [],
      plaintiff: null,
      defendant: null,
      judgment: null,
      attorney: null,
      redemptionDays: null,
      seniorLienRisk: undefined,
      cashToClose: null,
      status: "research",
      provenance: { recordKind: "user-entered research query" },
    };

    setSelectedListing(customListing);
  };

  const resetFilters = () => {
    setObservedOnly(false);
    setSearchQuery("");
    setSelectedState("all");
    setSelectedSource("all");
    setMinDealScore(0);
    setMinEquity(0);
    setMaxOpeningBid(null);
    setPropertyType("all");
    setOccupancy("all");
    setSeniorLienFilter("all");
    setRedemptionFilter("all");
    setSortBy("date");
  };

  const serializedFilters = terminalQuery({ searchQuery, selectedState, selectedSource, observedOnly, sortBy, minDealScore, minEquity, maxOpeningBid, propertyType, occupancy, seniorLienFilter, redemptionFilter, activeView });
  const currentPath = typeof window !== "undefined" ? window.location.pathname : "/";
  const currentHash = typeof window !== "undefined" ? window.location.hash : "";
  const returnContext = `${currentPath}${serializedFilters ? `?${serializedFilters}` : ""}${currentHash}`;

  useEffect(() => {
    if (!urlReady) return;
    if (typeof window !== "undefined" && window.location.pathname === "/") {
      if (window.location.hash) {
        window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.hash}`);
      }
      return;
    }
    window.history.replaceState(window.history.state, "", returnContext);
  }, [urlReady, returnContext]);

  const activeFiltersCount =
    (observedOnly ? 1 : 0) +
    (searchQuery ? 1 : 0) +
    (selectedState !== "all" ? 1 : 0) +
    (selectedSource !== "all" ? 1 : 0) +
    (minDealScore > 0 ? 1 : 0) +
    (minEquity > 0 ? 1 : 0) +
    (maxOpeningBid !== null ? 1 : 0) +
    (propertyType !== "all" ? 1 : 0) +
    (occupancy !== "all" ? 1 : 0) +
    (seniorLienFilter !== "all" ? 1 : 0) +
    (redemptionFilter !== "all" ? 1 : 0);

  const inventory = [...workspaceRecords.filter((record) => !listings.some((item) => item.id === record.id)), ...listings];
  const observedRecordCountsAtAddress = sourceRecordCountsAtAddress(inventory, isObservedSourceRecord);
  const normalizedQuery = searchQuery.toLowerCase().trim();
  const exactSearchField = (["county", "city", "state", "zip"] as const).find((field) => normalizedQuery && inventory.some((item) => item[field]?.toLowerCase() === normalizedQuery));
  const filtered = inventory.filter((l) => {
    if (observedOnly && !isObservedSourceRecord(l)) return false;
    if (selectedState !== "all" && l.state !== selectedState) return false;
    if (selectedSource !== "all" && l.source !== selectedSource) return false;
    const dealScore = knownNumber(l.dealScore);
    const equity = knownNumber(l.equity);
    const openingBid = knownNumber(l.openingBid);
    if (minDealScore > 0 && (dealScore === null || dealScore < minDealScore)) return false;
    if (minEquity > 0 && (equity === null || equity < minEquity)) return false;
    if (maxOpeningBid !== null && (openingBid === null || openingBid > maxOpeningBid)) return false;
    if (propertyType !== "all" && l.propType?.toLowerCase() !== propertyType.toLowerCase()) return false;
    if (occupancy !== "all" && l.occupancy?.toLowerCase() !== occupancy.toLowerCase()) return false;
    if (seniorLienFilter === "clean" && l.seniorLienRisk !== "low") return false;
    if (seniorLienFilter === "risk" && l.seniorLienRisk !== "high") return false;
    if (redemptionFilter === "immediate" && l.redemptionDays !== 0) return false;
    if (redemptionFilter === "redemption_active" && (!l.redemptionDays || l.redemptionDays === 0)) return false;

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      if (exactSearchField) return l[exactSearchField]?.toLowerCase() === q;

      const hay = [l.address, l.city, l.county, l.state, l.zip, l.plaintiff, l.defendant, l.attorney].join(" ").toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const compareKnown = (a: number | null, b: number | null, direction: "asc" | "desc") => {
    if (a === null && b === null) return 0;
    if (a === null) return 1;
    if (b === null) return -1;
    return direction === "asc" ? a - b : b - a;
  };
  const parsedDate = (value: string | null) => {
    if (!value) return null;
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? timestamp : null;
  };
  const deadlineOrder = (value: string | null) => {
    const timestamp = parsedDate(value);
    if (timestamp === null) return { bucket: 1, value: Number.MAX_SAFE_INTEGER };
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    if (timestamp >= startOfToday.getTime()) return { bucket: 0, value: timestamp };
    return { bucket: 2, value: -timestamp };
  };

  if (sortBy === "equity") filtered.sort((a, b) => compareKnown(knownNumber(a.equity), knownNumber(b.equity), "desc"));
  else if (sortBy === "bid") filtered.sort((a, b) => compareKnown(knownNumber(a.openingBid), knownNumber(b.openingBid), "asc"));
  else if (sortBy === "date") filtered.sort((a, b) => {
    const left = deadlineOrder(a.saleDate);
    const right = deadlineOrder(b.saleDate);
    return left.bucket - right.bucket || left.value - right.value || a.id.localeCompare(b.id);
  });
  else if (sortBy === "images") filtered.sort((a, b) => (b.images?.length || 0) - (a.images?.length || 0));
  else filtered.sort((a, b) => compareKnown(knownNumber(a.dealScore), knownNumber(b.dealScore), "desc"));

  const knownBids = filtered.map((listing) => knownNumber(listing.openingBid)).filter((value): value is number => value !== null).sort((a, b) => a - b);
  const medianBid = knownBids.length > 0 ? knownBids[Math.floor(knownBids.length / 2)] : null;
  const knownEquity = filtered.map((listing) => knownNumber(listing.equity)).filter((value): value is number => value !== null);
  const avgEquity = knownEquity.length > 0 ? Math.round(knownEquity.reduce((sum, value) => sum + value, 0) / knownEquity.length) : null;
  const knownScores = filtered.map((listing) => knownNumber(listing.dealScore)).filter((value): value is number => value !== null);
  const eliteCount = knownScores.filter((score) => score >= 70).length;
  const strongCount = knownScores.filter((score) => score >= 55 && score < 70).length;
  const fairCount = knownScores.filter((score) => score >= 35 && score < 55).length;

  const savedListings = inventory.filter((l) => savedIds.has(l.id));
  const availableStates = Array.from(
    new Set(listings.map((listing) => listing.state).filter(Boolean)),
  ).sort((a, b) => (STATE_LABELS[a] ?? a).localeCompare(STATE_LABELS[b] ?? b));

  const availableSources = Array.from(
    new Set([...Object.keys(SOURCES), ...listings.map((l) => l.source).filter(Boolean)]),
  );

  return (
    <section id="live-feed" className="py-20 bg-[#F5F6F7] border-t border-[#E5E7EB]" aria-label="Live property feed">
      <div className="mx-auto max-w-[1200px] px-4">
        {/* Terminal Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-8">
          <div>
            <span className="text-[11px] font-extrabold uppercase tracking-wider text-emerald-700">
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
              <span>Deal Grid ({filtered.length} records)</span>
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
              <span>Map ({filtered.length} records)</span>
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
              className="px-4 py-2 bg-white border border-[#E5E7EB] hover:border-slate-900 text-[#111827] text-xs font-bold rounded-xl transition flex items-center gap-1.5 shadow-sm"
            >
              <Bookmark className="w-4 h-4 text-[#0F172A] fill-[#0F172A]" />
              <span>Watchlist ({savedIds.size})</span>
            </button>

            <button
              onClick={() => setIsAlertsOpen(true)}
              className="px-4 py-2 bg-white border border-[#E5E7EB] hover:border-amber-500 text-[#111827] text-xs font-bold rounded-xl transition flex items-center gap-1.5 shadow-sm"
              aria-label="Open Alerts Manager"
            >
              <Bell className="w-4 h-4 text-amber-500 fill-amber-500/20" />
              <span>Saved searches</span>
            </button>

            <Link
              href="/hunts"
              className="px-4 py-2 bg-white border border-[#E5E7EB] hover:border-emerald-700 text-[#111827] text-xs font-bold rounded-xl transition flex items-center gap-1.5 shadow-sm"
              title="Durable saved hunts criteria engine"
            >
              <Crosshair className="w-4 h-4 text-emerald-700" />
              <span>Saved Hunts</span>
            </Link>

            <Link
              href="/sources"
              className="px-4 py-2 bg-white border border-[#E5E7EB] hover:border-slate-800 text-[#111827] text-xs font-bold rounded-xl transition flex items-center gap-1.5 shadow-sm"
              title="Source network intake and collector radar"
            >
              <Radio className="w-4 h-4 text-slate-700" />
              <span>Source Radar</span>
            </Link>
          </div>
        </div>

        {activeView === "parser" ? (
          <NoticeParser onSaveToWatchlist={handleAddParsedListing} />
        ) : (
          <>
            {/* Live Scraper Ingestion Banner */}
            <div className="mb-4 px-4 py-2.5 bg-[#0F172A] rounded-2xl border border-slate-700 text-white flex flex-wrap items-center justify-between gap-3 text-xs shadow-md">
              <div className="flex items-center gap-2">
                <span className={cn("w-2 h-2 rounded-full", syncStatus === "ready" && observedCount > 0 ? "bg-emerald-400" : "bg-amber-400")} />
                <span className={cn("font-bold", syncStatus === "ready" && observedCount > 0 ? "text-emerald-400" : "text-amber-300")}>
                  {syncStatus === "error"
                    ? "Demo fallback — data API unavailable"
                    : observedCount === 0 && syncCount > 0
                      ? "Unverified or demo feed — no source-observed records"
                      : observedCount === syncCount && syncCount > 0
                        ? "Connected to source-observed property feed"
                        : "Mixed evidence feed — verify each record"}
                </span>
                <span className="text-slate-400 hidden sm:inline">· scraper execution runs separately on the backend</span>
              </div>
              <div className="flex items-center gap-3 font-mono text-[11px] text-slate-300">
                {syncStatus === "ready" && <span className={cn("font-bold", observedCount > 0 ? "text-emerald-400" : "text-amber-300")}>{observedCount} observed · {syncCount - observedCount} demo/unverified</span>}
                {syncStatus === "loading" && <span>Connecting to property API…</span>}
                {syncStatus === "error" && <span>Last loaded inventory retained</span>}
                <button
                  disabled={syncStatus === "loading" || syncStatus === "refreshing"}
                  onClick={() => void loadListings(true)}
                  className="bg-slate-800 hover:bg-slate-700 disabled:opacity-60 text-white font-bold px-3 py-1 rounded-lg text-[10px] uppercase transition tracking-wider flex items-center gap-1 border border-slate-600"
                >
                  {syncStatus === "refreshing" ? (
                    <><span className="w-2.5 h-2.5 border-2 border-black/40 border-t-black rounded-full animate-spin inline-block" />Refreshing…</>
                  ) : "Refresh live feed"}
                </button>
              </div>
            </div>

            {inventoryNotice && <p role="status" className="mb-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">{inventoryNotice}</p>}
            {/* Filter Bar */}
            <div className="p-4 bg-white rounded-2xl border border-[#E5E7EB] shadow-sm mb-4 space-y-3">
              <div className="flex flex-wrap items-center gap-3">
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
                  className="px-3 py-2 text-xs font-semibold rounded-xl border border-[#D1D5DB] bg-white text-[#374151] outline-none focus:outline-none focus:ring-2 focus:ring-slate-900/20"
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
                  className="px-3 py-2 text-xs font-semibold rounded-xl border border-[#D1D5DB] bg-white text-[#374151] outline-none focus:outline-none focus:ring-2 focus:ring-slate-900/20"
                >
                  <option value="all">All Sources</option>
                  {availableSources.map((key) => {
                    const s = SOURCES[key];
                    return (
                      <option key={key} value={key}>
                        {s ? s.label : key}
                      </option>
                    );
                  })}
                </select>

                {/* Sort By */}
                <button
                  type="button"
                  aria-pressed={observedOnly}
                  onClick={() => setObservedOnly((value) => !value)}
                  className={cn("rounded-xl border px-3 py-2 text-xs font-semibold transition", observedOnly ? "border-[#0F172A] bg-[#0F172A] text-white" : "border-[#D1D5DB] bg-white text-[#374151]")}
                >Source-observed only</button>
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as any)}
                  aria-label="Sort listings"
                  className="px-3 py-2 text-xs font-semibold rounded-xl border border-[#D1D5DB] bg-white text-[#374151] outline-none focus:outline-none focus:ring-2 focus:ring-slate-900/20"
                >
                  <option value="date">Published Deadline (Soonest)</option>
                  <option value="equity">Bid Spread (Highest)</option>
                  <option value="bid">Opening Bid (Lowest)</option>
                  <option value="score">Modeled Triage Score (Highest)</option>
                  <option value="images">Most Photos</option>
                </select>

                {/* Advanced Underwriting Box Trigger */}
                <button
                  type="button"
                  onClick={() => setIsAdvancedOpen(!isAdvancedOpen)}
                  className={cn(
                    "px-3 py-2 text-xs font-semibold rounded-xl border transition flex items-center gap-1.5 shadow-sm",
                    isAdvancedOpen || activeFiltersCount > 0
                      ? "bg-[#0F172A] text-white border-[#0F172A]"
                      : "bg-white border-[#D1D5DB] text-[#374151] hover:bg-[#F5F6F7]"
                  )}
                  aria-expanded={isAdvancedOpen}
                  aria-label="Toggle institutional filters"
                >
                  <SlidersHorizontal className="w-3.5 h-3.5" />
                  <span>Institutional Filters {activeFiltersCount > 0 ? `(${activeFiltersCount})` : ""}</span>
                  <ChevronDown className={cn("w-3.5 h-3.5 transition-transform", isAdvancedOpen && "rotate-180")} />
                </button>

                {/* Reset All Filters */}
                {activeFiltersCount > 0 && (
                  <button
                    type="button"
                    onClick={resetFilters}
                    className="px-3 py-2 text-xs font-semibold rounded-xl border border-red-200 bg-red-50 text-red-700 hover:bg-red-100 transition flex items-center gap-1"
                    aria-label="Reset all filters"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>Reset ({activeFiltersCount})</span>
                  </button>
                )}
              </div>

              {/* Advanced Underwriting Drawer Tray */}
              {isAdvancedOpen && (
                <div className="pt-3 border-t border-[#E5E7EB] grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 animate-in fade-in duration-150">
                  {/* Min Deal Score */}
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-[#6B7280] mb-1">
                      Min Deal Score
                    </label>
                    <select
                      value={minDealScore}
                      onChange={(e) => setMinDealScore(Number(e.target.value))}
                      className="w-full px-2.5 py-1.5 text-xs font-semibold rounded-lg border border-[#D1D5DB] bg-white text-[#374151]"
                    >
                      <option value={0}>Any Score</option>
                      <option value={70}>70+ (Elite Only)</option>
                      <option value={55}>55+ (Strong & Above)</option>
                      <option value={35}>35+ (Fair & Above)</option>
                    </select>
                  </div>

                  {/* Minimum modeled bid spread */}
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-[#6B7280] mb-1">
                      Min Bid Spread
                    </label>
                    <select
                      value={minEquity}
                      onChange={(e) => setMinEquity(Number(e.target.value))}
                      className="w-full px-2.5 py-1.5 text-xs font-semibold rounded-lg border border-[#D1D5DB] bg-white text-[#374151]"
                    >
                      <option value={0}>Any Bid Spread</option>
                      <option value={25000}>$25,000+</option>
                      <option value={50000}>$50,000+</option>
                      <option value={75000}>$75,000+</option>
                      <option value={100000}>$100,000+</option>
                    </select>
                  </div>

                  {/* Max Opening Bid */}
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-[#6B7280] mb-1">
                      Max Opening Bid
                    </label>
                    <select
                      value={maxOpeningBid === null ? "all" : maxOpeningBid}
                      onChange={(e) => setMaxOpeningBid(e.target.value === "all" ? null : Number(e.target.value))}
                      className="w-full px-2.5 py-1.5 text-xs font-semibold rounded-lg border border-[#D1D5DB] bg-white text-[#374151]"
                    >
                      <option value="all">Any Opening Bid</option>
                      <option value={50000}>Under $50k</option>
                      <option value={100000}>Under $100k</option>
                      <option value={150000}>Under $150k</option>
                      <option value={250000}>Under $250k</option>
                    </select>
                  </div>

                  {/* Property Type */}
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-[#6B7280] mb-1">
                      Property Type
                    </label>
                    <select
                      value={propertyType}
                      onChange={(e) => setPropertyType(e.target.value)}
                      className="w-full px-2.5 py-1.5 text-xs font-semibold rounded-lg border border-[#D1D5DB] bg-white text-[#374151]"
                    >
                      <option value="all">All Types</option>
                      <option value="Single Family">Single Family</option>
                      <option value="Multi-Family">Multi-Family</option>
                      <option value="Condo">Condo / Townhome</option>
                      <option value="Land">Land / Lot</option>
                    </select>
                  </div>

                  {/* Senior Lien / Title Risk */}
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-[#6B7280] mb-1">
                      Senior Title Risk
                    </label>
                    <select
                      value={seniorLienFilter}
                      onChange={(e) => setSeniorLienFilter(e.target.value)}
                      className="w-full px-2.5 py-1.5 text-xs font-semibold rounded-lg border border-[#D1D5DB] bg-white text-[#374151]"
                    >
                      <option value="all">All Title Profiles</option>
                      <option value="clean">Clean 1st Lien Only</option>
                      <option value="risk">Junior Foreclosure Risk</option>
                    </select>
                  </div>

                  {/* Statutory Redemption */}
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-[#6B7280] mb-1">
                      Redemption Status
                    </label>
                    <select
                      value={redemptionFilter}
                      onChange={(e) => setRedemptionFilter(e.target.value)}
                      className="w-full px-2.5 py-1.5 text-xs font-semibold rounded-lg border border-[#D1D5DB] bg-white text-[#374151]"
                    >
                      <option value="all">All Jurisdictions</option>
                      <option value="immediate">Immediate Possession</option>
                      <option value="redemption_active">Active Redemption Period</option>
                    </select>
                  </div>
                </div>
              )}

              {/* Active Filter Chips */}
              {activeFiltersCount > 0 && (
                <div className="pt-2 border-t border-[#F1F5F9] flex flex-wrap items-center gap-1.5 text-xs">
                  <span className="text-[11px] font-bold text-[#6B7280] mr-1">Active:</span>
                  {observedOnly && <span className="inline-flex items-center gap-1 rounded-full bg-[#0F172A] px-2.5 py-0.5 text-[11px] font-semibold text-white">Source-observed<button type="button" onClick={() => setObservedOnly(false)} aria-label="Remove observed-only filter"><CloseIcon className="h-3 w-3" /></button></span>}
                  {selectedState !== "all" && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-[#0F172A] text-white text-[11px] font-semibold">
                      State: {selectedState}
                      <button type="button" onClick={() => setSelectedState("all")} aria-label="Remove state filter">
                        <CloseIcon className="w-3 h-3 hover:text-red-300" />
                      </button>
                    </span>
                  )}
                  {selectedSource !== "all" && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-[#0F172A] text-white text-[11px] font-semibold">
                      Source: {sourceDisplayText(SOURCES[selectedSource]?.label || selectedSource)}
                      <button type="button" onClick={() => setSelectedSource("all")} aria-label="Remove source filter">
                        <CloseIcon className="w-3 h-3 hover:text-red-300" />
                      </button>
                    </span>
                  )}
                  {minDealScore > 0 && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-[#0F172A] text-white text-[11px] font-semibold">
                      Score: ≥{minDealScore}
                      <button type="button" onClick={() => setMinDealScore(0)} aria-label="Remove score filter">
                        <CloseIcon className="w-3 h-3 hover:text-red-300" />
                      </button>
                    </span>
                  )}
                  {minEquity > 0 && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-[#0F172A] text-white text-[11px] font-semibold">
                      Bid spread: ≥${(minEquity / 1000).toFixed(0)}k
                      <button type="button" onClick={() => setMinEquity(0)} aria-label="Remove bid spread filter">
                        <CloseIcon className="w-3 h-3 hover:text-red-300" />
                      </button>
                    </span>
                  )}
                  {maxOpeningBid !== null && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-[#0F172A] text-white text-[11px] font-semibold">
                      Bid: ≤${(maxOpeningBid / 1000).toFixed(0)}k
                      <button type="button" onClick={() => setMaxOpeningBid(null)} aria-label="Remove max bid filter">
                        <CloseIcon className="w-3 h-3 hover:text-red-300" />
                      </button>
                    </span>
                  )}
                  {propertyType !== "all" && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-[#0F172A] text-white text-[11px] font-semibold">
                      Type: {propertyType}
                      <button type="button" onClick={() => setPropertyType("all")} aria-label="Remove property type filter">
                        <CloseIcon className="w-3 h-3 hover:text-red-300" />
                      </button>
                    </span>
                  )}
                  {seniorLienFilter !== "all" && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-[#0F172A] text-white text-[11px] font-semibold">
                      Title: {seniorLienFilter === "clean" ? "Clean 1st" : "Junior Risk"}
                      <button type="button" onClick={() => setSeniorLienFilter("all")} aria-label="Remove title risk filter">
                        <CloseIcon className="w-3 h-3 hover:text-red-300" />
                      </button>
                    </span>
                  )}
                  {redemptionFilter !== "all" && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-[#0F172A] text-white text-[11px] font-semibold">
                      Redemption: {redemptionFilter === "immediate" ? "Immediate" : "Active Window"}
                      <button type="button" onClick={() => setRedemptionFilter("all")} aria-label="Remove redemption filter">
                        <CloseIcon className="w-3 h-3 hover:text-red-300" />
                      </button>
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Triage Analytics Summary Bar */}
            <div className="mb-6 p-4 bg-white rounded-2xl border border-[#E5E7EB] shadow-sm grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-[#0F172A]/5 flex items-center justify-center text-[#0F172A] shrink-0">
                  <LayoutGrid className="w-4 h-4" />
                </div>
                <div>
                  <p className="text-[#6B7280] text-[10px] font-bold uppercase tracking-wider">Filtered Pipeline</p>
                  <p className="text-base font-extrabold text-[#111827]">{filtered.length} Records</p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-[#0F172A]/5 flex items-center justify-center text-[#0F172A] shrink-0">
                  <Calendar className="w-4 h-4" />
                </div>
                <div>
                  <p className="text-[#6B7280] text-[10px] font-bold uppercase tracking-wider">Median Opening Bid</p>
                  <p className="text-base font-extrabold text-[#111827]">{displayMoney(medianBid)}</p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-emerald-50 flex items-center justify-center text-emerald-800 shrink-0">
                  <TrendingUp className="w-4 h-4" />
                </div>
                <div>
                  <p className="text-emerald-800 text-[10px] font-bold uppercase tracking-wider">Avg Bid Spread</p>
                  <p className="text-base font-extrabold text-emerald-950">{avgEquity === null ? "Not modeled" : `+${avgEquity.toLocaleString()}`}</p>
                </div>
              </div>

              {/* Interactive Deal Score Band Spectrum */}
              <div className="flex flex-col justify-center">
                <p className="text-[#6B7280] text-[10px] font-bold uppercase tracking-wider mb-1.5">Score Distribution</p>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setMinDealScore(minDealScore === 70 ? 0 : 70)}
                    title={`Elite (70+): ${eliteCount} deals`}
                    className={cn(
                      "px-2 py-0.5 rounded text-[10px] font-extrabold transition",
                      minDealScore === 70
                        ? "bg-[#0F172A] text-white ring-2 ring-[#0F172A]"
                        : "bg-slate-200 text-slate-800 hover:bg-slate-300"
                    )}
                  >
                    Elite: {eliteCount}
                  </button>
                  <button
                    type="button"
                    onClick={() => setMinDealScore(minDealScore === 55 ? 0 : 55)}
                    title={`Strong (55–69): ${strongCount} deals`}
                    className={cn(
                      "px-2 py-0.5 rounded text-[10px] font-extrabold transition",
                      minDealScore === 55
                        ? "bg-[#0F172A] text-white ring-2 ring-[#0F172A]"
                        : "bg-slate-200 text-slate-800 hover:bg-slate-300"
                    )}
                  >
                    Strong: {strongCount}
                  </button>
                  <button
                    type="button"
                    onClick={() => setMinDealScore(minDealScore === 35 ? 0 : 35)}
                    title={`Fair (35–54): ${fairCount} deals`}
                    className={cn(
                      "px-2 py-0.5 rounded text-[10px] font-extrabold transition",
                      minDealScore === 35
                        ? "bg-[#F59E0B] text-white ring-2 ring-[#0F172A]"
                        : "bg-[#F59E0B]/15 text-[#B45309] hover:bg-[#F59E0B]/25"
                    )}
                  >
                    Fair: {fairCount}
                  </button>
                </div>
              </div>
            </div>

            {activeView === "map" ? (
              <MarketMap listings={filtered} onUnderwrite={setSelectedListing} returnTo={returnContext} />
            ) : (
            /* Listings Grid */
            filtered.length === 0 ? (
              <div className="p-12 text-center bg-white rounded-2xl border border-[#E5E7EB] shadow-sm space-y-4">
                <SlidersHorizontal className="w-10 h-10 mx-auto text-[#9CA3AF]" />
                <h3 className="text-lg font-bold text-[#111827]">No properties match these underwriting criteria</h3>
                <p className="text-xs text-[#6B7280] max-w-md mx-auto">
                  Try adjusting your modeled score, bid spread, or opening amount range to capture more published records.
                </p>

                {searchQuery.trim() && (
                  <div className="pt-2 max-w-md mx-auto p-4 rounded-xl bg-[#0F172A] text-white space-y-2 border border-slate-700 shadow-md text-left">
                    <div className="flex items-center gap-2 text-emerald-300 text-xs font-bold uppercase tracking-wider">
                      <Sparkles className="w-3.5 h-3.5" />
                      <span>Address research workspace</span>
                    </div>
                    <p className="text-xs text-slate-300">
                      Looking for <strong>&quot;{searchQuery}&quot;</strong>? Open an evidence checklist for this address. Legal and title status remains unverified until official records are attached.
                    </p>
                    <button
                      type="button"
                      onClick={() => handleDeepCheckAddress(searchQuery)}
                      className="w-full mt-2 py-2 px-4 rounded-lg bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold flex items-center justify-center gap-1.5 transition border border-slate-600"
                    >
                      <Scale className="w-3.5 h-3.5" />
                      <span>Open evidence checklist for &quot;{searchQuery}&quot;</span>
                    </button>
                  </div>
                )}

                <div className="pt-2">
                  <button
                    type="button"
                    onClick={resetFilters}
                    className="inline-flex items-center gap-1.5 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-[#0F172A] text-xs font-bold rounded-xl transition shadow-sm"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Reset All Filters</span>
                  </button>
                </div>
              </div>
            ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {filtered.map((listing) => {
                const src = SOURCES[listing.source] || SOURCES.sheriff;
                const isSaved = savedIds.has(listing.id);
                const isObserved = isObservedSourceRecord(listing);
                const sourceRecordCountAtAddress = observedRecordCountsAtAddress.get(listing.id);
                const publisherMedia = inspectPublisherPhoto(listing);
                const secondaryMedia = publisherMedia.accepted ? null : inspectSecondaryMedia(listing);
                const cardPhoto = publisherMedia.accepted ? publisherMedia.url : secondaryMedia?.url;

                return (
                  <div
                    key={listing.id}
                    style={{ contentVisibility: "auto", containIntrinsicSize: "auto 460px" }}
                    className="bg-white rounded-2xl border border-[#E5E7EB] overflow-hidden shadow-sm hover:shadow-lg transition duration-200 flex flex-col justify-between group"
                  >
                    <div>
                      {/* Photo + Tags */}
                      <div className="relative h-48 w-full bg-[#F5F6F7] overflow-hidden">
                        <ListingThumbnail listingId={listing.id} address={listing.address} photo={cardPhoto} observed={isObserved} photoProvider={secondaryMedia?.accepted ? secondaryMedia.provider : undefined} photoSourceUrl={secondaryMedia?.accepted ? secondaryMedia.sourceRecordUrl : undefined} />
                        <div className="absolute top-3 left-3 flex items-center gap-1.5">
                          <span
                            className="text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-md text-white shadow-sm"
                            style={{ backgroundColor: src.color }}
                          >
                            {src.label}
                          </span>
                          <span className={cn(
                            "rounded-md px-2 py-0.5 text-[10px] font-extrabold uppercase shadow-sm",
                            isObserved ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-900",
                          )}>
                            {isObserved ? "Observed" : "Demo / unverified"}
                          </span>
                        </div>
                        <button
                          onClick={(e) => { e.stopPropagation(); toggleSave(listing.id); }}
                          aria-label={isSaved ? `Remove ${listing.address} from watchlist` : `Add ${listing.address} to watchlist`}
                          aria-pressed={isSaved}
                          className="absolute top-3 right-3 p-1.5 rounded-full bg-white/90 backdrop-blur-md text-[#374151] hover:text-slate-900 shadow"
                        >
                          <Bookmark className={cn("w-4 h-4", isSaved && "fill-slate-900 text-slate-900")} />
                        </button>
                      </div>

                      {/* Card Content */}
                      <div className="p-5 space-y-3">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <h3 className="font-bold text-base text-[#111827] line-clamp-1">{listing.address}</h3>
                            <p className="text-xs text-[#6B7280]">{displayText(listing.city)}, {listing.state} · {displayText(listing.county, "County not published")}</p>
                            {sourceRecordCountAtAddress && (
                              <p className="mt-1 text-xs font-semibold text-slate-900">
                                {sourceRecordCountAtAddress} source records at this address
                              </p>
                            )}
                          </div>
                          <span className="text-xs font-extrabold px-2.5 py-1 rounded-md bg-emerald-50 text-emerald-800 shrink-0">
                            {knownNumber(listing.dealScore) === null ? "Not modeled" : `${listing.dealScore}/100`}
                          </span>
                        </div>

                        {/* Metric Row */}
                        <div className="grid grid-cols-2 gap-2 pt-2 border-t border-[#E5E7EB] text-xs">
                          <div>
                            <span className="text-[#6B7280] block">Opening Bid:</span>
                            <span data-testid="listing-opening-bid" className="font-bold text-[#111827] text-sm">{displayMoney(listing.openingBid)}</span>
                          </div>
                          <div>
                            <span className="text-emerald-800 font-semibold block">Modeled Bid Spread:</span>
                            <span className="font-bold text-emerald-800 text-sm">{knownNumber(listing.equity) === null ? "Not modeled" : `+${listing.equity?.toLocaleString()}`}</span>
                          </div>
                        </div>

                        <p className="text-xs text-[#6B7280] flex items-center gap-1 pt-1">
                          <Calendar className="w-3.5 h-3.5 text-[#9CA3AF]" />
                          Auction: <span className="font-semibold text-[#111827]">{displayDate(listing.saleDate)}</span>
                        </p>
                      </div>
                    </div>

                    {/* Card Action */}
                    <div className="grid grid-cols-3 gap-2 px-5 pb-5 pt-1">
                      <button
                        onClick={() => setSelectedListing(listing)}
                        className="w-full inline-flex h-10 items-center justify-center rounded-xl bg-[#0F172A] text-white text-xs font-bold hover:bg-[#1E293B] transition gap-1 shadow-sm"
                      >
                        <span>Underwrite Deal</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                      <Link
                        href={`/listings/${listing.id}`}
                        data-testid="listing-detail-link"
                        aria-label={`Open listing page for ${listing.address}`}
                        className="w-full inline-flex h-10 items-center justify-center rounded-xl border border-[#D1D5DB] bg-white text-[#0F172A] text-xs font-bold hover:bg-[#F3F4F6] transition gap-1 shadow-sm"
                      >
                        <span>Listing page</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </Link>
                      <CaseAction listingId={listing.id} />
                    </div>
                  </div>
                );
              })}
            </div>
            ))}
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

      {/* Automated Alerts Modal */}
      <AlertsModal
        isOpen={isAlertsOpen}
        onClose={() => setIsAlertsOpen(false)}
        availableStates={availableStates}
        listings={inventory}
        onApply={(search: SavedSearch) => {
          resetFilters();
          setSelectedState(search.state === "All" ? "all" : search.state);
          setMinDealScore(search.minScore);
          setMaxOpeningBid(search.maxBid > 0 ? search.maxBid : null);
          setActiveView("grid");
          setIsAlertsOpen(false);
        }}
      />
    </section>
  );
}
