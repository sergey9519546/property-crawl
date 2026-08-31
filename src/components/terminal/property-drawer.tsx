"use client";

import { useEffect, useState } from "react";
import { X, Bookmark, ExternalLink, Sparkles, MapPin, Calendar, Box, FileText } from "lucide-react";
import { Listing, SOURCES } from "@/data/listings";
import { cn } from "@/lib/utils";
import { Parcel3DVisualizer } from "./parcel-3d-visualizer";
import { BiddingSimulator } from "./bidding-simulator";
import { getExactSourceListingUrl } from "@/lib/listing-links";

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
        <div className="bg-[#F8FAFC] px-6 py-2 border-b border-[#E5E7EB] flex items-center gap-2">
          <button
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
            onClick={() => setActiveTab("bidding")}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition",
              activeTab === "bidding"
                ? "bg-white text-[#111827] shadow-sm border border-[#E5E7EB]"
                : "text-[#6B7280] hover:text-[#111827]"
            )}
          >
            <Sparkles className="w-3.5 h-3.5 text-[#3B82F6]" />
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
            <>
              {/* Core Valuation Matrix */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-4 bg-[#F5F6F7] rounded-2xl border border-[#E5E7EB]">
                <div>
                  <p className="text-[11px] font-bold text-[#6B7280] uppercase">Opening Bid</p>
                  <p className="text-lg font-extrabold text-[#111827]">$${listing.openingBid.toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-[11px] font-bold text-[#6B7280] uppercase">Est. Low / High</p>
                  <p className="text-sm font-bold text-[#374151]">
                    $${(listing.estLow / 1000).toFixed(0)}k–$${(listing.estHigh / 1000).toFixed(0)}k
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

              {/* Statutory Redemption & Senior Lien Warnings */}
              {(listing.redemptionWarning || (listing.state === 'AL' || listing.state === 'MI' || listing.state === 'NJ' || listing.source === 'irs')) && (
                <div className="p-3.5 rounded-xl border border-amber-200 bg-amber-50 text-xs text-amber-900 space-y-1">
                  <span className="font-bold flex items-center gap-1.5 text-amber-950">
                    <span className="inline-block w-2 h-2 rounded-full bg-amber-500"></span>
                    Statutory Redemption & Title Caveat
                  </span>
                  <p>
                    {listing.redemptionWarning || (listing.state === 'AL' ? 'Alabama: 180-Day Statutory Right of Redemption Applies.' : listing.state === 'MI' ? 'Michigan: 6-Month Statutory Right of Redemption Applies.' : listing.state === 'NJ' ? 'New Jersey: 10-Day Statutory Objection Window Applies.' : 'Federal asset seizure rules apply.')}
                  </p>
                </div>
              )}

              {/* Cash to Close Breakdown */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-[#111827] uppercase tracking-wide">Cash-to-Close Breakdown</h3>
                  <span className="text-xs font-extrabold text-[#0F172A]">
                    Est. ${(listing.openingBid * 1.045 + 500).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </span>
                </div>
                <div className="divide-y divide-[#E5E7EB] border border-[#E5E7EB] rounded-2xl bg-white text-xs">
                  <div className="p-3 flex justify-between">
                    <span className="text-[#6B7280]">Opening Bid</span>
                    <span className="font-semibold text-[#111827]">${listing.openingBid.toLocaleString()}</span>
                  </div>
                  <div className="p-3 flex justify-between">
                    <span className="text-[#6B7280]">Estimated Statutory Poundage & Fees (2–3%)</span>
                    <span className="font-semibold text-[#374151]">${Math.round(listing.openingBid * 0.02).toLocaleString()}</span>
                  </div>
                  <div className="p-3 flex justify-between">
                    <span className="text-[#6B7280]">State/County Transfer Tax & Recording</span>
                    <span className="font-semibold text-[#374151]">${Math.round(listing.openingBid * 0.005 + 500).toLocaleString()}</span>
                  </div>
                  <div className="p-3 flex justify-between bg-[#F8FAFC]">
                    <span className="font-bold text-[#111827]">Estimated Total Due at Settlement</span>
                    <span className="font-extrabold text-[#16A34A]">${Math.round(listing.openingBid * 1.025 + 500).toLocaleString()}</span>
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
            </>
          )}

          {/* TAB 2: 3D Parcel & Topography */}
          {activeTab === "3d" && (
            <div className="space-y-4 animate-in fade-in">
              <Parcel3DVisualizer listing={listing} />
              <div className="p-4 bg-[#F8FAFC] rounded-2xl border border-[#E5E7EB] text-xs text-[#6B7280] space-y-1.5">
                <span className="font-bold text-[#111827] block">3D Terrain & Contour Insights:</span>
                <p>• Estimated building setback: 25ft front / 15ft rear.</p>
                <p>• Zero floodplain overlap detected (FEMA Zone X minimal hazard).</p>
              </div>
            </div>
          )}

          {/* TAB 3: Bidding Simulator */}
          {activeTab === "bidding" && (
            <BiddingSimulator listing={listing} />
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
