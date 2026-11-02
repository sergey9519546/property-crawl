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
  ChevronRight,
  ChevronLeft,
  Download,
  Kanban,
  CheckCircle2,
} from "lucide-react";
import { useWorkspaceSession } from "@/components/workspace/workspace-shell";
import { sourceDisplayText } from "@/lib/source-display";
import { bandForScore } from "@/lib/score-bands";

export type PipelineStage =
  | "triage"
  | "title_audit"
  | "bid_approved"
  | "at_auction"
  | "redemption_carry"
  | "settled";

export const PIPELINE_STAGES: Array<{ id: PipelineStage; label: string; description: string }> = [
  { id: "triage", label: "Triage", description: "Initial screening & model score review" },
  { id: "title_audit", label: "Title & Lien Audit", description: "Senior lien, HOA super-lien & docket verification" },
  { id: "bid_approved", label: "Bid Approved", description: "Buyer maximum ceiling & wire deposit ready" },
  { id: "at_auction", label: "At Auction", description: "Scheduled active sale / bidding window" },
  { id: "redemption_carry", label: "Redemption Carry", description: "Post-sale statutory hold / IRS 120-day lockup" },
  { id: "settled", label: "Settled / Resold", description: "Deed recorded, possession acquired or redeemed" },
];

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

const STORAGE_PIPELINE_KEY = "perfectproperty_pipeline_stages_v1";

