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
} from "lucide-react";
import { useWorkspaceSession } from "@/components/workspace/workspace-shell";
import { useLocale } from "@/components/i18n/locale-provider";
import type { Locale } from "@/lib/i18n/config";
import { localizeDisplayDate, localizePropType } from "@/lib/i18n/domain";
import { formatUsd } from "@/lib/i18n/translator";
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

type EscrowAllocationItem = {
  id: string;
  targetBid: number;
  requiredDeposit: number;
  depositPercent: number;
  paymentMethod: string;
  platform: string;
  saleDate: string | null;
  lockupStartDate: string | null;
  recyclableDate: string | null;
  refundTurnaroundDays: number;
  priorityScore: number;
  status: "FUNDED" | "EXCLUDED_CAPITAL_SHORTFALL" | "EXCLUDED_DATE_CONFLICT";
  allocatedDeposit?: number;
  reason: string;
  original?: {
    address?: string;
    state?: string;
  };
};

type EscrowDateConflict = {
  candidateAuction: string;
  conflictingAuctions: string[];
  candidateRequiredDeposit: number;
  overlappingDeposits: number;
  totalNeeded: number;
  availableCapital: number;
  shortfall: number;
  reason: string;
};

type EscrowAllocationPayload = {
  totalCapital: number;
  totalCommittedCapital: number;
  remainingUnallocatedCapital: number;
  maximumExecutableBiddingPower: number;
  capitalEfficiencyRatio: number;
  fundedAuctionCount?: number;
  excludedAuctionCount?: number;
  allocatedAuctions: EscrowAllocationItem[];
  dateConflicts: EscrowDateConflict[];
  notes?: string;
};

type DashboardPayload = {
  escrowAllocation?: EscrowAllocationPayload | null;
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
  pipelineStage?: PipelineStage;
};

function formatMoney(amount: number | null | undefined, locale: Locale): string {
  if (amount == null || !Number.isFinite(amount)) return "—";
  return formatUsd(locale, amount);
}

const STORAGE_PIPELINE_KEY = "perfectproperty_pipeline_stages_v1";

