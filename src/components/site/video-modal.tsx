"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import {
  X,
  CheckCircle2,
  ShieldAlert,
  Sparkles,
  FileText,
  Scale,
  Calculator,
  ArrowRight,
  ArrowLeft,
  ExternalLink,
  AlertTriangle,
  FileSearch,
  BadgeCheck,
} from "lucide-react";
import { sourceDisplayText } from "@/lib/source-display";
import { bandForScore } from "@/lib/score-bands";

interface VideoModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type WalkthroughScenario = {
  id: string;
  source: string;
  address: string;
  county: string;
  state: string;
  openingBid: number;
  estMid: number;
  dealScore: number;
  saleDate: string;
  docket: string;
  plaintiff: string;
  defendant: string;
  depositRule: string;
  depositAmount: number;
  redemptionWindow: string;
  titleRule: string;
  cashToClose: number;
  rawExcerpt: string;
};

const SCENARIOS: WalkthroughScenario[] = [
  {
    id: "HUD-412-652610",
    source: "hud",
    address: "3465 E 128th St, Cleveland, OH 44120",
    county: "Cuyahoga",
    state: "OH",
    openingBid: 42000,
    estMid: 98000,
    dealScore: 74,
    saleDate: "2026-11-12",
    docket: "CV-24-991204",
    plaintiff: "US Department of Housing & Urban Development",
    defendant: "Estate of Miller, et al.",
    depositRule: "10% certified funds wire at bid fall; balance in 30 days",
    depositAmount: 4200,
    redemptionWindow: "0 days post-confirmation (Ohio ORC § 2329.33 cut off at order)",
    titleRule: "First mortgage foreclosure; junior judgments extinguished upon confirmation",
    cashToClose: 44150,
    rawExcerpt: "IN THE COURT OF COMMON PLEAS, CUYAHOGA COUNTY, OHIO. CASE NO. CV-24-991204. Notice is hereby given that pursuant to an Order of Sale, the Sheriff will offer for sale at public auction the premises commonly known as 3465 E 128th St, Cleveland, OH 44120. Statutory upset appraisal floor: $42,000. Terms: 10% down by certified check or bank wire immediately upon fall of gavel.",
  },
  {
    id: "TRSY-27-66-110",
    source: "treasury",
    address: "16653 SE 19th Court, Summerfield, FL 34491",
    county: "Marion",
    state: "FL",
    openingBid: 80000,
    estMid: 195000,
    dealScore: 77,
    saleDate: "2026-11-20",
    docket: "TREAS-DISPO-2026-FL-110",
    plaintiff: "U.S. Department of the Treasury (CVM)",
    defendant: "Seized Asset Dispositions Branch",
    depositRule: "$5,000 cashier check registration deposit required before bidding",
    depositAmount: 5000,
    redemptionWindow: "None (Federal government administrative forfeiture deed)",
    titleRule: "Special Warranty Deed conveyances; buyer responsible for recording documentary stamps",
    cashToClose: 81200,
    rawExcerpt: "U.S. DEPARTMENT OF THE TREASURY REAL PROPERTY DISPOSITION NOTICE. CVM AUCTION CONTRACT #27-66-110. Single family residential parcel located at 16653 SE 19th Court, Summerfield, FL 34491. Opening bid minimum: $80,000. Bidder deposit of $5,000 cashier check required prior to issuance of paddle. Closing within 45 calendar days. Sold AS-IS WHERE-IS with all faults.",
  },
  {
    id: "TRSY-26-66-189",
    source: "treasury",
    address: "112 North Avenue E, Bruni, TX 78344",
    county: "Webb",
    state: "TX",
    openingBid: 10000,
    estMid: 38000,
    dealScore: 96,
    saleDate: "2026-12-05",
    docket: "TREAS-DISPO-2026-TX-189",
    plaintiff: "Internal Revenue Service / US Marshals Service",
    defendant: "Federal Asset Forfeiture Action",
    depositRule: "$2,500 guaranteed earnest deposit upon acceptance",
    depositAmount: 2500,
    redemptionWindow: "180 days statutory IRS right of redemption (26 U.S.C. § 7325)",
    titleRule: "Federal tax lien sale; subject to 180-day redemption interest at 6% per annum",
    cashToClose: 10850,
    rawExcerpt: "PUBLIC AUCTION NOTICE — UNITED STATES MARSHALS SERVICE & TREASURY. Real property at 112 North Avenue E, Bruni, Texas 78344. Opening minimum auction bid: $10,000. Under 26 U.S.C. Section 7325 statutory provisions, property is sold subject to statutory right of redemption within 180 calendar days from date of confirmation. Earnest deposit $2,500.",
  },
];

