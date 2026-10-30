"use client";

import React, { useEffect, useState } from "react";
import { Listing } from "@/data/listings";
import { AlertTriangle, Calculator, CheckCircle2, Sparkles } from "lucide-react";
import { computeCashToClose, computeStatutoryDeadlinesAndCarry, computeStatutoryFeePreset, computeTargetPriceScenario } from "@/lib/underwriting";
import { displayMoney, positiveNumber } from "@/lib/listing-display";
import { readUnderwriteScenario, writeUnderwriteScenario } from "@/lib/underwrite-scenario";

interface BiddingSimulatorProps { listing: Listing; }

type ScenarioField = "registrationFunds" | "creditedDeposit" | "buyersPremium" | "sheriffPoundage" | "transferTax" | "delinquentTaxes" | "settlementCosts";

const fieldLabels: Record<ScenarioField, string> = {
  registrationFunds: "Registration funds",
  creditedDeposit: "Deposit credited to price",
  buyersPremium: "Buyer’s premium",
  sheriffPoundage: "Sheriff / trustee fee",
  transferTax: "Transfer tax",
  delinquentTaxes: "Taxes or debt buyer must satisfy",
  settlementCosts: "Other settlement / recording costs",
};

const acquisitionFields: ScenarioField[] = ["buyersPremium", "sheriffPoundage", "transferTax", "delinquentTaxes", "settlementCosts"];