export function PortfolioView() {
  const session = useWorkspaceSession();
  const [tab, setTab] = React.useState<"watchlist" | "pipeline" | "drops" | "schedule" | "allocation">("pipeline");
  const [dashboard, setDashboard] = React.useState<DashboardPayload | null>(null);
  const [priceDrops, setPriceDrops] = React.useState<PriceDropItem[]>([]);
  const [deals, setDeals] = React.useState<SavedDeal[]>([]);
  const [pipelineStages, setPipelineStages] = React.useState<Record<string, PipelineStage>>({});
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [refreshing, setRefreshing] = React.useState(false);

  // Initialize pipeline stages from local storage
  React.useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_PIPELINE_KEY);
      if (saved) {
        setPipelineStages(JSON.parse(saved));
      }
    } catch {
      // Ignore local storage errors
    }
  }, []);

  const updateDealStage = React.useCallback((dealId: string, newStage: PipelineStage) => {
    setPipelineStages((prev) => {
      const next = { ...prev, [dealId]: newStage };
      try {
        localStorage.setItem(STORAGE_PIPELINE_KEY, JSON.stringify(next));
      } catch {
        // Ignore
      }
      return next;
    });
  }, []);

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

  const handleRemove = async (dealId: string) => {
    try {
      await fetch(`/api/alerts/${encodeURIComponent(dealId)}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      setDeals((prev) => prev.filter((d) => (d.listingId || d.id) !== dealId));
    } catch {
      // Ignore delete errors
    }
  };

  if (!session.memberTools) {
    return (
      <div className="mx-auto max-w-4xl px-6 py-20 text-center">
        <ShieldCheck className="mx-auto h-12 w-12 text-ink-3 mb-4" />
        <h2 className="text-2xl font-bold text-ink">Operator Access Required</h2>
        <p className="mt-2 text-sm text-ink-3 max-w-md mx-auto">
          The Portfolio & Capital Pipeline dashboard requires an active operator session. Unlock the workspace with your administrative credential to view portfolio rollups, track price drops, and manage capital workflows.
        </p>
        <div className="mt-6 flex justify-center gap-4">
          <button
            onClick={() => session.requestUnlock()}
            className="rounded-xl bg-ink px-6 py-3 text-sm font-semibold text-white hover:bg-ink-2 transition"
          >
            Unlock Workspace
          </button>
          <Link
            href="/listings"
            className="rounded-xl border border-line-strong bg-card px-6 py-3 text-sm font-semibold text-ink-2 hover:bg-paper transition"
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
        <Loader2 className="mx-auto h-8 w-8 animate-spin text-ink-3 mb-4" />
        <p className="text-sm font-medium text-ink-3">Calculating portfolio roll-up metrics...</p>
      </div>
    );
  }

  const count = dashboard?.count ?? deals.length;
  const dropsCount = priceDrops.filter((d) => d.dropped).length;

  // Pipeline calculations
  const dealsByStage: Record<PipelineStage, SavedDeal[]> = {
    triage: [],
    title_audit: [],
    bid_approved: [],
    at_auction: [],
    redemption_carry: [],
    settled: [],
  };

  let totalPipelineCapital = 0;
  for (const deal of deals) {
    const dealId = deal.listingId || deal.id;
    const stage = pipelineStages[dealId] || "triage";
    dealsByStage[stage].push(deal);
    if (typeof deal.openingBid === "number" && Number.isFinite(deal.openingBid)) {
      totalPipelineCapital += deal.openingBid;
    }
  }

  const stageOrder: PipelineStage[] = [
    "triage",
    "title_audit",
    "bid_approved",
    "at_auction",
    "redemption_carry",
    "settled",
  ];

  return (
    <div className="mx-auto max-w-7xl px-6 py-12 text-ink sm:px-8">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-8">
        <div>
          <p className="text-[12px] font-bold uppercase tracking-[0.14em] text-ink-3">Capital & Portfolio Management</p>
          <h1 className="mt-1 text-3xl font-extrabold tracking-tight text-ink">
            Institutional Capital Pipeline
          </h1>
          <p className="mt-1.5 text-xs text-ink-3">
            Track saved distressed assets through 6 operational deal stages, monitor price drop alerts, and aggregate committed capital.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <a
            href="/api/export?format=markdown&saved=true"
            download="perfectproperty_dossiers.md"
            className="flex items-center gap-1.5 rounded-xl border border-line-strong bg-card px-3.5 py-2.5 text-xs font-semibold text-ink-2 hover:bg-paper transition"
            title="Download printable Markdown Underwriting Dossiers for saved deals"
          >
            <Download className="h-3.5 w-3.5" />
            Export Dossiers (.md)
          </a>
          <a
            href="/api/export?format=csv&saved=true"
            download="perfectproperty_portfolio.csv"
            className="flex items-center gap-1.5 rounded-xl border border-line-strong bg-card px-3.5 py-2.5 text-xs font-semibold text-ink-2 hover:bg-paper transition"
            title="Download CSV table of all saved deals"
          >
            <Download className="h-3.5 w-3.5" />
            CSV Export
          </a>
          <button
            onClick={() => {
              setRefreshing(true);
              loadData();
            }}
            disabled={refreshing}
            className="flex items-center gap-1.5 rounded-xl border border-line-strong bg-card px-3.5 py-2.5 text-xs font-semibold text-ink-2 hover:bg-paper transition disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
            Refresh
          </button>
          <Link
            href="/listings"
            className="flex items-center gap-1.5 rounded-xl bg-ink px-4 py-2.5 text-xs font-semibold text-white hover:bg-ink-2 transition"
          >
            <Plus className="h-3.5 w-3.5" />
            Add Listings
          </Link>
        </div>
      </div>

      {error && (
        <div className="mt-6 flex items-center gap-2 rounded-xl border border-caution/40 bg-caution/10 p-4 text-xs font-medium text-caution">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* KPI Cards */}
      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl border border-line bg-card p-5 shadow-sm">
          <div className="flex items-center justify-between text-xs font-semibold text-ink-3">
            <span>Pipeline Capital Exposure</span>
            <DollarSign className="h-4 w-4 text-ink-3" />
          </div>
          <p className="mt-3 text-3xl font-extrabold text-ink">{formatMoney(totalPipelineCapital)}</p>
          <p className="mt-1 text-[11px] text-ink-3">Across {deals.length} tracked opportunities</p>
        </div>

        <div className="rounded-2xl border border-line bg-card p-5 shadow-sm">
          <div className="flex items-center justify-between text-xs font-semibold text-ink-3">
            <span>Modeled Spread</span>
            <Building className="h-4 w-4 text-ink-3" />
          </div>
          <p className="mt-3 text-3xl font-extrabold text-ink">
            {formatMoney(dashboard?.totalEstimatedEquity)}
          </p>
          <p className="mt-1 text-[11px] text-ink-3">Total modeled spread vs mid</p>
        </div>

        <div className="rounded-2xl border border-line bg-card p-5 shadow-sm">
          <div className="flex items-center justify-between text-xs font-semibold text-ink-3">
            <span>Median Deal Score</span>
            <ShieldCheck className="h-4 w-4 text-ink-3" />
          </div>
          <p className="mt-3 text-3xl font-extrabold text-ink" style={{ color: bandForScore(dashboard?.medianDealScore)?.color }}>
            {dashboard?.medianDealScore != null ? Math.round(dashboard.medianDealScore) : "—"}
          </p>
          <p className="mt-1 text-[11px] text-ink-3">
            {dashboard?.medianDiscount != null ? `${Math.round(dashboard.medianDiscount * 100)}% median discount` : "Weighted quality index"}
          </p>
        </div>

        <div className="rounded-2xl border border-line bg-card p-5 shadow-sm">
          <div className="flex items-center justify-between text-xs font-semibold text-ink-3">
            <span>Upcoming Auctions</span>
            <CalendarDays className="h-4 w-4 text-ink-3" />
          </div>
          <p className="mt-3 text-3xl font-extrabold text-ink">
            {dashboard?.upcomingSales?.length ?? 0}
          </p>
          <p className="mt-1 text-[11px] text-ink-3">Sales scheduled in next 30 days</p>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="mt-10 flex border-b border-line text-xs font-bold overflow-x-auto">
        <button
          onClick={() => setTab("pipeline")}
          className={`border-b-2 px-5 py-3 transition flex items-center gap-1.5 shrink-0 ${
            tab === "pipeline"
              ? "border-ink text-ink"
              : "border-transparent text-ink-3 hover:text-ink"
          }`}
        >
          <Kanban className="h-3.5 w-3.5" />
          Capital Pipeline ({deals.length})
        </button>
        <button
          onClick={() => setTab("watchlist")}
          className={`border-b-2 px-5 py-3 transition shrink-0 ${
            tab === "watchlist"
              ? "border-ink text-ink"
              : "border-transparent text-ink-3 hover:text-ink"
          }`}
        >
          Tracked Deals ({deals.length})
        </button>
        <button
          onClick={() => setTab("drops")}
          className={`border-b-2 px-5 py-3 transition flex items-center gap-1.5 shrink-0 ${
            tab === "drops"
              ? "border-ink text-ink"
              : "border-transparent text-ink-3 hover:text-ink"
          }`}
        >
          Price Drop Radar
          {dropsCount > 0 && (
            <span className="rounded-full bg-line px-2 py-0.5 text-[10px] text-ink">
              {dropsCount}
            </span>
          )}
        </button>
        <button
          onClick={() => setTab("schedule")}
          className={`border-b-2 px-5 py-3 transition shrink-0 ${
            tab === "schedule"
              ? "border-ink text-ink"
              : "border-transparent text-ink-3 hover:text-ink"
          }`}
        >
          Auction Schedule ({dashboard?.upcomingSales?.length ?? 0})
        </button>
        <button
          onClick={() => setTab("allocation")}
          className={`border-b-2 px-5 py-3 transition shrink-0 ${
            tab === "allocation"
              ? "border-ink text-ink"
              : "border-transparent text-ink-3 hover:text-ink"
          }`}
        >
          Jurisdiction Allocation
        </button>
      </div>

      {/* Tab Content */}
      <div className="mt-8">
        {/* Capital Pipeline Kanban Tab */}
        {tab === "pipeline" && (
          <div className="space-y-6">
            {deals.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-line bg-card p-12 text-center">
                <Kanban className="mx-auto h-8 w-8 text-ink-3 mb-3" />
                <h3 className="text-base font-bold text-ink">No deals in pipeline</h3>
                <p className="mt-1 text-xs text-ink-3 max-w-sm mx-auto">
                  Save listings to your watchlist to begin tracking opportunities through institutional underwriting, title review, auction bidding, and redemption carry.
                </p>
                <div className="mt-5">
                  <Link
                    href="/listings"
                    className="inline-flex items-center gap-2 rounded-xl bg-ink px-5 py-2.5 text-xs font-semibold text-white hover:bg-ink-2 transition"
                  >
                    Browse Opportunities <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4 items-start">
                {PIPELINE_STAGES.map((stage, stageIndex) => {
                  const stageDeals = dealsByStage[stage.id];
                  const stageCapital = stageDeals.reduce((sum, d) => sum + (d.openingBid || 0), 0);

                  return (
                    <div
                      key={stage.id}
                      className="rounded-2xl border border-line bg-card/60 p-3.5 flex flex-col min-h-[460px] shadow-sm"
                    >
                      {/* Column Header */}
                      <div className="border-b border-line pb-3">
                        <div className="flex items-center justify-between">
                          <span className="font-extrabold text-xs text-ink">{stage.label}</span>
                          <span className="rounded-full bg-line px-2 py-0.5 text-[10px] font-bold text-ink">
                            {stageDeals.length}
                          </span>
                        </div>
                        <div className="mt-1.5 flex items-center justify-between text-[11px] text-ink-3">
                          <span>Committed Capital:</span>
                          <span className="font-bold text-ink">{formatMoney(stageCapital)}</span>
                        </div>
                        <p className="mt-1 text-[10px] text-ink-3 line-clamp-1" title={stage.description}>
                          {stage.description}
                        </p>
                      </div>

                      {/* Cards Container */}
                      <div className="mt-3 space-y-3 flex-1 overflow-y-auto">
                        {stageDeals.length === 0 ? (
                          <div className="py-8 text-center text-[11px] text-ink-3 border border-dashed border-line/60 rounded-xl">
                            No assets in {stage.label.toLowerCase()}
                          </div>
                        ) : (
                          stageDeals.map((deal) => {
                            const dealId = deal.listingId || deal.id;
                            const scoreBand = bandForScore(deal.dealScore);

                            return (
                              <div
                                key={dealId}
                                className="group rounded-xl border border-line bg-card p-3 shadow-xs hover:border-line-strong transition"
                              >
                                <div className="flex items-center justify-between text-[10px] text-ink-3">
                                  <span className="font-semibold">{sourceDisplayText(deal.source || "Auction")}</span>
                                  {deal.dealScore != null && (
                                    <span
                                      className="rounded px-1.5 py-0.5 font-bold"
                                      style={{ backgroundColor: `${scoreBand?.color}20`, color: scoreBand?.color }}
                                    >
                                      {Math.round(deal.dealScore)}/99
                                    </span>
                                  )}
                                </div>
                                <h4 className="mt-1 text-xs font-bold text-ink line-clamp-2">
                                  {deal.address || "Address not published"}
                                </h4>
                                {deal.city && deal.state && (
                                  <p className="text-[10px] text-ink-3 mt-0.5">
                                    {deal.city}, {deal.state}
                                  </p>
                                )}
                                <div className="mt-2.5 flex items-center justify-between border-t border-line/60 pt-2 text-[11px]">
                                  <span className="text-[10px] text-ink-3">Opening:</span>
                                  <span className="font-extrabold text-ink">{formatMoney(deal.openingBid)}</span>
                                </div>

                                {deal.saleDate && (
                                  <div className="mt-1 flex items-center justify-between text-[10px] text-ink-3">
                                    <span>Sale Date:</span>
                                    <span className="font-semibold text-ink-2">
                                      {new Date(deal.saleDate).toLocaleDateString()}
                                    </span>
                                  </div>
                                )}

                                {/* Action Buttons & Stage Shift */}
                                <div className="mt-3 flex items-center justify-between border-t border-line/60 pt-2 text-[11px]">
                                  <button
                                    onClick={() => {
                                      if (stageIndex > 0) {
                                        updateDealStage(dealId, stageOrder[stageIndex - 1]);
                                      }
                                    }}
                                    disabled={stageIndex === 0}
                                    className="p-1 rounded text-ink-3 hover:text-ink disabled:opacity-20 hover:bg-paper transition"
                                    title={stageIndex > 0 ? `Move back to ${PIPELINE_STAGES[stageIndex - 1].label}` : "First stage"}
                                  >
                                    <ChevronLeft className="h-3.5 w-3.5" />
                                  </button>

                                  <Link
                                    href={`/listings/${encodeURIComponent(dealId)}`}
                                    className="text-[10px] font-semibold text-ink-2 hover:text-ink flex items-center gap-0.5 transition"
                                  >
                                    Dossier <ArrowRight className="h-2.5 w-2.5" />
                                  </Link>

                                  <button
                                    onClick={() => {
                                      if (stageIndex < stageOrder.length - 1) {
                                        updateDealStage(dealId, stageOrder[stageIndex + 1]);
                                      }
                                    }}
                                    disabled={stageIndex === stageOrder.length - 1}
                                    className="p-1 rounded text-ink-3 hover:text-ink disabled:opacity-20 hover:bg-paper transition"
                                    title={stageIndex < stageOrder.length - 1 ? `Advance to ${PIPELINE_STAGES[stageIndex + 1].label}` : "Final stage"}
                                  >
                                    <ChevronRight className="h-3.5 w-3.5" />
                                  </button>
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Watchlist Tab */}
        {tab === "watchlist" && (
          <div>
            {deals.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-line bg-card p-12 text-center">
                <Building className="mx-auto h-8 w-8 text-ink-3 mb-3" />
                <h3 className="text-base font-bold text-ink">No saved properties yet</h3>
                <p className="mt-1 text-xs text-ink-3 max-w-sm mx-auto">
                  Browse public listings, save promising assets, and monitor their status over time.
                </p>
                <div className="mt-5">
                  <Link
                    href="/listings"
                    className="inline-flex items-center gap-2 rounded-xl bg-ink px-5 py-2.5 text-xs font-semibold text-white hover:bg-ink-2 transition"
                  >
                    Browse Listings <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </div>
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {deals.map((deal) => {
                  const dealId = deal.listingId || deal.id;
                  const currentStageId = pipelineStages[dealId] || "triage";
                  const currentStage = PIPELINE_STAGES.find((s) => s.id === currentStageId);

                  return (
                    <div
                      key={dealId}
                      className="group flex flex-col justify-between rounded-2xl border border-line bg-card p-5 shadow-sm transition hover:shadow-md"
                    >
                      <div>
                        <div className="flex items-center justify-between text-xs text-ink-3">
                          <span className="font-semibold text-ink-3">
                            {sourceDisplayText(deal.source || "Auction")}
                          </span>
                          <div className="flex items-center gap-1.5">
                            <span className="rounded bg-line px-2 py-0.5 text-[10px] font-bold text-ink-2">
                              {currentStage?.label || "Triage"}
                            </span>
                            {deal.dealScore != null && (
                              <span className="rounded bg-line px-2 py-0.5 text-[10px] font-bold text-ink" style={{ color: bandForScore(deal.dealScore)?.color }}>
                                Score {Math.round(deal.dealScore)}
                              </span>
                            )}
                          </div>
                        </div>
                        <h3 className="mt-2 text-sm font-bold text-ink line-clamp-2">
                          {deal.address || "Address not published"}
                        </h3>
                        {deal.city && deal.state && (
                          <p className="text-xs text-ink-3 mt-0.5">
                            {deal.city}, {deal.state}
                          </p>
                        )}
                      </div>

                      <div className="mt-6 border-t border-line pt-4">
                        <div className="flex items-center justify-between text-xs">
                          <div>
                            <span className="block text-[10px] uppercase font-medium text-ink-3">
                              Opening Amount
                            </span>
                            <span className="text-sm font-extrabold text-ink">
                              {formatMoney(deal.openingBid)}
                            </span>
                          </div>
                          {deal.saleDate && (
                            <div className="text-right">
                              <span className="block text-[10px] uppercase font-medium text-ink-3">
                                Auction Date
                              </span>
                              <span className="text-xs font-semibold text-ink-2">
                                {new Date(deal.saleDate).toLocaleDateString()}
                              </span>
                            </div>
                          )}
                        </div>

                        <div className="mt-4 flex items-center justify-between gap-2 pt-2 border-t border-line/60">
                          <Link
                            href={`/listings/${encodeURIComponent(dealId)}`}
                            className="flex items-center gap-1 text-xs font-semibold text-ink hover:text-ink-2 transition"
                          >
                            Open Dossier <ArrowRight className="h-3 w-3" />
                          </Link>
                          <button
                            onClick={() => handleRemove(dealId)}
                            title="Remove from watchlist"
                            className="text-ink-3 hover:text-ink p-1 rounded transition"
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
              <div className="rounded-2xl border border-dashed border-line bg-card p-12 text-center">
                <TrendingDown className="mx-auto h-8 w-8 text-ink-3 mb-3" />
                <h3 className="text-base font-bold text-ink">No price drops recorded</h3>
                <p className="mt-1 text-xs text-ink-3 max-w-sm mx-auto">
                  When auctioneers or sheriff departments reduce opening bids or upset prices on your tracked assets,
                  they will appear here automatically.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-line rounded-2xl border border-line bg-card shadow-sm overflow-hidden">
                {priceDrops.map((drop) => (
                  <div key={drop.listingId} className="flex items-center justify-between p-5 hover:bg-paper transition">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="rounded bg-line px-2 py-0.5 text-[10px] font-bold text-ink">
                          {drop.dropPct ? `-${Math.round(drop.dropPct * 100)}% DROP` : "PRICE DROP"}
                        </span>
                        <h4 className="text-sm font-bold text-ink">{drop.address || drop.listingId}</h4>
                      </div>
                      <p className="text-xs text-ink-3 mt-1">
                        Reduced from {formatMoney(drop.previousBid)} to{" "}
                        <strong className="text-ink">{formatMoney(drop.currentBid)}</strong>
                      </p>
                    </div>
                    <Link
                      href={`/listings/${encodeURIComponent(drop.listingId)}`}
                      className="rounded-xl border border-line-strong bg-card px-3.5 py-2 text-xs font-semibold text-ink-2 hover:bg-paper transition"
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
              <div className="rounded-2xl border border-dashed border-line bg-card p-12 text-center">
                <CalendarDays className="mx-auto h-8 w-8 text-ink-3 mb-3" />
                <h3 className="text-base font-bold text-ink">No sales in the next 30 days</h3>
                <p className="mt-1 text-xs text-ink-3 max-w-sm mx-auto">
                  None of your currently tracked properties have an auction date scheduled in the next 30-day window.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-line rounded-2xl border border-line bg-card shadow-sm overflow-hidden">
                {dashboard.upcomingSales.map((sale) => (
                  <div key={sale.id} className="flex items-center justify-between p-5 hover:bg-paper transition">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="flex items-center gap-1 rounded bg-go-wash px-2 py-0.5 text-[10px] font-bold text-go">
                          <Clock className="h-3 w-3" />
                          {sale.saleDate ? new Date(sale.saleDate).toLocaleDateString() : "Scheduled"}
                        </span>
                        <h4 className="text-sm font-bold text-ink">{sale.address || sale.id}</h4>
                      </div>
                      <p className="text-xs text-ink-3 mt-1">
                        Opening Amount: <strong>{formatMoney(sale.openingBid)}</strong> · Source:{" "}
                        {sourceDisplayText(sale.source || "Public Auction")}
                      </p>
                    </div>
                    <Link
                      href={`/listings/${encodeURIComponent(sale.id)}`}
                      className="rounded-xl bg-ink px-3.5 py-2 text-xs font-semibold text-white hover:bg-ink-2 transition"
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
            <div className="rounded-2xl border border-line bg-card p-5 shadow-sm space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-ink-3 flex items-center gap-2">
                <Layers className="h-4 w-4" /> Jurisdiction (State)
              </h3>
              <div className="space-y-2 pt-2">
                {Object.entries(dashboard?.perState || {}).length === 0 ? (
                  <p className="text-xs text-ink-3">No jurisdiction data</p>
                ) : (
                  Object.entries(dashboard?.perState || {})
                    .sort(([, a], [, b]) => b - a)
                    .map(([state, num]) => (
                      <div key={state} className="flex items-center justify-between text-xs">
                        <span className="font-semibold text-ink-2">{state}</span>
                        <span className="rounded bg-line px-2 py-0.5 font-bold text-ink">
                          {num} ({Math.round((num / count) * 100)}%)
                        </span>
                      </div>
                    ))
                )}
              </div>
            </div>

            {/* By Source */}
            <div className="rounded-2xl border border-line bg-card p-5 shadow-sm space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-ink-3 flex items-center gap-2">
                <Building className="h-4 w-4" /> Source Agency / Feed
              </h3>
              <div className="space-y-2 pt-2">
                {Object.entries(dashboard?.perSource || {}).length === 0 ? (
                  <p className="text-xs text-ink-3">No source data</p>
                ) : (
                  Object.entries(dashboard?.perSource || {})
                    .sort(([, a], [, b]) => b - a)
                    .map(([source, num]) => (
                      <div key={source} className="flex items-center justify-between text-xs">
                        <span className="font-semibold text-ink-2">{sourceDisplayText(source)}</span>
                        <span className="rounded bg-line px-2 py-0.5 font-bold text-ink">
                          {num}
                        </span>
                      </div>
                    ))
                )}
              </div>
            </div>

            {/* By Property Type */}
            <div className="rounded-2xl border border-line bg-card p-5 shadow-sm space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-ink-3 flex items-center gap-2">
                <PieChart className="h-4 w-4" /> Asset Classification
              </h3>
              <div className="space-y-2 pt-2">
                {Object.entries(dashboard?.perPropType || {}).length === 0 ? (
                  <p className="text-xs text-ink-3">No property type data</p>
                ) : (
                  Object.entries(dashboard?.perPropType || {})
                    .sort(([, a], [, b]) => b - a)
                    .map(([propType, num]) => (
                      <div key={propType} className="flex items-center justify-between text-xs">
                        <span className="font-semibold text-ink-2">{propType}</span>
                        <span className="rounded bg-line px-2 py-0.5 font-bold text-ink">
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
