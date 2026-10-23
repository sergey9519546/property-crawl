"use client";

import React, { useEffect, useState } from "react";
import type { Listing } from "@/data/listings";
import {
  computeStatutoryFeePreset,
  computeStatutoryDeadlinesAndCarry,
  computeLienWaterfall,
  type LienWaterfallResult,
} from "@/lib/underwriting";
import { displayMoney, positiveNumber } from "@/lib/listing-display";
import {
  CheckCircle2,
  AlertTriangle,
  ShieldAlert,
  Clock,
  Printer,
  ChevronDown,
  ChevronUp,
  FileCheck2,
  Landmark,
  Scale,
  DollarSign,
  Users,
} from "lucide-react";

interface DueDiligenceChecklistProps {
  listing: Listing;
  className?: string;
}

type CheckStatus = "verified" | "flagged" | "pending";

interface CheckItem {
  id: string;
  category: string;
  title: string;
  statutoryRule: string;
  detectedFinding: string;
  actionRequired: string;
  defaultStatus: CheckStatus;
}

export function DueDiligenceChecklist({ listing, className = "" }: DueDiligenceChecklistProps) {
  const openingBid = positiveNumber(listing.openingBid) ?? 0;
  const stateCode = (listing.state || "US").toUpperCase();

  // 1. Detect statutory presets and carry deadlines
  const feePreset = computeStatutoryFeePreset({
    purchasePrice: openingBid,
    state: stateCode,
    source: listing.source,
    depositText: typeof listing.deposit === "string" ? listing.deposit : null,
  });

  const hasIrsNoticeFlag =
    listing.source === "irs" ||
    /(?:internal\s*revenue|federal\s*tax\s*lien|26\s*u\.?s\.?c\.?\s*§?\s*7425)/i.test(
      `${listing.seniorLienWarning || ""} ${listing.redemptionWarning || ""}`
    );

  const deadlines = computeStatutoryDeadlinesAndCarry({
    saleDate: listing.saleDate,
    state: stateCode,
    purchasePrice: openingBid,
    redemptionDays: typeof listing.redemptionDays === "number" ? listing.redemptionDays : null,
    hasIrsLien: hasIrsNoticeFlag,
  });

  // 2. Foreclosure type detection
  const isSeniorLienRisk = /(?:junior|second|2nd|heloc|hoa|subordinate)/i.test(
    `${listing.seniorLienRisk || ""} ${listing.seniorLienWarning || ""}`
  );
  const detectedForeclosingType: "first_mortgage" | "second_mortgage" | "heloc" | "hoa_assessment" | "tax_deed" =
    /(?:hoa|homeowners\s*assoc)/i.test(`${listing.seniorLienWarning || ""}`)
      ? "hoa_assessment"
      : /(?:heloc|equity\s*line)/i.test(`${listing.seniorLienWarning || ""}`)
      ? "heloc"
      : /(?:second|2nd)/i.test(`${listing.seniorLienWarning || ""}`)
      ? "second_mortgage"
      : listing.source === "irs" || /(?:tax\s*collector|tax\s*deed)/i.test(`${listing.source || ""}`)
      ? "tax_deed"
      : "first_mortgage";

  // 3. Waterfall Simulation state
  const [waterfallBid, setWaterfallBid] = useState<number>(openingBid > 0 ? openingBid : 100_000);
  const [waterfallLienType, setWaterfallLienType] = useState<
    "first_mortgage" | "second_mortgage" | "heloc" | "hoa_assessment" | "tax_deed"
  >(detectedForeclosingType);
  const [waterfallSeniorMtg, setWaterfallSeniorMtg] = useState<number>(isSeniorLienRisk ? 150_000 : 0);
  const [waterfallTaxes, setWaterfallTaxes] = useState<number>(3_500);
  const [showWaterfallDetails, setShowWaterfallDetails] = useState<boolean>(isSeniorLienRisk);

  // 4. Verification Checklist Items
  const initialItems: CheckItem[] = [
    {
      id: "check-1-senior-lien",
      category: "Title & Priority",
      title: "Senior Deed of Trust / 1st Mortgage Survival",
      statutoryRule: "Common law lien priority: Foreclosure of a junior deed (2nd mortgage, HELOC, or HOA) leaves senior 1st mortgage in full effect against purchaser.",
      detectedFinding: isSeniorLienRisk
        ? `FLAGGED: Junior lien signals detected (${listing.seniorLienWarning || "Possible subordinate mortgage"}). Senior mortgage may survive!`
        : "Standard First Mortgage Foreclosure: Noticed senior mortgage foreclosure extinguishes subordinate liens.",
      actionRequired: "Examine County Recorder grantor/grantee index and Title Commitment Schedule B to verify deed recording date and priority position.",
      defaultStatus: isSeniorLienRisk ? "flagged" : "verified",
    },
    {
      id: "check-2-ad-valorem-taxes",
      category: "Municipal Liens",
      title: "Ad Valorem County/Municipal Real Property Taxes",
      statutoryRule: "State constitutional tax super-priority: Real property ad valorem taxes prime all private mortgages and survive mortgage foreclosure.",
      detectedFinding: `County property taxes in ${listing.county || "county"}, ${stateCode}: Buyer is responsible for delinquent property taxes not satisfied by auction distribution.`,
      actionRequired: "Contact County Treasurer/Tax Collector for exact delinquent ad valorem balance plus penalties through sale month.",
      defaultStatus: "pending",
    },
    {
      id: "check-3-irs-lien",
      category: "Federal Tax Liens",
      title: "IRS 120-Day Super-Priority Right of Redemption (26 U.S.C. § 7425)",
      statutoryRule: "26 U.S.C. § 7425(d): If a federal tax lien is divested by foreclosure, the United States holds a 120-day post-sale right of redemption.",
      detectedFinding: hasIrsNoticeFlag
        ? `IRS FEDERAL TAX LIEN DETECTED: 120-day redemption window locks title until ${deadlines.irsRedemptionDeadline || "120 days post-sale"}. Modeled carry: ${displayMoney(deadlines.estimatedCarryCost)}.`
        : "No IRS Notice Phrase: No federal tax lien citations identified in published legal notice.",
      actionRequired: "Check County Recorder judgment docket for recorded Federal Tax Liens against the defendant/borrower.",
      defaultStatus: hasIrsNoticeFlag ? "flagged" : "verified",
    },
    {
      id: "check-4-statutory-redemption",
      category: "Redemption & Confirmation",
      title: "State Statutory Redemption & Court Confirmation Window",
      statutoryRule: `${deadlines.objectionLabel || "State confirmation/objection window"}. Debtor statutory redemption or upset bid rights prevent immediate title vesting.`,
      detectedFinding: `${deadlines.effectiveLockupDays}-day statutory holding lockup. Capital is frozen during this period. Modeled capital carry: ${displayMoney(deadlines.estimatedCarryCost)}.`,
      actionRequired: "Confirm with clerk of court whether debtor has filed an objection, bankruptcy, or intent to upset bid.",
      defaultStatus: deadlines.effectiveLockupDays > 0 ? "flagged" : "verified",
    },
    {
      id: "check-5-bankruptcy-stay",
      category: "Federal Bankruptcy",
      title: "Automatic Bankruptcy Stay Verification (11 U.S.C. § 362)",
      statutoryRule: "11 U.S.C. § 362(a): A bankruptcy filing by the debtor prior to the auction gavel drop makes the foreclosure sale VOID ab initio.",
      detectedFinding: "PACER / Bankruptcy Court Verification required morning of auction. A last-minute Chapter 13 filing voids the transaction.",
      actionRequired: "Search PACER / CourtListener for debtor name and SSN last 4 digits at 8:30 AM on auction morning.",
      defaultStatus: "pending",
    },
    {
      id: "check-6-cash-settlement",
      category: "Auction Execution",
      title: "Certified Funds Deposit & Settlement Protocol",
      statutoryRule: feePreset ? feePreset.scheduleLabel : "Court cashier's check deposit requirements.",
      detectedFinding: feePreset
        ? `Deposit requirement: ${displayMoney(feePreset.creditedDeposit)} (${feePreset.citations[0] || "Statutory deposit"}). Balance deadline per local court rules.`
        : "Certified cashier's check required at hammer strike; failure to tender remaining balance results in deposit forfeiture.",
      actionRequired: "Obtain bank cashier's checks in exact payable denominations to sheriff / referee / trustee prior to auction.",
      defaultStatus: "pending",
    },
    {
      id: "check-7-occupancy-ptfa",
      category: "Possession & Occupancy",
      title: "Occupancy & Protecting Tenants at Foreclosure Act (PTFA)",
      statutoryRule: "12 U.S.C. § 5220 (PTFA): Bona fide residential tenants are entitled to a minimum 90-day notice to vacate or lease term fulfillment.",
      detectedFinding: listing.occupancy
        ? `Reported occupancy: "${listing.occupancy}". Eviction proceedings require separate post-sale writ of possession.`
        : "Occupancy status not published in source record. Physical drive-by or exterior reconnaissance required.",
      actionRequired: "Perform drive-by visual inspection to confirm occupancy, active utilities, and post-sale holdover eviction timeline.",
      defaultStatus: "pending",
    },
  ];

  // Load custom checklist status from localStorage
  const storageKey = `due-diligence-${listing.id}`;
  const [itemStatuses, setItemStatuses] = useState<Record<string, CheckStatus>>(() => {
    return Object.fromEntries(initialItems.map((item) => [item.id, item.defaultStatus]));
  });

  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === "object") {
          setItemStatuses((prev) => ({ ...prev, ...parsed }));
        }
      }
    } catch {
      // Local storage unavailable in SSR or private mode
    }
  }, [storageKey]);

  const setStatus = (id: string, status: CheckStatus) => {
    const next = { ...itemStatuses, [id]: status };
    setItemStatuses(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      // Ignore storage errors
    }
  };

  // Compute waterfall
  const waterfallResult: LienWaterfallResult = computeLienWaterfall({
    winningBid: waterfallBid,
    foreclosingLienType: waterfallLienType,
    foreclosingLienAmount: waterfallBid,
    delinquentTaxesAmount: waterfallTaxes,
    seniorMortgageAmount: waterfallSeniorMtg,
    state: stateCode,
  });

  const verifiedCount = Object.values(itemStatuses).filter((s) => s === "verified").length;
  const flaggedCount = Object.values(itemStatuses).filter((s) => s === "flagged").length;
  const pendingCount = Object.values(itemStatuses).filter((s) => s === "pending").length;

  return (
    <section
      id="due-diligence-binder"
      className={`rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6 print:border-none print:p-0 print:shadow-none ${className}`}
      aria-labelledby="due-diligence-heading"
    >
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 pb-5">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-slate-900 p-2 text-white">
            <Scale className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="rounded bg-sky-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-sky-700 border border-sky-200">
                Courthouse Underwriting Binder
              </span>
              <span className="text-xs text-slate-400">·</span>
              <span className="text-xs text-slate-500 font-medium">7 Deal-Killer Audit Matrix</span>
            </div>
            <h2 id="due-diligence-heading" className="mt-1 text-xl font-bold tracking-tight text-slate-950">
              Statutory Due Diligence & Lien Waterfall
            </h2>
            <p className="mt-0.5 text-xs text-slate-600">
              Automated legal risk elimination before tendering cashier&apos;s checks at courthouse auction.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 print:hidden">
          <button
            onClick={() => window.print()}
            type="button"
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 hover:text-slate-950"
          >
            <Printer className="h-3.5 w-3.5 text-slate-600" />
            Print Bidding Binder
          </button>
        </div>
      </div>

      {/* Triage Status Pills */}
      <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs sm:gap-4">
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-3">
          <span className="text-[11px] font-semibold text-emerald-800">Clear / Verified</span>
          <p className="mt-0.5 text-lg font-black text-emerald-950">{verifiedCount} of 7</p>
        </div>
        <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3">
          <span className="text-[11px] font-semibold text-amber-800">Flagged Risk Items</span>
          <p className="mt-0.5 text-lg font-black text-amber-950">{flaggedCount}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
          <span className="text-[11px] font-semibold text-slate-600">Pending Verification</span>
          <p className="mt-0.5 text-lg font-black text-slate-950">{pendingCount}</p>
        </div>
      </div>

      {/* Critical Foreclosure Trap Banner */}
      {isSeniorLienRisk && (
        <div className="mt-5 rounded-xl border border-rose-300 bg-rose-50 p-4 text-rose-950">
          <div className="flex items-start gap-3">
            <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-rose-600" />
            <div className="space-y-1 text-xs">
              <h3 className="font-bold text-sm text-rose-900">
                CRITICAL WARNING: Junior Mortgage / HOA Foreclosure Signal
              </h3>
              <p className="leading-relaxed">
                Source notices indicate this auction is prosecuted by a subordinate lienholder (
                {listing.seniorLienWarning || "junior deed or assessment"}). Under state foreclosure law, the senior first mortgage
                does NOT wipe out; it survives against the auction winner!
              </p>
              <p className="font-semibold text-rose-950">
                Do not bid based on opening bid alone. Simulate the surviving senior mortgage below.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* 7 Deal-Killer Checklist */}
      <div className="mt-6 space-y-3">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
          The 7 Statutory Deal-Killer Checkpoints
        </h3>
        <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white shadow-xs">
          {initialItems.map((item) => {
            const status = itemStatuses[item.id] || item.defaultStatus;
            return (
              <div key={item.id} className="p-4 transition hover:bg-slate-50/50">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1 flex-1 min-w-[240px]">
                    <div className="flex items-center gap-2">
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">
                        {item.category}
                      </span>
                      <h4 className="text-sm font-bold text-slate-950">{item.title}</h4>
                    </div>
                    <p className="text-xs text-slate-600 leading-relaxed font-medium">
                      {item.detectedFinding}
                    </p>
                    <p className="text-[11px] text-slate-500 leading-relaxed">
                      <strong>Statutory Basis:</strong> {item.statutoryRule}
                    </p>
                    <p className="text-[11px] text-sky-900 font-semibold leading-relaxed">
                      <strong>Action:</strong> {item.actionRequired}
                    </p>
                  </div>

                  {/* Status Toggle Buttons */}
                  <div className="flex items-center gap-1.5 self-start print:hidden">
                    <button
                      type="button"
                      onClick={() => setStatus(item.id, "verified")}
                      className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                        status === "verified"
                          ? "bg-emerald-600 text-white shadow-xs"
                          : "border border-slate-200 bg-white text-slate-600 hover:bg-emerald-50 hover:text-emerald-800"
                      }`}
                    >
                      ✓ Verified
                    </button>
                    <button
                      type="button"
                      onClick={() => setStatus(item.id, "flagged")}
                      className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                        status === "flagged"
                          ? "bg-amber-600 text-white shadow-xs"
                          : "border border-slate-200 bg-white text-slate-600 hover:bg-amber-50 hover:text-amber-800"
                      }`}
                    >
                      ⚠ Risk Flag
                    </button>
                    <button
                      type="button"
                      onClick={() => setStatus(item.id, "pending")}
                      className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                        status === "pending"
                          ? "bg-slate-700 text-white shadow-xs"
                          : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-100"
                      }`}
                    >
                      Pending
                    </button>
                  </div>

                  {/* Print Status Display */}
                  <div className="hidden print:block text-xs font-bold uppercase">
                    Status: {status.toUpperCase()}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Interactive Lien Waterfall & Surplus Simulator */}
      <div className="mt-8 rounded-2xl border border-slate-200 bg-slate-50/70 p-5 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200/80 pb-3">
          <div className="flex items-center gap-2">
            <Landmark className="h-4 w-4 text-slate-800" />
            <h3 className="text-sm font-bold text-slate-950">
              Interactive Lien Waterfall & Surplus Proceeds Simulator
            </h3>
          </div>
          <button
            type="button"
            onClick={() => setShowWaterfallDetails(!showWaterfallDetails)}
            className="flex items-center gap-1 text-xs font-semibold text-slate-600 hover:text-slate-950"
          >
            {showWaterfallDetails ? "Collapse Controls" : "Adjust Lien Assumptions"}
            {showWaterfallDetails ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
        </div>

        {/* Inputs */}
        {showWaterfallDetails && (
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 text-xs font-medium text-slate-700">
            <label className="space-y-1">
              <span>Simulated Winning Bid ($)</span>
              <input
                type="number"
                min="0"
                step="1000"
                value={waterfallBid}
                onChange={(e) => setWaterfallBid(Math.max(0, Number(e.target.value) || 0))}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-950 shadow-xs focus:border-slate-900 focus:outline-hidden"
              />
            </label>
            <label className="space-y-1">
              <span>Foreclosing Lien Type</span>
              <select
                value={waterfallLienType}
                onChange={(e) => setWaterfallLienType(e.target.value as any)}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-950 shadow-xs focus:border-slate-900 focus:outline-hidden"
              >
                <option value="first_mortgage">1st Mortgage (Senior Deed)</option>
                <option value="second_mortgage">2nd Mortgage (Subordinate)</option>
                <option value="heloc">HELOC / Equity Line</option>
                <option value="hoa_assessment">HOA Assessment Lien</option>
                <option value="tax_deed">County Tax Collector Deed</option>
              </select>
            </label>
            <label className="space-y-1">
              <span>Surviving Senior Mortgage ($)</span>
              <input
                type="number"
                min="0"
                step="5000"
                value={waterfallSeniorMtg}
                onChange={(e) => setWaterfallSeniorMtg(Math.max(0, Number(e.target.value) || 0))}
                placeholder="0 if 1st mtg foreclosing"
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-950 shadow-xs focus:border-slate-900 focus:outline-hidden"
              />
            </label>
            <label className="space-y-1">
              <span>Delinquent Real Property Taxes ($)</span>
              <input
                type="number"
                min="0"
                step="500"
                value={waterfallTaxes}
                onChange={(e) => setWaterfallTaxes(Math.max(0, Number(e.target.value) || 0))}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-950 shadow-xs focus:border-slate-900 focus:outline-hidden"
              />
            </label>
          </div>
        )}

        {/* Waterfall Calculation Summary Cards */}
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-xs">
            <span className="text-[11px] font-semibold text-slate-500">Your Winning Bid</span>
            <p className="mt-0.5 text-lg font-black text-slate-950">{displayMoney(waterfallBid)}</p>
            <span className="text-[10px] text-slate-500">Knock-down price at auction</span>
          </div>

          <div
            className={`rounded-xl border p-3 shadow-xs ${
              waterfallResult.totalSurvivingDebtOnProperty > 0
                ? "border-rose-200 bg-rose-50"
                : "border-emerald-200 bg-emerald-50"
            }`}
          >
            <span
              className={`text-[11px] font-semibold ${
                waterfallResult.totalSurvivingDebtOnProperty > 0 ? "text-rose-800" : "text-emerald-800"
              }`}
            >
              Surviving Priority Debt
            </span>
            <p
              className={`mt-0.5 text-lg font-black ${
                waterfallResult.totalSurvivingDebtOnProperty > 0 ? "text-rose-950" : "text-emerald-950"
              }`}
            >
              {displayMoney(waterfallResult.totalSurvivingDebtOnProperty)}
            </p>
            <span
              className={`text-[10px] ${
                waterfallResult.totalSurvivingDebtOnProperty > 0 ? "text-rose-700" : "text-emerald-700"
              }`}
            >
              {waterfallResult.totalSurvivingDebtOnProperty > 0
                ? "Buyer must satisfy this senior debt!"
                : "Zero surviving priority liens"}
            </span>
          </div>

          <div className="rounded-xl border border-slate-900 bg-slate-900 p-3 text-white shadow-xs">
            <span className="text-[11px] font-semibold text-slate-300">True Effective Cost</span>
            <p className="mt-0.5 text-lg font-black text-emerald-400">
              {displayMoney(waterfallResult.totalEffectiveAcquisitionCost)}
            </p>
            <span className="text-[10px] text-slate-400">Bid + surviving mortgages & taxes</span>
          </div>
        </div>

        {/* Waterfall Breakdown Table */}
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500">
                <th className="py-2 pr-3 font-semibold">Priority Tier</th>
                <th className="py-2 pr-3 font-semibold">Lienholder / Instrument</th>
                <th className="py-2 pr-3 font-semibold text-right">Lien Amount</th>
                <th className="py-2 pr-3 font-semibold text-right">Paid From Bid</th>
                <th className="py-2 font-semibold text-right">Surviving Debt</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-medium">
              {waterfallResult.items.map((item) => (
                <tr key={item.id} className="text-slate-800">
                  <td className="py-2 pr-3">
                    <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-bold text-slate-800">
                      #{item.seniority}
                    </span>
                  </td>
                  <td className="py-2 pr-3 font-semibold text-slate-950">
                    {item.name}
                    {item.isForeclosingLien && (
                      <span className="ml-1.5 rounded bg-indigo-100 px-1 py-0.2 text-[9px] font-bold text-indigo-800">
                        Foreclosing
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-3 text-right">{displayMoney(item.amount)}</td>
                  <td className="py-2 pr-3 text-right font-semibold text-emerald-700">
                    {displayMoney(item.amountPaidFromProceeds)}
                  </td>
                  <td
                    className={`py-2 text-right font-bold ${
                      item.remainingBalanceAgainstProperty > 0 ? "text-rose-600" : "text-slate-400"
                    }`}
                  >
                    {item.remainingBalanceAgainstProperty > 0
                      ? displayMoney(item.remainingBalanceAgainstProperty)
                      : "EXTINGUISHED"}
                  </td>
                </tr>
              ))}
              {waterfallResult.surplusProceedsToBorrower > 0 && (
                <tr className="bg-sky-50/60 font-semibold text-sky-950">
                  <td className="py-2 pr-3 text-[10px] uppercase font-bold text-sky-800">Surplus</td>
                  <td className="py-2 pr-3" colSpan={2}>
                    Debtor / Mortgagor Surplus Proceeds
                  </td>
                  <td className="py-2 pr-3 text-right text-emerald-700">
                    {displayMoney(waterfallResult.surplusProceedsToBorrower)}
                  </td>
                  <td className="py-2 text-right text-slate-400">—</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <p className="mt-3 text-[11px] leading-relaxed text-slate-600 font-medium">
          {waterfallResult.summary}
        </p>
      </div>
    </section>
  );
}
