"use client";

import React, { useMemo, useState } from "react";
import { AlertTriangle, Calendar, CheckCircle2, Clock, Info, Scale, ShieldCheck } from "lucide-react";
import { StatutoryDeadlinesAndCarry } from "@/lib/underwriting";
import { displayMoney } from "@/lib/listing-display";

export interface StatutoryDeadlinesTimelineProps {
  saleDate: string | null;
  state: string;
  openingBid: number | null;
  isHomestead: boolean;
  onHomesteadChange?: (isHomestead: boolean) => void;
  deadlinesAndCarry: StatutoryDeadlinesAndCarry;
}

type AnchorOption = "sale_date" | "today" | "7d_ago" | "30d_ago";

export function StatutoryDeadlinesTimeline({
  saleDate,
  state,
  openingBid,
  isHomestead,
  onHomesteadChange,
  deadlinesAndCarry,
}: StatutoryDeadlinesTimelineProps) {
  const st = (state || "").trim().toUpperCase();
  const hasPublishedSaleDate = Boolean(saleDate && Number.isFinite(Date.parse(String(saleDate).slice(0, 10))));

  const [anchorOption, setAnchorOption] = useState<AnchorOption>(
    hasPublishedSaleDate ? "sale_date" : "today"
  );

  const anchorDateStr = useMemo(() => {
    const now = new Date();
    if (anchorOption === "sale_date" && hasPublishedSaleDate) {
      return String(saleDate).slice(0, 10);
    }
    if (anchorOption === "7d_ago") {
      const past = new Date(now.getTime() - 7 * 86_400_000);
      return past.toISOString().slice(0, 10);
    }
    if (anchorOption === "30d_ago") {
      const past = new Date(now.getTime() - 30 * 86_400_000);
      return past.toISOString().slice(0, 10);
    }
    return now.toISOString().slice(0, 10);
  }, [anchorOption, saleDate, hasPublishedSaleDate]);

  const daysElapsed = useMemo(() => {
    const anchorTime = Date.parse(anchorDateStr);
    if (!Number.isFinite(anchorTime)) return 0;
    const nowTime = Date.now();
    return Math.floor((nowTime - anchorTime) / 86_400_000);
  }, [anchorDateStr]);

  // Compute remaining days and statuses for each statutory window
  const objectionDays = deadlinesAndCarry.objectionOrConfirmationDays;
  const objectionRemaining = Math.max(0, objectionDays - Math.max(0, daysElapsed));
  const objectionActive = daysElapsed >= 0 && daysElapsed < objectionDays;
  const objectionExpired = daysElapsed >= objectionDays;

  const irsDays = deadlinesAndCarry.irsRedemptionDays;
  const irsRemaining = Math.max(0, irsDays - Math.max(0, daysElapsed));
  const irsActive = irsDays > 0 && daysElapsed >= 0 && daysElapsed < irsDays;
  const irsExpired = irsDays > 0 && daysElapsed >= irsDays;

  const stateRedemptionDays = deadlinesAndCarry.stateRedemptionDays;
  const stateRedemptionRemaining = Math.max(0, stateRedemptionDays - Math.max(0, daysElapsed));
  const stateRedemptionActive = stateRedemptionDays > 0 && daysElapsed >= 0 && daysElapsed < stateRedemptionDays;
  const stateRedemptionExpired = stateRedemptionDays > 0 && daysElapsed >= stateRedemptionDays;

  const totalLockupDays = deadlinesAndCarry.effectiveLockupDays;
  const progressPct = totalLockupDays > 0
    ? Math.min(100, Math.max(0, Math.round((Math.max(0, daysElapsed) / totalLockupDays) * 100)))
    : 100;

  // North Carolina Upset Bid Calculation (N.C.G.S. § 45-21.27)
  const isNorthCarolina = st === "NC";
  const ncActiveBid = openingBid !== null && openingBid > 0 ? openingBid : 0;
  const ncUpsetIncrement = Math.max(750, Math.round(ncActiveBid * 0.05));
  const ncNextUpsetBid = ncActiveBid + ncUpsetIncrement;
  const ncRequiredDeposit = Math.max(750, Math.round(ncNextUpsetBid * 0.05));

  // Alabama Redemption Details (Ala. Code § 6-5-248 & § 40-10-122)
  const isAlabama = st === "AL";

  if (totalLockupDays <= 0 && !isNorthCarolina && !isAlabama) {
    return null;
  }

  return (
    <div className="space-y-4 rounded-xl border border-line bg-paper p-4 text-xs text-ink-2 shadow-xs">
      {/* Header & Lockup Summary */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-3">
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-yours" />
          <span className="text-sm font-bold text-ink">
            Statutory Lockup &amp; Post-Sale Timeline
          </span>
          <span className="rounded-md bg-card px-2 py-0.5 text-xs font-semibold text-ink-2 border border-line">
            {totalLockupDays}d Total Lockup
          </span>
        </div>
        {deadlinesAndCarry.estimatedCarryCost !== null && (
          <div className="text-xs font-semibold text-yours">
            Estimated lockup carry: <strong>{displayMoney(deadlinesAndCarry.estimatedCarryCost)}</strong>
            <span className="text-ink-3 font-normal"> ({deadlinesAndCarry.annualCostOfCapitalPct}%/yr capital cost)</span>
          </div>
        )}
      </div>

      {/* Interactive Date Anchor Simulation */}
      <div className="flex flex-wrap items-center justify-between gap-2 bg-card/60 p-2.5 rounded-lg border border-line">
        <div className="flex items-center gap-2">
          <Calendar className="h-3.5 w-3.5 text-ink-3" />
          <span className="text-xs font-semibold text-ink">Simulate auction gavel drop:</span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {hasPublishedSaleDate && (
            <button
              type="button"
              onClick={() => setAnchorOption("sale_date")}
              className={`px-2 py-1 text-xs font-semibold rounded-md border transition ${
                anchorOption === "sale_date"
                  ? "bg-ink text-white border-ink shadow-xs"
                  : "bg-paper text-ink border-line hover:border-ink/30"
              }`}
            >
              Scheduled Sale ({saleDate})
            </button>
          )}
          <button
            type="button"
            onClick={() => setAnchorOption("today")}
            className={`px-2 py-1 text-xs font-semibold rounded-md border transition ${
              anchorOption === "today"
                ? "bg-ink text-white border-ink shadow-xs"
                : "bg-paper text-ink border-line hover:border-ink/30"
            }`}
          >
            Today (Gavel Drop)
          </button>
          <button
            type="button"
            onClick={() => setAnchorOption("7d_ago")}
            className={`px-2 py-1 text-xs font-semibold rounded-md border transition ${
              anchorOption === "7d_ago"
                ? "bg-ink text-white border-ink shadow-xs"
                : "bg-paper text-ink border-line hover:border-ink/30"
            }`}
          >
            7 Days Ago
          </button>
          <button
            type="button"
            onClick={() => setAnchorOption("30d_ago")}
            className={`px-2 py-1 text-xs font-semibold rounded-md border transition ${
              anchorOption === "30d_ago"
                ? "bg-ink text-white border-ink shadow-xs"
                : "bg-paper text-ink border-line hover:border-ink/30"
            }`}
          >
            30 Days Ago
          </button>
        </div>
      </div>

      {/* Visual Timeline Progress Track */}
      {totalLockupDays > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs text-ink-3">
            <span>
              Anchor: <strong>{anchorDateStr}</strong> ({daysElapsed < 0 ? `Sale in ${Math.abs(daysElapsed)} days` : `${daysElapsed} days elapsed`})
            </span>
            <span className="font-semibold text-ink">
              {progressPct}% of lockup completed
            </span>
          </div>
          <div className="h-2.5 w-full rounded-full bg-card overflow-hidden border border-line">
            <div
              className="h-full bg-yours transition-all duration-300"
              style={{ width: `${progressPct}%` }}
              role="progressbar"
              aria-valuenow={progressPct}
              aria-valuemin={0}
              aria-valuemax={100}
            />
          </div>
        </div>
      )}

      {/* Statutory Windows Grid */}
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3 text-xs">
        {/* 1. Objection / Confirmation Window */}
        {objectionDays > 0 ? (
          <div className="rounded-lg border border-line bg-card p-2.5 space-y-1">
            <div className="flex items-center justify-between">
              <span className="font-bold text-ink">Objection / Upset</span>
              <span className={`px-1.5 py-0.5 rounded text-xs font-bold ${
                objectionExpired ? "bg-go-wash text-go-fill border border-go-fill/30" :
                objectionActive ? "bg-catch-wash text-catch-ink border border-catch/30" :
                "bg-paper text-ink-3 border border-line"
              }`}>
                {objectionExpired ? "Expired" : objectionActive ? `${objectionRemaining}d left` : "Pending"}
              </span>
            </div>
            <p className="text-xs text-ink-3 leading-tight line-clamp-2">
              {deadlinesAndCarry.objectionLabel || `${objectionDays}-day court objection window`}
            </p>
            {deadlinesAndCarry.objectionDeadline && (
              <p className="text-xs font-medium text-ink-2">Deadline: {deadlinesAndCarry.objectionDeadline}</p>
            )}
          </div>
        ) : (
          <div className="rounded-lg border border-line bg-card p-2.5 space-y-1">
            <span className="font-bold text-ink">Objection / Confirmation</span>
            <p className="text-xs text-ink-3">0-day objection period; title vests upon deed delivery.</p>
          </div>
        )}

        {/* 2. IRS 120-Day Redemption Window */}
        <div className="rounded-lg border border-line bg-card p-2.5 space-y-1">
          <div className="flex items-center justify-between">
            <span className="font-bold text-ink">IRS 120d Right</span>
            <span className={`px-1.5 py-0.5 rounded text-xs font-bold ${
              !irsDays ? "bg-paper text-ink-3 border border-line" :
              irsExpired ? "bg-go-wash text-go-fill border border-go-fill/30" :
              irsActive ? "bg-catch-wash text-catch-ink border border-catch/30" :
              "bg-paper text-ink-3 border border-line"
            }`}>
              {irsDays === 0 ? "No IRS Lien" : irsExpired ? "Expired" : irsActive ? `${irsRemaining}d left` : "Pending"}
            </span>
          </div>
          <p className="text-xs text-ink-3 leading-tight">
            {irsDays > 0
              ? "26 U.S.C. § 7425(d): IRS holds 120-day statutory redemption right to reimburse buyer."
              : "No IRS notice phrase detected; 120-day federal redemption does not apply."}
          </p>
          {deadlinesAndCarry.irsRedemptionDeadline && (
            <p className="text-xs font-medium text-catch-ink">Deadline: {deadlinesAndCarry.irsRedemptionDeadline}</p>
          )}
        </div>

        {/* 3. State Statutory Redemption */}
        <div className="rounded-lg border border-line bg-card p-2.5 space-y-1">
          <div className="flex items-center justify-between">
            <span className="font-bold text-ink">State Redemption</span>
            <span className={`px-1.5 py-0.5 rounded text-xs font-bold ${
              stateRedemptionDays === 0 ? "bg-go-wash text-go-fill border border-go-fill/30" :
              stateRedemptionExpired ? "bg-go-wash text-go-fill border border-go-fill/30" :
              stateRedemptionActive ? "bg-catch-wash text-catch-ink border border-catch/30" :
              "bg-paper text-ink-3 border border-line"
            }`}>
              {stateRedemptionDays === 0 ? "0 Days" : stateRedemptionExpired ? "Expired" : stateRedemptionActive ? `${stateRedemptionRemaining}d left` : "Pending"}
            </span>
          </div>
          <p className="text-xs text-ink-3 leading-tight">
            {stateRedemptionDays > 0
              ? `${stateRedemptionDays}-day post-sale redemption period under ${st} statute.`
              : `0-day post-sale redemption; immediate fee-simple title upon deed delivery.`}
          </p>
          {deadlinesAndCarry.stateRedemptionDeadline && (
            <p className="text-xs font-medium text-ink-2">Deadline: {deadlinesAndCarry.stateRedemptionDeadline}</p>
          )}
        </div>
      </div>

      {/* North Carolina Specific Upset Bid Interactive Module */}
      {isNorthCarolina && (
        <div className="rounded-lg border border-line bg-card p-3 text-xs space-y-2">
          <div className="flex items-center gap-2">
            <Scale className="h-4 w-4 text-yours" />
            <span className="font-bold text-ink">
              North Carolina 10-Day Rolling Upset-Bid Calculator (N.C.G.S. § 45-21.27)
            </span>
          </div>
          <p className="text-xs text-ink-2 leading-relaxed">
            In North Carolina, the high bid at the courthouse steps is not final. Any bidder may submit an upset bid within 10 days of the sale report.
            <strong> Each upset bid resets the 10-day statutory clock for all bidders.</strong>
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1">
            <div className="bg-paper p-2 rounded-md border border-line">
              <span className="text-xs font-semibold text-ink-3 uppercase block">Current Bid Baseline</span>
              <span className="text-sm font-bold text-ink">{displayMoney(ncActiveBid)}</span>
            </div>
            <div className="bg-paper p-2 rounded-md border border-line">
              <span className="text-xs font-semibold text-ink-3 uppercase block">Min Qualifying Upset Bid (+5% / $750 min)</span>
              <span className="text-sm font-bold text-yours">{displayMoney(ncNextUpsetBid)}</span>
            </div>
            <div className="bg-paper p-2 rounded-md border border-line">
              <span className="text-xs font-semibold text-ink-3 uppercase block">Required Deposit to Clerk (5%)</span>
              <span className="text-sm font-bold text-ink">{displayMoney(ncRequiredDeposit)}</span>
            </div>
          </div>
        </div>
      )}

      {/* Alabama Specific Redemption & Homestead Toggle */}
      {isAlabama && (
        <div className="rounded-lg border border-line bg-card p-3 text-xs space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-yours" />
              <span className="font-bold text-ink">
                Alabama Statutory Redemption (Ala. Code § 6-5-248 &amp; § 40-10-122)
              </span>
            </div>
            {onHomesteadChange && (
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-ink-2">Property Type:</span>
                <button
                  type="button"
                  onClick={() => onHomesteadChange(!isHomestead)}
                  className={`px-2 py-0.5 text-xs font-semibold rounded-md border transition ${
                    isHomestead
                      ? "bg-yours text-white border-yours"
                      : "bg-paper text-ink border-line hover:border-ink/30"
                  }`}
                >
                  {isHomestead ? "Homestead (180d)" : "Non-Homestead (365d)"}
                </button>
              </div>
            )}
          </div>
          <p className="text-xs text-ink-3 leading-relaxed">
            {isHomestead
              ? "Ala. Code § 6-5-248(b): 180-day redemption applies to residential properties on which a homestead exemption was claimed in the tax year of the foreclosure sale."
              : "Ala. Code § 6-5-248(a): 1-year (365-day) statutory redemption applies to non-homestead, commercial, or non-exempt real property."}
            {" "}Under Ala. Code § 40-10-122, redemption requires reimbursement of the purchase price plus <strong>12% per annum simple interest</strong> and certified permanent improvements.
          </p>
        </div>
      )}
    </div>
  );
}
