"use client";

import * as React from "react";
import Link from "next/link";
import {
  PieChart,
  TrendingDown,
  CalendarDays,
  ShieldCheck,
  Building,
  DollarSign,
  ArrowRight,
  ExternalLink,
  Trash2,
  AlertCircle,
  Loader2,
  Plus,
  RefreshCw,
  Clock,
  Layers,
} from "lucide-react";
import { useWorkspaceSession } from "@/components/workspace/workspace-shell";
import { sourceDisplayText } from "@/lib/source-display";

type DashboardPayload = {
  count: number;
  totalEstimatedValue: number | null;
  totalEstimatedEquity: number | null;
  medianOpeningBid: number | null;
  medianMid: number | null;
  medianDealScore: number | null;
  medianDiscount: number | null;
  perState: Record<string, number>;
  perSource: Record<string, number>;
  perPropType: Record<string, number>;
  upcomingSales: Array<{
    id: string;
    address?: string;
    state?: string;
    saleDate?: string | null;
    openingBid?: number | null;
    dealScore?: number | null;
    source?: string;
  }>;
};

type PriceDropItem = {
  listingId: string;
  address?: string;
  state?: string;
  dropped: boolean;
  dropAmount?: number;
  dropPct?: number;
  currentBid?: number | null;
  previousBid?: number | null;
};

type SavedDeal = {
  id: string;
  listingId?: string;
  address?: string;
  city?: string;
  state?: string;
  openingBid?: number | null;
  dealScore?: number | null;
  saleDate?: string | null;
  source?: string;
  propType?: string;
};

function formatMoney(amount: number | null | undefined): string {
  if (amount == null || !Number.isFinite(amount)) return "—";
  return `$${Math.round(amount).toLocaleString()}`;
}