const STAGES = [
  { id: 0, label: "1. Find the sale", icon: FileText, desc: "The sale notice as published" },
  { id: 1, label: "2. Read the fine print", icon: FileSearch, desc: "Who is selling, the case number and the deposit" },
  { id: 2, label: "3. Read the catch", icon: Scale, desc: "The redemption period and liens to check" },
  { id: 3, label: "4. Run your numbers", icon: Calculator, desc: "Cash to close and the Deal Score" },
];

function formatCurrency(val: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(val);
}

export function VideoModal({ isOpen, onClose }: VideoModalProps) {
  const [scenarioIndex, setScenarioIndex] = useState(0);
  const [currentStage, setCurrentStage] = useState(0);
  const dialogRef = React.useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const dialog = dialogRef.current;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    dialog?.querySelector<HTMLElement>("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])")?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === "Tab" && dialog) {
        const focusable = Array.from(
          dialog.querySelectorAll<HTMLElement>(
            'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'
          )
        );
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
      if (previousFocus && document.contains(previousFocus)) {
        previousFocus.focus();
      }
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const current = SCENARIOS[scenarioIndex] || SCENARIOS[0];

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto bg-black/60 backdrop-blur-md p-3 sm:p-6 flex items-center justify-center animate-in fade-in"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="walkthrough-title"
        className="w-full max-w-4xl bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col my-auto"
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 bg-white">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-xl bg-emerald-100 flex items-center justify-center text-emerald-800">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <h3 id="walkthrough-title" className="text-base font-bold text-slate-950">
                Sample listing
              </h3>
              <p className="text-xs text-slate-500">
                A sample walk-through of how a sale notice becomes a listing with a Deal Score. The listing below is an example.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close walkthrough"
            className="p-2 rounded-xl text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scenario Selector */}
        <div className="px-6 py-3 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 text-xs">
          <span className="font-semibold text-slate-600">Pick a sample listing:</span>
          <div className="flex flex-wrap gap-1.5">
            {SCENARIOS.map((sc, idx) => (
              <button
                key={sc.id}
                type="button"
                onClick={() => {
                  setScenarioIndex(idx);
                  setCurrentStage(0);
                }}
                className={`px-3 py-1.5 rounded-lg font-medium transition ${
                  scenarioIndex === idx
                    ? "bg-slate-900 text-white font-bold"
                    : "bg-white border border-slate-200 text-slate-700 hover:bg-slate-100"
                }`}
              >
                {sc.state} — {sourceDisplayText(sc.source)} ({sc.id})
              </button>
            ))}
          </div>
        </div>

        {/* Stage Progress Tabs */}
        <div className="px-6 py-3 bg-white border-b border-slate-200 overflow-x-auto">
          <div className="flex items-center gap-2 min-w-[580px]">
            {STAGES.map((stg) => {
              const Icon = stg.icon;
              const isActive = currentStage === stg.id;
              const isPast = currentStage > stg.id;
              return (
                <button
                  key={stg.id}
                  type="button"
                  onClick={() => setCurrentStage(stg.id)}
                  className={`flex-1 flex items-center gap-2 p-2.5 rounded-xl border text-left transition ${
                    isActive
                      ? "border-emerald-600 bg-emerald-50/70 text-emerald-950 font-bold"
                      : isPast
                      ? "border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100"
                      : "border-slate-200 text-slate-400 hover:text-slate-600"
                  }`}
                >
                  <div
                    className={`h-6 w-6 rounded-lg flex items-center justify-center shrink-0 text-xs font-bold ${
                      isActive
                        ? "bg-emerald-600 text-white"
                        : isPast
                        ? "bg-emerald-100 text-emerald-800"
                        : "bg-slate-100 text-slate-500"
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                  </div>
                  <div className="truncate">
                    <span className="block text-xs leading-none">{stg.label}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Walkthrough Content Canvas */}
        <div className="p-6 bg-[#F8FAFC] space-y-5">
          {/* Stage 0: Raw Notice */}
          {currentStage === 0 && (
            <div className="space-y-4">
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-emerald-800 bg-emerald-50 px-2.5 py-1 rounded-md border border-emerald-200">
                    Step 1: Find the sale
                  </span>
                  <span className="text-xs font-mono text-slate-500">Source: {sourceDisplayText(current.source)}</span>
                </div>
                <h4 className="text-lg font-bold text-slate-900">{current.address}</h4>
                <div className="p-4 rounded-xl bg-slate-950 text-slate-200 font-mono text-xs leading-relaxed border border-slate-800">
                  <p className="text-emerald-400 font-bold mb-2">// Sample sale notice text</p>
                  <p>{current.rawExcerpt}</p>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs pt-2">
                  <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                    <span className="text-slate-500 block">County / State</span>
                    <strong className="text-slate-950 font-bold">{current.county}, {current.state}</strong>
                  </div>
                  <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                    <span className="text-slate-500 block">Opening bid</span>
                    <strong className="text-slate-950 font-bold">{formatCurrency(current.openingBid)}</strong>
                  </div>
                  <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                    <span className="text-slate-500 block">Sale Date</span>
                    <strong className="text-slate-950 font-bold">{current.saleDate}</strong>
                  </div>
                  <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                    <span className="text-slate-500 block">Sample ID</span>
                    <strong className="text-slate-950 font-bold font-mono">{current.id}</strong>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Stage 1: Fine-Print Legal Extraction */}
          {currentStage === 1 && (
            <div className="space-y-4">
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-emerald-800 bg-emerald-50 px-2.5 py-1 rounded-md border border-emerald-200">
                    Step 2: Read the fine print
                  </span>
                  <span className="text-xs text-slate-500 font-mono">Case: {current.docket}</span>
                </div>
                <div className="grid sm:grid-cols-2 gap-4">
                  <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-2">
                    <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Case number</p>
                    <p className="text-sm font-bold text-slate-950 font-mono">{current.docket}</p>
                    <p className="text-xs text-slate-600">Case number from the notice.</p>
                  </div>
                  <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-2">
                    <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Who is selling</p>
                    <p className="text-sm font-bold text-slate-950">{current.plaintiff}</p>
                    <p className="text-xs text-slate-600">The lender or government agency behind the sale.</p>
                  </div>
                  <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-2">
                    <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Current owner</p>
                    <p className="text-sm font-bold text-slate-950">{current.defendant}</p>
                    <p className="text-xs text-slate-600">The owner named in the notice.</p>
                  </div>
                  <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-2">
                    <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Deposit</p>
                    <p className="text-sm font-bold text-slate-950">{current.depositRule}</p>
                    <p className="text-xs text-emerald-700 font-semibold">Cash due right away: {formatCurrency(current.depositAmount)}</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Stage 2: Title & Cadastral Risk */}
          {currentStage === 2 && (
            <div className="space-y-4">
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-amber-800 bg-amber-50 px-2.5 py-1 rounded-md border border-amber-200">
                    Step 3: Read the catch
                  </span>
                  <span className="text-xs font-semibold text-slate-500">Sample</span>
                </div>
                <div className="space-y-3">
                  <div className="p-4 rounded-xl border border-amber-200 bg-amber-50/50 space-y-1.5">
                    <p className="flex items-center gap-2 text-xs font-bold text-amber-950 uppercase tracking-wider">
                      <AlertTriangle className="w-4 h-4 text-amber-600" />
                      Redemption period
                    </p>
                    <p className="text-sm font-semibold text-slate-900">{current.redemptionWindow}</p>
                    <p className="text-xs text-slate-600">
                      How long the former owner may have to buy the property back after the sale.
                    </p>
                  </div>

                  <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-1.5">
                    <p className="flex items-center gap-2 text-xs font-bold text-slate-900 uppercase tracking-wider">
                      <Scale className="w-4 h-4 text-slate-700" />
                      Liens to check
                    </p>
                    <p className="text-sm font-semibold text-slate-900">{current.titleRule}</p>
                    <p className="text-xs text-slate-600">
                      Some liens, such as IRS tax debts or city utility charges, can stay with the property after the sale. Check them before you bid.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Stage 3: Modeled Cash-to-Close & Triage */}
          {currentStage === 3 && (
            <div className="space-y-4">
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-emerald-800 bg-emerald-50 px-2.5 py-1 rounded-md border border-emerald-200">
                    Step 4: Run your numbers
                  </span>
                  {(() => {
                    const scoreBand = bandForScore(current.dealScore);
                    return (
                      <div
                        className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full font-bold text-xs"
                        style={
                          scoreBand
                            ? { backgroundColor: `${scoreBand.color}${scoreBand.alpha}`, color: scoreBand.color }
                            : { backgroundColor: "#F1F5F9", color: "#475569" }
                        }
                      >
                        <BadgeCheck className="w-4 h-4" />
                        Deal Score: {current.dealScore} / 99{scoreBand ? ` (${scoreBand.label})` : ""}
                      </div>
                    );
                  })()}
                </div>

                <div className="grid sm:grid-cols-3 gap-3">
                  <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 text-center">
                    <span className="text-xs text-slate-500 font-semibold block">Opening bid</span>
                    <strong className="text-xl font-bold text-slate-950">{formatCurrency(current.openingBid)}</strong>
                  </div>
                  <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 text-center">
                    <span className="text-xs text-slate-500 font-semibold block">Middle of value range</span>
                    <strong className="text-xl font-bold text-slate-950">{formatCurrency(current.estMid)}</strong>
                  </div>
                  <div className="p-4 bg-emerald-50 rounded-xl border border-emerald-200 text-center">
                    <span className="text-xs text-emerald-800 font-semibold block">Estimated cash to close</span>
                    <strong className="text-xl font-bold text-emerald-950">{formatCurrency(current.cashToClose)}</strong>
                  </div>
                </div>

                <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 text-xs leading-relaxed space-y-2 text-slate-700">
                  <p className="font-bold text-slate-900">How the Deal Score is worked out:</p>
                  <p>
                    Deal Score {current.dealScore} compares the opening bid ({formatCurrency(current.openingBid)}) to the middle of the value range ({formatCurrency(current.estMid)}). Always check title and liens before you bid.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer Navigation */}
        <div className="px-6 py-4 bg-white border-t border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={currentStage === 0}
              onClick={() => setCurrentStage((s) => Math.max(0, s - 1))}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-40 transition"
            >
              <ArrowLeft className="w-3.5 h-3.5" /> Previous step
            </button>
            {currentStage < STAGES.length - 1 ? (
              <button
                type="button"
                onClick={() => setCurrentStage((s) => Math.min(STAGES.length - 1, s + 1))}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-bold hover:bg-slate-800 transition"
              >
                Next step <ArrowRight className="w-3.5 h-3.5" />
              </button>
            ) : null}
          </div>

          <div className="flex items-center gap-3">
            <Link
              href={`/listings/${encodeURIComponent(current.id)}`}
              onClick={onClose}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-700 text-white text-xs font-bold hover:bg-emerald-800 transition"
            >
              Open sample listing <ExternalLink className="w-3.5 h-3.5" />
            </Link>
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl border border-slate-200 text-slate-600 text-xs font-semibold hover:bg-slate-50 transition"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
