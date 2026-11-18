"use client";

import React, { useMemo, useState } from "react";
import { AlertTriangle, Calendar, CheckCircle2, Clock, Info, Scale, ShieldCheck } from "lucide-react";
import { StatutoryDeadlinesAndCarry } from "@/lib/underwriting";
import { displayMoney } from "@/lib/listing-display";
import { useLocale } from "@/components/i18n/locale-provider";
import { localizeDisplayDate } from "@/lib/i18n/domain";
import { formatUsd, interpolate } from "@/lib/i18n/translator";

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
  const { locale, messages } = useLocale();
  const t = messages.underwritingDeep;
  const money = (value: number) => (locale === "en" ? displayMoney(value) : formatUsd(locale, value));
  const fmtDate = (value: string | null | undefined) => {
    if (!value) return "";
    return locale === "en" ? value : localizeDisplayDate(value, locale, value);
  };

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
            {t.sdtTitle}
          </span>
          <span className="rounded-md bg-card px-2 py-0.5 text-xs font-semibold text-ink-2 border border-line">
            {interpolate(t.sdtTotalLockup, { days: totalLockupDays })}
          </span>
        </div>
        {deadlinesAndCarry.estimatedCarryCost !== null && (
          <div className="text-xs font-semibold text-yours">
            {t.sdtEstCarryPrefix} <strong>{money(deadlinesAndCarry.estimatedCarryCost)}</strong>
            <span className="text-ink-3 font-normal"> {interpolate(t.sdtCapitalCostSuffix, { pct: deadlinesAndCarry.annualCostOfCapitalPct })}</span>
          </div>
        )}
      </div>

      {/* Interactive Date Anchor Simulation */}
      <div className="flex flex-wrap items-center justify-between gap-2 bg-card/60 p-2.5 rounded-lg border border-line">
        <div className="flex items-center gap-2">
          <Calendar className="h-3.5 w-3.5 text-ink-3" />
          <span className="text-xs font-semibold text-ink">{t.sdtSimulateGavel}</span>
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
              {interpolate(t.sdtScheduledSale, { date: fmtDate(saleDate) })}
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
            {t.sdtToday}
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
            {t.sdt7dAgo}
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
            {t.sdt30dAgo}
          </button>
        </div>
      </div>

      {/* Visual Timeline Progress Track */}
      {totalLockupDays > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs text-ink-3">
            <span>
              {t.sdtAnchor} <strong>{fmtDate(anchorDateStr)}</strong> ({daysElapsed < 0 ? interpolate(t.sdtSaleInDays, { days: Math.abs(daysElapsed) }) : interpolate(t.sdtDaysElapsed, { days: daysElapsed })})
            </span>
            <span className="font-semibold text-ink">
              {interpolate(t.sdtLockupPct, { pct: progressPct })}
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
              <span className="font-bold text-ink">{t.sdtObjTitle}</span>
              <span className={`px-1.5 py-0.5 rounded text-xs font-bold ${
                objectionExpired ? "bg-paper text-ink-2 border border-line" :
                objectionActive ? "bg-catch-wash text-catch-ink border border-catch/30" :
                "bg-paper text-ink-3 border border-line"
              }`}>
                {objectionExpired ? t.sdtExpired : objectionActive ? interpolate(t.sdtDaysLeft, { days: objectionRemaining }) : t.sdtPending}
              </span>
            </div>
            <p className="text-xs text-ink-3 leading-tight line-clamp-2">
              {deadlinesAndCarry.objectionLabel || interpolate(t.sdtObjWindowFallback, { days: objectionDays })}
            </p>
            {deadlinesAndCarry.objectionDeadline && (
              <p className="text-xs font-medium text-ink-2">{interpolate(t.sdtDeadline, { date: fmtDate(deadlinesAndCarry.objectionDeadline) })}</p>
            )}
          </div>
        ) : (
          <div className="rounded-lg border border-line bg-card p-2.5 space-y-1">
            <span className="font-bold text-ink">{t.sdtObjConfTitle}</span>
            <p className="text-xs text-ink-3">{t.sdtObjZeroDesc}</p>
          </div>
        )}

        {/* 2. IRS 120-Day Redemption Window */}
        <div className="rounded-lg border border-line bg-card p-2.5 space-y-1">
          <div className="flex items-center justify-between">
            <span className="font-bold text-ink">{t.sdtIrsRightTitle}</span>
            <span className={`px-1.5 py-0.5 rounded text-xs font-bold ${
              !irsDays ? "bg-paper text-ink-3 border border-line" :
              irsExpired ? "bg-paper text-ink-2 border border-line" :
              irsActive ? "bg-catch-wash text-catch-ink border border-catch/30" :
              "bg-paper text-ink-3 border border-line"
            }`}>
              {irsDays === 0 ? t.trfNoIrsLien : irsExpired ? t.sdtExpired : irsActive ? interpolate(t.sdtDaysLeft, { days: irsRemaining }) : t.sdtPending}
            </span>
          </div>
          <p className="text-xs text-ink-3 leading-tight">
            {irsDays > 0 ? t.sdtIrsActiveDesc : t.sdtIrsNoneDesc}
          </p>
          {deadlinesAndCarry.irsRedemptionDeadline && (
            <p className="text-xs font-medium text-catch-ink">{interpolate(t.sdtDeadline, { date: fmtDate(deadlinesAndCarry.irsRedemptionDeadline) })}</p>
          )}
        </div>

        {/* 3. State Statutory Redemption */}
        <div className="rounded-lg border border-line bg-card p-2.5 space-y-1">
          <div className="flex items-center justify-between">
            <span className="font-bold text-ink">{t.sdtStateRedeemTitle}</span>
            <span className={`px-1.5 py-0.5 rounded text-xs font-bold ${
              stateRedemptionDays === 0 ? "bg-paper text-ink-2 border border-line" :
              stateRedemptionExpired ? "bg-paper text-ink-2 border border-line" :
              stateRedemptionActive ? "bg-catch-wash text-catch-ink border border-catch/30" :
              "bg-paper text-ink-3 border border-line"
            }`}>
              {stateRedemptionDays === 0 ? t.sdtZeroDays : stateRedemptionExpired ? t.sdtExpired : stateRedemptionActive ? interpolate(t.sdtDaysLeft, { days: stateRedemptionRemaining }) : t.sdtPending}
            </span>
          </div>
          <p className="text-xs text-ink-3 leading-tight">
            {stateRedemptionDays > 0
              ? interpolate(t.sdtStateRedeemActive, { days: stateRedemptionDays, state: st })
              : t.sdtStateRedeemZero}
          </p>
          {deadlinesAndCarry.stateRedemptionDeadline && (
            <p className="text-xs font-medium text-ink-2">{interpolate(t.sdtDeadline, { date: fmtDate(deadlinesAndCarry.stateRedemptionDeadline) })}</p>
          )}
        </div>
      </div>

      {/* North Carolina Specific Upset Bid Interactive Module */}
      {isNorthCarolina && (
        <div className="rounded-lg border border-line bg-card p-3 text-xs space-y-2">
          <div className="flex items-center gap-2">
            <Scale className="h-4 w-4 text-yours" />
            <span className="font-bold text-ink">
              {t.sdtNcTitle}
            </span>
          </div>
          <p className="text-xs text-ink-2 leading-relaxed">
            {t.sdtNcBody1}{" "}
            <strong>{t.sdtNcBodyStrong}</strong>
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1">
            <div className="bg-paper p-2 rounded-md border border-line">
              <span className="text-xs font-semibold text-ink-3 uppercase block">{t.sdtNcCurrentBid}</span>
              <span className="text-sm font-bold text-ink">{money(ncActiveBid)}</span>
            </div>
            <div className="bg-paper p-2 rounded-md border border-line">
              <span className="text-xs font-semibold text-ink-3 uppercase block">{t.sdtNcMinUpset}</span>
              <span className="text-sm font-bold text-yours">{money(ncNextUpsetBid)}</span>
            </div>
            <div className="bg-paper p-2 rounded-md border border-line">
              <span className="text-xs font-semibold text-ink-3 uppercase block">{t.sdtNcDeposit}</span>
              <span className="text-sm font-bold text-ink">{money(ncRequiredDeposit)}</span>
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
                {t.sdtAlTitle}
              </span>
            </div>
            {onHomesteadChange && (
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-ink-2">{t.sdtAlPropType}</span>
                <button
                  type="button"
                  onClick={() => onHomesteadChange(!isHomestead)}
                  className={`px-2 py-0.5 text-xs font-semibold rounded-md border transition ${
                    isHomestead
                      ? "bg-yours text-white border-yours"
                      : "bg-paper text-ink border-line hover:border-ink/30"
                  }`}
                >
                  {isHomestead ? t.sdtAlHomesteadBtn : t.sdtAlNonHomesteadBtn}
                </button>
              </div>
            )}
          </div>
          <p className="text-xs text-ink-3 leading-relaxed">
            {isHomestead ? t.sdtAlHomesteadDesc : t.sdtAlNonHomesteadDesc}
            {" "}{t.sdtAlInterestPrefix} <strong>{t.sdtAlInterestStrong}</strong> {t.sdtAlInterestSuffix}
          </p>
        </div>
      )}
    </div>
  );
}
