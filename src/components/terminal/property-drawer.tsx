"use client";

import { useEffect, useState } from "react";
import {
  X,
  Bookmark,
  ExternalLink,
  Sparkles,
  MapPin,
  Calendar,
  Box,
  FileText,
  ShieldCheck,
  ShieldAlert,
  Calculator,
  Scale,
  DollarSign,
  Clock,
  Home,
  CheckCircle2,
  AlertTriangle,
  ArrowUpRight,
  Download
} from "lucide-react";
import { Listing, SOURCES } from "@/data/listings";
import { cn } from "@/lib/utils";
import { Parcel3DVisualizer } from "./parcel-3d-visualizer";
import { BiddingSimulator } from "./bidding-simulator";
import { DealVideoGenerator } from "./deal-video-generator";
import { DocketAgent } from "./docket-agent";
import { PropertyIntelligence } from "@/components/listings/property-intelligence";
import { getExactSourceListingUrl } from "@/lib/listing-links";
import { displayDate, displayMoney, displayText, knownNumber, positiveNumber, safeImageUrl } from "@/lib/listing-display";
import { sourceDisplayText } from "@/lib/source-display";
import { computeCashToClose, computeCreMetrics, generateLetterOfIntent, generateInvestmentCommitteeMemo } from "@/lib/underwriting";
import type { CashAmountField, CashInputBasis } from "@/lib/underwriting";

interface PropertyDrawerProps {
  listing: Listing | null;
  onClose: () => void;
  isSaved: boolean;
  onToggleSave: (id: string) => void;
}

function explicitCashScenario(listing: Listing, openingBid: number | null) {
  if (openingBid === null || !listing.cashToCloseDetails || typeof listing.cashToCloseDetails !== "object") return null;
  const details = listing.cashToCloseDetails;
  if (details.model !== "explicit-cash-requirements-v2") return null;
  const rawBasis = details.basis && typeof details.basis === "object"
    ? details.basis as Record<string, unknown>
    : {};
  const basis = Object.fromEntries(
    Object.entries(rawBasis).filter((entry): entry is [string, CashInputBasis] => entry[1] === "published" || entry[1] === "assumption"),
  ) as Partial<Record<CashAmountField, CashInputBasis>>;
  return computeCashToClose({
    openingBid,
    purchasePrice: knownNumber(details.purchasePrice),
    registrationFunds: knownNumber(details.registrationFunds),
    creditedDeposit: knownNumber(details.creditedDeposit),
    buyersPremium: knownNumber(details.buyersPremium),
    sheriffPoundage: knownNumber(details.sheriffPoundage),
    transferTax: knownNumber(details.transferTax),
    delinquentTaxes: knownNumber(details.delinquentTaxes),
    settlementCosts: knownNumber(details.settlementCosts ?? details.deedPrepAndRecording),
    basis,
  });
}

