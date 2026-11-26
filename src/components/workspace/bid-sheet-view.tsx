"use client";

import * as React from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Banknote,
  CalendarClock,
  CheckCircle2,
  Landmark,
  Loader2,
  Printer,
  RefreshCw,
  ShieldAlert,
  Wallet,
} from "lucide-react";
import { computeCashiersCheckLadder } from "@server/intelligence/check-ladder";
import { readDeviceWatchlistIds, extractAlertDealIds } from "@/lib/watchlist-sync";
import { readUnderwriteScenario, writeUnderwriteScenario, syncScenarioToDealFile } from "@/lib/underwrite-scenario";
import { displayDate, displayMoney, knownNumber, positiveNumber } from "@/lib/listing-display";
import { sourceDisplayText } from "@/lib/source-display";
import { useLocale } from "@/components/i18n/locale-provider";
import type { PropertyListing } from "@/components/terminal/property-data";

const SCENARIO_V1_PREFIX = "pp:underwrite-scenario:v1:";

interface LocalScenarioOverride {
  maxAllowableOffer: number | null;
  customOpeningBid: number | null;
  rehabBudget: number | null;
  delinquentTaxes: number | null;
  customValuation: number | null;
}

function parseNonNegNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? value : null;
  if (typeof value === "string" && value.trim()) {
    const cleaned = Number(value.replace(/[$,\s]/g, ""));
    return Number.isFinite(cleaned) && cleaned >= 0 ? cleaned : null;
  }
  return null;
}

function readLocalScenarioOverrides(): Record<string, LocalScenarioOverride> {
  const out: Record<string, LocalScenarioOverride> = {};
  if (typeof window === "undefined") return out;
  try {
    const ls = window.localStorage;
    for (let i = 0; i < ls.length; i += 1) {
      const key = ls.key(i);
      if (!key || !key.startsWith(SCENARIO_V1_PREFIX)) continue;
      const listingId = key.slice(SCENARIO_V1_PREFIX.length);
      if (!listingId) continue;
      const raw = ls.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (!parsed || typeof parsed !== "object") continue;
      out[listingId] = {
        maxAllowableOffer: parseNonNegNumber(parsed.maxAllowableOffer),
        customOpeningBid: parseNonNegNumber(parsed.customOpeningBid),
        rehabBudget: parseNonNegNumber(parsed.rehabBudget),
        delinquentTaxes: parseNonNegNumber(parsed.delinquentTaxes),
        customValuation: parseNonNegNumber(parsed.customValuation),
      };
    }
  } catch {
    // Ignore localStorage unavailability or malformed entries
  }
  return out;
}

function resolveScenarioForListing(
  listingId: string,
  localOverrides: Record<string, LocalScenarioOverride>,
): LocalScenarioOverride {
  const lsRow = localOverrides[listingId];
  const ssRow = readUnderwriteScenario(listingId);
  return {
    maxAllowableOffer: lsRow?.maxAllowableOffer ?? parseNonNegNumber(ssRow?.maxAllowableOffer),
    customOpeningBid: lsRow?.customOpeningBid ?? parseNonNegNumber(ssRow?.customOpeningBid),
    rehabBudget: lsRow?.rehabBudget ?? parseNonNegNumber(ssRow?.rehabBudget),
    delinquentTaxes: lsRow?.delinquentTaxes ?? parseNonNegNumber(ssRow?.delinquentTaxes),
    customValuation: lsRow?.customValuation ?? parseNonNegNumber(ssRow?.customValuation),
  };
}

function formatPaymentMethod(method: string): string {
  switch (method) {
    case "wire":
      return "Wire / ACH";
    case "credit_card_hold":
      return "Card Hold / Wire";
    case "cashiers_check":
      return "Cashier's Check (100%)";
    case "certified_funds":
      return "Certified / Cashier's Check";
    default:
      return method.replace(/_/g, " ");
  }
}

function publishedValuationRange(listing: PropertyListing, notPublishedLabel: string): string {
  const low = positiveNumber(listing.estLow);
  const high = positiveNumber(listing.estHigh);
  if (low !== null && high !== null) {
    return `${displayMoney(low)} – ${displayMoney(high)}`;
  }
  const mid = positiveNumber(listing.mid);
  if (mid !== null) return displayMoney(mid);
  return notPublishedLabel;
}