function enteredAmount(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function BiddingSimulator({ listing }: BiddingSimulatorProps) {
  const [rehabBudget, setRehabBudget] = useState(25_000);
  const [targetMargin, setTargetMargin] = useState(30);
  const [scenario, setScenario] = useState<Record<ScenarioField, string>>({
    registrationFunds: "", creditedDeposit: "", buyersPremium: "", sheriffPoundage: "", transferTax: "", delinquentTaxes: "", settlementCosts: "",
  });
  const [customValuation, setCustomValuation] = useState<string>("");
  const [customOpeningBid, setCustomOpeningBid] = useState<string>("");
  const [isImportingAssessor, setIsImportingAssessor] = useState(false);
  const [assessorError, setAssessorError] = useState<string | null>(null);
  const [aiStrategy, setAiStrategy] = useState<string | null>(null);
  const [loadingStrategy, setLoadingStrategy] = useState(false);
  const [appliedPresetCitations, setAppliedPresetCitations] = useState<string[] | null>(null);

  useEffect(() => {
    const stored = readUnderwriteScenario(listing.id);
    if (!stored) return;
    setScenario({
      registrationFunds: stored.registrationFunds,
      creditedDeposit: stored.creditedDeposit,
      buyersPremium: stored.buyersPremium,
      sheriffPoundage: stored.sheriffPoundage,
      transferTax: stored.transferTax,
      delinquentTaxes: stored.delinquentTaxes,
      settlementCosts: stored.settlementCosts,
    });
    setRehabBudget(stored.rehabBudget);
    setTargetMargin(stored.targetMargin);
    if (stored.customValuation) {
      setCustomValuation(stored.customValuation);
    }
    if (stored.customOpeningBid) {
      setCustomOpeningBid(stored.customOpeningBid);
    }
  }, [listing.id]);

  const persistScenario = (
    next: Record<ScenarioField, string>,
    rehab = rehabBudget,
    margin = targetMargin,
    customVal = customValuation,
    customBid = customOpeningBid,
  ) => {
    writeUnderwriteScenario(listing.id, {
      ...next,
      rehabBudget: rehab,
      targetMargin: margin,
      customValuation: customVal,
      customOpeningBid: customBid,
    });
  };

  const publishedOpeningBid = positiveNumber(listing.openingBid);
  const customOpeningBidNum = enteredAmount(customOpeningBid);
  const openingBid = publishedOpeningBid ?? customOpeningBidNum;
  const isCustomOpeningBid = publishedOpeningBid === null && customOpeningBidNum !== null;
  const publisherValuation = positiveNumber(listing.mid) ?? positiveNumber(listing.estHigh);
  const customValuationNum = enteredAmount(customValuation);
  const estimatedValue = customValuationNum ?? publisherValuation;
  const isCustomValuation = customValuationNum !== null;

  // The bid-cost model and the max-allowable-offer calculation do not need the
  // same inputs. Cost to close is arithmetic over the PUBLISHED opening amount
  // plus costs the buyer enters, so it is answerable whenever the publisher gave
  // us an opening bid. MAO is a statement about what the property is worth, so it
  // requires a supported valuation band and is withheld when none exists.
  //
  // Gating the whole panel on a valuation meant that with estLow/estHigh null
  // across the inventory (they are, on every record) this component rendered
  // its amber notice and nothing else - including the cash model it had already
  // computed and never displayed. That is dead code behind a gate the cost model
  // does not need.
  if (openingBid === null) {
    return (
      <div className="rounded-2xl border border-catch/30 bg-catch-wash p-5 text-ink shadow-sm">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-catch-ink" />
          <div className="flex-1">
            <h3 className="text-sm font-bold">Price scenario unavailable</h3>
            <p className="mt-1 text-xs leading-relaxed text-ink-2">This record carries no published opening amount, so no bid scenario can be modeled. Nothing is inferred from the address or the county.</p>
            <div className="mt-3 border-t border-catch/30 pt-3">
              <label htmlFor="custom-opening-bid-input" className="block text-xs font-semibold text-ink">
                Model scenario with your target or assumed opening bid:
              </label>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <div className="flex items-center rounded-lg border border-line-strong bg-card px-3 focus-within:border-yours">
                  <span className="text-xs font-bold text-ink-3">$</span>
                  <input
                    id="custom-opening-bid-input"
                    inputMode="decimal"
                    value={customOpeningBid}
                    onChange={(event) => updateCustomOpeningBid(event.target.value)}
                    placeholder="e.g. 85000"
                    aria-label="Target bid or assumed opening amount"
                    className="w-32 bg-transparent px-2 py-1.5 text-xs font-semibold text-yours outline-none"
                  />
                </div>
              </div>
              <p className="mt-1.5 text-[10px] text-ink-3">
                Entering an assumed opening bid enables cash-to-close and statutory fee modeling for this session as an investor assumption.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const amounts = Object.fromEntries(Object.entries(scenario).map(([field, value]) => [field, enteredAmount(value)])) as Record<ScenarioField, number | null>;
  const cash = computeCashToClose({ openingBid, purchasePrice: openingBid, ...amounts });
  const otherAcquisitionCosts = acquisitionFields.every((field) => amounts[field] !== null)
    ? acquisitionFields.reduce((total, field) => total + (amounts[field] ?? 0), 0)
    : null;
  const reverseScenario = computeTargetPriceScenario({ estimatedValue, targetMarginPct: targetMargin, rehabBudget, currentPrice: openingBid, otherAcquisitionCosts });

  const updateScenario = (field: ScenarioField, value: string) => {
    if (value !== "" && (!/^\d*(?:\.\d{0,2})?$/.test(value) || Number(value) < 0)) return;
    const next = { ...scenario, [field]: value };
    setScenario(next);
    persistScenario(next, rehabBudget, targetMargin, customValuation, customOpeningBid);
    setAiStrategy(null);
  };

  const updateCustomValuation = (val: string) => {
    if (val !== "" && (!/^\d*(?:\.\d{0,2})?$/.test(val) || Number(val) < 0)) return;
    setCustomValuation(val);
    persistScenario(scenario, rehabBudget, targetMargin, val, customOpeningBid);
    setAiStrategy(null);
  };

  const updateCustomOpeningBid = (val: string) => {
    if (val !== "" && (!/^\d*(?:\.\d{0,2})?$/.test(val) || Number(val) < 0)) return;
    setCustomOpeningBid(val);
    persistScenario(scenario, rehabBudget, targetMargin, customValuation, val);
    setAiStrategy(null);
  };

  const handleImportAssessor = async () => {
    setIsImportingAssessor(true);
    setAssessorError(null);
    try {
      const res = await fetch(`/api/listings/${encodeURIComponent(listing.id)}/assessor`, { cache: "no-store" });
      if (!res.ok) throw new Error("Assessor lookup returned " + res.status);
      const data = await res.json();
      const figure = data?.marketComparison ?? data?.rawFigure;
      if (figure && Number.isFinite(figure) && figure > 0) {
        const rounded = Math.round(figure).toString();
        updateCustomValuation(rounded);
      } else {
        setAssessorError(data?.withheldReason || "No figure available from county assessor.");
      }
    } catch {
      setAssessorError("Could not reach county assessor layer.");
    } finally {
      setIsImportingAssessor(false);
    }
  };

  const statutoryPreset = computeStatutoryFeePreset({ purchasePrice: openingBid, state: listing.state, source: listing.source, depositText: typeof listing.deposit === "string" ? listing.deposit : null });
  const applyStatutoryPreset = () => {
    if (!statutoryPreset) return;
    const next: Record<ScenarioField, string> = {
      registrationFunds: String(statutoryPreset.registrationFunds),
      creditedDeposit: String(statutoryPreset.creditedDeposit),
      buyersPremium: String(statutoryPreset.buyersPremium),
      sheriffPoundage: String(statutoryPreset.sheriffPoundage),
      transferTax: String(statutoryPreset.transferTax),
      delinquentTaxes: scenario.delinquentTaxes || "0",
      settlementCosts: scenario.settlementCosts || "0",
    };
    setScenario(next);
    persistScenario(next, rehabBudget, targetMargin, customValuation);
    setAppliedPresetCitations([statutoryPreset.scheduleLabel, ...statutoryPreset.citations]);
    setAiStrategy(null);
  };
  const hasIrsNoticeFlag = listing.source === "irs" || /(?:internal\s*revenue|federal\s*tax\s*lien|26\s*u\.?s\.?c\.?\s*§?\s*7425)/i.test(`${listing.seniorLienWarning || ""} ${listing.redemptionWarning || ""}`);
  const deadlinesAndCarry = computeStatutoryDeadlinesAndCarry({
    saleDate: listing.saleDate,
    state: listing.state,
    purchasePrice: cash.totalAcquisitionCost ?? openingBid,
    redemptionDays: typeof listing.redemptionDays === "number" ? listing.redemptionDays : null,
    hasIrsLien: hasIrsNoticeFlag,
  });
  const affirmZeroCosts = () => {
    const next = { ...scenario, buyersPremium: "0", sheriffPoundage: "0", transferTax: "0", delinquentTaxes: "0", settlementCosts: "0" };
    setScenario(next);
    persistScenario(next, rehabBudget, targetMargin, customValuation);
    setAiStrategy(null);
  };

  const handleRunAiStrategy = async () => {
    if (openingBid === null) return;
    setLoadingStrategy(true);

    if (reverseScenario && cash.totalAcquisitionCost !== null) {
      const costLine = otherAcquisitionCosts === null
        ? "Other acquisition costs are incomplete, so they are excluded from the target."
        : `Other acquisition costs you entered total ${displayMoney(otherAcquisitionCosts)}.`;
      const reductionLine = reverseScenario.priceReductionNeeded > 0
        ? `The published opening amount is ${displayMoney(reverseScenario.priceReductionNeeded)} above that target.`
        : `The published opening amount is ${displayMoney(openingBid - reverseScenario.maxPurchasePrice)} below that target.`;
      const feasibilityLine = reverseScenario.targetAchievableAtCurrentPrice
        ? `Reaching the target at the opening amount requires ${displayMoney(reverseScenario.costReductionNeeded)} of cost reduction.`
        : "The target is not achievable at the opening amount, even with zero other acquisition costs.";
      const valuationLabel = isCustomValuation
        ? `entered ARV assumption ${displayMoney(estimatedValue)} (investor assumption, not a publisher appraisal)`
        : `valuation midpoint ${displayMoney(estimatedValue)}`;
      setAiStrategy([
        `1. Maximum Allowable Offer = ${valuationLabel} minus ${targetMargin}% target margin, ${displayMoney(rehabBudget)} rehab budget, and entered settlement costs.`,
        `2. Target purchase ceiling: ${displayMoney(reverseScenario.maxPurchasePrice)}. ${costLine} ${reductionLine}`,
        `3. Feasibility: ${feasibilityLine}`,
        `4. Statutory Due Diligence: ${listing.redemptionWarning || (listing.redemptionDays ? `${listing.redemptionDays}-day statutory redemption window applies.` : "Check local statutory redemption.")} ${listing.seniorLienWarning || "Verify senior judicial and municipal liens before bidding."}`,
      ].join("\n\n"));
    } else {
      const totalCost = cash.totalAcquisitionCost !== null
        ? displayMoney(cash.totalAcquisitionCost)
        : `At least ${displayMoney(openingBid)} + unresolved buyer fees`;
      const cashToClose = cash.cashDueAtSettlement !== null
        ? displayMoney(cash.cashDueAtSettlement)
        : "Unresolved until deposit and registration funds are entered";
      
      setAiStrategy([
        `1. Acquisition Cost Model: Published opening amount is ${displayMoney(openingBid)}. Modeled total acquisition cost: ${totalCost} (with ${displayMoney(rehabBudget)} estimated rehab). Estimated cash to close: ${cashToClose}.`,
        `2. Statutory Redemption: ${listing.redemptionWarning || (listing.redemptionDays ? `${listing.redemptionDays}-day statutory redemption period under ${listing.state || "state"} law.` : "No statutory redemption period detected; verify clerk docket.")}`,
        `3. Title & Lien Risk: ${listing.seniorLienWarning || "No senior lien phrase detected. Certified title search must be performed before tender of cashier's check."}`,
        `4. Bidding Discipline: In distressed judicial auctions, opening amounts reflect petitioner debt or upset statutory minimums, not property value. Ensure rehab plus holding costs remain under 70% of verified local tax assessor or CMA value.`,
      ].join("\n\n"));
    }
    setLoadingStrategy(false);
  };

  return (
    <div className="space-y-6 animate-in fade-in">
      <div className="space-y-5 rounded-2xl border border-line bg-card p-5 shadow-sm">
        <div className="flex items-start gap-2">
          <Calculator className="mt-0.5 h-5 w-5 text-ink" />
          <div>
            <h3 className="text-base font-bold text-ink">{estimatedValue === null ? "Bid cost model" : "Max Allowable Offer (MAO) Simulator"}</h3>
            <p className="mt-1 text-xs leading-relaxed text-ink-3">{estimatedValue === null
              ? "Costs below are modeled from the published opening amount and the assumptions you enter. No fee is inferred from the source or state; enter 0 only when zero is your deliberate assumption. A maximum allowable offer is not shown because this record has no supported valuation."
              : "No fee is inferred from the source or state. Enter a published amount or your own assumption; enter 0 only when zero is your deliberate assumption."}</p>
          </div>
        </div>

        {isCustomOpeningBid && (
          <div className="rounded-xl border border-yours/30 bg-yours-wash px-3.5 py-2.5 text-xs text-ink">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-yours" />
                <span>Modeled from assumed target bid: <strong>{displayMoney(openingBid)}</strong> (investor assumption — opening bid unpublished)</span>
              </div>
              <button
                type="button"
                onClick={() => updateCustomOpeningBid("")}
                className="text-[11px] font-bold text-ink-2 underline underline-offset-2 hover:text-ink"
              >
                Reset bid
              </button>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {Object.entries(fieldLabels).map(([field, label]) => (
            <label key={field} className="space-y-1 text-xs font-semibold text-ink-2">
              <span>{label}</span>
              <div className="flex items-center rounded-lg border border-line-strong bg-card px-3 focus-within:border-yours">
                <span className="text-ink-3">$</span>
                <input inputMode="decimal" value={scenario[field as ScenarioField]} onChange={(event) => updateScenario(field as ScenarioField, event.target.value)} placeholder="Unresolved" aria-label={`${label} assumption`} className="min-w-0 flex-1 bg-transparent px-2 py-2 text-sm font-semibold text-yours outline-none" />
              </div>
            </label>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <button type="button" onClick={affirmZeroCosts} className="text-xs font-bold text-ink-2 underline underline-offset-2">Explicitly set all acquisition-cost fields to $0</button>
          {statutoryPreset && (
            <button type="button" onClick={applyStatutoryPreset} className="rounded-lg border border-line-strong bg-paper px-3 py-1.5 text-xs font-bold text-ink transition hover:bg-line">
              {statutoryPreset.supported === false ? `Apply generic baseline (${statutoryPreset.state} not modeled)` : `Apply ${statutoryPreset.state} statutory schedule preset`}
            </button>
          )}
        </div>
        {statutoryPreset?.supported === false && statutoryPreset.notice && <p role="note" data-testid="statutory-unsupported-notice" className="rounded-xl border border-catch/30 bg-catch-wash p-3 text-[11px] text-ink">{statutoryPreset.notice}</p>}
        {appliedPresetCitations && (
          <div className="rounded-xl border border-line-strong bg-paper p-3 text-[11px] leading-relaxed text-ink-2">
            <p className="font-bold">Applied statutory schedule assumption ({appliedPresetCitations[0]}):</p>
            <ul className="mt-1 list-disc pl-4 space-y-0.5">
              {appliedPresetCitations.slice(1).map((cite) => <li key={cite}>{cite}</li>)}
            </ul>
            <p className="mt-1 text-[10px] text-ink-3">Explicit scenario assumptions only — verify exact county clerk / sheriff fee sheet before bidding.</p>
          </div>
        )}
        {deadlinesAndCarry.effectiveLockupDays > 0 && (
          <div className="rounded-xl border border-line bg-paper p-3 text-xs text-ink-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-bold text-ink">Post-sale statutory window: {deadlinesAndCarry.effectiveLockupDays} days</span>
              {deadlinesAndCarry.estimatedCarryCost !== null && (
                <span className="font-semibold text-yours">Modeled lockup carry ({deadlinesAndCarry.annualCostOfCapitalPct}%/yr): {displayMoney(deadlinesAndCarry.estimatedCarryCost)}</span>
              )}
            </div>
            {deadlinesAndCarry.objectionLabel && (
              <p className="mt-1 text-[11px] text-ink-3">{deadlinesAndCarry.objectionLabel}{deadlinesAndCarry.objectionDeadline ? ` — window ends ${deadlinesAndCarry.objectionDeadline}` : ""}</p>
            )}
            {deadlinesAndCarry.stateRedemptionDeadline && (
              <p className="mt-0.5 text-[11px] text-ink-3">Recorded redemption window ends {deadlinesAndCarry.stateRedemptionDeadline} ({deadlinesAndCarry.stateRedemptionDays}d)</p>
            )}
            {deadlinesAndCarry.irsRedemptionDeadline && (
              <p className="mt-0.5 text-[11px] text-catch-ink font-semibold">26 U.S.C. § 7425(d) IRS 120-day redemption window ends {deadlinesAndCarry.irsRedemptionDeadline}</p>
            )}
          </div>
        )}

        <div className="space-y-4 border-t border-line pt-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm font-semibold text-ink-2"><label htmlFor="rehab-budget">Rehab assumption</label><span className="text-yours">{displayMoney(rehabBudget)}</span></div>
            <input id="rehab-budget" type="range" min="0" max="150000" step="5000" value={rehabBudget} onChange={(event) => { const next = Number(event.target.value); setRehabBudget(next); persistScenario(scenario, next, targetMargin); }} className="w-full accent-[var(--color-yours)]" />
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm font-semibold text-ink-2"><label htmlFor="target-margin">Target profit margin</label><span className="text-yours">{targetMargin}%</span></div>
            <input id="target-margin" type="range" min="10" max="40" step="5" value={targetMargin} onChange={(event) => { const next = Number(event.target.value); setTargetMargin(next); persistScenario(scenario, rehabBudget, next); }} className="w-full accent-[var(--color-yours)]" />
          </div>
        </div>

        {cash.totalAcquisitionCost !== null ? (
          <div className="grid grid-cols-1 gap-3 border-t border-line pt-4 sm:grid-cols-2">
            <div className="rounded-xl border border-line bg-paper p-3">
              <p className="text-[11px] font-bold uppercase text-ink-3">Acquisition cost at the opening amount</p>
              <p className="text-xl font-extrabold text-yours">{displayMoney(cash.totalAcquisitionCost)}</p>
              <p className="mt-1 text-[10px] text-ink-3">The published opening amount plus the acquisition costs you entered.</p>
            </div>
            {amounts.registrationFunds !== null && amounts.creditedDeposit !== null && cash.cashDueAtSettlement !== null ? (
              <div className="rounded-xl border border-line bg-paper p-3">
                <p className="text-[11px] font-bold uppercase text-ink-3">Cash to close</p>
                <p className="text-xl font-extrabold text-yours">{displayMoney(cash.cashDueAtSettlement)}</p>
                <p className="mt-1 text-[10px] text-ink-3">Acquisition cost minus the deposit credited to the price. Registration funds are not added again.</p>
              </div>
            ) : (
              <div className="rounded-xl border border-catch/30 bg-catch-wash p-3 text-xs text-ink">Cash to close stays blank until registration funds and the credited deposit are both entered.</div>
            )}
          </div>
        ) : (
          <div className="flex gap-3 rounded-xl border border-catch/30 bg-catch-wash p-4 text-xs text-ink"><AlertTriangle className="h-4 w-4 shrink-0" /><p>Unknown taxes, debt, and fees are not treated as $0. Every acquisition-cost field needs a value before any total can be shown.</p></div>
        )}

        {estimatedValue === null ? (
          <div className="rounded-xl border border-catch/30 bg-catch-wash p-4 text-ink">
            <div className="flex gap-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-catch-ink" />
              <div>
                <h4 className="text-xs font-bold">Price scenario unavailable</h4>
                <p className="mt-1 text-[11px] leading-relaxed text-ink-2">A maximum allowable offer is a statement about what this property is worth, and this record carries no supported comparable-sale valuation, so none is shown. The published opening amount is {displayMoney(openingBid)}; the cost model above uses only that amount and the assumptions you entered.</p>
              </div>
            </div>
            <div className="mt-3 border-t border-catch/30 pt-3">
              <label htmlFor="custom-valuation-input" className="block text-xs font-semibold text-ink">
                Model MAO with your target ARV or county assessor figure:
              </label>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <div className="flex items-center rounded-lg border border-line-strong bg-card px-3 focus-within:border-yours">
                  <span className="text-xs font-bold text-ink-3">$</span>
                  <input
                    id="custom-valuation-input"
                    inputMode="decimal"
                    value={customValuation}
                    onChange={(event) => updateCustomValuation(event.target.value)}
                    placeholder="e.g. 185000"
                    aria-label="Target ARV or valuation assumption"
                    className="w-32 bg-transparent px-2 py-1.5 text-xs font-semibold text-yours outline-none"
                  />
                </div>
                <button
                  type="button"
                  disabled={isImportingAssessor}
                  onClick={handleImportAssessor}
                  className="rounded-lg border border-line-strong bg-card px-3 py-1.5 text-xs font-semibold text-ink-2 shadow-sm transition hover:bg-paper disabled:opacity-50"
                >
                  {isImportingAssessor ? "Reading assessor…" : "Import Assessor Figure"}
                </button>
                {assessorError && (
                  <span className="text-[11px] text-catch-ink">{assessorError}</span>
                )}
              </div>
              <p className="mt-1.5 text-[10px] text-ink-3">
                Entering an assumption enables MAO modeling for this session. It will be labeled as an investor assumption, not a publisher appraisal.
              </p>
            </div>
          </div>
        ) : reverseScenario ? (
          <div className="space-y-3">
            {isCustomValuation && (
              <div className="flex items-center justify-between rounded-xl border border-yours/30 bg-yours-wash px-3.5 py-2.5 text-xs text-ink">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-yours" />
                  <span>Modeled from entered ARV assumption: <strong>{displayMoney(estimatedValue)}</strong> (investor assumption — not a publisher appraisal)</span>
                </div>
                <button
                  type="button"
                  onClick={() => updateCustomValuation("")}
                  className="text-[11px] font-bold text-ink-2 underline underline-offset-2 hover:text-ink"
                >
                  Reset assumption
                </button>
              </div>
            )}
            <div className="grid grid-cols-1 gap-3 border-t border-line pt-4 sm:grid-cols-2">
              <div className="rounded-xl border border-line bg-paper p-3"><p className="text-[11px] font-bold uppercase text-ink-3">Maximum price meeting target</p><p className="text-xl font-extrabold text-yours">{displayMoney(reverseScenario.maxPurchasePrice)}</p><p className="mt-1 text-[10px] text-ink-3">After explicit costs, rehab, and target profit.</p></div>
              <div className="rounded-xl border border-line bg-paper p-3"><p className="text-[11px] font-bold uppercase text-ink-3">Change needed at opening amount</p><p className="text-xl font-extrabold text-yours">{displayMoney(reverseScenario.priceReductionNeeded)}</p><p className="mt-1 text-[10px] text-ink-3">Required price reduction if costs stay unchanged.</p></div>
              <div className="rounded-xl border border-line bg-paper p-3 sm:col-span-2">
                <p className="text-[11px] font-bold uppercase text-ink-3">Cost alternative</p>
                <p className="mt-1 text-sm font-bold text-yours">At the opening amount, other acquisition costs may total at most {displayMoney(reverseScenario.maxOtherAcquisitionCostsAtCurrentPrice)}.</p>
                <p className="mt-1 text-xs text-ink-3">{reverseScenario.targetAchievableAtCurrentPrice ? `Required cost reduction: ${displayMoney(reverseScenario.costReductionNeeded)}.` : "The target cannot be achieved at the current price, even with zero other acquisition costs."} Registration funds and a credited deposit affect timing and liquidity; a credited deposit is not counted twice.</p>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex gap-3 rounded-xl border border-catch/30 bg-catch-wash p-4 text-xs text-ink"><AlertTriangle className="h-4 w-4 shrink-0" /><p>Target price remains unresolved until every acquisition-cost field has a value. Unknown taxes, debt, and fees are not treated as $0.</p></div>
        )}
      </div>

      {reverseScenario && (
        <div className={`flex gap-3 rounded-xl border p-4 text-sm ${reverseScenario.priceReductionNeeded > 0 ? "border-catch/30 bg-catch-wash text-ink" : "border-line-strong bg-paper text-ink-2"}`}>
          {reverseScenario.priceReductionNeeded > 0 ? <AlertTriangle className="h-5 w-5 shrink-0 text-catch-ink" /> : <CheckCircle2 className="h-5 w-5 shrink-0 text-ink-3" />}
          <p>{reverseScenario.priceReductionNeeded > 0 ? <>The opening amount is {displayMoney(reverseScenario.priceReductionNeeded)} above the price that meets this scenario&apos;s target.</> : <>The opening amount meets this scenario&apos;s target with {displayMoney(reverseScenario.maxPurchasePrice - openingBid)} of price headroom.</>}</p>
        </div>
      )}

      <div className="space-y-2.5 rounded-xl border border-line bg-paper p-4 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-ink"><Sparkles className="h-3.5 w-3.5 fill-ink-3 text-ink-3" /><span>Explain this scenario</span></div>
          <button disabled={openingBid === null || loadingStrategy} onClick={handleRunAiStrategy} className="rounded-lg bg-ink px-2.5 py-1 text-[11px] font-bold text-white shadow-sm transition hover:bg-ink-2 disabled:cursor-not-allowed disabled:opacity-40">{aiStrategy ? "Re-run explanation" : "Explain scenario & risks"}</button>
        </div>
        {loadingStrategy && <p className="animate-pulse text-xs text-ink-3">Checking the entered scenario...</p>}
        {aiStrategy && <div className="whitespace-pre-line border-t border-line pt-2 text-xs leading-relaxed text-ink-2">{aiStrategy}</div>}
      </div>
    </div>
  );
}