export function PropertyDrawer({ listing, onClose, isSaved, onToggleSave }: PropertyDrawerProps) {
  const [activeTab, setActiveTab] = useState<"underwrite" | "3d" | "bidding">("underwrite");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiAnalysis, setAiAnalysis] = useState<string | null>(null);
  const [aiSource, setAiSource] = useState<string | null>(null);
  const [selectedPuterModel, setSelectedPuterModel] = useState<string>("claude-3-5-sonnet");
  const [generatingAiLoi, setGeneratingAiLoi] = useState<boolean>(false);
  const [generatingAiMemo, setGeneratingAiMemo] = useState<boolean>(false);

  useEffect(() => {
    if (!listing) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [listing, onClose]);

  if (!listing) return null;

  const source = SOURCES[listing.source] || {
    label: sourceDisplayText(listing.source),
    color: "#64748B",
    tier: 'Unrated',
    note: "Source not classified",
    websiteUrl: "#"
  };
  const exactSourceUrl = getExactSourceListingUrl(listing, source.websiteUrl);
  const openingBid = positiveNumber(listing.openingBid);
  const estLow = positiveNumber(listing.estLow);
  const estHigh = positiveNumber(listing.estHigh);
  const mid = positiveNumber(listing.mid);
  const sqft = positiveNumber(listing.sqft);
  const dealScore = knownNumber(listing.dealScore);
  const bidSpread = knownNumber(listing.equity);
  const photoUrl = safeImageUrl(listing.photo);

  const cashToClose = explicitCashScenario(listing, openingBid);

  const isCommercialOrMulti = (
    (listing.propType || "").toLowerCase().includes("commercial") ||
    (listing.propType || "").toLowerCase().includes("multi")
  );

  const creMetrics = isCommercialOrMulti && openingBid !== null && sqft !== null ? computeCreMetrics({
    sqft,
    openingBid,
    estimatedValue: mid ?? undefined,
    propType: listing.propType ?? undefined
  }) : null;

  const handleRunAi = async () => {
    setAiLoading(true);
    try {
      const response = await fetch('/api/enrich', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ listingId: listing.id }),
      });
      if (!response.ok) {
        throw new Error('Network response was not ok');
      }
      const data = await response.json();
      setAiAnalysis(data.analysis);
      setAiSource('backend');
    } catch (error) {
      console.error('Error fetching AI analysis:', error);
      setAiAnalysis('An error occurred while fetching the analysis.');
      setAiSource('backend');
    } finally {
      setAiLoading(false);
    }
  };

  const handleRunPuterAi = async () => {
    setAiLoading(true);
    if (typeof window !== "undefined" && (window as any).puter?.ai?.chat) {
      try {
        const prompt = `You are an institutional real estate underwriting AI analyzing a distressed foreclosure auction asset:
Address: ${listing.address}, ${listing.city}, ${listing.state} ${listing.zip}
Source Agency: ${sourceDisplayText(listing.source).toUpperCase()}
Opening Bid: ${displayMoney(listing.openingBid)}
Estimated Market Value: ${displayMoney(listing.estLow)} - ${displayMoney(listing.estHigh)} (Modeled deal score: ${dealScore ?? 'not available'})
Property Type: ${displayText(listing.propType)}
Deposit Terms: ${displayText(listing.deposit)}
Occupancy Status: ${listing.occupancy || 'Unknown'}
Foreclosing Plaintiff: ${listing.plaintiff || '—'}
Redemption evidence: ${listing.redemptionDays ? `${listing.redemptionDays} days (${listing.redemptionWarning || ''})` : 'Not published in the current record'}
Title-risk signal: ${listing.seniorLienRisk === 'high' ? 'Possible senior-lien risk; unverified' : 'No conclusive source evidence; official title work required'}

Use only the facts above. Treat every missing value as unknown and do not invent liens, title status, comps, condition, costs, or legal conclusions. Provide a rigorous 2-paragraph institutional deal breakdown:
Paragraph 1 - **Valuation Spread & Primary Catch**: Opening bid discount vs market value, deposit requirement, and immediate downside risks.
Paragraph 2 - **Title Caveats & Next Checks**: Statutory redemption delays, occupancy/eviction obstacles, senior lien status, and evidence required before the buyer sets a maximum price.`;

        const resp = await (window as any).puter.ai.chat(prompt, { model: selectedPuterModel });
        const text = typeof resp === 'string' ? resp : resp?.message?.content || resp?.toString();
        if (text && text.trim().length > 20) {
          setAiAnalysis(text);
          setAiSource(selectedPuterModel);
          setAiLoading(false);
          return;
        }
      } catch (err) {
        console.warn("Puter AI client fallback to backend:", err);
      }
    }
    await handleRunAi();
  };

  const handleDownloadLoi = () => {
    if (!listing || openingBid === null) {
      setAiAnalysis("A source-published opening amount is required before an LOI scenario can be generated.");
      return;
    }
    const text = generateLetterOfIntent(listing, { offerPrice: openingBid });
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `LOI-${listing.id}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleGenerateAiLoi = async () => {
    if (!listing || openingBid === null) {
      setAiAnalysis("A source-published opening amount is required before an LOI scenario can be generated.");
      return;
    }
    setGeneratingAiLoi(true);
    try {
      if (typeof window !== "undefined" && (window as any).puter?.ai?.chat) {
        const prompt = `You are a distressed asset acquisitions attorney drafting a formal Letter of Intent (LOI) to purchase an auction asset:
Property: ${listing.address}, ${listing.city}, ${listing.state} ${listing.zip}
Opening Bid: ${displayMoney(openingBid)}
Deposit Required: ${displayText(listing.deposit)}
Occupancy: ${displayText(listing.occupancy)}
Plaintiff / Docket: ${listing.plaintiff || 'County Court Foreclosure'}

Draft a non-binding due-diligence LOI scenario. Do not claim clear title, verified occupancy, published fees, or seller acceptance. Label assumed terms explicitly.`;

        const resp = await (window as any).puter.ai.chat(prompt, { model: selectedPuterModel });
        const text = typeof resp === 'string' ? resp : resp?.message?.content || resp?.toString();
        if (text && text.trim().length > 50) {
          const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `AI-LOI-${listing.id}.md`;
          a.click();
          URL.revokeObjectURL(url);
          setGeneratingAiLoi(false);
          return;
        }
      }
    } catch (e) {
      console.warn("AI LOI fallback to static template:", e);
    }
    setGeneratingAiLoi(false);
    handleDownloadLoi();
  };

  const handleDownloadIcMemo = () => {
    if (!listing || openingBid === null || estHigh === null) {
      setAiAnalysis("A source-published opening amount and valuation evidence are required before an investment memo can be generated.");
      return;
    }
    const memoMetrics = isCommercialOrMulti && sqft !== null ? computeCreMetrics({
      sqft,
      openingBid,
      propType: listing.propType ?? undefined,
    }) : undefined;
    const text = generateInvestmentCommitteeMemo(listing, memoMetrics);
    const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `IC-Memo-${listing.id}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleGenerateAiMemo = async () => {
    if (!listing || openingBid === null || estHigh === null) {
      setAiAnalysis("A source-published opening amount and valuation evidence are required before an investment memo can be generated.");
      return;
    }
    setGeneratingAiMemo(true);
    try {
      if (typeof window !== "undefined" && (window as any).puter?.ai?.chat) {
        const memoMetrics = isCommercialOrMulti && sqft !== null ? computeCreMetrics({
          sqft,
          openingBid,
          propType: listing.propType ?? undefined,
        }) : null;
        const prompt = `You are an acquisitions director preparing an Investment Committee (IC) acquisition memorandum for this asset:
Property: ${listing.address}, ${listing.city}, ${listing.state} ${listing.zip}
Opening Bid: ${displayMoney(openingBid)}
Estimated value ceiling: ${displayMoney(estHigh)}
Modeled deal score: ${dealScore ?? 'not available'}
Modeled NOI: ${memoMetrics ? displayMoney(memoMetrics.netOperatingIncome) : 'not modeled'}
Modeled target-yield MAO: ${memoMetrics ? displayMoney(memoMetrics.maxAllowableOffer) : 'not modeled'}
Senior Lien Risk: ${listing.seniorLienRisk}

Use only the supplied evidence. Never invent comps, title status, property condition, rent, fees, or legal conclusions. Label every calculation and assumption. Draft an executive 1-page Investment Committee Acquisition Memorandum covering Executive Summary, evidence gaps, modeled valuation, title-review requirements, and a conditional recommendation.`;

        const resp = await (window as any).puter.ai.chat(prompt, { model: selectedPuterModel });
        const text = typeof resp === 'string' ? resp : resp?.message?.content || resp?.toString();
        if (text && text.trim().length > 50) {
          const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `AI-IC-Memo-${listing.id}.md`;
          a.click();
          URL.revokeObjectURL(url);
          setGeneratingAiMemo(false);
          return;
        }
      }
    } catch (e) {
      console.warn("AI IC Memo fallback:", e);
    }
    setGeneratingAiMemo(false);
    handleDownloadIcMemo();
  };

  return (
    <div
      className="fixed inset-0 z-50 overflow-hidden bg-black/40 backdrop-blur-sm flex justify-end animate-in fade-in duration-200"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="property-drawer-title"
        className="w-full max-w-xl bg-white h-full shadow-2xl overflow-y-auto flex flex-col border-l border-[#E5E7EB]"
      >
        {/* Drawer Header */}
        <div className="sticky top-0 z-20 bg-white/95 backdrop-blur border-b border-[#E5E7EB] px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span
              className="text-[11px] font-extrabold uppercase px-2.5 py-1 rounded-md text-white shadow-sm"
              style={{ backgroundColor: source.color }}
            >
              {source.label}
            </span>
            <span className="text-xs font-bold text-[#6B7280]">Tier {source.tier}</span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => onToggleSave(listing.id)}
              className={cn(
                "p-2 rounded-xl border transition flex items-center gap-1.5 text-xs font-semibold",
                isSaved
                  ? "bg-[#16A34A]/10 border-[#16A34A] text-[#16A34A]"
                  : "bg-white border-[#E5E7EB] text-[#374151] hover:bg-[#F5F6F7]"
              )}
            >
              <Bookmark className={cn("w-4 h-4", isSaved && "fill-current")} />
              <span>{isSaved ? "Saved" : "Add to Watchlist"}</span>
            </button>

            <button
              onClick={onClose}
              className="p-2 rounded-xl text-[#6B7280] hover:text-[#111827] hover:bg-[#F5F6F7] transition"
              aria-label="Close drawer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Tab Navigation */}
        <div aria-label="Property inspection tabs" className="bg-[#F8FAFC] px-6 py-2 border-b border-[#E5E7EB] flex items-center gap-2">
          <button
            id="tab-underwrite"
            aria-controls="panel-underwrite"
            onClick={() => setActiveTab("underwrite")}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition",
              activeTab === "underwrite"
                ? "bg-white text-[#111827] shadow-sm border border-[#E5E7EB]"
                : "text-[#6B7280] hover:text-[#111827]"
            )}
          >
            <FileText className="w-3.5 h-3.5" />
            <span>Underwrite & Legal</span>
          </button>

          <button
            id="tab-3d"
            aria-controls="panel-3d"
            onClick={() => setActiveTab("3d")}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition",
              activeTab === "3d"
                ? "bg-white text-[#111827] shadow-sm border border-[#E5E7EB]"
                : "text-[#6B7280] hover:text-[#111827]"
            )}
          >
            <Box className="w-3.5 h-3.5 text-[#22C55E]" />
            <span>3D Lot & Elevation</span>
          </button>

          <button
            id="tab-bidding"
            aria-controls="panel-bidding"
            onClick={() => setActiveTab("bidding")}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition",
              activeTab === "bidding"
                ? "bg-white text-[#111827] shadow-sm border border-[#E5E7EB]"
                : "text-[#6B7280] hover:text-[#111827]"
            )}
          >
            <Sparkles className="w-3.5 h-3.5 text-[#0F172A]" />
            <span>Bidding Simulator</span>
          </button>
        </div>


        {/* Property Hero Media */}
        {activeTab === "underwrite" && (
          <div className="relative h-56 sm:h-64 w-full bg-[#F5F6F7] overflow-hidden">
            {photoUrl ? (
              <img src={photoUrl} alt="" className="w-full h-full object-cover" />
            ) : (
              <div className="flex h-full items-center justify-center text-sm font-semibold text-[#6B7280]">No source photo published</div>
            )}
            {dealScore !== null && (
              <div className="absolute top-4 left-4 bg-white/90 backdrop-blur-md px-3 py-1.5 rounded-xl border border-white/80 shadow-md">
                <span className="text-xs text-[#6B7280] font-semibold uppercase">Modeled score: </span>
                <span className="text-sm font-extrabold text-[#111827]">{dealScore}/99</span>
                <span className="block text-[9px] text-[#6B7280]">Bid-to-midpoint triage only</span>
              </div>
            )}
          </div>
        )}

        {/* Content Body */}
        <div className="p-6 space-y-6 flex-1">
          <div>
            <h2 id="property-drawer-title" className="text-2xl font-bold text-[#111827]">{listing.address}</h2>
            <p className="text-sm text-[#6B7280] flex items-center gap-1.5 mt-1">
              <MapPin className="w-4 h-4 text-[#9CA3AF]" />
              {displayText(listing.city)}, {listing.state} {displayText(listing.zip, "")} · {displayText(listing.county, "County not published")}
            </p>
          </div>

          {/* TAB 1: Underwrite & Legal */}
          {activeTab === "underwrite" && (
            <div id="panel-underwrite" role="tabpanel" aria-labelledby="tab-underwrite" className="space-y-6">
              {/* Core Valuation Matrix */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-4 bg-[#F5F6F7] rounded-2xl border border-[#E5E7EB]">
                <div>
                  <p className="text-[11px] font-bold text-[#6B7280] uppercase">Opening Bid</p>
                  <p className="text-lg font-extrabold text-[#111827]">{displayMoney(openingBid)}</p>
                </div>
                <div>
                  <p className="text-[11px] font-bold text-[#6B7280] uppercase">Est. Low / High</p>
                  <p className="text-sm font-bold text-[#374151]">
                    {estLow !== null && estHigh !== null ? `${displayMoney(estLow)}–${displayMoney(estHigh)}` : "Not published"}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] font-bold text-[#16A34A] uppercase">Bid Spread</p>
                  <p className="text-lg font-extrabold text-[#16A34A]">{bidSpread === null ? "Not modeled" : displayMoney(bidSpread)}</p>
                  <p className="text-[9px] text-[#6B7280]">Valuation midpoint minus opening amount</p>
                </div>
                <div>
                  <p className="text-[11px] font-bold text-[#6B7280] uppercase">Sale Date</p>
                  <p className="text-sm font-bold text-[#111827] flex items-center gap-1">
                    <Calendar className="w-3.5 h-3.5" />
                    {displayDate(listing.saleDate)}
                  </p>
                </div>
              </div>

              {/* AI Deal Intelligence */}
              <div className="p-5 rounded-2xl border border-[#0F172A]/10 bg-[#F8FAFC] space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-[#FDBC15] fill-[#FDBC15]" />
                    <h3 className="text-sm font-bold text-[#111827] uppercase tracking-wide">
                      AI Deal Intelligence ("Here's the Catch")
                    </h3>
                  </div>
                  <div className="flex items-center gap-2">
                    <select
                      value={selectedPuterModel}
                      onChange={(e) => setSelectedPuterModel(e.target.value)}
                      title="Select Puter AI Model"
                      className="text-[11px] font-semibold bg-white border border-[#E5E7EB] rounded-lg px-2 py-1 text-[#374151] focus:outline-none focus:ring-1 focus:ring-slate-400 cursor-pointer shadow-sm"
                    >
                      <option value="claude-3-5-sonnet">Claude 3.5 Sonnet (Legal/Title)</option>
                      <option value="gpt-4o-mini">GPT-4o-mini (Fast Triage)</option>
                      <option value="deepseek-reasoner">DeepSeek R1 (Math/Debt)</option>
                    </select>
                    {aiSource && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800">
                        {aiSource === 'backend' ? 'Rule Engine' : `✨ ${aiSource === 'claude-3-5-sonnet' ? 'Claude 3.5' : aiSource === 'gpt-4o-mini' ? 'GPT-4o-mini' : 'DeepSeek R1'}`}
                      </span>
                    )}
                    {!aiAnalysis && !aiLoading ? (
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={handleRunAi}
                          className="px-3 py-1 bg-[#0F172A] text-white text-xs font-bold rounded-lg hover:bg-[#1E293B] transition shadow-sm"
                        >
                          Analyze Deal
                        </button>
                        <button
                          onClick={handleRunPuterAi}
                          title={`Free live ${selectedPuterModel} intelligence via Puter.js`}
                          className="px-2.5 py-1 bg-emerald-600 text-white text-xs font-bold rounded-lg hover:bg-emerald-700 transition shadow-sm flex items-center gap-1"
                        >
                          <Sparkles className="w-3 h-3" />
                          <span>Puter AI</span>
                        </button>
                      </div>
                    ) : !aiLoading && (
                      <div className="flex items-center gap-2">
                        <button
                          onClick={handleRunPuterAi}
                          className="text-[11px] font-bold text-emerald-700 hover:text-emerald-900 underline flex items-center gap-1"
                        >
                          <Sparkles className="w-3 h-3" />
                          <span>Run {selectedPuterModel === 'claude-3-5-sonnet' ? 'Claude 3.5' : selectedPuterModel === 'gpt-4o-mini' ? 'GPT-4o-mini' : 'DeepSeek'}</span>
                        </button>
                        <button
                          onClick={handleRunAi}
                          className="text-[11px] font-semibold text-slate-600 hover:text-slate-900 underline"
                        >
                          Re-analyze
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {aiLoading && (
                  <p className="text-xs text-[#6B7280] animate-pulse">Reviewing available listing evidence...</p>
                )}

                {aiAnalysis ? (
                  <div className="text-xs text-[#374151] leading-relaxed space-y-2 pt-2 border-t border-[#E5E7EB]">
                    <p className="whitespace-pre-line">{aiAnalysis}</p>
                  </div>
                ) : (
                  !aiLoading && (
                    <p className="text-xs text-[#6B7280]">
                      Analyze the available source record and surface evidence gaps. Official title, lien, docket, and occupancy checks remain separate.
                    </p>
                  )
                )}
              </div>

              {/* Fail-closed official-record evidence check. */}
              <PropertyIntelligence key={listing.id} listingId={listing.id} />
              <DocketAgent listing={listing} />

              {/* Modeled title-risk signal; not a completed title search. */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-[#111827] uppercase tracking-wide flex items-center gap-1.5">
                    <Scale className="w-4 h-4 text-[#0F172A]" />
                    <span>Modeled title-risk signal</span>
                  </h3>
                  <span className={cn(
                    "text-[10px] font-extrabold uppercase px-2.5 py-0.5 rounded-md",
                    listing.seniorLienRisk === "high"
                      ? "bg-red-100 text-red-700"
                      : "bg-amber-100 text-amber-800"
                  )}>
                    {listing.seniorLienRisk === "high" ? "Possible senior-lien risk" : "Official review required"}
                  </span>
                </div>

                <div className="p-4 rounded-2xl border border-[#E5E7EB] bg-white space-y-3 text-xs">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <span className="text-[#6B7280] block text-[11px]">Normalized source category:</span>
                      <span className="font-bold text-[#111827]">{source.label}</span>
                    </div>
                    <div>
                      <span className="text-[#6B7280] block text-[11px]">Lien-priority status:</span>
                      <span className="font-bold text-amber-800">Unverified</span>
                    </div>
                  </div>
                  <div className={cn(
                    "p-2.5 rounded-xl border text-[11px] flex items-start gap-2",
                    listing.seniorLienRisk === "high"
                      ? "border-red-200 bg-red-50 text-red-800"
                      : "border-amber-200 bg-amber-50 text-amber-900"
                  )}>
                    <AlertTriangle className={cn("w-4 h-4 shrink-0 mt-0.5", listing.seniorLienRisk === "high" ? "text-red-600" : "text-amber-600")} />
                    <p>
                      {listing.seniorLienRisk === "high"
                        ? "The normalized notice contains a possible junior-claimant signal. Confirm lien priority and surviving encumbrances from official recorder and court documents."
                        : "No senior-lien warning was detected in the normalized source fields. This does not establish lien priority or extinguishment."}
                    </p>
                  </div>
                </div>
              </div>

              {/* Statutory Redemption & Title Caveat */}
              {(listing.redemptionWarning || (listing.state === 'AL' || listing.state === 'MI' || listing.state === 'NJ' || listing.source === 'irs')) && (
                <div className="p-3.5 rounded-xl border border-amber-200 bg-amber-50 text-xs text-amber-900 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-bold flex items-center gap-1.5 text-amber-950">
                      <Clock className="w-4 h-4 text-amber-600" />
                      Modeled redemption review
                    </span>
                    <span className="font-extrabold text-[10px] uppercase px-2 py-0.5 rounded bg-amber-200/80 text-amber-950">
                      Official terms required
                    </span>
                  </div>
                  <p className="leading-relaxed">
                    This listing may be subject to a redemption or objection period. Confirm the exact duration, triggering event, exceptions, and possession timeline in current official documents before bidding.
                  </p>
                  <div className="grid grid-cols-2 gap-1 pt-1 text-[10px] text-amber-900 border-t border-amber-200/60">
                    <div><strong>Feed auction date:</strong> {displayDate(listing.saleDate)}</div>
                    <div><strong>Jurisdiction:</strong> {listing.state} · {source.label}</div>
                  </div>
                </div>
              )}

              {/* Evidence-backed cash requirement. */}
              {cashToClose ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-[#111827] uppercase tracking-wide flex items-center gap-1.5">
                      <DollarSign className="w-4 h-4 text-[#0F172A]" />
                      <span>Cash requirement evidence</span>
                    </h3>
                    <span className="text-xs font-extrabold text-emerald-700">{displayMoney(cashToClose.totalAcquisitionCost)}</span>
                  </div>
                  <p className="text-[11px] leading-relaxed text-[#6B7280]">Every amount below is tagged as published evidence or an explicit scenario assumption. Missing terms remain unresolved.</p>
                  <div className="divide-y divide-[#E5E7EB] border border-[#E5E7EB] rounded-2xl bg-white text-xs">
                    {([
                      ["Purchase-price scenario", "purchasePrice", cashToClose.purchasePrice],
                      ["Registration funds (separate)", "registrationFunds", cashToClose.registrationFunds],
                      ["Deposit credited to purchase", "creditedDeposit", cashToClose.creditedDeposit],
                      ["Buyer’s premium", "buyersPremium", cashToClose.buyersPremium],
                      ["Sheriff / trustee fee", "sheriffPoundage", cashToClose.sheriffPoundage],
                      ["Transfer tax", "transferTax", cashToClose.transferTax],
                      ["Taxes or surviving debt", "delinquentTaxes", cashToClose.delinquentTaxes],
                      ["Other settlement costs", "settlementCosts", cashToClose.settlementCosts],
                    ] as const).map(([label, field, amount]) => (
                      <div key={field} className="p-3 flex items-center justify-between gap-3">
                        <span className="text-[#6B7280]">{label}<span className="ml-1 text-[9px] uppercase">({cashToClose.basis[field] ?? "unresolved"})</span></span>
                        <span className="font-semibold text-[#374151]">{displayMoney(amount)}</span>
                      </div>
                    ))}
                    <div className="p-3 flex justify-between bg-[#F8FAFC]"><span className="font-bold text-[#111827]">Total acquisition cash</span><span className="font-extrabold text-[#16A34A]">{displayMoney(cashToClose.totalAcquisitionCost)}</span></div>
                    <div className="p-3 flex justify-between bg-[#F8FAFC]"><span className="font-bold text-[#111827]">Cash remaining at settlement</span><span className="font-extrabold text-[#111827]">{displayMoney(cashToClose.cashDueAtSettlement)}</span></div>
                  </div>
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-[#CBD5E1] bg-[#F8FAFC] p-4 text-xs text-[#475569]">
                  Cash requirements are unresolved. No fee is inferred from the source name or state. Open the Price Scenario tab to enter published terms or explicit assumptions.
                </div>
              )}

              {/* Commercial & Multi-Family CRE Underwriting */}
              {creMetrics && (
                <div className="p-4 rounded-2xl border border-slate-200 bg-slate-50 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <Scale className="w-4 h-4 text-slate-800" />
                      <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wide">CRE / Multi-Family Underwriting</h3>
                    </div>
                    <span className="text-xs font-extrabold text-slate-800">
                      Cap Rate: {creMetrics.capitalizationRate}%
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-center text-xs">
                    <div className="p-2.5 rounded-xl bg-white border border-slate-200">
                      <p className="text-[#6B7280] text-[10px] uppercase font-bold">Net Operating Income</p>
                      <p className="font-extrabold text-sm text-[#111827]">${creMetrics.netOperatingIncome.toLocaleString()}/yr</p>
                    </div>
                    <div className="p-2.5 rounded-xl bg-white border border-slate-200">
                      <p className="text-[#6B7280] text-[10px] uppercase font-bold">Estimated DSCR</p>
                      <p className="font-extrabold text-sm text-slate-800">{creMetrics.estimatedDscr}x</p>
                    </div>
                    <div className="p-2.5 rounded-xl bg-white border border-slate-200">
                      <p className="text-emerald-700 text-[10px] uppercase font-bold">Target Yield MAO</p>
                      <p className="font-extrabold text-sm text-emerald-700">${creMetrics.maxAllowableOffer.toLocaleString()}</p>
                    </div>
                  </div>
                </div>
              )}

              <button type="button" onClick={() => setActiveTab("bidding")} className="w-full rounded-2xl border border-[#0F172A]/15 bg-[#F8FAFC] p-4 text-left transition hover:border-[#0F172A]">
                <span className="flex items-center gap-1.5 text-sm font-bold uppercase tracking-wide text-[#111827]"><Calculator className="h-4 w-4" />Price and cost reverse scenario</span>
                <span className="mt-1 block text-xs leading-relaxed text-[#6B7280]">Enter the costs you can support, then see the maximum price or cost reduction that meets your target. Unknown fees and debt stay unresolved.</span>
              </button>

              {/* Comparable-sale evidence */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-[#111827] uppercase tracking-wide flex items-center gap-1.5">
                    <Home className="w-4 h-4 text-[#0F172A]" />
                    <span>Comparable-sale evidence</span>
                  </h3>
                  <span className="text-xs text-[#6B7280]">{displayText(listing.city)}, {listing.state}</span>
                </div>
                <div className="rounded-2xl border border-dashed border-[#CBD5E1] bg-white p-4 text-xs leading-relaxed text-[#475569]">
                  No verified comparable-sale records were captured with this source record. The valuation band above is shown only when supplied by the ingestion pipeline; it is not a substitute for dated, address-level comps.
                </div>
              </div>

              {/* Court & Legal Specifics */}
              <div className="space-y-3">
                <h3 className="text-sm font-bold text-[#111827] uppercase tracking-wide">Legal Docket & Deposit Terms</h3>
                <div className="divide-y divide-[#E5E7EB] border border-[#E5E7EB] rounded-2xl bg-white text-xs">
                  <div className="p-3.5 flex justify-between">
                    <span className="text-[#6B7280] font-semibold">Plaintiff</span>
                    <span className="font-medium text-[#111827]">{displayText(listing.plaintiff)}</span>
                  </div>
                  <div className="p-3.5 flex justify-between">
                    <span className="text-[#6B7280] font-semibold">Defendant</span>
                    <span className="font-medium text-[#111827]">{displayText(listing.defendant)}</span>
                  </div>
                  <div className="p-3.5 flex justify-between">
                    <span className="text-[#6B7280] font-semibold">Attorney of Record</span>
                    <span className="font-medium text-[#111827]">{displayText(listing.attorney)}</span>
                  </div>
                  <div className="p-3.5 flex justify-between">
                    <span className="text-[#6B7280] font-semibold">Deposit Terms</span>
                    <span className="font-medium text-[#111827]">{displayText(listing.deposit)}</span>
                  </div>
                </div>
              </div>

              {/* Institutional Deal Execution Artifacts */}
              <div className="space-y-3">
                <h3 className="text-sm font-bold text-[#111827] uppercase tracking-wide">Institutional Execution Documents</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <button
                    onClick={handleDownloadLoi}
                    disabled={openingBid === null}
                    className="flex items-center justify-center gap-2 h-10 px-3 rounded-xl border border-[#0F172A] bg-[#0F172A] text-white text-xs font-bold hover:bg-[#1E293B] transition shadow-sm disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Download Standard LOI</span>
                  </button>

                  <button
                    onClick={handleGenerateAiLoi}
                    disabled={generatingAiLoi || openingBid === null}
                    className="flex items-center justify-center gap-2 h-10 px-3 rounded-xl border border-emerald-600 bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 transition shadow-sm disabled:opacity-50"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>{generatingAiLoi ? "Drafting with Puter..." : "✨ AI Tailored LOI"}</span>
                  </button>

                  <button
                    onClick={handleDownloadIcMemo}
                    disabled={openingBid === null || estHigh === null}
                    className="flex items-center justify-center gap-2 h-10 px-3 rounded-xl border border-[#E5E7EB] bg-white text-[#0F172A] text-xs font-bold hover:bg-[#F8FAFC] transition shadow-sm disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <FileText className="w-3.5 h-3.5" />
                    <span>Export Standard IC Memo</span>
                  </button>

                  <button
                    onClick={handleGenerateAiMemo}
                    disabled={generatingAiMemo || openingBid === null || estHigh === null}
                    className="flex items-center justify-center gap-2 h-10 px-3 rounded-xl bg-[#0F172A] text-white text-xs font-bold hover:bg-[#1E293B] transition shadow-sm disabled:opacity-50"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>{generatingAiMemo ? "Synthesizing Memo..." : "✨ AI Investment Memo"}</span>
                  </button>
                </div>
                {(openingBid === null || estHigh === null) && (
                  <p className="text-[11px] leading-relaxed text-[#6B7280]">Documents remain disabled until the source record includes the financial evidence each template requires.</p>
                )}
              </div>
            </div>
          )}

          {/* TAB 2: 3D Parcel & Topography */}
          {activeTab === "3d" && (
            <div id="panel-3d" role="tabpanel" aria-labelledby="tab-3d" className="space-y-4 animate-in fade-in">
              <Parcel3DVisualizer listing={listing} />
              <div className="p-4 bg-[#F8FAFC] rounded-2xl border border-[#E5E7EB] text-xs text-[#6B7280] space-y-1.5">
                <span className="font-bold text-[#111827] block">Concept visualization only</span>
                <p>This view is not a boundary survey, elevation certificate, zoning determination, or FEMA flood finding. Attach official parcel geometry and hazard records before relying on dimensions or setbacks.</p>
              </div>
            </div>
          )}

          {/* TAB 3: Bidding Simulator & AI Video Pitch */}
          {activeTab === "bidding" && (
            <div id="panel-bidding" role="tabpanel" aria-labelledby="tab-bidding" className="space-y-6 animate-in fade-in">
              <BiddingSimulator listing={listing} />
              <DealVideoGenerator listing={listing} />
            </div>
          )}

          {/* Source Link */}
          {exactSourceUrl ? (
            <div className="pt-2">
              <a
                href={exactSourceUrl}
                target="_blank"
                rel="noreferrer"
                data-testid="exact-source-listing-link"
                className="w-full inline-flex h-11 items-center justify-center rounded-xl bg-white border border-[#E5E7EB] text-sm font-bold text-[#0F172A] hover:bg-[#F5F6F7] transition gap-2 shadow-sm"
              >
                <span>Open exact {source.label} listing</span>
                <ExternalLink className="w-4 h-4" />
              </a>
            </div>
          ) : (
            <p
              data-testid="exact-source-listing-unavailable"
              className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-semibold leading-relaxed text-amber-900"
            >
              Exact upstream record unavailable. This listing will never send you to a generic portal homepage.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