export function PortfolioView() {
  const { locale, messages: m, format } = useLocale();
  const pv = m.portfolioView;
  const session = useWorkspaceSession();
  const [tab, setTab] = React.useState<"watchlist" | "pipeline" | "drops" | "schedule" | "allocation">("pipeline");
  const [dashboard, setDashboard] = React.useState<DashboardPayload | null>(null);
  const [priceDrops, setPriceDrops] = React.useState<PriceDropItem[]>([]);
  const [historyUnavailable, setHistoryUnavailable] = React.useState(false);
  const [deals, setDeals] = React.useState<SavedDeal[]>([]);
  const [pipelineStages, setPipelineStages] = React.useState<Record<string, PipelineStage>>({});
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [refreshing, setRefreshing] = React.useState(false);
  const [escrowCapital, setEscrowCapital] = React.useState("100000");
  const [debouncedEscrowCapital, setDebouncedEscrowCapital] = React.useState("100000");
  React.useEffect(() => {
    const t = window.setTimeout(() => setDebouncedEscrowCapital(escrowCapital), 300);
    return () => window.clearTimeout(t);
  }, [escrowCapital]);
  const [escrowSortBy, setEscrowSortBy] = React.useState<"priority" | "chronological" | "bidding_power">("priority");
  const [allowRecycling, setAllowRecycling] = React.useState(true);

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
    void fetch("/api/alerts", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ listingId: dealId, stage: newStage }),
    }).catch(() => {
      // Optimistic local cache remains intact if offline
    });
  }, []);

  const loadAbortRef = React.useRef<AbortController | null>(null);
  const loadData = React.useCallback(async () => {
    if (!session.memberTools) {
      setLoading(false);
      return;
    }
    loadAbortRef.current?.abort();
    const controller = new AbortController();
    loadAbortRef.current = controller;
    setError(null);
    try {
      const parsedCap = Number(debouncedEscrowCapital);
      const capParam = Number.isFinite(parsedCap) && parsedCap >= 0 ? parsedCap : 100000;
      const dashQuery = new URLSearchParams({
        capital: String(capParam),
        sortBy: escrowSortBy,
        allowRecycling: String(allowRecycling),
      }).toString();
      const [dashRes, dropsRes, alertsRes] = await Promise.all([
        fetch(`/api/portfolio/dashboard?${dashQuery}`, { cache: "no-store", credentials: "same-origin", signal: controller.signal }),
        fetch("/api/price-drops", { cache: "no-store", credentials: "same-origin", signal: controller.signal }),
        fetch("/api/alerts", { cache: "no-store", credentials: "same-origin", signal: controller.signal }),
      ]);
      if (!dashRes.ok || !dropsRes.ok || !alertsRes.ok) {
        const badStatus = !dashRes.ok ? dashRes.status : (!alertsRes.ok ? alertsRes.status : dropsRes.status);
        setError(`${pv.loadError} (HTTP ${badStatus})`);
      }

      if (dashRes.ok) {
        const dashData = await dashRes.json();
        setDashboard(dashData);
      }

      const dealAddressById = new Map<string, { address?: string; state?: string }>();
      if (alertsRes.ok) {
        const alertsData = await alertsRes.json();
        const rawDeals = Array.isArray(alertsData.deals) ? alertsData.deals : [];
        const mappedDeals: SavedDeal[] = rawDeals.map((d: any) => {
          const listingId = typeof d === "string" ? d : d.listingId || d.id;
          const address = typeof d === "string" ? undefined : d.address || d.headlineAddress;
          const state = typeof d === "string" ? undefined : d.state;
          if (listingId) dealAddressById.set(listingId, { address, state });
          return {
            id: typeof d === "string" ? d : d.id || d.listingId,
            listingId,
            address,
            city: d.city,
            state,
            openingBid: d.openingBid,
            dealScore: d.dealScore,
            saleDate: d.saleDate,
            source: d.source,
            propType: d.propType,
            pipelineStage: d.pipelineStage,
          };
        });
        setDeals(mappedDeals);
        const validStages = new Set<PipelineStage>(PIPELINE_STAGES.map((s) => s.id));
        const toMigrate: Array<{ id: string; stage: PipelineStage }> = [];
        setPipelineStages((prev) => {
          const next: Record<string, PipelineStage> = { ...prev };
          for (const deal of mappedDeals) {
            const dealKey = deal.listingId || deal.id;
            const serverStage = deal.pipelineStage;
            if (serverStage && validStages.has(serverStage)) {
              if (serverStage !== "triage") {
                next[dealKey] = serverStage;
              } else if (prev[dealKey] && validStages.has(prev[dealKey]) && prev[dealKey] !== "triage") {
                toMigrate.push({ id: dealKey, stage: prev[dealKey] });
              } else {
                next[dealKey] = serverStage;
              }
            }
          }
          try {
            localStorage.setItem(STORAGE_PIPELINE_KEY, JSON.stringify(next));
          } catch {
            // Ignore
          }
          return next;
        });
        for (const item of toMigrate) {
          void fetch("/api/alerts", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            credentials: "same-origin",
            body: JSON.stringify({ listingId: item.id, stage: item.stage }),
          }).catch(() => {});
        }
      }

      if (dropsRes.ok) {
        const dropsData = await dropsRes.json();
        setHistoryUnavailable(Boolean(dropsData.historyUnavailable));
        const rawDrops = Array.isArray(dropsData.drops)
          ? dropsData.drops
          : (Array.isArray(dropsData.items) ? dropsData.items : []);
        setPriceDrops(
          rawDrops.map((d: any) => {
            const meta = dealAddressById.get(d.listingId);
            return {
              listingId: d.listingId,
              address: d.address || meta?.address,
              state: d.state || meta?.state,
              dropped: Boolean(d.dropped),
              dropAmount: d.dropAmount ?? (typeof d.delta === "number" ? Math.abs(d.delta) : undefined),
              dropPct: d.dropPct ?? (typeof d.deltaPct === "number" ? Math.abs(d.deltaPct) : undefined),
              currentBid: d.currentBid ?? null,
              previousBid: d.previousBid ?? null,
            };
          })
        );
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      setError(err instanceof Error ? err.message : pv.loadError);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [session.memberTools, debouncedEscrowCapital, escrowSortBy, allowRecycling, pv.loadError]);

  React.useEffect(() => {
    loadData();
  }, [loadData]);

  const handleRemove = async (dealId: string) => {
    try {
      const res = await fetch("/api/alerts", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listingId: dealId }),
        credentials: "same-origin",
      });
      if (!res.ok) {
        setError(`Failed to remove saved deal (HTTP ${res.status})`);
        return;
      }
      setDeals((prev) => prev.filter((d) => (d.listingId || d.id) !== dealId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove saved deal");
    }
  };

  if (!session.memberTools) {
    return (
      <div className="mx-auto max-w-4xl px-6 py-20 text-center">
        <ShieldCheck className="mx-auto h-12 w-12 text-ink-3 mb-4" />
        <h1 className="text-2xl font-bold text-ink">{locale === "en" ? "Member Access Required" : m.workspacePages.portfolioLockedTitle}</h1>
        <p className="mt-2 text-sm text-ink-3 max-w-md mx-auto">
          {m.workspacePages.portfolioLockedSub}
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link
            href="/sign-in"
            className="rounded-control bg-ink px-6 py-3 text-sm font-semibold text-white hover:bg-ink-2 transition"
          >
            {m.workspacePages.huntsMemberBtn}
          </Link>
          <button
            type="button"
            onClick={() => session.requestUnlock()}
            className="rounded-control border border-line-strong bg-card px-5 py-3 text-sm font-semibold text-ink-2 hover:bg-paper transition"
          >
            {m.workspacePages.portfolioUnlockBtn}
          </button>
          <Link
            href="/listings"
            className="rounded-control border border-line-strong bg-card px-5 py-3 text-sm font-semibold text-ink-2 hover:bg-paper transition"
          >
            {m.common.browseListings}
          </Link>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-6xl px-6 py-20 text-center">
        <Loader2 className="mx-auto h-8 w-8 animate-spin text-ink-3 mb-4" />
        <p className="text-sm font-medium text-ink-3">{m.workspacePages.portfolioLoading}</p>
      </div>
    );
  }

  const count = dashboard?.count ?? deals.length;
  const activeDrops = priceDrops.filter((d) => d.dropped);
  const dropsCount = activeDrops.length;

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
          <p className="text-label font-bold uppercase tracking-[0.14em] text-ink-3">{m.workspacePages.portfolioEyebrow}</p>
          <h1 className="mt-1 text-3xl font-extrabold tracking-tight text-ink">
            {m.workspacePages.portfolioHeading}
          </h1>
          <p className="mt-1.5 text-xs text-ink-3">
            {m.workspacePages.portfolioSub}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <a
            href="/api/export?format=markdown&saved=true"
            download="perfectproperty_dossiers.md"
            className="flex items-center gap-1.5 rounded-control border border-line-strong bg-card px-3.5 py-2.5 text-xs font-semibold text-ink-2 hover:bg-paper transition"
            title={pv.exportMdTitle}
          >
            <Download className="h-3.5 w-3.5" />
            {pv.exportMdBtn}
          </a>
          <a
            href="/api/export?format=csv&saved=true"
            download="perfectproperty_portfolio.csv"
            className="flex items-center gap-1.5 rounded-control border border-line-strong bg-card px-3.5 py-2.5 text-xs font-semibold text-ink-2 hover:bg-paper transition"
            title={pv.exportCsvTitle}
          >
            <Download className="h-3.5 w-3.5" />
            {pv.exportCsvBtn}
          </a>
          <button
            onClick={() => {
              setRefreshing(true);
              loadData();
            }}
            disabled={refreshing}
            className="flex items-center gap-1.5 rounded-control border border-line-strong bg-card px-3.5 py-2.5 text-xs font-semibold text-ink-2 hover:bg-paper transition disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
            {pv.refreshBtn}
          </button>
          <Link
            href="/bid-sheet"
            className="flex items-center gap-1.5 rounded-control border border-line-strong bg-card px-3.5 py-2.5 text-xs font-semibold text-ink-2 hover:bg-paper transition"
          >
            {m.workspace.nav.bidSheet}
          </Link>
          <Link
            href="/listings"
            className="flex items-center gap-1.5 rounded-control bg-ink px-4 py-2.5 text-xs font-semibold text-white hover:bg-ink-2 transition"
          >
            <Plus className="h-3.5 w-3.5" />
            {pv.addListingsBtn}
          </Link>
        </div>
      </div>

      {error && (
        <div className="mt-6 flex items-center gap-2 rounded-control border border-catch/30 bg-catch-wash p-4 text-xs font-medium text-catch-ink" role="alert">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* KPI Cards */}
      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-card border border-line bg-card p-5 shadow-sm">
          <div className="flex items-center justify-between text-xs font-semibold text-ink-3">
            <span>{pv.kpiTotalBidsLabel}</span>
            <DollarSign className="h-4 w-4 text-ink-3" />
          </div>
          <p className="mt-3 text-3xl font-extrabold text-ink">{formatMoney(totalPipelineCapital, locale)}</p>
          <p className="mt-1 text-label text-ink-3">{format(pv.kpiTotalBidsSub, { count: deals.length })}</p>
        </div>

        <div className="rounded-card border border-line bg-card p-5 shadow-sm">
          <div className="flex items-center justify-between text-xs font-semibold text-ink-3">
            <span>{pv.kpiEquityLabel}</span>
            <Building className="h-4 w-4 text-ink-3" />
          </div>
          <p className="mt-3 text-3xl font-extrabold text-ink">
            {formatMoney(dashboard?.totalEstimatedEquity, locale)}
          </p>
          <p className="mt-1 text-label text-ink-3">{pv.kpiEquitySub}</p>
        </div>

        <div className="rounded-card border border-line bg-card p-5 shadow-sm">
          <div className="flex items-center justify-between text-xs font-semibold text-ink-3">
            <span>{pv.kpiMedianScoreLabel}</span>
            <ShieldCheck className="h-4 w-4 text-ink-3" />
          </div>
          <p className="mt-3 text-3xl font-extrabold text-ink" style={{ color: bandForScore(dashboard?.medianDealScore)?.color }}>
            {dashboard?.medianDealScore != null ? Math.round(dashboard.medianDealScore) : "—"}
          </p>
          <p className="mt-1 text-label text-ink-3">
            {dashboard?.medianDiscount != null
              ? format(pv.kpiMedianDiscountSub, { pct: Math.round(dashboard.medianDiscount * 100) })
              : pv.kpiMedianScoreFallbackSub}
          </p>
        </div>

        <div className="rounded-card border border-line bg-card p-5 shadow-sm">
          <div className="flex items-center justify-between text-xs font-semibold text-ink-3">
            <span>{pv.kpiUpcomingSalesLabel}</span>
            <CalendarDays className="h-4 w-4 text-ink-3" />
          </div>
          <p className="mt-3 text-3xl font-extrabold text-ink">
            {dashboard?.upcomingSales?.length ?? 0}
          </p>
          <p className="mt-1 text-label text-ink-3">{pv.kpiUpcomingSalesSub}</p>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="mt-10 flex flex-wrap border-b border-line text-xs font-bold">
        <button
          onClick={() => setTab("pipeline")}
          className={`border-b-2 px-5 py-3 transition flex items-center gap-1.5 shrink-0 ${
            tab === "pipeline"
              ? "border-ink text-ink"
              : "border-transparent text-ink-3 hover:text-ink"
          }`}
        >
          <Kanban className="h-3.5 w-3.5" />
          {format(pv.tabPipeline, { count: deals.length })}
        </button>
        <button
          onClick={() => setTab("watchlist")}
          className={`border-b-2 px-5 py-3 transition shrink-0 ${
            tab === "watchlist"
              ? "border-ink text-ink"
              : "border-transparent text-ink-3 hover:text-ink"
          }`}
        >
          {format(pv.tabWatchlist, { count: deals.length })}
        </button>
        <button
          onClick={() => setTab("drops")}
          className={`border-b-2 px-5 py-3 transition flex items-center gap-1.5 shrink-0 ${
            tab === "drops"
              ? "border-ink text-ink"
              : "border-transparent text-ink-3 hover:text-ink"
          }`}
        >
          {pv.tabDrops}
          {dropsCount > 0 && (
            <span className="rounded-full bg-line px-2 py-0.5 text-label text-ink">
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
          {format(pv.tabSchedule, { count: dashboard?.upcomingSales?.length ?? 0 })}
        </button>
        <button
          onClick={() => setTab("allocation")}
          className={`border-b-2 px-5 py-3 transition shrink-0 ${
            tab === "allocation"
              ? "border-ink text-ink"
              : "border-transparent text-ink-3 hover:text-ink"
          }`}
        >
          {pv.tabAllocation}
        </button>
      </div>

      {/* Tab Content */}
      <div className="mt-8">
        {/* Capital Pipeline Kanban Tab */}
        {tab === "pipeline" && (
          <div className="space-y-6">
            {deals.length === 0 ? (
              <div className="rounded-card border border-dashed border-line bg-card p-12 text-center">
                <Kanban className="mx-auto h-8 w-8 text-ink-3 mb-3" />
                <h2 className="text-base font-bold text-ink">{pv.pipelineEmptyHeading}</h2>
                <p className="mt-1 text-xs text-ink-3 max-w-sm mx-auto">
                  {pv.pipelineEmptyBody}
                </p>
                <div className="mt-5">
                  <Link
                    href="/listings"
                    className="inline-flex items-center gap-2 rounded-control bg-ink px-5 py-2.5 text-xs font-semibold text-white hover:bg-ink-2 transition"
                  >
                    {pv.browseListingsBtn} <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4 items-start">
                {PIPELINE_STAGES.map((stage, stageIndex) => {
                  const stageDeals = dealsByStage[stage.id];
                  const stageCapital = stageDeals.reduce((sum, d) => sum + (d.openingBid || 0), 0);
                  const stageMeta = pv.pipelineStages[stage.id];
                  const prevStageLabel = stageIndex > 0 ? pv.pipelineStages[PIPELINE_STAGES[stageIndex - 1].id].label : "";
                  const nextStageLabel = stageIndex < stageOrder.length - 1 ? pv.pipelineStages[PIPELINE_STAGES[stageIndex + 1].id].label : "";

                  return (
                    <div
                      key={stage.id}
                      className="rounded-card border border-line bg-card/60 p-3.5 flex flex-col min-h-[460px] shadow-sm"
                    >
                      {/* Column Header */}
                      <div className="border-b border-line pb-3">
                        <div className="flex items-center justify-between">
                          <span className="font-extrabold text-xs text-ink">{stageMeta.label}</span>
                          <span className="rounded-full bg-line px-2 py-0.5 text-label font-bold text-ink">
                            {stageDeals.length}
                          </span>
                        </div>
                        <div className="mt-1.5 flex items-center justify-between text-label text-ink-3">
                          <span>{pv.stageOpeningBidsLabel}</span>
                          <span className="font-bold text-ink">{formatMoney(stageCapital, locale)}</span>
                        </div>
                        <p className="mt-1 text-xs text-ink-3 line-clamp-1" title={stageMeta.description}>
                          {stageMeta.description}
                        </p>
                      </div>

                      {/* Cards Container */}
                      <div className="mt-3 space-y-3 flex-1 overflow-y-auto">
                        {stageDeals.length === 0 ? (
                          <div className="py-8 text-center text-label text-ink-3 border border-dashed border-line/60 rounded-control">
                            {format(pv.stageEmpty, { stage: stageMeta.label.toLowerCase() })}
                          </div>
                        ) : (
                          stageDeals.map((deal) => {
                            const dealId = deal.listingId || deal.id;
                            const scoreBand = bandForScore(deal.dealScore);

                            return (
                              <div
                                key={dealId}
                                className="group rounded-control border border-line bg-card p-3 shadow-xs hover:border-line-strong transition"
                              >
                                <div className="flex items-center justify-between text-meta text-ink-3">
                                  <span className="font-semibold">
                                    {deal.source ? sourceDisplayText(deal.source) : pv.defaultSourceAuction}
                                  </span>
                                  {deal.dealScore != null && (
                                    <span
                                      className="rounded px-1.5 py-0.5 font-bold"
                                      style={scoreBand ? { backgroundColor: `${scoreBand.color}20`, color: scoreBand.color } : undefined}
                                    >
                                      {format(pv.scoreOutOf99, { score: Math.round(deal.dealScore) })}
                                    </span>
                                  )}
                                </div>
                                <h4 className="mt-1 text-xs font-bold text-ink line-clamp-2">
                                  {deal.address || pv.addressNotPublished}
                                </h4>
                                {deal.city && deal.state && (
                                  <p className="text-meta text-ink-3 mt-0.5">
                                    {deal.city}, {deal.state}
                                  </p>
                                )}
                                <div className="mt-2.5 flex items-center justify-between border-t border-line/60 pt-2 text-label">
                                  <span className="text-meta text-ink-3">{pv.cardOpeningLabel}</span>
                                  <span className="font-extrabold text-ink">{formatMoney(deal.openingBid, locale)}</span>
                                </div>

                                {deal.saleDate && (
                                  <div className="mt-1 flex items-center justify-between text-meta text-ink-3">
                                    <span>{pv.cardSaleDateLabel}</span>
                                    <span className="font-semibold text-ink-2">
                                      {localizeDisplayDate(deal.saleDate, locale, pv.unscheduled)}
                                    </span>
                                  </div>
                                )}

                                {/* Action Buttons & Stage Shift */}
                                <div className="mt-3 flex items-center justify-between border-t border-line/60 pt-2 text-label">
                                  <button
                                    onClick={() => {
                                      if (stageIndex > 0) {
                                        updateDealStage(dealId, stageOrder[stageIndex - 1]);
                                      }
                                    }}
                                    disabled={stageIndex === 0}
                                    className="p-1 rounded text-ink-3 hover:text-ink disabled:opacity-20 hover:bg-paper transition"
                                    title={stageIndex > 0 ? format(pv.moveBackTitle, { stage: prevStageLabel }) : pv.firstStageTitle}
                                  >
                                    <ChevronLeft className="h-3.5 w-3.5" />
                                  </button>

                                  <Link
                                    href={`/listings/${encodeURIComponent(dealId)}`}
                                    className="text-label font-semibold text-ink-2 hover:text-ink flex items-center gap-0.5 transition"
                                  >
                                    {pv.dossierLink} <ArrowRight className="h-2.5 w-2.5" />
                                  </Link>

                                  <button
                                    onClick={() => {
                                      if (stageIndex < stageOrder.length - 1) {
                                        updateDealStage(dealId, stageOrder[stageIndex + 1]);
                                      }
                                    }}
                                    disabled={stageIndex === stageOrder.length - 1}
                                    className="p-1 rounded text-ink-3 hover:text-ink disabled:opacity-20 hover:bg-paper transition"
                                    title={stageIndex < stageOrder.length - 1 ? format(pv.advanceToTitle, { stage: nextStageLabel }) : pv.finalStageTitle}
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
              <div className="rounded-card border border-dashed border-line bg-card p-12 text-center">
                <Building className="mx-auto h-8 w-8 text-ink-3 mb-3" />
                <h2 className="text-base font-bold text-ink">{pv.watchlistEmptyHeading}</h2>
                <p className="mt-1 text-xs text-ink-3 max-w-sm mx-auto">
                  {pv.watchlistEmptyBody}
                </p>
                <div className="mt-5">
                  <Link
                    href="/listings"
                    className="inline-flex items-center gap-2 rounded-control bg-ink px-5 py-2.5 text-xs font-semibold text-white hover:bg-ink-2 transition"
                  >
                    {pv.browseListingsBtn} <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </div>
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {deals.map((deal) => {
                  const dealId = deal.listingId || deal.id;
                  const currentStageId = pipelineStages[dealId] || "triage";
                  const currentStageLabel = pv.pipelineStages[currentStageId]?.label || pv.pipelineStages.triage.label;

                  return (
                    <div
                      key={dealId}
                      className="group flex flex-col justify-between rounded-card border border-line bg-card p-5 shadow-sm transition hover:shadow-md"
                    >
                      <div>
                        <div className="flex items-center justify-between text-xs text-ink-3">
                          <span className="font-semibold text-ink-3">
                            {deal.source ? sourceDisplayText(deal.source) : pv.defaultSourceAuction}
                          </span>
                          <div className="flex items-center gap-1.5">
                            <span className="rounded-control bg-line px-2 py-0.5 text-label font-bold text-ink-2">
                              {currentStageLabel}
                            </span>
                            {deal.dealScore != null && (
                              <span className="rounded-control bg-line px-2 py-0.5 text-label font-bold text-ink" style={{ color: bandForScore(deal.dealScore)?.color }}>
                                {format(pv.scoreBadge, { score: Math.round(deal.dealScore) })}
                              </span>
                            )}
                          </div>
                        </div>
                        <h3 className="mt-2 text-sm font-bold text-ink line-clamp-2">
                          {deal.address || pv.addressNotPublished}
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
                            <span className="block text-meta uppercase font-medium text-ink-3">
                              {pv.openingAmountLabel}
                            </span>
                            <span className="text-sm font-extrabold text-ink">
                              {formatMoney(deal.openingBid, locale)}
                            </span>
                          </div>
                          {deal.saleDate && (
                            <div className="text-right">
                              <span className="block text-meta uppercase font-medium text-ink-3">
                                {pv.auctionDateLabel}
                              </span>
                              <span className="text-xs font-semibold text-ink-2">
                                {localizeDisplayDate(deal.saleDate, locale, pv.unscheduled)}
                              </span>
                            </div>
                          )}
                        </div>

                        <div className="mt-4 flex items-center justify-between gap-2 pt-2 border-t border-line/60">
                          <Link
                            href={`/listings/${encodeURIComponent(dealId)}`}
                            className="flex items-center gap-1 text-xs font-semibold text-ink hover:text-ink-2 transition"
                          >
                            {pv.openDossierLink} <ArrowRight className="h-3 w-3" />
                          </Link>
                          <button
                            onClick={() => handleRemove(dealId)}
                            title={pv.removeWatchlistTitle}
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
            {historyUnavailable && (
              <div className="rounded-control border border-catch/40 bg-catch/5 px-4 py-3 text-xs text-ink">
                {locale === "en"
                  ? "Historical bid snapshots are temporarily unavailable, so prior-bid comparisons could not be computed for your saved listings."
                  : pv.historyUnavailableBanner}
              </div>
            )}
            {activeDrops.length === 0 ? (
              <div className="rounded-card border border-dashed border-line bg-card p-12 text-center">
                <TrendingDown className="mx-auto h-8 w-8 text-ink-3 mb-3" />
                <h2 className="text-base font-bold text-ink">{pv.dropsEmptyHeading}</h2>
                <p className="mt-1 text-xs text-ink-3 max-w-sm mx-auto">
                  {pv.dropsEmptyBody}
                </p>
              </div>
            ) : (
              <div className="divide-y divide-line rounded-card border border-line bg-card shadow-sm overflow-hidden">
                {activeDrops.map((drop) => (
                  <div key={drop.listingId} className="flex items-center justify-between p-5 hover:bg-paper transition">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="rounded-control bg-line px-2 py-0.5 text-label font-bold text-ink">
                          {drop.dropPct ? format(pv.dropPctBadge, { pct: Math.round(drop.dropPct * 100) }) : pv.priceDropBadge}
                        </span>
                        <h4 className="text-sm font-bold text-ink">{drop.address || drop.listingId}</h4>
                      </div>
                      <p className="text-xs text-ink-3 mt-1">
                        {format(pv.reducedFromLabel, { previous: formatMoney(drop.previousBid, locale) })}{" "}
                        <strong className="text-ink">{formatMoney(drop.currentBid, locale)}</strong>
                      </p>
                    </div>
                    <Link
                      href={`/listings/${encodeURIComponent(drop.listingId)}`}
                      className="rounded-control border border-line-strong bg-card px-3.5 py-2 text-xs font-semibold text-ink-2 hover:bg-paper transition"
                    >
                      {pv.viewUpdateLink}
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
              <div className="rounded-card border border-dashed border-line bg-card p-12 text-center">
                <CalendarDays className="mx-auto h-8 w-8 text-ink-3 mb-3" />
                <h2 className="text-base font-bold text-ink">{pv.scheduleEmptyHeading}</h2>
                <p className="mt-1 text-xs text-ink-3 max-w-sm mx-auto">
                  {pv.scheduleEmptyBody}
                </p>
              </div>
            ) : (
              <div className="divide-y divide-line rounded-card border border-line bg-card shadow-sm overflow-hidden">
                {dashboard.upcomingSales.map((sale) => (
                  <div key={sale.id} className="flex items-center justify-between p-5 hover:bg-paper transition">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="flex items-center gap-1 rounded-control bg-go-wash px-2 py-0.5 text-label font-bold text-go">
                          <Clock className="h-3 w-3" />
                          {sale.saleDate ? localizeDisplayDate(sale.saleDate, locale, pv.scheduled) : pv.scheduled}
                        </span>
                        <h4 className="text-sm font-bold text-ink">{sale.address || sale.id}</h4>
                      </div>
                      <p className="text-xs text-ink-3 mt-1">
                        {pv.openingAmountPrefix} <strong>{formatMoney(sale.openingBid, locale)}</strong> · {pv.sourcePrefix}{" "}
                        {sale.source ? sourceDisplayText(sale.source) : pv.defaultSourcePublicAuction}
                      </p>
                    </div>
                    <Link
                      href={`/listings/${encodeURIComponent(sale.id)}`}
                      className="rounded-control bg-ink px-3.5 py-2 text-xs font-semibold text-white hover:bg-ink-2 transition"
                    >
                      {pv.prepareBidLink}
                    </Link>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Allocation Tab */}
        {tab === "allocation" && (
          <div className="space-y-6">
            {/* Escrow & Deposit Capital Optimizer (optimizeEscrowAllocation) */}
            <div className="rounded-card border border-line bg-card p-5 shadow-sm space-y-5" data-testid="escrow-optimizer-panel">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h3 className="text-sm font-bold text-ink flex items-center gap-2">
                    <DollarSign className="h-4 w-4 text-ink-2" />
                    {pv.escrowTitle}
                  </h3>
                  <p className="mt-1 text-xs text-ink-3">
                    {pv.escrowSub}
                  </p>
                </div>
                <div className="flex flex-wrap items-end gap-3">
                  <label className="block text-xs">
                    <span className="font-semibold text-ink-3 block mb-1">{pv.liquidCapitalLabel}</span>
                    <input
                      type="number"
                      min={0}
                      step={5000}
                      value={escrowCapital}
                      onChange={(e) => setEscrowCapital(e.target.value)}
                      className="h-9 w-32 rounded-control border border-line-strong bg-paper px-2.5 text-xs font-semibold text-ink"
                    />
                  </label>
                  <label className="block text-xs">
                    <span className="font-semibold text-ink-3 block mb-1">{pv.priorityPolicyLabel}</span>
                    <select
                      value={escrowSortBy}
                      onChange={(e) => setEscrowSortBy(e.target.value as "priority" | "chronological" | "bidding_power")}
                      className="h-9 rounded-control border border-line-strong bg-paper px-2.5 text-xs font-semibold text-ink"
                    >
                      <option value="priority">{pv.priorityScoreOption}</option>
                      <option value="chronological">{pv.priorityChronologicalOption}</option>
                      <option value="bidding_power">{pv.priorityBiddingPowerOption}</option>
                    </select>
                  </label>
                  <label className="inline-flex h-9 items-center gap-2 rounded-control border border-line bg-paper px-3 text-xs font-semibold text-ink-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={allowRecycling}
                      onChange={(e) => setAllowRecycling(e.target.checked)}
                      className="rounded border-line-strong"
                    />
                    {pv.recycleDepositsLabel}
                  </label>
                </div>
              </div>

              {dashboard?.escrowAllocation ? (
                <>
                  <div className="grid gap-3 sm:grid-cols-4">
                    <div className="rounded-control border border-line bg-paper p-3">
                      <span className="text-label font-bold uppercase tracking-wider text-ink-3">{pv.peakCommittedLabel}</span>
                      <p className="mt-1 text-lg font-bold text-ink">{formatMoney(dashboard.escrowAllocation.totalCommittedCapital, locale)}</p>
                    </div>
                    <div className="rounded-control border border-line bg-paper p-3">
                      <span className="text-label font-bold uppercase tracking-wider text-ink-3">{pv.remainingCapitalLabel}</span>
                      <p className="mt-1 text-lg font-bold text-ink">{formatMoney(dashboard.escrowAllocation.remainingUnallocatedCapital, locale)}</p>
                    </div>
                    <div className="rounded-control border border-line bg-paper p-3">
                      <span className="text-label font-bold uppercase tracking-wider text-ink-3">{pv.maxBiddingPowerLabel}</span>
                      <p className="mt-1 text-lg font-bold text-yours">{formatMoney(dashboard.escrowAllocation.maximumExecutableBiddingPower, locale)}</p>
                    </div>
                    <div className="rounded-control border border-line bg-paper p-3">
                      <span className="text-label font-bold uppercase tracking-wider text-ink-3">{pv.capitalEfficiencyLabel}</span>
                      <p className="mt-1 text-lg font-bold text-ink">{dashboard.escrowAllocation.capitalEfficiencyRatio}x</p>
                    </div>
                  </div>

                  {dashboard.escrowAllocation.dateConflicts.length > 0 && (
                    <div className="rounded-control border border-catch/30 bg-catch-wash p-3.5 space-y-1.5">
                      <p className="text-xs font-bold text-catch-ink flex items-center gap-1.5">
                        <AlertCircle className="h-3.5 w-3.5" />
                        {format(pv.conflictsDetected, { count: dashboard.escrowAllocation.dateConflicts.length })}
                      </p>
                      <ul className="space-y-1 text-xs text-catch-ink">
                        {dashboard.escrowAllocation.dateConflicts.map((conflict, idx) => (
                          <li key={`${conflict.candidateAuction}-${idx}`}>{conflict.reason}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {dashboard.escrowAllocation.allocatedAuctions.length === 0 ? (
                    <p className="text-xs text-ink-3">{dashboard.escrowAllocation.notes || pv.escrowEmptyNotes}</p>
                  ) : (
                    <div className="divide-y divide-line rounded-control border border-line">
                      {dashboard.escrowAllocation.allocatedAuctions.map((item) => (
                        <div key={item.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className={`rounded-full px-2 py-0.5 text-label font-bold uppercase ${
                                item.status === "FUNDED"
                                  ? "bg-yours-wash text-yours border border-yours/30"
                                  : "bg-catch-wash text-catch-ink border border-catch/30"
                              }`}>
                                {item.status === "FUNDED"
                                  ? pv.statusFunded
                                  : item.status === "EXCLUDED_DATE_CONFLICT"
                                    ? pv.statusDateConflict
                                    : pv.statusCapitalShortfall}
                              </span>
                              <span className="text-xs font-bold text-ink truncate">
                                {item.original?.address || item.id}{item.original?.state ? ` (${item.original.state})` : ""}
                              </span>
                            </div>
                            <p className="mt-1 text-xs text-ink-3">
                              {item.platform} · {item.paymentMethod.replace(/_/g, " ")} · {pv.depositLabel}:{" "}
                              <strong>{formatMoney(item.requiredDeposit, locale)}</strong> ({Math.round(item.depositPercent * 100)}%) ·{" "}
                              {pv.targetBidLabel}: <strong>{formatMoney(item.targetBid, locale)}</strong>
                            </p>
                            <p className="mt-0.5 text-label text-ink-3">{item.reason}</p>
                          </div>
                          {item.saleDate && (
                            <span className="shrink-0 text-xs font-semibold text-ink-2">
                              {pv.gavelPrefix} {localizeDisplayDate(item.saleDate, locale, "—")}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <p className="text-xs text-ink-3">{pv.escrowNoAllocation}</p>
              )}
            </div>

            <div className="grid gap-6 sm:grid-cols-3">
            {/* By State */}
            <div className="rounded-card border border-line bg-card p-5 shadow-sm space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-ink-3 flex items-center gap-2">
                <Layers className="h-4 w-4" /> {pv.byStateHeading}
              </h3>
              <div className="space-y-2 pt-2">
                {Object.entries(dashboard?.perState || {}).length === 0 ? (
                  <p className="text-xs text-ink-3">{pv.byStateEmpty}</p>
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
            <div className="rounded-card border border-line bg-card p-5 shadow-sm space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-ink-3 flex items-center gap-2">
                <Building className="h-4 w-4" /> {pv.bySourceHeading}
              </h3>
              <div className="space-y-2 pt-2">
                {Object.entries(dashboard?.perSource || {}).length === 0 ? (
                  <p className="text-xs text-ink-3">{pv.bySourceEmpty}</p>
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
            <div className="rounded-card border border-line bg-card p-5 shadow-sm space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-ink-3 flex items-center gap-2">
                <PieChart className="h-4 w-4" /> {pv.byPropTypeHeading}
              </h3>
              <div className="space-y-2 pt-2">
                {Object.entries(dashboard?.perPropType || {}).length === 0 ? (
                  <p className="text-xs text-ink-3">{pv.byPropTypeEmpty}</p>
                ) : (
                  Object.entries(dashboard?.perPropType || {})
                    .sort(([, a], [, b]) => b - a)
                    .map(([propType, num]) => (
                      <div key={propType} className="flex items-center justify-between text-xs">
                        <span className="font-semibold text-ink-2">{localizePropType(propType, m, locale) || propType}</span>
                        <span className="rounded bg-line px-2 py-0.5 font-bold text-ink">
                          {num}
                        </span>
                      </div>
                    ))
                )}
              </div>
            </div>
          </div>
          </div>
        )}
      </div>
    </div>
  );
}
