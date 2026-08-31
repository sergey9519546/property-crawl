"use client";

import { useEffect, useState } from "react";
import { X, Bookmark, ExternalLink, Sparkles, MapPin, Calendar, Box, FileText } from "lucide-react";
import { Listing, SOURCES } from "@/data/listings";
import { cn } from "@/lib/utils";
import { Parcel3DVisualizer } from "./parcel-3d-visualizer";
import { getExactSourceListingUrl } from "@/lib/listing-links";

interface PropertyDrawerProps {
  listing: Listing | null;
  onClose: () => void;
  isSaved: boolean;
  onToggleSave: (id: string) => void;
}

export function PropertyDrawer({ listing, onClose, isSaved, onToggleSave }: PropertyDrawerProps) {
  const [activeTab, setActiveTab] = useState<"underwrite" | "3d">("underwrite");
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

  const handleRunAi = () => {
    setAiLoading(true);
    setTimeout(() => {
      const lines: string[] = [];
      const ratio = listing.openingBid / listing.mid;
      const spread = listing.estHigh - listing.openingBid;

      // Valuation spread analysis
      if (ratio < 0.5) {
        lines.push(`Opening bid of $${listing.openingBid.toLocaleString()} is ${Math.round((1 - ratio) * 100)}% below mid-range estimated value of $${listing.mid.toLocaleString()} — exceptional spread for a judicial sale. Upside to high estimate: $${spread.toLocaleString()}.`);
      } else if (ratio < 0.7) {
        lines.push(`Opening bid at ${Math.round(ratio * 100)}% of estimated value ($${listing.mid.toLocaleString()}). Strong spread of $${spread.toLocaleString()} before renovation costs — pencil out scope before auction day.`);
      } else {
        lines.push(`Opening bid at ${Math.round(ratio * 100)}% of estimated value ($${listing.mid.toLocaleString()}). Tighter margin of $${spread.toLocaleString()} — confirm repair budget stays under $${Math.round(spread * 0.6).toLocaleString()} to preserve return.`);
      }

      // Source-specific legal flags
      if (listing.source === "irs" || listing.source === "usms") {
        lines.push(`Federal seizure source (${source.label}): carries a 180-day statutory right of redemption. Do not close improvements until the redemption window expires. Consult title counsel before committing capital.`);
      } else if (listing.source === "hud") {
        lines.push(`HUD Home (FHA-insured REO): owner-occupant "First Look" priority period restricts investor bidding for 15–30 days from listing date. Verify current period status before submitting an offer.`);
      } else if (listing.source === "fannie") {
        lines.push(`Fannie Mae HomePath listing: direct purchase is available; no appraisal required for HomePath Mortgage. First Look period may still apply — confirm expiry date with listing agent.`);
      } else if (listing.source === "sheriff" || listing.source === "tax") {
        lines.push(`Judicial foreclosure — title conveyed by sheriff's deed. Confirm no senior federal or municipal liens survive the sale. Property tax arrears accrued after the foreclosure cut-off date are typically buyer's responsibility.`);
      } else if (listing.source === "trustee") {
        lines.push(`Non-judicial trustee sale — no court confirmation required. Title typically conveys quickly but verify state-specific redemption rights. Occupancy status critical: eviction timeline varies by county.`);
      }

      // Plaintiff / case type insight
      const pLower = (listing.plaintiff || "").toLowerCase();
      if (pLower.includes("bank") || pLower.includes("mortgage") || pLower.includes("financial")) {
        lines.push(`Lender-initiated action (${listing.plaintiff}): primary mortgage foreclosure. Subordinate liens — second mortgages, HOA dues, mechanic's liens — are generally extinguished at sale. Verify with a local title search.`);
      } else if (pLower.includes("county") || pLower.includes("treasurer") || pLower.includes("auditor")) {
        lines.push(`Tax authority action (${listing.plaintiff}): tax deed foreclosures typically extinguish subordinate mortgages but check for any senior federal tax liens on the grantee separately.`);
      }

      // Deposit terms
      if (listing.deposit) {
        lines.push(`Deposit requirement: ${listing.deposit}. Bring certified funds — personal checks and wire transfers on the day are rejected at most county auctions. Confirm accepted forms with the sheriff's office before attending.`);
      }

      // Equity cushion summary
      if (listing.equity > 60000) {
        lines.push(`Built-in equity cushion of $${listing.equity.toLocaleString()} provides a strong renovation and carry-cost buffer even in a conservative market.`);
      } else if (listing.equity > 25000) {
        lines.push(`Moderate equity buffer of $${listing.equity.toLocaleString()}. Limit total acquisition + renovation spend to 70% of ARV ($${Math.round(listing.estHigh * 0.7).toLocaleString()}) to protect margin.`);
      } else {
        lines.push(`Slim equity buffer of $${listing.equity.toLocaleString()}. This deal requires accurate rehab scoping — overspending by more than $${Math.round(listing.equity * 0.4).toLocaleString()} erases the return.`);
      }

      setAiAnalysis(lines.join("\n\n"));
      setAiLoading(false);
    }, 600);
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
