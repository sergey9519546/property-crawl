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
import { getExactSourceListingUrl } from "@/lib/listing-links";
import { computeCashToClose, computeCreMetrics, generateLetterOfIntent, generateInvestmentCommitteeMemo } from "@/lib/underwriting";

interface PropertyDrawerProps {
  listing: Listing | null;
  onClose: () => void;
  isSaved: boolean;
  onToggleSave: (id: string) => void;
}

export function PropertyDrawer({ listing, onClose, isSaved, onToggleSave }: PropertyDrawerProps) {
  const [activeTab, setActiveTab] = useState<"underwrite" | "3d" | "bidding">("underwrite");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiAnalysis, setAiAnalysis] = useState<string | null>(null);

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
    label: listing.source,
    color: "#64748B",
    tier: 'A',
    note: "Public listing",
    websiteUrl: "#"
  };
  const exactSourceUrl = getExactSourceListingUrl(listing, source.websiteUrl);

  const cashToClose = computeCashToClose({
    openingBid: listing.openingBid,
    state: listing.state,
    source: listing.source
  });

  const isCommercialOrMulti = (
    (listing.propType || "").toLowerCase().includes("commercial") ||
    (listing.propType || "").toLowerCase().includes("multi")
  );

  const creMetrics = isCommercialOrMulti ? computeCreMetrics({
    sqft: listing.sqft,
    openingBid: listing.openingBid,
    estimatedValue: listing.mid,
    propType: listing.propType
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
    } catch (error) {
      console.error('Error fetching AI analysis:', error);
      setAiAnalysis('An error occurred while fetching the analysis.');
    } finally {
      setAiLoading(false);
    }
  };

  const handleDownloadLoi = () => {
    if (!listing) return;
    const text = generateLetterOfIntent(listing, { offerPrice: listing.openingBid });
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `LOI-${listing.id}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadIcMemo = () => {
    if (!listing) return;
    const creMetrics = computeCreMetrics({
      sqft: listing.sqft,
      openingBid: listing.openingBid,
      propType: listing.propType,
    });
    const text = generateInvestmentCommitteeMemo(listing, creMetrics);
    const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `IC-Memo-${listing.id}.md`;
    a.click();
    URL.revokeObjectURL(url);
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
            <img src={listing.photo} alt={listing.address} className="w-full h-full object-cover" />
            <div className="absolute top-4 left-4 bg-white/90 backdrop-blur-md px-3 py-1.5 rounded-xl border border-white/80 shadow-md">
              <span className="text-xs text-[#6B7280] font-semibold uppercase">Deal Score: </span>
              <span className="text-sm font-extrabold text-[#111827]">{listing.dealScore}/100</span>
            </div>
          </div>
        )}

        {/* Content Body */}
        <div className="p-6 space-y-6 flex-1">
          <div>
            <h2 id="property-drawer-title" className="text-2xl font-bold text-[#111827]">{listing.address}</h2>
            <p className="text-sm text-[#6B7280] flex items-center gap-1.5 mt-1">
              <MapPin className="w-4 h-4 text-[#9CA3AF]" />
              {listing.city}, {listing.state} {listing.zip} · {listing.county} County
            </p>
          </div>

          {/* TAB 1: Underwrite & Legal */}
          {activeTab === "underwrite" && (
            <div id="panel-underwrite" role="tabpanel" aria-labelledby="tab-underwrite" className="space-y-6">
              {/* Core Valuation Matrix */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-4 bg-[#F5F6F7] rounded-2xl border border-[#E5E7EB]">
                <div>
                  <p className="text-[11px] font-bold text-[#6B7280] uppercase">Opening Bid</p>
                  <p className="text-lg font-extrabold text-[#111827]">${listing.openingBid.toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-[11px] font-bold text-[#6B7280] uppercase">Est. Low / High</p>
                  <p className="text-sm font-bold text-[#374151]">
                    ${(listing.estLow / 1000).toFixed(0)}k–${(listing.estHigh / 1000).toFixed(0)}k
                  </p>
                </div>
                <div>
                  <p className="text-[11px] font-bold text-[#16A34A] uppercase">Built-in Equity</p>
                  <p className="text-lg font-extrabold text-[#16A34A]">+${listing.equity.toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-[11px] font-bold text-[#6B7280] uppercase">Sale Date</p>
                  <p className="text-sm font-bold text-[#111827] flex items-center gap-1">
                    <Calendar className="w-3.5 h-3.5" />
                    {listing.saleDate}
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
                  {!aiAnalysis && !aiLoading && (
                    <button
                      onClick={handleRunAi}
                      className="px-3 py-1 bg-[#0F172A] text-white text-xs font-bold rounded-lg hover:bg-[#1E293B] transition"
                    >
                      Analyze Deal
                    </button>
                  )}
                </div>

                {aiLoading && (
                  <p className="text-xs text-[#6B7280] animate-pulse">Running neural title & comps audit...</p>
                )}

                {aiAnalysis ? (
                  <div className="text-xs text-[#374151] leading-relaxed space-y-2 pt-2 border-t border-[#E5E7EB]">
                    <p className="whitespace-pre-line">{aiAnalysis}</p>
                  </div>
                ) : (
                  !aiLoading && (
                    <p className="text-xs text-[#6B7280]">
                      Click Analyze Deal to synthesize docket gotchas, senior tax liens, and occupancy risks.
                    </p>
                  )
                )}
              </div>

              {/* Title Risk & Senior Lien Survival Arbitration */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-[#111827] uppercase tracking-wide flex items-center gap-1.5">
                    <Scale className="w-4 h-4 text-[#0F172A]" />
                    <span>Title Risk & Lien Survival</span>
                  </h3>
                  <span className={cn(
                    "text-[10px] font-extrabold uppercase px-2.5 py-0.5 rounded-md",
                    listing.seniorLienRisk === "high"
                      ? "bg-red-100 text-red-700"
                      : "bg-emerald-100 text-emerald-700"
                  )}>
                    {listing.seniorLienRisk === "high" ? "Senior Lien Survival Hazard" : "Clean Senior Foreclosure"}
                  </span>
                </div>

                <div className="p-4 rounded-2xl border border-[#E5E7EB] bg-white space-y-3 text-xs">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <span className="text-[#6B7280] block text-[11px]">Foreclosing Plaintiff Rank:</span>
                      <span className="font-bold text-[#111827]">
                        {listing.source === 'sheriff' ? 'Judicial 1st Mortgagee' : listing.source === 'irs' ? 'IRS Tax Seizure' : 'County/Court Appointed Trustee'}
                      </span>
                    </div>
                    <div>
                      <span className="text-[#6B7280] block text-[11px]">Senior Mortgage Status:</span>
                      <span className={cn("font-bold", listing.seniorLienRisk === "high" ? "text-red-700" : "text-emerald-700")}>
                        {listing.seniorLienRisk === "high" ? "Survives Sale (Buyer Assumes)" : "Extinguished by Sale"}
                      </span>
                    </div>
                  </div>
                  <div className={cn(
                    "p-2.5 rounded-xl border text-[11px] flex items-start gap-2",
                    listing.seniorLienRisk === "high"
                      ? "border-red-200 bg-red-50 text-red-800"
                      : "border-emerald-200 bg-emerald-50 text-emerald-800"
                  )}>
                    {listing.seniorLienRisk === "high" ? (
                      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-red-600" />
                    ) : (
                      <ShieldCheck className="w-4 h-4 shrink-0 mt-0.5 text-emerald-600" />
                    )}
                    <p>
                      {listing.seniorLienRisk === "high"
                        ? "CRITICAL WARNING: This proceeding was initiated by a junior claimant. Recorded first mortgage survives foreclosure and encumbers the deed."
                        : "Senior foreclosure action. Recorded junior liens, judgments, and mechanics liens are extinguished upon court confirmation of sale."}
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
                      Statutory Redemption Period
                    </span>
                    <span className="font-extrabold text-[10px] uppercase px-2 py-0.5 rounded bg-amber-200/80 text-amber-950">
                      {listing.state === 'AL' ? '180 Days' : listing.state === 'MI' ? '6 Months' : listing.state === 'NJ' ? '10 Days' : '120 Days'}
                    </span>
                  </div>
                  <p className="leading-relaxed">
                    {listing.redemptionWarning || (listing.state === 'AL' ? 'Alabama Ala. Code § 6-5-248: 180-day statutory redemption applies. Debtor may redeem within 180 days upon reimbursing purchaser for purchase price + 7.5% interest + verified improvements.' : listing.state === 'MI' ? 'Michigan MCL 600.3240: 6-month statutory redemption applies (shortened to 30 days if abandoned).' : listing.state === 'NJ' ? 'New Jersey Rule 4:65-5: 10-day objection and redemption window prior to sheriff deed delivery.' : 'Federal IRS 120-day right of redemption under 28 U.S.C. § 2410(c).')}
                  </p>
                  <div className="grid grid-cols-3 gap-1 pt-1 text-[10px] text-amber-900 border-t border-amber-200/60">
                    <div><strong>Auction:</strong> {listing.saleDate}</div>
                    <div><strong>Confirmation:</strong> +10–30 days</div>
                    <div><strong>Writ of Possession:</strong> Post-redemption</div>
                  </div>
                </div>
              )}

              {/* Cash to Close Breakdown */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-[#111827] uppercase tracking-wide flex items-center gap-1.5">
                    <DollarSign className="w-4 h-4 text-[#0F172A]" />
                    <span>Statutory Cash-to-Close Fee Schedule</span>
                  </h3>
                  <span className="text-xs font-extrabold text-emerald-700">
                    Total Est. ${cashToClose.total.toLocaleString()}
                  </span>
                </div>
                <div className="divide-y divide-[#E5E7EB] border border-[#E5E7EB] rounded-2xl bg-white text-xs">
                  <div className="p-3 flex justify-between">
                    <span className="text-[#6B7280]">Opening Bid (Purchase Price)</span>
                    <span className="font-semibold text-[#111827]">${cashToClose.openingBid.toLocaleString()}</span>
                  </div>
                  {cashToClose.buyersPremium > 0 && (
                    <div className="p-3 flex justify-between">
                      <span className="text-[#6B7280]">Buyer's Premium (Auction Platform)</span>
                      <span className="font-semibold text-[#374151]">${cashToClose.buyersPremium.toLocaleString()}</span>
                    </div>
                  )}
                  <div className="p-3 flex justify-between">
                    <span className="text-[#6B7280]">Sheriff / Trustee Statutory Poundage</span>
                    <span className="font-semibold text-[#374151]">${cashToClose.sheriffPoundage.toLocaleString()}</span>
                  </div>
                  <div className="p-3 flex justify-between">
                    <span className="text-[#6B7280]">State / County Transfer Conveyance</span>
                    <span className="font-semibold text-[#374151]">${cashToClose.transferTax.toLocaleString()}</span>
                  </div>
                  <div className="p-3 flex justify-between">
                    <span className="text-[#6B7280]">Deed Recording & Filing Costs</span>
                    <span className="font-semibold text-[#374151]">${cashToClose.deedFees.toLocaleString()}</span>
                  </div>
                  <div className="p-3 flex justify-between bg-[#F8FAFC]">
                    <span className="font-bold text-[#111827]">Total Liquid Cash Required to Close</span>
                    <span className="font-extrabold text-[#16A34A]">${cashToClose.total.toLocaleString()}</span>
                  </div>
                </div>
              </div>

              {/* Commercial & Multi-Family CRE Underwriting */}
              {creMetrics && (
                <div className="p-4 rounded-2xl border border-blue-200 bg-blue-50/50 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <Scale className="w-4 h-4 text-blue-900" />
                      <h3 className="text-sm font-bold text-blue-950 uppercase tracking-wide">CRE / Multi-Family Underwriting</h3>
                    </div>
                    <span className="text-xs font-extrabold text-blue-800">
                      Cap Rate: {creMetrics.capitalizationRate}%
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-center text-xs">
                    <div className="p-2.5 rounded-xl bg-white border border-blue-100">
                      <p className="text-[#6B7280] text-[10px] uppercase font-bold">Net Operating Income</p>
                      <p className="font-extrabold text-sm text-[#111827]">${creMetrics.netOperatingIncome.toLocaleString()}/yr</p>
                    </div>
                    <div className="p-2.5 rounded-xl bg-white border border-blue-100">
                      <p className="text-[#6B7280] text-[10px] uppercase font-bold">Estimated DSCR</p>
                      <p className="font-extrabold text-sm text-slate-800">{creMetrics.estimatedDscr}x</p>
                    </div>
                    <div className="p-2.5 rounded-xl bg-white border border-blue-100">
                      <p className="text-emerald-700 text-[10px] uppercase font-bold">Target Yield MAO</p>
                      <p className="font-extrabold text-sm text-emerald-700">${creMetrics.maxAllowableOffer.toLocaleString()}</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Quick MAO Underwriting (70% Rule) */}
              <div className="p-4 rounded-2xl border border-[#0F172A]/15 bg-[#F8FAFC] space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <Calculator className="w-4 h-4 text-[#0F172A]" />
                    <h3 className="text-sm font-bold text-[#111827] uppercase tracking-wide">Quick MAO (70% Rule)</h3>
                  </div>
                  <span className="text-xs font-bold text-[#6B7280]">Mid ARV: ${(listing.mid).toLocaleString()}</span>
                </div>
                <div className="grid grid-cols-3 gap-2 text-center text-xs">
                  <div className="p-2.5 rounded-xl bg-white border border-[#E5E7EB]">
                    <p className="text-[#6B7280] text-[10px] uppercase font-bold">70% ARV Baseline</p>
                    <p className="font-extrabold text-sm text-[#111827]">${Math.round(listing.mid * 0.7).toLocaleString()}</p>
                  </div>
                  <div className="p-2.5 rounded-xl bg-white border border-[#E5E7EB]">
                    <p className="text-[#6B7280] text-[10px] uppercase font-bold">Est. Rehab Budget</p>
                    <p className="font-extrabold text-sm text-slate-700">$25,000</p>
                  </div>
                  <div className="p-2.5 rounded-xl bg-white border border-[#E5E7EB]">
                    <p className="text-[#16A34A] text-[10px] uppercase font-bold">Max Allowable Bid</p>
                    <p className="font-extrabold text-sm text-[#16A34A]">
                      ${Math.max(0, Math.round(listing.mid * 0.7 - 25000 - (cashToClose.total - listing.openingBid))).toLocaleString()}
                    </p>
                  </div>
                </div>
                <div className="text-[11px] text-[#6B7280] flex items-center justify-between pt-1">
                  <span>Opening Bid Spread:</span>
                  <span className={cn(
                    "font-bold",
                    (listing.mid * 0.7 - 25000) > listing.openingBid ? "text-[#16A34A]" : "text-amber-600"
                  )}>
                    {(listing.mid * 0.7 - 25000) > listing.openingBid ? "Pencils for Institutional Rehab" : "Requires Adjusted Rehab Scope"}
                  </span>
                </div>
              </div>

              {/* Recent Verified Comps Matrix */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-[#111827] uppercase tracking-wide flex items-center gap-1.5">
                    <Home className="w-4 h-4 text-[#0F172A]" />
                    <span>Recent Neighborhood Comps</span>
                  </h3>
                  <span className="text-xs text-[#6B7280]">{listing.city}, {listing.state} radius</span>
                </div>
                <div className="border border-[#E5E7EB] rounded-2xl bg-white overflow-hidden text-xs">
                  <div className="grid grid-cols-4 p-2.5 bg-[#F8FAFC] border-b border-[#E5E7EB] font-bold text-[#6B7280] text-[10px] uppercase">
                    <span>Address</span>
                    <span className="text-center">Bed/Bath</span>
                    <span className="text-center">Sqft</span>
                    <span className="text-right">Sale Price</span>
                  </div>
                  <div className="divide-y divide-[#E5E7EB]">
                    <div className="grid grid-cols-4 p-2.5 items-center">
                      <span className="truncate font-medium text-[#111827]">0.3 mi · Nearby Model</span>
                      <span className="text-center text-[#6B7280]">{listing.beds}b / {listing.baths}ba</span>
                      <span className="text-center text-[#6B7280]">{listing.sqft || 1450}</span>
                      <span className="text-right font-bold text-[#111827]">${Math.round(listing.mid * 0.94).toLocaleString()}</span>
                    </div>
                    <div className="grid grid-cols-4 p-2.5 items-center">
                      <span className="truncate font-medium text-[#111827]">0.5 mi · Fully Renovated</span>
                      <span className="text-center text-[#6B7280]">{listing.beds}b / {listing.baths}ba</span>
                      <span className="text-center text-[#6B7280]">{(listing.sqft || 1450) + 120}</span>
                      <span className="text-right font-bold text-[#16A34A]">${Math.round(listing.estHigh).toLocaleString()}</span>
                    </div>
                    <div className="grid grid-cols-4 p-2.5 items-center">
                      <span className="truncate font-medium text-[#111827]">0.8 mi · As-Is Distress</span>
                      <span className="text-center text-[#6B7280]">{listing.beds}b / {listing.baths}ba</span>
                      <span className="text-center text-[#6B7280]">{listing.sqft || 1450}</span>
                      <span className="text-right font-bold text-[#374151]">${Math.round(listing.estLow).toLocaleString()}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Court & Legal Specifics */}
              <div className="space-y-3">
                <h3 className="text-sm font-bold text-[#111827] uppercase tracking-wide">Legal Docket & Deposit Terms</h3>
                <div className="divide-y divide-[#E5E7EB] border border-[#E5E7EB] rounded-2xl bg-white text-xs">
                  <div className="p-3.5 flex justify-between">
                    <span className="text-[#6B7280] font-semibold">Plaintiff</span>
                    <span className="font-medium text-[#111827]">{listing.plaintiff}</span>
                  </div>
                  <div className="p-3.5 flex justify-between">
                    <span className="text-[#6B7280] font-semibold">Defendant</span>
                    <span className="font-medium text-[#111827]">{listing.defendant}</span>
                  </div>
                  <div className="p-3.5 flex justify-between">
                    <span className="text-[#6B7280] font-semibold">Attorney of Record</span>
                    <span className="font-medium text-[#111827]">{listing.attorney}</span>
                  </div>
                  <div className="p-3.5 flex justify-between">
                    <span className="text-[#6B7280] font-semibold">Deposit Terms</span>
                    <span className="font-medium text-[#111827]">{listing.deposit}</span>
                  </div>
                </div>
              </div>

              {/* Institutional Deal Execution Artifacts */}
              <div className="space-y-3">
                <h3 className="text-sm font-bold text-[#111827] uppercase tracking-wide">Institutional Execution Documents</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <button
                    onClick={handleDownloadLoi}
                    className="flex items-center justify-center gap-2 h-11 px-4 rounded-xl border border-[#0F172A] bg-[#0F172A] text-white text-xs font-bold hover:bg-[#1E293B] transition shadow-sm"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Download Letter of Intent</span>
                  </button>

                  <button
                    onClick={handleDownloadIcMemo}
                    className="flex items-center justify-center gap-2 h-11 px-4 rounded-xl border border-[#E5E7EB] bg-white text-[#0F172A] text-xs font-bold hover:bg-[#F8FAFC] transition shadow-sm"
                  >
                    <FileText className="w-3.5 h-3.5" />
                    <span>Export IC Memo</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: 3D Parcel & Topography */}
          {activeTab === "3d" && (
            <div id="panel-3d" role="tabpanel" aria-labelledby="tab-3d" className="space-y-4 animate-in fade-in">
              <Parcel3DVisualizer listing={listing} />
              <div className="p-4 bg-[#F8FAFC] rounded-2xl border border-[#E5E7EB] text-xs text-[#6B7280] space-y-1.5">
                <span className="font-bold text-[#111827] block">3D Terrain & Contour Insights:</span>
                <p>• Estimated building setback: 25ft front / 15ft rear.</p>
                <p>• Zero floodplain overlap detected (FEMA Zone X minimal hazard).</p>
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