export function PortfolioView() {
  const session = useWorkspaceSession();
  const [tab, setTab] = React.useState<"watchlist" | "drops" | "schedule" | "allocation">("watchlist");
  const [dashboard, setDashboard] = React.useState<DashboardPayload | null>(null);
  const [priceDrops, setPriceDrops] = React.useState<PriceDropItem[]>([]);
  const [deals, setDeals] = React.useState<SavedDeal[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [refreshing, setRefreshing] = React.useState(false);

  const loadData = React.useCallback(async () => {
    if (!session.memberTools) {
      setLoading(false);
      return;
    }
    setError(null);
    try {
      const [dashRes, dropsRes, alertsRes] = await Promise.all([
        fetch("/api/portfolio/dashboard", { cache: "no-store", credentials: "same-origin" }),
        fetch("/api/price-drops", { cache: "no-store", credentials: "same-origin" }),
        fetch("/api/alerts", { cache: "no-store", credentials: "same-origin" }),
      ]);

      if (dashRes.ok) {
        const dashData = await dashRes.json();
        setDashboard(dashData);
      }

      if (dropsRes.ok) {
        const dropsData = await dropsRes.json();
        setPriceDrops(Array.isArray(dropsData.items) ? dropsData.items : []);
      }

      if (alertsRes.ok) {
        const alertsData = await alertsRes.json();
        const rawDeals = Array.isArray(alertsData.deals) ? alertsData.deals : [];
        setDeals(
          rawDeals.map((d: any) => ({
            id: typeof d === "string" ? d : d.id || d.listingId,
            listingId: typeof d === "string" ? d : d.listingId || d.id,
            address: d.address || d.headlineAddress,
            city: d.city,
            state: d.state,
            openingBid: d.openingBid,
            dealScore: d.dealScore,
            saleDate: d.saleDate,
            source: d.source,
            propType: d.propType,
          }))
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load portfolio metrics");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [session.memberTools]);

  React.useEffect(() => {
    loadData();
  }, [loadData]);

  async function handleRemove(listingId: string) {
    try {
      const res = await fetch("/api/alerts", {
        method: "DELETE",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listingId }),
      });
      if (!res.ok) throw new Error(`Could not remove from watchlist (HTTP ${res.status}).`);
      setDeals((prev) => prev.filter((d) => d.id !== listingId && d.listingId !== listingId));
      loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove from watchlist.");
    }
  }

  if (!session.memberTools) {
    return (
      <div className="mx-auto max-w-4xl px-6 py-20 text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-700 mb-6">
          <PieChart className="h-8 w-8" />
        </div>
        <h1 className="text-3xl font-extrabold text-slate-950">Portfolio & Watchlist Dashboard</h1>
        <p className="mt-3 text-sm text-slate-600 max-w-md mx-auto">
          Sign in or unlock with your operator key to aggregate saved deals, monitor automated price drops,
          and track upcoming auction schedules.
        </p>
        <div className="mt-8 flex justify-center gap-4">
          <button
            onClick={() => session.requestUnlock()}
            className="rounded-xl bg-slate-950 px-6 py-3 text-sm font-semibold text-white hover:bg-slate-800 transition"
          >
            Unlock Workspace
          </button>
          <Link
            href="/listings"
            className="rounded-xl border border-slate-300 bg-white px-6 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition"
          >
            Explore Listings
          </Link>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-6xl px-6 py-20 text-center">
        <Loader2 className="mx-auto h-8 w-8 animate-spin text-slate-500 mb-4" />
        <p className="text-sm font-medium text-slate-600">Calculating portfolio roll-up metrics...</p>
      </div>
    );
  }

  const count = dashboard?.count ?? deals.length;
  const dropsCount = priceDrops.filter((d) => d.dropped).length;

  return (
    <div className="mx-auto max-w-6xl px-6 py-12 text-slate-900 sm:px-8">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-8">
        <div>
          <p className="text-[12px] font-bold uppercase tracking-[0.14em] text-slate-500">Asset Management</p>
          <h1 className="mt-1 text-3xl font-extrabold tracking-tight text-slate-950">
            Portfolio & Watchlist Dashboard
          </h1>
          <p className="mt-1.5 text-xs text-slate-500">
            Roll-up financial metrics, detected price drops, and auction schedules for your tracked assets.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              setRefreshing(true);
              loadData();
            }}
            disabled={refreshing}
            className="flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
            Refresh Metrics
          </button>
          <Link
            href="/listings"
            className="flex items-center gap-1.5 rounded-xl bg-slate-950 px-4 py-2.5 text-xs font-semibold text-white hover:bg-slate-800 transition"
          >
            <Plus className="h-3.5 w-3.5" />
            Add Listings
          </Link>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-500">
            <span>Tracked Properties</span>
            <Building className="h-4 w-4 text-slate-400" />
          </div>
          <p className="mt-3 text-3xl font-extrabold text-slate-950">{count}</p>
          <p className="mt-1 text-[11px] text-slate-400">Saved to operator watchlist</p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-500">
            <span>Modeled Equity</span>
            <DollarSign className="h-4 w-4 text-emerald-600" />
          </div>
          <p className="mt-3 text-3xl font-extrabold text-emerald-950">
            {formatMoney(dashboard?.totalEstimatedEquity)}
          </p>
          <p className="mt-1 text-[11px] text-slate-400">Total modeled spread vs mid</p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-500">
            <span>Median Deal Score</span>
            <ShieldCheck className="h-4 w-4 text-indigo-600" />
          </div>
          <p className="mt-3 text-3xl font-extrabold text-indigo-950">
            {dashboard?.medianDealScore != null ? Math.round(dashboard.medianDealScore) : "—"}
          </p>
          <p className="mt-1 text-[11px] text-slate-400">
            {dashboard?.medianDiscount != null ? `${Math.round(dashboard.medianDiscount * 100)}% median discount` : "Weighted quality index"}
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-500">
            <span>Upcoming Auctions</span>
            <CalendarDays className="h-4 w-4 text-amber-600" />
          </div>
          <p className="mt-3 text-3xl font-extrabold text-amber-950">
            {dashboard?.upcomingSales?.length ?? 0}
          </p>
          <p className="mt-1 text-[11px] text-slate-400">Sales scheduled in next 30 days</p>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="mt-10 flex border-b border-slate-200 text-xs font-bold">
        <button
          onClick={() => setTab("watchlist")}
          className={`border-b-2 px-5 py-3 transition ${
            tab === "watchlist"
              ? "border-slate-950 text-slate-950"
              : "border-transparent text-slate-500 hover:text-slate-900"
          }`}
        >
          Tracked Deals ({deals.length})
        </button>
        <button
          onClick={() => setTab("drops")}
          className={`border-b-2 px-5 py-3 transition flex items-center gap-1.5 ${
            tab === "drops"
              ? "border-slate-950 text-slate-950"
              : "border-transparent text-slate-500 hover:text-slate-900"
          }`}
        >
          Price Drop Radar
          {dropsCount > 0 && (
            <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] text-red-800">
              {dropsCount}
            </span>
          )}
        </button>
        <button
          onClick={() => setTab("schedule")}
          className={`border-b-2 px-5 py-3 transition ${
            tab === "schedule"
              ? "border-slate-950 text-slate-950"
              : "border-transparent text-slate-500 hover:text-slate-900"
          }`}
        >
          Auction Schedule ({dashboard?.upcomingSales?.length ?? 0})
        </button>
        <button
          onClick={() => setTab("allocation")}
          className={`border-b-2 px-5 py-3 transition ${
            tab === "allocation"
              ? "border-slate-950 text-slate-950"
              : "border-transparent text-slate-500 hover:text-slate-900"
          }`}
        >
          Portfolio Allocation
        </button>
      </div>

      {/* Tab Content */}
      <div className="mt-8">
        {/* Watchlist Tab */}
        {tab === "watchlist" && (
          <div>
            {deals.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-12 text-center">
                <Building className="mx-auto h-8 w-8 text-slate-400 mb-3" />
                <h3 className="text-base font-bold text-slate-950">No saved properties yet</h3>
                <p className="mt-1 text-xs text-slate-500 max-w-sm mx-auto">
                  Browse public listings, save promising assets, and monitor their status over time.
                </p>
                <div className="mt-5">
                  <Link
                    href="/listings"
                    className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-5 py-2.5 text-xs font-semibold text-white hover:bg-slate-800 transition"
                  >
                    Browse Listings <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </div>
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {deals.map((deal) => {
                  const dealId = deal.listingId || deal.id;
                  return (
                    <div
                      key={dealId}
                      className="group flex flex-col justify-between rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:shadow-md"
                    >
                      <div>
                        <div className="flex items-center justify-between text-xs text-slate-500">
                          <span className="font-semibold text-slate-600">
                            {sourceDisplayText(deal.source || "Auction")}
                          </span>
                          {deal.dealScore != null && (
                            <span className="rounded bg-indigo-100 px-2 py-0.5 text-[10px] font-bold text-indigo-900">
                              Score {Math.round(deal.dealScore)}
                            </span>
                          )}
                        </div>
                        <h3 className="mt-2 text-sm font-bold text-slate-950 line-clamp-2">
                          {deal.address || "Address not published"}
                        </h3>
                        {deal.city && deal.state && (
                          <p className="text-xs text-slate-500 mt-0.5">
                            {deal.city}, {deal.state}
                          </p>
                        )}
                      </div>

                      <div className="mt-6 border-t border-slate-100 pt-4">
                        <div className="flex items-center justify-between text-xs">
                          <div>
                            <span className="block text-[10px] uppercase font-medium text-slate-400">
                              Opening Amount
                            </span>
                            <span className="text-sm font-extrabold text-slate-950">
                              {formatMoney(deal.openingBid)}
                            </span>
                          </div>
                          {deal.saleDate && (
                            <div className="text-right">
                              <span className="block text-[10px] uppercase font-medium text-slate-400">
                                Auction Date
                              </span>
                              <span className="text-xs font-semibold text-slate-700">
                                {new Date(deal.saleDate).toLocaleDateString()}
                              </span>
                            </div>
                          )}
                        </div>

                        <div className="mt-4 flex items-center justify-between gap-2 pt-2 border-t border-slate-100/60">
                          <Link
                            href={`/listings/${encodeURIComponent(dealId)}`}
                            className="flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:text-indigo-800 transition"
                          >
                            Open Dossier <ArrowRight className="h-3 w-3" />
                          </Link>
                          <button
                            onClick={() => handleRemove(dealId)}
                            title="Remove from watchlist"
                            className="text-slate-400 hover:text-red-600 p-1 rounded transition"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Price Drop Radar Tab */}
        {tab === "drops" && (
          <div className="space-y-4">
            {priceDrops.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-12 text-center">
                <TrendingDown className="mx-auto h-8 w-8 text-slate-400 mb-3" />
                <h3 className="text-base font-bold text-slate-950">No price drops recorded</h3>
                <p className="mt-1 text-xs text-slate-500 max-w-sm mx-auto">
                  When auctioneers or sheriff departments reduce opening bids or upset prices on your tracked assets,
                  they will appear here automatically.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-slate-200 rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                {priceDrops.map((drop) => (
                  <div key={drop.listingId} className="flex items-center justify-between p-5 hover:bg-slate-50 transition">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="rounded bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-900">
                          {drop.dropPct ? `-${Math.round(drop.dropPct * 100)}% DROP` : "PRICE DROP"}
                        </span>
                        <h4 className="text-sm font-bold text-slate-950">{drop.address || drop.listingId}</h4>
                      </div>
                      <p className="text-xs text-slate-500 mt-1">
                        Reduced from {formatMoney(drop.previousBid)} to{" "}
                        <strong className="text-slate-900">{formatMoney(drop.currentBid)}</strong>
                      </p>
                    </div>
                    <Link
                      href={`/listings/${encodeURIComponent(drop.listingId)}`}
                      className="rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 transition"
                    >
                      View Update
                    </Link>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Schedule Tab */}
        {tab === "schedule" && (
          <div className="space-y-4">
            {!dashboard?.upcomingSales?.length ? (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-12 text-center">
                <CalendarDays className="mx-auto h-8 w-8 text-slate-400 mb-3" />
                <h3 className="text-base font-bold text-slate-950">No sales in the next 30 days</h3>
                <p className="mt-1 text-xs text-slate-500 max-w-sm mx-auto">
                  None of your currently tracked properties have an auction date scheduled in the next 30-day window.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-slate-200 rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                {dashboard.upcomingSales.map((sale) => (
                  <div key={sale.id} className="flex items-center justify-between p-5 hover:bg-slate-50 transition">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="flex items-center gap-1 rounded bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-950">
                          <Clock className="h-3 w-3" />
                          {sale.saleDate ? new Date(sale.saleDate).toLocaleDateString() : "Scheduled"}
                        </span>
                        <h4 className="text-sm font-bold text-slate-950">{sale.address || sale.id}</h4>
                      </div>
                      <p className="text-xs text-slate-500 mt-1">
                        Opening Amount: <strong>{formatMoney(sale.openingBid)}</strong> · Source:{" "}
                        {sourceDisplayText(sale.source || "Public Auction")}
                      </p>
                    </div>
                    <Link
                      href={`/listings/${encodeURIComponent(sale.id)}`}
                      className="rounded-xl bg-slate-950 px-3.5 py-2 text-xs font-semibold text-white hover:bg-slate-800 transition"
                    >
                      Prepare Bid
                    </Link>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Allocation Tab */}
        {tab === "allocation" && (
          <div className="grid gap-6 sm:grid-cols-3">
            {/* By State */}
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-2">
                <Layers className="h-4 w-4" /> Jurisdiction (State)
              </h3>
              <div className="space-y-2 pt-2">
                {Object.entries(dashboard?.perState || {}).length === 0 ? (
                  <p className="text-xs text-slate-400">No jurisdiction data</p>
                ) : (
                  Object.entries(dashboard?.perState || {})
                    .sort(([, a], [, b]) => b - a)
                    .map(([state, num]) => (
                      <div key={state} className="flex items-center justify-between text-xs">
                        <span className="font-semibold text-slate-700">{state}</span>
                        <span className="rounded bg-slate-100 px-2 py-0.5 font-bold text-slate-800">
                          {num} ({Math.round((num / count) * 100)}%)
                        </span>
                      </div>
                    ))
                )}
              </div>
            </div>

            {/* By Source */}
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-2">
                <Building className="h-4 w-4" /> Source Agency / Feed
              </h3>
              <div className="space-y-2 pt-2">
                {Object.entries(dashboard?.perSource || {}).length === 0 ? (
                  <p className="text-xs text-slate-400">No source data</p>
                ) : (
                  Object.entries(dashboard?.perSource || {})
                    .sort(([, a], [, b]) => b - a)
                    .map(([source, num]) => (
                      <div key={source} className="flex items-center justify-between text-xs">
                        <span className="font-semibold text-slate-700">{sourceDisplayText(source)}</span>
                        <span className="rounded bg-slate-100 px-2 py-0.5 font-bold text-slate-800">
                          {num}
                        </span>
                      </div>
                    ))
                )}
              </div>
            </div>

            {/* By Property Type */}
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-2">
                <PieChart className="h-4 w-4" /> Asset Classification
              </h3>
              <div className="space-y-2 pt-2">
                {Object.entries(dashboard?.perPropType || {}).length === 0 ? (
                  <p className="text-xs text-slate-400">No property type data</p>
                ) : (
                  Object.entries(dashboard?.perPropType || {})
                    .sort(([, a], [, b]) => b - a)
                    .map(([propType, num]) => (
                      <div key={propType} className="flex items-center justify-between text-xs">
                        <span className="font-semibold text-slate-700">{propType}</span>
                        <span className="rounded bg-slate-100 px-2 py-0.5 font-bold text-slate-800">
                          {num}
                        </span>
                      </div>
                    ))
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
