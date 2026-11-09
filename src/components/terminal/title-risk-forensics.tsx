"use client";

import React, { useId, useState } from "react";
import { AlertOctagon, Layers, Scale, ShieldAlert, ShieldCheck } from "lucide-react";
import { computeLienWaterfall, LienWaterfallResult } from "@/lib/underwriting";
import { displayMoney } from "@/lib/listing-display";

export interface TitleRiskForensicsProps {
  plaintiff?: string | null;
  seniorLienRisk?: string | null;
  seniorLienWarning?: string | null;
  judgment?: number | null;
  openingBid?: number | null;
  state?: string;
  source?: string;
}

type ForeclosingLienType =
  | "first_mortgage"
  | "second_mortgage"
  | "hoa_assessment"
  | "tax_deed"
  | "mechanic_lien";

const HOA_SUPER_PRIORITY_STATES = new Set([
  "AL", "AK", "CO", "CT", "DE", "DC", "FL", "HI", "IL", "MD",
  "MA", "MN", "MO", "NV", "NH", "NJ", "NY", "OR", "PA", "RI", "TN", "WA", "WV"
]);

function inferInitialLienType(
  plaintiff?: string | null,
  warning?: string | null,
  source?: string | null
): ForeclosingLienType {
  const combined = `${plaintiff || ""} ${warning || ""} ${source || ""}`.toLowerCase();
  if (/(?:second\s*mortgage|2nd\s*mortgage|junior\s*mortgage|heloc|equity\s*line)/i.test(combined)) {
    return "second_mortgage";
  }
  if (/(?:mechanic'?s?\s*lien|construction\s*lien|materialm[ae]n)/i.test(combined)) {
    return "mechanic_lien";
  }
  if (/(?:homeowners?\s*association|condominium\s*association|\bhoa\b|master\s*association)/i.test(combined)) {
    return "hoa_assessment";
  }
  if (/(?:tax\s*collector|county\s*treasurer|tax\s*lien|tax\s*deed|ad\s*valorem)/i.test(combined) || source === "tax_deed") {
    return "tax_deed";
  }
  return "first_mortgage";
}

export function TitleRiskForensics({
  plaintiff,
  seniorLienRisk,
  seniorLienWarning,
  judgment,
  openingBid,
  state = "OH",
  source = "",
}: TitleRiskForensicsProps) {
  const seniorDebtInputId = useId();
  const [foreclosingType, setForeclosingType] = useState<ForeclosingLienType>(() =>
    inferInitialLienType(plaintiff, seniorLienWarning, source)
  );
  const [assumedSeniorDebt, setAssumedSeniorDebt] = useState<string>("");
  const [hasIrsLienOverride, setHasIrsLienOverride] = useState<boolean>(() => {
    const combined = `${seniorLienWarning || ""} ${source || ""}`.toLowerCase();
    return /(?:internal\s*revenue|\birs\b|federal\s*tax\s*lien|26\s*u\.?s\.?c\.?\s*§?\s*7425)/i.test(combined) || source === "irs";
  });

  const parsedSeniorDebt = assumedSeniorDebt.trim() ? Number(assumedSeniorDebt) : null;
  const validSeniorDebt = typeof parsedSeniorDebt === "number" && Number.isFinite(parsedSeniorDebt) && parsedSeniorDebt >= 0
    ? parsedSeniorDebt
    : null;

  const currentBid = typeof openingBid === "number" && Number.isFinite(openingBid) && openingBid > 0 ? openingBid : 100_000;
  const currentJudgment = typeof judgment === "number" && Number.isFinite(judgment) && judgment > 0 ? judgment : currentBid;

  const waterfall: LienWaterfallResult = computeLienWaterfall({
    winningBid: currentBid,
    foreclosingLienType: foreclosingType,
    foreclosingLienAmount: currentJudgment,
    seniorMortgageAmount: validSeniorDebt,
    state,
  });

  const isJunior = foreclosingType === "second_mortgage" || foreclosingType === "mechanic_lien" || foreclosingType === "hoa_assessment";
  const isSuperPriorityState = HOA_SUPER_PRIORITY_STATES.has(state.toUpperCase());

  // Determine overall risk level
  let calculatedRisk: "CRITICAL" | "HIGH" | "LOW" = "LOW";
  if (isJunior) {
    if (foreclosingType === "hoa_assessment" && state.toUpperCase() === "NV") {
      calculatedRisk = "HIGH";
    } else {
      calculatedRisk = "CRITICAL";
    }
  } else if (hasIrsLienOverride) {
    calculatedRisk = "HIGH";
  } else if (seniorLienRisk?.toLowerCase() === "critical") {
    calculatedRisk = "CRITICAL";
  } else if (seniorLienRisk?.toLowerCase() === "high") {
    calculatedRisk = "HIGH";
  }

  return (
    <div className="rounded-xl border border-line bg-card p-4 space-y-4 text-xs">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-3">
        <div className="flex items-center gap-2">
          <Layers className="h-4 w-4 text-yours" />
          <span className="text-sm font-bold text-ink">Title &amp; Senior Lien Survival Forensics</span>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`px-2.5 py-0.5 rounded-md font-bold uppercase tracking-wider text-xs border ${
              calculatedRisk === "CRITICAL"
                ? "bg-catch-wash text-catch-ink border-catch/40"
                : calculatedRisk === "HIGH"
                ? "bg-catch-wash text-catch-ink border-catch/30"
                : "bg-go-wash text-go-fill border-go-fill/30"
            }`}
          >
            {calculatedRisk === "CRITICAL" ? "Critical Title Defect" : calculatedRisk === "HIGH" ? "Elevated Title Risk" : "Standard Senior Position"}
          </span>
        </div>
      </div>

      {/* Foreclosing Party & Context */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="rounded-lg border border-line bg-paper p-2.5 space-y-1">
          <span className="font-semibold text-ink-3 uppercase block text-xs">Foreclosing Petitioner / Plaintiff</span>
          <p className="font-bold text-ink truncate text-xs">{plaintiff || "Published foreclosing mortgagee / trustee"}</p>
          {judgment && judgment > 0 && (
            <p className="text-xs text-ink-2">Foreclosure Judgment Debt: {displayMoney(judgment)}</p>
          )}
        </div>
        <div className="rounded-lg border border-line bg-paper p-2.5 space-y-1">
          <span className="font-semibold text-ink-3 uppercase block text-xs">Senior Mortgage Survival Rule</span>
          <p className="font-bold text-ink text-xs">
            {foreclosingType === "first_mortgage"
              ? "Wipes junior subordinate deeds (1st position)"
              : foreclosingType === "tax_deed"
              ? "Super-priority ad valorem tax primes private mortgages"
              : foreclosingType === "hoa_assessment" && state.toUpperCase() === "NV"
              ? "Nevada NRS 116.3116 9-month super-priority primes 1st mortgage"
              : "Senior 1st Mortgage SURVIVES foreclosure in full"}
          </p>
          <p className="text-xs text-ink-3">
            {isJunior
              ? "Winning bidder takes title subject to unpaid senior deeds."
              : "Subordinate junior encumbrances extinguished upon confirmation."}
          </p>
        </div>
      </div>

      {/* Interactive Foreclosing Lien Position Selector */}
      <div className="space-y-2 pt-1">
        <div className="flex items-center justify-between">
          <span className="font-bold text-ink">Simulate Foreclosing Lien Priority Position:</span>
          <span className="text-xs text-ink-3">Click to simulate alternate party status</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5">
          {[
            { id: "first_mortgage" as const, label: "1st Mortgage (Senior)" },
            { id: "second_mortgage" as const, label: "2nd Mortgage / HELOC" },
            { id: "hoa_assessment" as const, label: "HOA Assessment Lien" },
            { id: "tax_deed" as const, label: "County Tax Collector" },
            { id: "mechanic_lien" as const, label: "Mechanic's Lien" },
          ].map((type) => (
            <button
              key={type.id}
              type="button"
              onClick={() => setForeclosingType(type.id)}
              className={`px-2 py-1.5 rounded-lg border text-xs font-semibold transition text-center ${
                foreclosingType === type.id
                  ? "bg-ink text-white border-ink shadow-xs"
                  : "bg-paper text-ink-2 border-line hover:border-ink/30"
              }`}
            >
              {type.label}
            </button>
          ))}
        </div>
      </div>

      {/* Junior Foreclosure Senior Debt Assumption Box */}
      {isJunior && (
        <div className="rounded-lg border border-line bg-paper p-3 space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <Scale className="h-4 w-4 text-yours" />
              <label htmlFor={seniorDebtInputId} className="font-bold text-ink text-xs">Buyer Assumed Surviving Senior 1st Mortgage Balance:</label>
            </div>
            <span className="text-xs text-ink-3">Zero-Fabrication: Supply explicit loan balance</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-ink-2">$</span>
            <input
              id={seniorDebtInputId}
              type="number"
              min="0"
              step="5000"
              placeholder="e.g. 185000 (unpaid 1st mortgage)"
              value={assumedSeniorDebt}
              onChange={(e) => setAssumedSeniorDebt(e.target.value)}
              className="w-full rounded-md border border-line bg-card px-3 py-1.5 text-xs text-ink font-semibold focus:outline-hidden focus:ring-1 focus:ring-ink"
            />
          </div>
          {validSeniorDebt === null && (
            <p className="text-xs text-catch-ink">
              ⚠️ In junior lien foreclosures, effective acquisition cost cannot be computed until the surviving senior debt balance is supplied.
            </p>
          )}
        </div>
      )}

      {/* Waterfall & Effective Acquisition Cost Card */}
      {waterfall.criticalAlert && (
        <div className="rounded-lg border border-catch/30 bg-catch-wash p-3 text-xs text-catch-ink space-y-1">
          <div className="flex items-center gap-1.5 font-bold">
            <AlertOctagon className="h-4 w-4 shrink-0" />
            <span>Title Priority Invariant Warning</span>
          </div>
          <p className="leading-relaxed">{waterfall.criticalAlert}</p>
        </div>
      )}

      {/* True Effective Acquisition Cost Callout */}
      <div className="rounded-lg border border-line bg-paper p-3 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-bold text-ink text-xs">Total Effective Acquisition Capital:</span>
          <span className="text-sm font-bold text-ink">
            {waterfall.totalEffectiveAcquisitionCost !== null
              ? displayMoney(waterfall.totalEffectiveAcquisitionCost)
              : `${displayMoney(currentBid)} (Plus Unknown Surviving Debt)`}
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 border-t border-line text-xs">
          <div>
            <span className="text-ink-3 block">Auction Winning Bid Baseline:</span>
            <span className="font-semibold text-ink">{displayMoney(currentBid)}</span>
          </div>
          <div>
            <span className="text-ink-3 block">Surviving Senior Liens to Satisfy:</span>
            <span className="font-semibold text-ink">
              {waterfall.totalSurvivingDebtOnProperty !== null
                ? displayMoney(waterfall.totalSurvivingDebtOnProperty)
                : "Unknown (Title Search Required)"}
            </span>
          </div>
        </div>
      </div>

      {/* Federal Tax Lien & Super-Priority Statutory Toggles */}
      <div className="space-y-2 pt-1">
        <span className="font-bold text-ink text-xs block">Federal Encumbrances &amp; Statutory Defenses:</span>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {/* IRS Federal Tax Lien Badge */}
          <div className="rounded-lg border border-line bg-paper p-2.5 space-y-1">
            <div className="flex items-center justify-between">
              <span className="font-bold text-ink text-xs">26 U.S.C. § 7425 Federal Tax Lien</span>
              <button
                type="button"
                onClick={() => setHasIrsLienOverride(!hasIrsLienOverride)}
                className={`px-2 py-0.5 rounded text-xs font-bold border transition ${
                  hasIrsLienOverride
                    ? "bg-catch-wash text-catch-ink border-catch/40"
                    : "bg-card text-ink-3 border-line"
                }`}
              >
                {hasIrsLienOverride ? "IRS Lien Detected" : "No IRS Lien"}
              </button>
            </div>
            <p className="text-xs text-ink-3 leading-tight">
              {hasIrsLienOverride
                ? "25-day formal IRS notice required. IRS retains a 120-day statutory right of redemption under 26 U.S.C. § 7425(d) to reimburse buyer at bid price plus interest."
                : "No IRS notice phrase detected; 120-day statutory redemption right does not apply."}
            </p>
          </div>

          {/* HOA Super-Priority Badge */}
          <div className="rounded-lg border border-line bg-paper p-2.5 space-y-1">
            <div className="flex items-center justify-between">
              <span className="font-bold text-ink text-xs">HOA Super-Priority Assessment</span>
              <span className={`px-2 py-0.5 rounded text-xs font-bold border ${
                isSuperPriorityState
                  ? "bg-catch-wash text-catch-ink border-catch/30"
                  : "bg-card text-ink-3 border-line"
              }`}>
                {isSuperPriorityState ? `${state} Super-Priority` : `${state} Standard Priority`}
              </span>
            </div>
            <p className="text-xs text-ink-3 leading-tight">
              {isSuperPriorityState
                ? `${state} statute grants HOA assessments super-priority (typically 6-9 months of common charges), requiring purchaser satisfaction prior to obtaining clear insurable title.`
                : `${state} does not give HOA dues super-priority over senior mortgages; HOA assessment liens are wiped by first mortgage foreclosure.`}
            </p>
          </div>
        </div>
      </div>

      {/* Statutory Due Diligence Footer */}
      <div className="flex items-start gap-2 pt-1 text-xs text-ink-3 leading-tight">
        <ShieldCheck className="h-4 w-4 shrink-0 text-go-fill mt-0.5" />
        <p>
          <strong>Zero-Fabrication Underwriting Standard:</strong> Priority determinations are statutory estimates based on petitioner naming conventions. Certified 40-year title examination by a licensed title insurer is required before bidding at any distressed judicial or non-judicial auction.
        </p>
      </div>
    </div>
  );
}