export function BidSheetView() {
  const { messages } = useLocale();
  const bs = messages.bidSheetPage;
  const [apiVerifying, setApiVerifying] = React.useState<boolean>(false);
  const [apiVerifyNote, setApiVerifyNote] = React.useState<string | null>(null);
  const [apiVerifyError, setApiVerifyError] = React.useState<string | null>(null);
  const [listings, setListings] = React.useState<PropertyListing[]>([]);
  const [scenarioMap, setScenarioMap] = React.useState<Record<string, LocalScenarioOverride>>({});
  const [manualWalkAwayBids, setManualWalkAwayBids] = React.useState<Record<string, string>>(() => {
    if (typeof window === "undefined") return {};
    try {
      const raw = window.localStorage.getItem("pp_bid_sheet_manual_bids_v1");
      const parsed = raw ? JSON.parse(raw) : null;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  });
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem("pp_bid_sheet_manual_bids_v1", JSON.stringify(manualWalkAwayBids));
    } catch {
      // Ignore quota errors
    }
    const entries = Object.entries(manualWalkAwayBids);
    if (entries.length === 0) return;
    const timer = window.setTimeout(() => {
      for (const [targetId, rawVal] of entries) {
        const parsed = parseNonNegNumber(rawVal);
        if (parsed === null || parsed <= 0) continue;
        const current = readUnderwriteScenario(targetId);
        if (current?.maxAllowableOffer === parsed) continue;
        writeUnderwriteScenario(targetId, { maxAllowableOffer: parsed });
        const saved = readUnderwriteScenario(targetId);
        if (saved) void syncScenarioToDealFile(targetId, saved);
      }
    }, 350);
    return () => window.clearTimeout(timer);
  }, [manualWalkAwayBids]);
  const [availableCapitalInput, setAvailableCapitalInput] = React.useState<string>("150000");
  const [loading, setLoading] = React.useState<boolean>(true);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [missingIds, setMissingIds] = React.useState<string[]>([]);
  const [scenarioOnlyIds, setScenarioOnlyIds] = React.useState<string[]>([]);

  const loadBidSheet = React.useCallback(async (overrideIds?: string[]) => {
    setLoading(true);
    setLoadError(null);
    setMissingIds([]);

    try {
      const localOverrides = readLocalScenarioOverrides();
      const deviceIds = readDeviceWatchlistIds();

      let serverIds: string[] = [];
      try {
        const alertsRes = await fetch("/api/alerts", { cache: "no-store", credentials: "same-origin" });
        if (alertsRes.ok) {
          const alertsPayload = await alertsRes.json().catch(() => ({}));
          serverIds = extractAlertDealIds(alertsPayload);
        }
      } catch {
        // Guest or offline session: continue with device watchlist
      }

      const watchlistIds = Array.from(new Set([...(overrideIds ?? []), ...deviceIds, ...serverIds]));
      const extraScenarioIds = Object.keys(localOverrides).filter((id) => !watchlistIds.includes(id));
      setScenarioOnlyIds(extraScenarioIds);

      if (watchlistIds.length === 0) {
        setListings([]);
        setScenarioMap(localOverrides);
        setLoading(false);
        return;
      }

      const fetched: PropertyListing[] = [];
      const foundIds = new Set<string>();
      for (let i = 0; i < watchlistIds.length; i += 250) {
        const chunk = watchlistIds.slice(i, i + 250);
        try {
          const res = await fetch(`/api/listings?ids=${encodeURIComponent(chunk.join(","))}`, {
            cache: "no-store",
            credentials: "same-origin",
          });
          if (!res.ok) continue;
          const data = (await res.json()) as { listings?: PropertyListing[] };
          if (Array.isArray(data?.listings)) {
            for (const item of data.listings) {
              if (item && typeof item.id === "string") {
                fetched.push(item);
                foundIds.add(item.id);
              }
            }
          }
        } catch {
          // Ignore network error for this chunk; missing IDs computed below
        }
      }
      const missed = watchlistIds.filter((id) => !foundIds.has(id));

      const mergedScenarios: Record<string, LocalScenarioOverride> = {};
      for (const item of fetched) {
        mergedScenarios[item.id] = resolveScenarioForListing(item.id, localOverrides);
      }

      setListings(fetched);
      setScenarioMap(mergedScenarios);
      setMissingIds(missed);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Could not load saved auction targets.");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void loadBidSheet();
  }, [loadBidSheet]);

  const parsedCapital = React.useMemo(() => {
    const trimmed = availableCapitalInput.trim();
    if (!trimmed) return null;
    const val = Number(trimmed);
    return Number.isFinite(val) && val >= 0 ? val : null;
  }, [availableCapitalInput]);

  const ladderTargets = React.useMemo(() => {
    return listings.map((listing) => {
      const scenario = scenarioMap[listing.id];
      const manualText = manualWalkAwayBids[listing.id];
      const manualBid = manualText !== undefined ? parseNonNegNumber(manualText) : null;

      const yoursMao = scenario?.maxAllowableOffer ?? null;
      const yoursCustomOpening = scenario?.customOpeningBid ?? null;
      const publishedOpening = positiveNumber(listing.openingBid);

      let effectiveMaxBid: number | null = null;
      let bidBasis = "unresolved";
      if (manualBid !== null && manualBid > 0) {
        effectiveMaxBid = manualBid;
        bidBasis = "yours_manual";
      } else if (yoursMao !== null && yoursMao > 0) {
        effectiveMaxBid = yoursMao;
        bidBasis = "yours_mao";
      } else if (yoursCustomOpening !== null && yoursCustomOpening > 0) {
        effectiveMaxBid = yoursCustomOpening;
        bidBasis = "yours_opening_bid";
      } else if (publishedOpening !== null) {
        effectiveMaxBid = publishedOpening;
        bidBasis = "published_opening_bid";
      }

      return {
        ...listing,
        maxBid: effectiveMaxBid ?? 0,
        bidBasis,
        maxAllowableOffer: yoursMao,
        customOpeningBid: yoursCustomOpening,
        rehabBudget: scenario?.rehabBudget ?? null,
        delinquentTaxes: scenario?.delinquentTaxes ?? null,
        customValuation: scenario?.customValuation ?? null,
      };
    });
  }, [listings, scenarioMap, manualWalkAwayBids]);

  const ladderResult = React.useMemo(() => {
    return computeCashiersCheckLadder({
      targets: ladderTargets,
      availableCapital: parsedCapital,
    });
  }, [ladderTargets, parsedCapital]);

  const verifyLadderViaApi = React.useCallback(async () => {
    if (ladderTargets.length === 0) return;
    setApiVerifying(true);
    setApiVerifyNote(null);
    setApiVerifyError(null);
    try {
      let checks = 0;
      let wires = 0;
      for (let i = 0; i < ladderTargets.length; i += 250) {
        const chunk = ladderTargets.slice(i, i + 250);
        const response = await fetch("/api/check-ladder", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ targets: chunk, availableCapital: i === 0 ? parsedCapital : null }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload?.error || bs.apiVerifyError);
        }
        checks += Array.isArray(payload?.checkLadder)
          ? payload.checkLadder.reduce((sum: number, row: { count?: number }) => sum + Number(row?.count || 0), 0)
          : 0;
        wires += Array.isArray(payload?.preWireSchedule) ? payload.preWireSchedule.length : 0;
      }
      setApiVerifyNote(
        bs.apiVerifiedStatus
          .replace("{checks}", String(checks))
          .replace("{wires}", String(wires)),
      );
    } catch (err) {
      setApiVerifyError(err instanceof Error ? err.message : bs.apiVerifyError);
    } finally {
      setApiVerifying(false);
    }
  }, [ladderTargets, parsedCapital, bs.apiVerifiedStatus, bs.apiVerifyError]);

  const { summary, checkLadder, preWireSchedule, gavelTargets, struckTargets } = ladderResult;
  const listingById = React.useMemo(() => {
    const map = new Map<string, PropertyListing & { rehabBudget?: number | null; delinquentTaxes?: number | null; customValuation?: number | null }>();
    for (const item of ladderTargets) map.set(item.id, item);
    return map;
  }, [ladderTargets]);

  if (loading) {
    return (
      <div className="mx-auto max-w-6xl px-6 py-20 text-center">
        <Loader2 className="mx-auto mb-3 h-8 w-8 animate-spin text-ink-3" />
        <p className="text-sm font-medium text-ink-3">{bs.loading}</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-6 py-10 text-ink sm:px-8">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-line pb-6">
        <div>
          <p className="text-label font-bold uppercase text-ink-3">{bs.eyebrow}</p>
          <h1 className="mt-1 text-title font-bold text-ink">
            {bs.title}
          </h1>
          <p className="mt-1 text-meta text-ink-3">
            {bs.subtitle}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 print:hidden">
          <div className="flex flex-col gap-1">
            <label htmlFor="bid-sheet-capital" className="text-label font-bold uppercase text-ink-3">
              {bs.availableCapitalLabel}
            </label>
            <div className="flex items-center rounded-control border border-line-strong bg-card px-3 py-1.5 focus-within:border-yours focus-within:ring-2 focus-within:ring-yours/20">
              <Wallet className="mr-2 h-4 w-4 text-yours" />
              <span className="mr-1 font-mono text-sm text-ink-3">$</span>
              <input
                id="bid-sheet-capital"
                type="number"
                min={0}
                step={1000}
                value={availableCapitalInput}
                onChange={(e) => setAvailableCapitalInput(e.target.value)}
                placeholder="150000"
                className="w-32 bg-transparent font-mono text-sm font-semibold tabular-nums text-ink outline-none"
              />
            </div>
          </div>

          <button
            type="button"
            onClick={() => void loadBidSheet()}
            className="mt-5 inline-flex items-center gap-1.5 rounded-control border border-line-strong bg-card px-3.5 py-2 text-xs font-semibold text-ink-2 transition hover:bg-paper"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            {bs.refreshBtn}
          </button>

          <button
            type="button"
            disabled={apiVerifying || ladderTargets.length === 0}
            onClick={() => void verifyLadderViaApi()}
            className="mt-5 inline-flex items-center gap-1.5 rounded-control border border-line-strong bg-card px-3.5 py-2 text-xs font-semibold text-ink transition hover:bg-paper disabled:opacity-50"
          >
            <CheckCircle2 className="h-3.5 w-3.5 text-yours" />
            {apiVerifying ? bs.verifyingApiBtn : bs.verifyApiBtn}
          </button>

          <button
            type="button"
            onClick={() => window.print()}
            className="mt-5 inline-flex items-center gap-1.5 rounded-control bg-ink px-4 py-2 text-xs font-semibold text-card transition hover:bg-ink-2"
          >
            <Printer className="h-3.5 w-3.5" />
            {bs.printBtn}
          </button>
        </div>
      </div>

      {apiVerifyNote && (
        <div role="status" className="mt-4 flex items-center gap-2 rounded-control border border-go/30 bg-go-wash px-4 py-2.5 text-xs font-medium text-go">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>{apiVerifyNote}</span>
        </div>
      )}

      {apiVerifyError && (
        <div role="alert" className="mt-4 flex items-center gap-2 rounded-control border border-catch/30 bg-catch-wash px-4 py-2.5 text-xs font-medium text-catch-ink">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{apiVerifyError}</span>
        </div>
      )}

      {/* Capital & Error Notices */}
      {loadError && (
        <div role="alert" className="mt-6 flex items-center gap-2 rounded-control border border-catch/30 bg-catch-wash p-4 text-xs font-medium text-catch-ink">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{loadError}</span>
        </div>
      )}

      {missingIds.length > 0 && (
        <div role="status" className="mt-4 flex items-center gap-2 rounded-control border border-line-strong bg-card p-3 text-xs text-ink-2">
          <AlertTriangle className="h-4 w-4 shrink-0 text-catch-ink" />
          <span>
            {bs.missingTargetsNotice
              .replace("{count}", String(missingIds.length))
              .replace("{ids}", missingIds.join(", "))}
          </span>
        </div>
      )}

      {/* Empty Watchlist State */}
      {listings.length === 0 ? (
        <div className="mt-10 rounded-card border border-dashed border-line-strong bg-card p-12 text-center shadow-sm">
          <Banknote className="mx-auto mb-3 h-10 w-10 text-ink-3" />
          <h2 className="text-lg font-bold text-ink">{bs.emptyTitle}</h2>
          <p className="mx-auto mt-2 max-w-md text-meta text-ink-3">
            {bs.emptyBody}
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3 print:hidden">
            <Link
              href="/listings"
              className="rounded-control bg-ink px-5 py-2.5 text-xs font-semibold text-card transition hover:bg-ink-2"
            >
              {bs.browseAuctionsCta}
            </Link>
            {scenarioOnlyIds.length > 0 && (
              <button
                type="button"
                onClick={() => void loadBidSheet(scenarioOnlyIds)}
                className="rounded-control border border-yours/30 bg-yours-wash px-5 py-2.5 text-xs font-semibold text-yours transition hover:bg-card"
              >
                {bs.loadScenariosCta.replace("{count}", String(scenarioOnlyIds.length))}
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="mt-8 space-y-8">
          {/* Summary KPI Strip */}
          <section aria-label={bs.kpi.summaryAria} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-card border border-line bg-card p-5 shadow-sm">
              <p className="text-label font-bold uppercase text-ink-3">{bs.kpi.activeTargets}</p>
              <p className="mt-2 font-mono text-2xl font-bold tabular-nums text-ink">
                {summary.activeTargetCount}
              </p>
              <p className="mt-1 text-xs text-ink-3">
                {bs.kpi.struckCountSuffix.replace("{count}", String(summary.struckTargetCount))}
              </p>
            </div>

            <div className="rounded-card border border-line bg-card p-5 shadow-sm">
              <p className="text-label font-bold uppercase text-ink-3">{bs.kpi.preWireRequired}</p>
              <p className="mt-2 font-mono text-2xl font-bold tabular-nums text-ink">
                {displayMoney(summary.totalPreWireEscrowRequired)}
              </p>
              <p className="mt-1 text-xs text-ink-3">
                {bs.kpi.portalWiresSuffix.replace("{count}", String(preWireSchedule.length))}
              </p>
            </div>

            <div className="rounded-card border border-line bg-card p-5 shadow-sm">
              <p className="text-label font-bold uppercase text-ink-3">{bs.kpi.peakCheckLadder}</p>
              <p className="mt-2 font-mono text-2xl font-bold tabular-nums text-ink">
                {displayMoney(summary.checkLadderTotal)}
              </p>
              <p className="mt-1 text-xs text-ink-3">
                {bs.kpi.peakDayNeed} <span className="font-mono tabular-nums">{displayMoney(summary.peakAtGavelCheckRequired)}</span>
                {summary.peakSaleDay && !summary.peakSaleDay.startsWith("undated:") ? ` (${summary.peakSaleDay})` : ""}
              </p>
            </div>

            <div
              className={`rounded-card border p-5 shadow-sm ${
                summary.feasible === false
                  ? "border-catch/30 bg-catch-wash"
                  : summary.feasible === true
                    ? "border-go/30 bg-go-wash"
                    : "border-line bg-card"
              }`}
            >
              <p className="text-label font-bold uppercase text-ink-3">
                {summary.feasible === false ? bs.kpi.shortfallTitle : bs.kpi.surplusFeasibilityTitle}
              </p>
              <p
                className={`mt-2 font-mono text-2xl font-bold tabular-nums ${
                  summary.feasible === false
                    ? "text-catch-ink"
                    : summary.feasible === true
                      ? "text-go"
                      : "text-ink"
                }`}
              >
                {summary.availableCapital === null
                  ? bs.kpi.enterCapital
                  : summary.feasible
                    ? `+${displayMoney(summary.availableCapital - summary.totalCapitalRequired)}`
                    : `-${displayMoney(summary.capitalShortfall)}`}
              </p>
              <p className="mt-1 flex items-center gap-1 text-xs text-ink-2">
                {summary.feasible === true && <CheckCircle2 className="h-3.5 w-3.5 text-go" />}
                {summary.feasible === false && <ShieldAlert className="h-3.5 w-3.5 text-catch-ink" />}
                <span>
                  {bs.kpi.totalNeeded} <strong className="font-mono tabular-nums">{displayMoney(summary.totalCapitalRequired)}</strong>
                </span>
              </p>
            </div>
          </section>

          {/* Two-column: Cashier's Check Denomination Ladder + Pre-Wire Schedule */}
          <div className="grid gap-6 lg:grid-cols-12">
            {/* Cashier's Check Ladder */}
            <section className="rounded-card border border-line bg-card p-6 shadow-sm lg:col-span-5">
              <div className="flex items-center justify-between gap-2 border-b border-line pb-4">
                <div>
                  <h2 className="flex items-center gap-2 text-base font-bold text-ink">
                    <Banknote className="h-4 w-4 text-ink-2" />
                    {bs.checkLadder.title}
                  </h2>
                  <p className="mt-0.5 text-xs text-ink-3">
                    {bs.checkLadder.subtitle}
                  </p>
                </div>
                <span className="rounded-full bg-paper px-2.5 py-1 font-mono text-xs font-bold tabular-nums text-ink">
                  {displayMoney(summary.checkLadderTotal)}
                </span>
              </div>

              {checkLadder.length === 0 ? (
                <p className="mt-4 text-xs text-ink-3">
                  {bs.checkLadder.empty}
                </p>
              ) : (
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-line text-label uppercase text-ink-3">
                        <th className="py-2 font-bold">{bs.checkLadder.colSize}</th>
                        <th className="py-2 text-right font-bold">{bs.checkLadder.colQty}</th>
                        <th className="py-2 text-right font-bold">{bs.checkLadder.colSubtotal}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {checkLadder.map((row) => (
                        <tr key={row.denomination}>
                          <td className="py-2.5 font-mono font-semibold tabular-nums text-ink">
                            {displayMoney(row.denomination)}
                          </td>
                          <td className="py-2.5 text-right font-mono tabular-nums text-ink-2">
                            {row.count}
                          </td>
                          <td className="py-2.5 text-right font-mono font-bold tabular-nums text-ink">
                            {displayMoney(row.subtotal)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t border-line-strong font-bold text-ink">
                        <td className="pt-3">{bs.checkLadder.totalRow}</td>
                        <td className="pt-3 text-right font-mono tabular-nums">
                          {checkLadder.reduce((sum, r) => sum + r.count, 0)}
                        </td>
                        <td className="pt-3 text-right font-mono tabular-nums">
                          {displayMoney(summary.checkLadderTotal)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </section>

            {/* Pre-Wire Escrow Schedule */}
            <section className="rounded-card border border-line bg-card p-6 shadow-sm lg:col-span-7">
              <div className="flex items-center justify-between gap-2 border-b border-line pb-4">
                <div>
                  <h2 className="flex items-center gap-2 text-base font-bold text-ink">
                    <CalendarClock className="h-4 w-4 text-ink-2" />
                    {bs.preWire.title}
                  </h2>
                  <p className="mt-0.5 text-xs text-ink-3">
                    {bs.preWire.subtitle}
                  </p>
                </div>
                <span className="rounded-full bg-paper px-2.5 py-1 font-mono text-xs font-bold tabular-nums text-ink">
                  {displayMoney(summary.totalPreWireEscrowRequired)}
                </span>
              </div>

              {preWireSchedule.length === 0 ? (
                <p className="mt-4 text-xs text-ink-3">
                  {bs.preWire.empty}
                </p>
              ) : (
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-line text-label uppercase text-ink-3">
                        <th className="py-2 pr-3 font-bold">{bs.preWire.colProperty}</th>
                        <th className="py-2 pr-3 font-bold">{bs.preWire.colCutoff}</th>
                        <th className="py-2 pr-3 font-bold">{bs.preWire.colSaleDate}</th>
                        <th className="py-2 text-right font-bold">{bs.preWire.colRequired}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {preWireSchedule.map((item) => (
                        <tr key={item.id}>
                          <td className="py-3 pr-3">
                            <Link href={`/listings/${encodeURIComponent(item.id)}`} className="font-semibold text-ink hover:underline">
                              {item.address}
                            </Link>
                            <p className="text-label text-ink-3">
                              {sourceDisplayText(item.source)} · {formatPaymentMethod(item.paymentMethod)} ({Math.round(item.depositPct * 100)}%, {item.wireLeadHours}h lead)
                            </p>
                          </td>
                          <td className="py-3 pr-3 font-mono text-ink-2">
                            {item.depositDeadline ? displayDate(item.depositDeadline) : bs.preWire.confirmDeadline}
                          </td>
                          <td className="py-3 pr-3 font-mono text-ink-2">
                            {item.saleDate ? displayDate(item.saleDate) : bs.preWire.unpublished}
                          </td>
                          <td className="py-3 text-right font-mono font-bold tabular-nums text-ink">
                            {displayMoney(item.requiredDeposit)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>

          {/* Per-Target Walk-Away MAO & Gavel Execution Table */}
          <section className="rounded-card border border-line bg-card p-6 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-4">
              <div>
                <h2 className="flex items-center gap-2 text-base font-bold text-ink">
                  <Landmark className="h-4 w-4 text-ink-2" />
                  {bs.targets.title}
                </h2>
                <p className="mt-0.5 text-xs text-ink-3">
                  {bs.targets.subtitle}
                </p>
              </div>
              <span className="text-xs text-ink-3">
                {bs.targets.countsSummary
                  .replace("{gavel}", String(gavelTargets.length))
                  .replace("{preWire}", String(preWireSchedule.length))}
              </span>
            </div>

            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-line text-label uppercase text-ink-3">
                    <th className="py-2 pr-3 font-bold">{bs.targets.colTarget}</th>
                    <th className="py-2 pr-3 font-bold">{bs.targets.colPublished}</th>
                    <th className="py-2 pr-3 font-bold">{bs.targets.colWalkAway}</th>
                    <th className="py-2 pr-3 font-bold">{bs.targets.colRuleTiming}</th>
                    <th className="py-2 pr-3 text-right font-bold">{bs.targets.colDeposit}</th>
                    <th className="py-2 font-bold">{bs.targets.colSubset}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {[...gavelTargets, ...preWireSchedule].map((target) => {
                    const listing = listingById.get(target.id);
                    const isAtGavel = target.wireLeadHours === 0;
                    const safmrRent = positiveNumber(listing?.hudSafmr?.fairMarketRent);
                    const isYoursBid = target.bidBasis.startsWith("yours_");
                    const subsetChecks = "subsetChecks" in target && Array.isArray(target.subsetChecks)
                      ? (target.subsetChecks as Array<{ denomination: number; count: number; subtotal: number }>)
                      : [];
                    const subsetText = isAtGavel && subsetChecks.length > 0
                      ? subsetChecks.map((c) => `${c.count}×${displayMoney(c.denomination)}`).join(" + ")
                      : null;
                    const overTenderAmount = "overTenderAmount" in target ? knownNumber(target.overTenderAmount) : null;

                    return (
                      <tr key={target.id} className="align-top">
                        <td className="py-3 pr-3">
                          <Link href={`/listings/${encodeURIComponent(target.id)}`} className="font-bold text-ink hover:underline">
                            {target.address}
                          </Link>
                          <p className="mt-0.5 text-label text-ink-3">
                            {target.county ? `${target.county}, ` : ""}{target.state || "—"} · {target.saleDate ? displayDate(target.saleDate) : bs.targets.dateUnpublished}
                          </p>
                          {listing?.rehabBudget !== null && listing?.rehabBudget !== undefined && (
                            <p className="mt-0.5 text-label text-yours">
                              {bs.targets.yoursRehab.replace("{amount}", displayMoney(listing.rehabBudget))}
                              {listing.delinquentTaxes ? bs.targets.yoursTaxes.replace("{amount}", displayMoney(listing.delinquentTaxes)) : ""}
                            </p>
                          )}
                        </td>

                        <td className="py-3 pr-3">
                          <p className="font-mono text-ink">
                            {bs.targets.estLabel} {listing ? publishedValuationRange(listing, bs.targets.unresolved) : bs.targets.unresolved}
                          </p>
                          <p className="mt-0.5 font-mono text-ink-3">
                            {bs.targets.openingLabel} {displayMoney(listing?.openingBid)}
                          </p>
                          {safmrRent !== null && (
                            <p className="mt-0.5 text-label text-ink-3">
                              {bs.targets.safmrBenchmark.replace("{rent}", displayMoney(safmrRent))}
                            </p>
                          )}
                        </td>

                        <td className="py-3 pr-3">
                          <div className="flex items-center gap-1.5">
                            <input
                              type="number"
                              min={0}
                              step={1000}
                              aria-label={`Walk-away max bid for ${target.address}`}
                              value={
                                manualWalkAwayBids[target.id] !== undefined
                                  ? manualWalkAwayBids[target.id]
                                  : target.maxBid > 0
                                    ? String(target.maxBid)
                                    : ""
                              }
                              onChange={(e) =>
                                setManualWalkAwayBids((prev) => ({
                                  ...prev,
                                  [target.id]: e.target.value,
                                }))
                              }
                              placeholder={bs.targets.enterMaoPlaceholder}
                              className="w-28 rounded-control border border-line-strong bg-paper px-2 py-1 font-mono text-xs font-semibold tabular-nums text-ink focus:border-yours focus:outline-none"
                            />
                            <span
                              className={`rounded-full px-2 py-0.5 text-label font-bold ${
                                isYoursBid
                                  ? "bg-yours-wash text-yours"
                                  : target.bidBasis === "unresolved"
                                    ? "bg-catch-wash text-catch-ink"
                                    : "bg-paper text-ink-2"
                              }`}
                            >
                              {isYoursBid ? bs.targets.badgeYours : target.bidBasis === "unresolved" ? bs.targets.badgeUnknown : bs.targets.badgePublished}
                            </span>
                          </div>
                        </td>

                        <td className="py-3 pr-3">
                          <p className="font-semibold text-ink">
                            {sourceDisplayText(target.source)} ({Math.round(target.depositPct * 100)}%)
                          </p>
                          <p className="text-label text-ink-3">
                            {isAtGavel ? bs.targets.dueAtGavel : bs.targets.preWireLead.replace("{hours}", String(target.wireLeadHours))}
                          </p>
                        </td>

                        <td className="py-3 pr-3 text-right font-mono font-bold tabular-nums text-ink">
                          {target.maxBid > 0 ? displayMoney(target.requiredDeposit) : bs.targets.unresolved}
                        </td>

                        <td className="py-3">
                          {isAtGavel ? (
                            subsetText ? (
                              <div>
                                <p className="font-mono font-semibold text-ink">{subsetText}</p>
                                {overTenderAmount !== null && overTenderAmount > 0 && (
                                  <p className="text-label text-ink-3">
                                    {bs.targets.roundingBuffer.replace("{amount}", displayMoney(overTenderAmount))}
                                  </p>
                                )}
                              </div>
                            ) : (
                              <span className="text-ink-3">{bs.targets.enterCeiling}</span>
                            )
                          ) : (
                            <span className="text-ink-3">{bs.targets.preAuctionWire}</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          {/* Struck / Postponed Targets Section */}
          {struckTargets.length > 0 && (
            <section className="rounded-card border border-catch/30 bg-catch-wash p-6">
              <h2 className="flex items-center gap-2 text-base font-bold text-catch-ink">
                <ShieldAlert className="h-4 w-4" />
                {bs.struck.title.replace("{count}", String(struckTargets.length))}
              </h2>
              <p className="mt-1 text-xs text-catch-ink">
                {bs.struck.subtitle}
              </p>
              <div className="mt-4 divide-y divide-catch/20 rounded-control border border-catch/20 bg-card">
                {struckTargets.map((item) => (
                  <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-xs">
                    <div>
                      <Link href={`/listings/${encodeURIComponent(item.id)}`} className="font-bold text-ink hover:underline">
                        {item.address}
                      </Link>
                      <p className="text-label text-ink-3">
                        {sourceDisplayText(item.source)} · {item.state || "—"}
                      </p>
                    </div>
                    <span className="rounded-full bg-catch-wash px-2.5 py-1 text-label font-bold uppercase text-catch-ink">
                      {item.struckReason}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
