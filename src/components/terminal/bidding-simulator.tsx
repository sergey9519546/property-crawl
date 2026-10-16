"use client";

import React, { useEffect, useState } from "react";
import { Listing } from "@/data/listings";
import { AlertTriangle, Calculator, CheckCircle2, Sparkles } from "lucide-react";
import { computeCashToClose, computeTargetPriceScenario } from "@/lib/underwriting";
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
  const [aiStrategy, setAiStrategy] = useState<string | null>(null);
  const [loadingStrategy, setLoadingStrategy] = useState(false);

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
  }, [listing.id]);

  const persistScenario = (next: Record<ScenarioField, string>, rehab = rehabBudget, margin = targetMargin) => {
    writeUnderwriteScenario(listing.id, { ...next, rehabBudget: rehab, targetMargin: margin });
  };

  const openingBid = positiveNumber(listing.openingBid);
  const estimatedValue = positiveNumber(listing.mid) ?? positiveNumber(listing.estHigh);

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
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-amber-950 shadow-sm">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
          <div>
            <h3 className="text-sm font-bold">Price scenario unavailable</h3>
            <p className="mt-1 text-xs leading-relaxed text-amber-900/80">This record carries no published opening amount, so no bid scenario can be modeled. Nothing is inferred from the address or the county.</p>
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
    persistScenario(next);
    setAiStrategy(null);
  };

  const affirmZeroCosts = () => {
    const next = { ...scenario, buyersPremium: "0", sheriffPoundage: "0", transferTax: "0", delinquentTaxes: "0", settlementCosts: "0" };
    setScenario(next);
    persistScenario(next);
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
      setAiStrategy([
        `1. Maximum Allowable Offer = valuation midpoint ${displayMoney(estimatedValue)} minus ${targetMargin}% target margin, ${displayMoney(rehabBudget)} rehab budget, and entered settlement costs.`,
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
      <div className="space-y-5 rounded-2xl border border-[#E5E7EB] bg-white p-5 shadow-sm">
        <div className="flex items-start gap-2">
          <Calculator className="mt-0.5 h-5 w-5 text-[#0F172A]" />
          <div>
            <h3 className="text-base font-bold text-[#111827]">{estimatedValue === null ? "Bid cost model" : "Max Allowable Offer (MAO) Simulator"}</h3>
            <p className="mt-1 text-xs leading-relaxed text-[#5B6472]">{estimatedValue === null
              ? "Costs below are modeled from the published opening amount and the assumptions you enter. No fee is inferred from the source or state; enter 0 only when zero is your deliberate assumption. A maximum allowable offer is not shown because this record has no supported valuation."
              : "No fee is inferred from the source or state. Enter a published amount or your own assumption; enter 0 only when zero is your deliberate assumption."}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {Object.entries(fieldLabels).map(([field, label]) => (
            <label key={field} className="space-y-1 text-xs font-semibold text-[#374151]">
              <span>{label}</span>
              <div className="flex items-center rounded-lg border border-[#D1D5DB] bg-white px-3 focus-within:border-[#0F172A]">
                <span className="text-[#5B6472]">$</span>
                <input inputMode="decimal" value={scenario[field as ScenarioField]} onChange={(event) => updateScenario(field as ScenarioField, event.target.value)} placeholder="Unresolved" aria-label={`${label} assumption`} className="min-w-0 flex-1 bg-transparent px-2 py-2 text-sm font-semibold text-[#111827] outline-none" />
              </div>
            </label>
          ))}
        </div>
        <button type="button" onClick={affirmZeroCosts} className="text-xs font-bold text-slate-700 underline underline-offset-2">Explicitly set all acquisition-cost fields to $0</button>

        <div className="space-y-4 border-t border-[#E5E7EB] pt-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm font-semibold text-[#374151]"><label htmlFor="rehab-budget">Rehab assumption</label><span>{displayMoney(rehabBudget)}</span></div>
            <input id="rehab-budget" type="range" min="0" max="150000" step="5000" value={rehabBudget} onChange={(event) => { const next = Number(event.target.value); setRehabBudget(next); persistScenario(scenario, next, targetMargin); }} className="w-full accent-[#0F172A]" />
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm font-semibold text-[#374151]"><label htmlFor="target-margin">Target profit margin</label><span>{targetMargin}%</span></div>
            <input id="target-margin" type="range" min="10" max="40" step="5" value={targetMargin} onChange={(event) => { const next = Number(event.target.value); setTargetMargin(next); persistScenario(scenario, rehabBudget, next); }} className="w-full accent-[#0F172A]" />
          </div>
        </div>

        {cash.totalAcquisitionCost !== null ? (
          <div className="grid grid-cols-1 gap-3 border-t border-[#E5E7EB] pt-4 sm:grid-cols-2">
            <div className="rounded-xl border border-[#E5E7EB] bg-[#F8FAFC] p-3">
              <p className="text-[11px] font-bold uppercase text-[#5B6472]">Acquisition cost at the opening amount</p>
              <p className="text-xl font-extrabold text-[#111827]">{displayMoney(cash.totalAcquisitionCost)}</p>
              <p className="mt-1 text-[10px] text-[#5B6472]">The published opening amount plus the acquisition costs you entered.</p>
            </div>
            {amounts.registrationFunds !== null && amounts.creditedDeposit !== null && cash.cashDueAtSettlement !== null ? (
              <div className="rounded-xl border border-[#E5E7EB] bg-[#F8FAFC] p-3">
                <p className="text-[11px] font-bold uppercase text-[#5B6472]">Cash to close</p>
                <p className="text-xl font-extrabold text-[#111827]">{displayMoney(cash.cashDueAtSettlement)}</p>
                <p className="mt-1 text-[10px] text-[#5B6472]">Acquisition cost minus the deposit credited to the price. Registration funds are not added again.</p>
              </div>
            ) : (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-950">Cash to close stays blank until registration funds and the credited deposit are both entered.</div>
            )}
          </div>
        ) : (
          <div className="flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900"><AlertTriangle className="h-4 w-4 shrink-0" /><p>Unknown taxes, debt, and fees are not treated as $0. Every acquisition-cost field needs a value before any total can be shown.</p></div>
        )}

        {estimatedValue === null ? (
          <div className="flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-950">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <div>
              <h4 className="text-xs font-bold">Price scenario unavailable</h4>
              <p className="mt-1 text-[11px] leading-relaxed text-amber-900/80">A maximum allowable offer is a statement about what this property is worth, and this record carries no supported comparable-sale valuation, so none is shown. The published opening amount is {displayMoney(openingBid)}; the cost model above uses only that amount and the assumptions you entered.</p>
            </div>
          </div>
        ) : reverseScenario ? (
          <div className="grid grid-cols-1 gap-3 border-t border-[#E5E7EB] pt-4 sm:grid-cols-2">
            <div className="rounded-xl border border-[#E5E7EB] bg-[#F8FAFC] p-3"><p className="text-[11px] font-bold uppercase text-[#5B6472]">Maximum price meeting target</p><p className="text-xl font-extrabold text-[#111827]">{displayMoney(reverseScenario.maxPurchasePrice)}</p><p className="mt-1 text-[10px] text-[#5B6472]">After explicit costs, rehab, and target profit.</p></div>
            <div className="rounded-xl border border-[#E5E7EB] bg-[#F8FAFC] p-3"><p className="text-[11px] font-bold uppercase text-[#5B6472]">Change needed at opening amount</p><p className="text-xl font-extrabold text-[#111827]">{displayMoney(reverseScenario.priceReductionNeeded)}</p><p className="mt-1 text-[10px] text-[#5B6472]">Required price reduction if costs stay unchanged.</p></div>
            <div className="rounded-xl border border-[#E5E7EB] bg-[#F8FAFC] p-3 sm:col-span-2">
              <p className="text-[11px] font-bold uppercase text-[#5B6472]">Cost alternative</p>
              <p className="mt-1 text-sm font-bold text-[#111827]">At the opening amount, other acquisition costs may total at most {displayMoney(reverseScenario.maxOtherAcquisitionCostsAtCurrentPrice)}.</p>
              <p className="mt-1 text-xs text-[#5B6472]">{reverseScenario.targetAchievableAtCurrentPrice ? `Required cost reduction: ${displayMoney(reverseScenario.costReductionNeeded)}.` : "The target cannot be achieved at the current price, even with zero other acquisition costs."} Registration funds and a credited deposit affect timing and liquidity; a credited deposit is not counted twice.</p>
            </div>
          </div>
        ) : (
          <div className="flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900"><AlertTriangle className="h-4 w-4 shrink-0" /><p>Target price remains unresolved until every acquisition-cost field has a value. Unknown taxes, debt, and fees are not treated as $0.</p></div>
        )}
      </div>

      {reverseScenario && (
        <div className={`flex gap-3 rounded-xl border p-4 text-sm ${reverseScenario.priceReductionNeeded > 0 ? "border-red-200 bg-red-50 text-red-900" : "border-green-200 bg-green-50 text-green-900"}`}>
          {reverseScenario.priceReductionNeeded > 0 ? <AlertTriangle className="h-5 w-5 shrink-0 text-red-600" /> : <CheckCircle2 className="h-5 w-5 shrink-0 text-green-600" />}
          <p>{reverseScenario.priceReductionNeeded > 0 ? <>The opening amount is {displayMoney(reverseScenario.priceReductionNeeded)} above the price that meets this scenario&apos;s target.</> : <>The opening amount meets this scenario&apos;s target with {displayMoney(reverseScenario.maxPurchasePrice - openingBid)} of price headroom.</>}</p>
        </div>
      )}

      <div className="space-y-2.5 rounded-xl border border-slate-200 bg-[#F8FAFC] p-4 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-[#0F172A]"><Sparkles className="h-3.5 w-3.5 fill-amber-500 text-amber-500" /><span>Explain this scenario</span></div>
          <button disabled={openingBid === null || loadingStrategy} onClick={handleRunAiStrategy} className="rounded-lg bg-[#0F172A] px-2.5 py-1 text-[11px] font-bold text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40">{aiStrategy ? "Re-run explanation" : "Explain scenario & risks"}</button>
        </div>
        {loadingStrategy && <p className="animate-pulse text-xs text-slate-500">Checking the entered scenario...</p>}
        {aiStrategy && <div className="whitespace-pre-line border-t border-slate-200 pt-2 text-xs leading-relaxed text-slate-700">{aiStrategy}</div>}
      </div>
    </div>
  );
}
