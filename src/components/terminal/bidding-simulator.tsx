"use client";

import React, { useState } from "react";
import { Listing } from "@/data/listings";
import { AlertTriangle, Calculator, CheckCircle2, Sparkles } from "lucide-react";
import { computeCashToClose, computeTargetPriceScenario } from "@/lib/underwriting";
import { displayMoney, positiveNumber } from "@/lib/listing-display";
import { sourceDisplayText } from "@/lib/source-display";

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

  const openingBid = positiveNumber(listing.openingBid);
  const estimatedValue = positiveNumber(listing.mid) ?? positiveNumber(listing.estHigh);
  const location = [listing.city, listing.state].filter(Boolean).join(", ");

  if (openingBid === null || estimatedValue === null) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-amber-950 shadow-sm">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
          <div>
            <h3 className="text-sm font-bold">Price scenario unavailable</h3>
            <p className="mt-1 text-xs leading-relaxed text-amber-900/80">A published opening amount and supported valuation range are required. Opening amount: {displayMoney(openingBid)}. Valuation: {displayMoney(estimatedValue)}.</p>
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
    setScenario((current) => ({ ...current, [field]: value }));
    setAiStrategy(null);
  };

  const affirmZeroCosts = () => {
    setScenario((current) => ({ ...current, buyersPremium: "0", sheriffPoundage: "0", transferTax: "0", delinquentTaxes: "0", settlementCosts: "0" }));
    setAiStrategy(null);
  };

  const handleRunAiStrategy = async () => {
    if (!reverseScenario || cash.totalAcquisitionCost === null) return;
    setLoadingStrategy(true);
    try {
      if (typeof window !== "undefined" && (window as any).puter?.ai?.chat) {
        const prompt = `Review this buyer-entered acquisition scenario using only the supplied facts.
Property: ${listing.address}${location ? `, ${location}` : ""}
Source channel: ${sourceDisplayText(listing.source)}
Published opening amount used as price scenario: $${openingBid.toLocaleString()}
Supported valuation-range midpoint: $${estimatedValue.toLocaleString()}
Explicit acquisition costs excluding price: $${otherAcquisitionCosts?.toLocaleString()}
Explicit rehab assumption: $${rehabBudget.toLocaleString()}
Target profit margin: ${targetMargin}%
Maximum price meeting target: $${reverseScenario.maxPurchasePrice.toLocaleString()}
Price reduction needed: $${reverseScenario.priceReductionNeeded.toLocaleString()}
Published deposit text: ${listing.deposit || "Not published"}

Explain the target-price math in three short points. Treat title, debt, property condition, final sale price, and any amount not listed above as unknown. Do not predict bidder behavior or recommend a bid.`;
        const response = await (window as any).puter.ai.chat(prompt, { model: "claude-3-5-sonnet" });
        const text = typeof response === "string" ? response : response?.message?.content || response?.toString();
        if (text && text.trim().length > 30) { setAiStrategy(text); setLoadingStrategy(false); return; }
      }
    } catch (error) {
      console.warn("Scenario explanation error:", error);
    }
    setAiStrategy("The explanation service is unavailable. The displayed maximum price is the supported valuation midpoint minus the selected target profit, rehab assumption, and every entered acquisition cost.");
    setLoadingStrategy(false);
  };

  return (
    <div className="space-y-6 animate-in fade-in">
      <div className="space-y-5 rounded-2xl border border-[#E5E7EB] bg-white p-5 shadow-sm">
        <div className="flex items-start gap-2">
          <Calculator className="mt-0.5 h-5 w-5 text-[#0F172A]" />
          <div>
            <h3 className="text-base font-bold text-[#111827]">Max Allowable Offer (MAO) Simulator</h3>
            <p className="mt-1 text-xs leading-relaxed text-[#6B7280]">No fee is inferred from the source or state. Enter a published amount or your own assumption; enter 0 only when zero is your deliberate assumption.</p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {Object.entries(fieldLabels).map(([field, label]) => (
            <label key={field} className="space-y-1 text-xs font-semibold text-[#374151]">
              <span>{label}</span>
              <div className="flex items-center rounded-lg border border-[#D1D5DB] bg-white px-3 focus-within:border-[#0F172A]">
                <span className="text-[#9CA3AF]">$</span>
                <input inputMode="decimal" value={scenario[field as ScenarioField]} onChange={(event) => updateScenario(field as ScenarioField, event.target.value)} placeholder="Unresolved" aria-label={`${label} assumption`} className="min-w-0 flex-1 bg-transparent px-2 py-2 text-sm font-semibold text-[#111827] outline-none" />
              </div>
            </label>
          ))}
        </div>
        <button type="button" onClick={affirmZeroCosts} className="text-xs font-bold text-slate-700 underline underline-offset-2">Explicitly set all acquisition-cost fields to $0</button>

        <div className="space-y-4 border-t border-[#E5E7EB] pt-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm font-semibold text-[#374151]"><label htmlFor="rehab-budget">Rehab assumption</label><span>{displayMoney(rehabBudget)}</span></div>
            <input id="rehab-budget" type="range" min="0" max="150000" step="5000" value={rehabBudget} onChange={(event) => setRehabBudget(Number(event.target.value))} className="w-full accent-[#0F172A]" />
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm font-semibold text-[#374151]"><label htmlFor="target-margin">Target profit margin</label><span>{targetMargin}%</span></div>
            <input id="target-margin" type="range" min="10" max="40" step="5" value={targetMargin} onChange={(event) => setTargetMargin(Number(event.target.value))} className="w-full accent-[#0F172A]" />
          </div>
        </div>

        {reverseScenario ? (
          <div className="grid grid-cols-1 gap-3 border-t border-[#E5E7EB] pt-4 sm:grid-cols-2">
            <div className="rounded-xl border border-[#E5E7EB] bg-[#F8FAFC] p-3"><p className="text-[11px] font-bold uppercase text-[#6B7280]">Maximum price meeting target</p><p className="text-xl font-extrabold text-[#111827]">{displayMoney(reverseScenario.maxPurchasePrice)}</p><p className="mt-1 text-[10px] text-[#6B7280]">After explicit costs, rehab, and target profit.</p></div>
            <div className="rounded-xl border border-[#E5E7EB] bg-[#F8FAFC] p-3"><p className="text-[11px] font-bold uppercase text-[#6B7280]">Change needed at opening amount</p><p className="text-xl font-extrabold text-[#111827]">{displayMoney(reverseScenario.priceReductionNeeded)}</p><p className="mt-1 text-[10px] text-[#6B7280]">Required price reduction if costs stay unchanged.</p></div>
            <div className="rounded-xl border border-[#E5E7EB] bg-[#F8FAFC] p-3 sm:col-span-2">
              <p className="text-[11px] font-bold uppercase text-[#6B7280]">Cost alternative</p>
              <p className="mt-1 text-sm font-bold text-[#111827]">At the opening amount, other acquisition costs may total at most {displayMoney(reverseScenario.maxOtherAcquisitionCostsAtCurrentPrice)}.</p>
              <p className="mt-1 text-xs text-[#6B7280]">Required cost reduction: {displayMoney(reverseScenario.costReductionNeeded)}. Registration funds and a credited deposit affect timing and liquidity; a credited deposit is not counted twice.</p>
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
          <button disabled={!reverseScenario || loadingStrategy} onClick={handleRunAiStrategy} className="rounded-lg bg-[#0F172A] px-2.5 py-1 text-[11px] font-bold text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40">{aiStrategy ? "Explain again" : "Explain math"}</button>
        </div>
        {loadingStrategy && <p className="animate-pulse text-xs text-slate-500">Checking the entered scenario...</p>}
        {aiStrategy && <div className="whitespace-pre-line border-t border-slate-200 pt-2 text-xs leading-relaxed text-slate-700">{aiStrategy}</div>}
      </div>
    </div>
  );
}
