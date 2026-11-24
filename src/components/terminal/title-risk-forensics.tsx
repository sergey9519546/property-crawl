"use client";

import React, { useId, useState } from "react";
import { AlertOctagon, Layers, Scale, ShieldCheck } from "lucide-react";
import { computeLienWaterfall, LienWaterfallResult } from "@/lib/underwriting";
import { displayMoney } from "@/lib/listing-display";
import { useLocale } from "@/components/i18n/locale-provider";
import { formatUsd, interpolate } from "@/lib/i18n/translator";

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
  | "unknown"
  | "first_mortgage"
  | "second_mortgage"
  | "hoa_assessment"
  | "tax_deed"
  | "mechanic_lien";

// Authoritative parity with server/intelligence/hoa-super-lien.js (22 jurisdictions)
const HOA_SUPER_PRIORITY_STATES = new Set([
  "AL", "AK", "CO", "CT", "DC", "FL", "HI", "IL", "MA", "MD",
  "MN", "MO", "NJ", "NV", "NY", "OR", "PA", "RI", "TN", "VT", "WA", "WV"
]);

function inferInitialLienType(
  plaintiff?: string | null,
  warning?: string | null,
  source?: string | null
): ForeclosingLienType {
  const plaintiffText = String(plaintiff || "").trim();
  const rawWarning = String(warning || "").trim();
  const safeWarning = /^(?:no\s+junior|no\s+senior|no_title_conclusion|unconfirmed)/i.test(rawWarning)
    ? ""
    : rawWarning;
  const sourceText = String(source || "").trim();
  const combined = `${plaintiffText} ${safeWarning} ${sourceText}`.toLowerCase();

  const foreclosingContext = combined.replace(
    /(?:omitted|unjoined)\s+(?:junior|subordinate)\s+(?:mortgagee?|deed|lien(?:holder)?|defendant|party)/gi,
    ""
  );
  if (/(?:second\s*(?:mortgage|(?:trust\s*)?deed)|2nd\s*(?:mortgage|(?:trust\s*)?deed)|junior\s*(?:mortgage|deed|lien)|\bheloc\b|(?:home\s+)?equity\s*line|subordinate\s*(?:deed|mortgage|lien))/i.test(foreclosingContext)) {
    return "second_mortgage";
  }
  if (/(?:mechanic'?s?\s*lien|construction\s*lien|materialm[ae]n'?s?\s*lien|contractor'?s?\s*lien|claim\s*of\s*lien)/i.test(combined)) {
    return "mechanic_lien";
  }
  if (/(?:homeowners?\s*association|condominium\s*association|\bhoa\b|condo\s*owners|master\s*association|community\s*association|property\s*owners\s*association)/i.test(combined)) {
    return "hoa_assessment";
  }
  // Federal IRS tax lien foreclosures do not prime prior recorded private mortgages;
  // do not classify IRS seizures as super-priority ad valorem tax deeds.
  const isIrsContext = /(?:internal\s*revenue|\birs\b|federal\s*tax\s*lien)/i.test(combined) || sourceText.toLowerCase() === "irs";
  if (!isIrsContext && /(?:tax\s*collector|county\s*treasurer|tax\s*lien|tax\s*deed|tax[_\s-]*sale|delinquent\s*tax|ad\s*valorem)/i.test(combined)) {
    return "tax_deed";
  }
  // Only classify as first_mortgage when the published plaintiff itself matches
  // a known mortgage/institutional lender pattern (never infer from source="trustee" alone).
  if (
    plaintiffText &&
    !isIrsContext &&
    /(?:first\s*(?:mortgage|(?:trust\s*)?deed)|1st\s*(?:mortgage|(?:trust\s*)?deed)|mortgage|bank|fannie|freddie|wells\s*fargo|jpmorgan|chase|citibank|truist|pnc|us\s*bank|loan\s*service|trustee|nationstar|mr\s*cooper|freedom\s*mortgage|rocket|caliber|quicken)/i.test(plaintiffText)
  ) {
    return "first_mortgage";
  }
  return "unknown";
}

export function TitleRiskForensics({
  plaintiff,
  seniorLienRisk,
  seniorLienWarning,
  judgment,
  openingBid,
  state = "",
  source = "",
}: TitleRiskForensicsProps) {
  const { locale, messages } = useLocale();
  const t = messages.underwritingDeep;
  const money = (value: number) => (locale === "en" ? displayMoney(value) : formatUsd(locale, value));

  const seniorDebtInputId = useId();
  const delinquentTaxesInputId = useId();
  const assumedBidInputId = useId();

  const stateCode = String(state || "").trim().toUpperCase();
  const detectedIrsFromRecord = React.useMemo(() => {
    const combined = `${seniorLienWarning || ""} ${source || ""}`.toLowerCase();
    return /(?:internal\s*revenue|\birs\b|federal\s*tax\s*lien|26\s*u\.?s\.?c\.?\s*§?\s*7425)/i.test(combined) || source === "irs";
  }, [seniorLienWarning, source]);

  const [foreclosingType, setForeclosingType] = useState<ForeclosingLienType>(() =>
    inferInitialLienType(plaintiff, seniorLienWarning, source)
  );
  const [nvSuperPriorityMode, setNvSuperPriorityMode] = useState<boolean>(true);
  const [assumedSeniorDebt, setAssumedSeniorDebt] = useState<string>("");
  const [delinquentTaxesInput, setDelinquentTaxesInput] = useState<string>("");
  const [assumedBidInput, setAssumedBidInput] = useState<string>("");
  const [hasIrsLienOverride, setHasIrsLienOverride] = useState<boolean>(detectedIrsFromRecord);

  const parsedSeniorDebt = assumedSeniorDebt.trim() ? Number(assumedSeniorDebt) : null;
  const validSeniorDebt = typeof parsedSeniorDebt === "number" && Number.isFinite(parsedSeniorDebt) && parsedSeniorDebt >= 0
    ? parsedSeniorDebt
    : null;

  const parsedTaxes = delinquentTaxesInput.trim() ? Number(delinquentTaxesInput) : null;
  const validDelinquentTaxes = typeof parsedTaxes === "number" && Number.isFinite(parsedTaxes) && parsedTaxes >= 0
    ? parsedTaxes
    : null;

  const publishedOpeningBid = typeof openingBid === "number" && Number.isFinite(openingBid) && openingBid > 0 ? openingBid : null;
  const parsedAssumedBid = assumedBidInput.trim() ? Number(assumedBidInput) : null;
  const validAssumedBid = typeof parsedAssumedBid === "number" && Number.isFinite(parsedAssumedBid) && parsedAssumedBid > 0
    ? parsedAssumedBid
    : null;
  const currentBid = publishedOpeningBid ?? validAssumedBid;
  const currentJudgment = typeof judgment === "number" && Number.isFinite(judgment) && judgment > 0 ? judgment : null;

  const isNvHoaSuperPriority = foreclosingType === "hoa_assessment" && stateCode === "NV" && nvSuperPriorityMode;
  const isJunior =
    foreclosingType === "second_mortgage" ||
    foreclosingType === "mechanic_lien" ||
    (foreclosingType === "hoa_assessment" && !isNvHoaSuperPriority);

  const waterfall: LienWaterfallResult | null = currentBid !== null
    ? computeLienWaterfall({
        winningBid: currentBid,
        foreclosingLienType: foreclosingType,
        foreclosingLienAmount: currentJudgment,
        delinquentTaxesAmount: validDelinquentTaxes,
        seniorMortgageAmount: validSeniorDebt,
        state: stateCode,
        hoaSuperPriorityForeclosure: isNvHoaSuperPriority,
      })
    : null;

  const isSuperPriorityState = Boolean(stateCode && HOA_SUPER_PRIORITY_STATES.has(stateCode));

  // Determine overall risk level aligned with server/intelligence/title-risk-engine.js
  let calculatedRisk: "CRITICAL" | "HIGH" | "MODERATE" | "LOW" = "LOW";
  if (isJunior || seniorLienRisk?.toLowerCase() === "critical") {
    calculatedRisk = "CRITICAL";
  } else if (isNvHoaSuperPriority || hasIrsLienOverride || seniorLienRisk?.toLowerCase() === "high") {
    calculatedRisk = "HIGH";
  } else if (foreclosingType === "unknown" || seniorLienRisk?.toLowerCase() === "moderate") {
    calculatedRisk = "MODERATE";
  }

  return (
    <div className="rounded-xl border border-line bg-card p-4 space-y-4 text-xs">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-3">
        <div className="flex items-center gap-2">
          <Layers className="h-4 w-4 text-yours" />
          <span className="text-sm font-bold text-ink">{t.trfTitle}</span>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`px-2.5 py-0.5 rounded-md font-bold uppercase tracking-wider text-xs border ${
              calculatedRisk === "CRITICAL"
                ? "bg-catch-wash text-catch-ink border-catch/40"
                : calculatedRisk === "HIGH"
                ? "bg-catch-wash text-catch-ink border-catch/30"
                : calculatedRisk === "MODERATE"
                ? "bg-catch-wash text-catch-ink border-catch/25"
                : "bg-paper text-ink-2 border-line"
            }`}
          >
            {calculatedRisk === "CRITICAL"
              ? t.trfCriticalBadge
              : calculatedRisk === "HIGH"
              ? t.trfHighBadge
              : calculatedRisk === "MODERATE"
              ? "Verification Required"
              : t.trfStandardBadge}
          </span>
        </div>
      </div>

      {/* Foreclosing Party & Context */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="rounded-lg border border-line bg-paper p-2.5 space-y-1">
          <span className="font-semibold text-ink-3 uppercase block text-xs">{t.trfPetitionerLabel}</span>
          <p className="font-bold text-ink truncate text-xs">{plaintiff || "Not published — unverified lien position"}</p>
          {judgment && judgment > 0 && (
            <p className="text-xs text-ink-2">{interpolate(t.trfJudgmentDebt, { amount: money(judgment) })}</p>
          )}
        </div>
        <div className="rounded-lg border border-line bg-paper p-2.5 space-y-1">
          <span className="font-semibold text-ink-3 uppercase block text-xs">{t.trfSurvivalRuleLabel}</span>
          <p className="font-bold text-ink text-xs">
            {foreclosingType === "unknown"
              ? "Unconfirmed Lien Position — Title Search Required"
              : foreclosingType === "first_mortgage"
              ? t.trfWipesJunior
              : foreclosingType === "tax_deed"
              ? t.trfTaxPrimes
              : isNvHoaSuperPriority
              ? t.trfNvHoaPrimes
              : t.trfSeniorSurvives}
          </p>
          <p className="text-xs text-ink-3">
            {foreclosingType === "unknown"
              ? "Foreclosing lien priority cannot be verified from the published plaintiff record; prior encumbrances may survive."
              : isNvHoaSuperPriority
              ? "9-month super-priority HOA foreclosure extinguishes prior 1st mortgage (SFR Investments Pool 1; verify no prior lender super-priority tender)."
              : isJunior
              ? t.trfJuniorTakesSubject
              : t.trfSubordinateWiped}
          </p>
        </div>
      </div>

      {/* Interactive Foreclosing Lien Position Selector */}
      <div className="space-y-2 pt-1">
        <div className="flex items-center justify-between">
          <span className="font-bold text-ink">{t.trfSimulateLabel}</span>
          <span className="text-xs text-ink-3">{t.trfSimulateHint}</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-1.5">
          {[
            { id: "unknown" as const, label: "Unknown / Unverified" },
            { id: "first_mortgage" as const, label: t.trfTypeFirst },
            { id: "second_mortgage" as const, label: t.trfTypeSecond },
            { id: "hoa_assessment" as const, label: t.trfTypeHoa },
            { id: "tax_deed" as const, label: t.trfTypeTax },
            { id: "mechanic_lien" as const, label: t.trfTypeMechanic },
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

      {/* Nevada NRS 116.3116 Super-Priority vs Sub-Priority Mode Toggle */}
      {foreclosingType === "hoa_assessment" && stateCode === "NV" && (
        <div className="rounded-lg border border-line bg-paper p-3 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-bold text-ink text-xs">Nevada NRS 116.3116 HOA Foreclosure Scope</span>
            <span className="text-xs text-ink-3">SFR Investments Pool 1 vs. lender tender / sub-priority dues</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            <button
              type="button"
              onClick={() => setNvSuperPriorityMode(true)}
              className={`px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition text-left ${
                nvSuperPriorityMode
                  ? "bg-ink text-white border-ink shadow-xs"
                  : "bg-card text-ink-2 border-line hover:border-ink/30"
              }`}
            >
              Super-Priority (9-mo assessments prime 1st mortgage)
            </button>
            <button
              type="button"
              onClick={() => setNvSuperPriorityMode(false)}
              className={`px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition text-left ${
                !nvSuperPriorityMode
                  ? "bg-ink text-white border-ink shadow-xs"
                  : "bg-card text-ink-2 border-line hover:border-ink/30"
              }`}
            >
              Sub-Priority / Lender-Tendered (1st mortgage survives)
            </button>
          </div>
        </div>
      )}

      {/* Delinquent Property Taxes Input (Zero-Fabrication) */}
      <div className="rounded-lg border border-line bg-paper p-3 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label htmlFor={delinquentTaxesInputId} className="font-bold text-ink text-xs">
            Delinquent Property Taxes ($):
          </label>
          <span className="text-xs text-ink-3">
            {validDelinquentTaxes === null
              ? "Unknown / blank (leave blank until tax roll verified, or enter 0 if clear)"
              : `Supplied tax arrears: ${money(validDelinquentTaxes)}`}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-ink-2">$</span>
          <input
            id={delinquentTaxesInputId}
            type="number"
            min="0"
            step="250"
            placeholder="Unknown — enter 0 if verified clear, or tax arrears"
            value={delinquentTaxesInput}
            onChange={(e) => setDelinquentTaxesInput(e.target.value)}
            className="w-full rounded-md border border-line bg-card px-3 py-1.5 text-xs text-ink font-semibold focus:outline-hidden focus:ring-1 focus:ring-ink"
          />
        </div>
      </div>

      {/* Junior Foreclosure Senior Debt Assumption Box */}
      {isJunior && (
        <div className="rounded-lg border border-line bg-paper p-3 space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <Scale className="h-4 w-4 text-yours" />
              <label htmlFor={seniorDebtInputId} className="font-bold text-ink text-xs">{t.trfSeniorDebtLabel}</label>
            </div>
            <span className="text-xs text-ink-3">{t.trfZeroFabLoan}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-ink-2">$</span>
            <input
              id={seniorDebtInputId}
              type="number"
              min="0"
              step="5000"
              placeholder={t.trfSeniorDebtPlaceholder}
              value={assumedSeniorDebt}
              onChange={(e) => setAssumedSeniorDebt(e.target.value)}
              className="w-full rounded-md border border-line bg-card px-3 py-1.5 text-xs text-ink font-semibold focus:outline-hidden focus:ring-1 focus:ring-ink"
            />
          </div>
          {validSeniorDebt === null && (
            <p className="text-xs text-catch-ink">
              ⚠️ {t.trfJuniorWarning}
            </p>
          )}
        </div>
      )}

      {/* Waterfall & Effective Acquisition Cost Card */}
      {waterfall?.criticalAlert && (
        <div className="rounded-lg border border-catch/30 bg-catch-wash p-3 text-xs text-catch-ink space-y-1">
          <div className="flex items-center gap-1.5 font-bold">
            <AlertOctagon className="h-4 w-4 shrink-0" />
            <span>{t.trfInvariantWarn}</span>
          </div>
          <p className="leading-relaxed">{waterfall.criticalAlert}</p>
        </div>
      )}

      {/* Buyer-Assumed Winning Bid when published opening bid is absent */}
      {publishedOpeningBid === null && (
        <div className="rounded-lg border border-line bg-paper p-3 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label htmlFor={assumedBidInputId} className="font-bold text-ink text-xs">
              {t.trfAssumedBidLabel}
            </label>
            <span className="text-xs text-ink-3">{t.trfZeroFabBid}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-ink-2">$</span>
            <input
              id={assumedBidInputId}
              type="number"
              min="1"
              step="1000"
              placeholder={t.trfAssumedBidPlaceholder}
              value={assumedBidInput}
              onChange={(e) => setAssumedBidInput(e.target.value)}
              className="w-full rounded-md border border-line bg-card px-3 py-1.5 text-xs text-ink font-semibold focus:outline-hidden focus:ring-1 focus:ring-ink"
            />
          </div>
        </div>
      )}

      {/* True Effective Acquisition Cost Callout */}
      <div className="rounded-lg border border-line bg-paper p-3 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-bold text-ink text-xs">{t.trfTotalCapitalLabel}</span>
          <span className="text-sm font-bold text-ink">
            {currentBid === null
              ? t.trfSupplyWinningBid
              : waterfall?.totalEffectiveAcquisitionCost !== null && waterfall?.totalEffectiveAcquisitionCost !== undefined
              ? money(waterfall.totalEffectiveAcquisitionCost)
              : interpolate(t.trfPlusUnknownDebt, { amount: money(currentBid) })}
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 border-t border-line text-xs">
          <div>
            <span className="text-ink-3 block">
              {publishedOpeningBid !== null ? t.trfBaselineBidLabel : t.trfAssumedBidBaselineLabel}
            </span>
            <span className="font-semibold text-ink">
              {currentBid !== null ? money(currentBid) : t.trfNotPublished}
            </span>
          </div>
          <div>
            <span className="text-ink-3 block">{t.trfSurvivingLiensLabel}</span>
            <span className="font-semibold text-ink">
              {waterfall && waterfall.totalSurvivingDebtOnProperty !== null
                ? money(waterfall.totalSurvivingDebtOnProperty)
                : isJunior
                ? (validSeniorDebt !== null ? money(validSeniorDebt) : t.trfUnknownTitleSearch)
                : currentBid === null
                ? t.trfZeroWiped
                : t.trfUnknownTitleSearch}
            </span>
          </div>
        </div>
      </div>

      {/* Federal Tax Lien & Super-Priority Statutory Toggles */}
      <div className="space-y-2 pt-1">
        <span className="font-bold text-ink text-xs block">{t.trfFederalDefensesLabel}</span>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {/* IRS Federal Tax Lien Badge & Sensitivity Toggle */}
          <div className="rounded-lg border border-line bg-paper p-2.5 space-y-1">
            <div className="flex items-center justify-between gap-2">
              <span className="font-bold text-ink text-xs">{t.trfIrsLienTitle}</span>
              <button
                type="button"
                onClick={() => setHasIrsLienOverride(!hasIrsLienOverride)}
                className={`px-2 py-0.5 rounded text-xs font-bold border transition ${
                  hasIrsLienOverride
                    ? "bg-catch-wash text-catch-ink border-catch/40"
                    : "bg-card text-ink-3 border-line"
                }`}
              >
                {hasIrsLienOverride
                  ? detectedIrsFromRecord
                    ? t.trfIrsDetected
                    : "Simulated IRS 120d"
                  : detectedIrsFromRecord
                  ? "IRS Check Suppressed (Sim)"
                  : "Simulate IRS 120d"}
              </button>
            </div>
            <p className="text-xs text-ink-3 leading-tight">
              {hasIrsLienOverride
                ? detectedIrsFromRecord
                  ? t.trfIrsDetectedDesc
                  : "Simulated IRS 120-day redemption sensitivity: models 26 U.S.C. § 7425 notice survival and 120-day redemption risk (no IRS lien detected in published record)."
                : detectedIrsFromRecord
                ? "Recorded notice flagged an IRS tax lien signal; currently suppressed for manual sensitivity modeling only."
                : t.trfNoIrsDesc}
            </p>
          </div>

          {/* HOA Super-Priority Badge */}
          <div className="rounded-lg border border-line bg-paper p-2.5 space-y-1">
            <div className="flex items-center justify-between gap-2">
              <span className="font-bold text-ink text-xs">{t.trfHoaTitle}</span>
              <span className={`px-2 py-0.5 rounded text-xs font-bold border ${
                isSuperPriorityState
                  ? "bg-catch-wash text-catch-ink border-catch/30"
                  : "bg-card text-ink-3 border-line"
              }`}>
                {!stateCode
                  ? "State Unknown"
                  : interpolate(isSuperPriorityState ? t.trfHoaSuperBadge : t.trfHoaStandardBadge, { state: stateCode })}
              </span>
            </div>
            <p className="text-xs text-ink-3 leading-tight">
              {!stateCode
                ? "State code not published — confirm whether applicable state law grants HOA assessments super-priority over senior mortgages."
                : interpolate(isSuperPriorityState ? t.trfHoaSuperDesc : t.trfHoaStandardDesc, { state: stateCode })}
            </p>
          </div>
        </div>
      </div>

      {/* Statutory Due Diligence Footer */}
      <div className="flex items-start gap-2 pt-1 text-xs text-ink-3 leading-tight">
        <ShieldCheck className="h-4 w-4 shrink-0 text-ink-2 mt-0.5" />
        <p>
          <strong>{t.trfStdBold}</strong> {t.trfStdBody}
        </p>
      </div>
    </div>
  );
}
