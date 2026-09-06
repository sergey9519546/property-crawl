"use client";
import React, { useEffect } from "react";
import { PropertyListing, SOURCES } from "./property-data";
import { displayDate, displayMoney, knownNumber, positiveNumber, safeImageUrl } from "@/lib/listing-display";
import { sourceDisplayText } from "@/lib/source-display";
import { X, Bookmark, FileText, Copy, Trash2, ImageOff } from "lucide-react";

interface WatchlistProps {
  isOpen: boolean;
  onClose: () => void;
  savedListings: PropertyListing[];
  onRemove: (id: string) => void;
  onSelectListing: (listing: PropertyListing) => void;
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  let text = String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function supportedCashRequirement(listing: PropertyListing) {
  const details = listing.cashToCloseDetails && typeof listing.cashToCloseDetails === "object"
    ? listing.cashToCloseDetails
    : null;
  const model = typeof details?.model === "string" ? details.model : null;
  const basis = details?.basis && typeof details.basis === "object"
    ? details.basis as Record<string, unknown>
    : null;
  const supported = model === "explicit-cash-requirements-v2"
    || (model === "reported-cash-requirement-v1" && basis?.totalAcquisitionCost);
  if (!supported) return { status: "unresolved", totalAcquisitionCost: null, details: null };
  return {
    status: typeof details?.modelStatus === "string" ? details.modelStatus : "reported",
    totalAcquisitionCost: knownNumber(details?.totalAcquisitionCost ?? details?.totalCashToClose),
    details,
  };
}

function publicWatchlistListing(listing: PropertyListing) {
  const { equity, cashToClose, cashToCloseDetails, source, ...rest } = listing;
  const publicRest = {
    ...rest,
    raw: typeof rest.raw === "string" ? sourceDisplayText(rest.raw) : rest.raw,
    plaintiff: typeof rest.plaintiff === "string" ? sourceDisplayText(rest.plaintiff) : rest.plaintiff,
    defendant: typeof rest.defendant === "string" ? sourceDisplayText(rest.defendant) : rest.defendant,
    attorney: typeof rest.attorney === "string" ? sourceDisplayText(rest.attorney) : rest.attorney,
    deposit: typeof rest.deposit === "string" ? sourceDisplayText(rest.deposit) : rest.deposit,
    provenance: rest.provenance && typeof rest.provenance === "object"
      ? { ...rest.provenance, publisher: typeof rest.provenance.publisher === "string" ? sourceDisplayText(rest.provenance.publisher) : rest.provenance.publisher }
      : rest.provenance,
  };
  return {
    ...publicRest,
    source: sourceDisplayText(SOURCES[source]?.label || source),
    bidSpread: knownNumber((listing as PropertyListing & { bidSpread?: number | null }).bidSpread ?? equity),
    dealScoreMeaning: "Opening amount versus supported valuation-range midpoint; triage only, not an appraisal.",
    cashRequirement: supportedCashRequirement({ ...listing, cashToClose, cashToCloseDetails }),
  };
}

export function WatchlistModal({ isOpen, onClose, savedListings, onRemove, onSelectListing }: WatchlistProps) {
  useEffect(() => {
    if (!isOpen) return;
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
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const knownOpeningBids = savedListings
    .map((listing) => positiveNumber(listing.openingBid))
    .filter((value): value is number => value !== null);
  const knownBidSpreads = savedListings
    .map((listing) => knownNumber(listing.equity))
    .filter((value): value is number => value !== null);
  const knownScores = savedListings
    .map((listing) => knownNumber(listing.dealScore))
    .filter((value): value is number => value !== null);
  const totalOpeningBids = knownOpeningBids.length
    ? knownOpeningBids.reduce((sum, value) => sum + value, 0)
    : null;
  const totalBidSpread = knownBidSpreads.length
    ? knownBidSpreads.reduce((sum, value) => sum + value, 0)
    : null;
  const averageModeledScore = knownScores.length
    ? Math.round(knownScores.reduce((sum, value) => sum + value, 0) / knownScores.length)
    : null;

  const exportCsv = () => {
    if (!savedListings.length) return;
    const headers = ["ID", "Address", "City", "State", "ZIP", "Source", "Opening Bid", "Est Low", "Est High", "Bid Spread", "Deal Score (1-99, triage only)", "Cash Requirement Status", "Total Acquisition Cash", "Redemption Days", "Senior Lien Risk", "Sale Date", "Plaintiff", "Defendant"];
    const rows = savedListings.map((listing) => {
      const cash = supportedCashRequirement(listing);
      return [
      listing.id,
      listing.address,
      listing.city,
      listing.state,
      listing.zip,
      sourceDisplayText(SOURCES[listing.source]?.label || listing.source),
      listing.openingBid,
      listing.estLow,
      listing.estHigh,
      listing.equity,
      listing.dealScore,
      cash.status,
      cash.totalAcquisitionCost,
      listing.redemptionDays,
      listing.seniorLienRisk?.toLowerCase(),
      listing.saleDate,
      sourceDisplayText(listing.plaintiff || ""),
      sourceDisplayText(listing.defendant || ""),
    ].map(csvCell).join(",");
    });
    const csvContent = [headers.join(","), ...rows].join("\r\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "perfectproperty_watchlist.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const exportJson = () => {
    if (!savedListings.length) return;
    const blob = new Blob([JSON.stringify(savedListings.map(publicWatchlistListing), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "perfectproperty_watchlist.json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div
      className="fixed inset-0 z-50 overflow-hidden flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 animate-in fade-in"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="watchlist-title"
        className="w-full max-w-2xl bg-white rounded-2xl shadow-2xl border border-[#E5E7EB] overflow-hidden flex flex-col max-h-[85vh]"
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-[#E5E7EB] flex items-center justify-between bg-white">
          <div className="flex items-center gap-2">
            <Bookmark className="w-5 h-5 text-[#16A34A] fill-[#16A34A]" />
            <h3 id="watchlist-title" className="text-lg font-bold text-[#111827]">Saved Watchlist ({savedListings.length})</h3>
          </div>
          <button onClick={onClose} aria-label="Close watchlist" className="p-2 rounded-xl text-[#6B7280] hover:text-[#111827] hover:bg-[#F5F6F7]">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Action Bar */}
        {savedListings.length > 0 && (
          <>
            <div className="px-6 py-2.5 bg-[#0F172A] text-white flex flex-wrap items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-4">
                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-400 block">Known opening amounts</span>
                  <span className="font-extrabold text-sm text-white">
                    {displayMoney(totalOpeningBids)}
                  </span>
                  <span className="block text-[9px] text-slate-500">{knownOpeningBids.length}/{savedListings.length} published</span>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-bold text-emerald-400 block">Known bid spread</span>
                  <span className="font-extrabold text-sm text-[#22C55E]">
                    {displayMoney(totalBidSpread)}
                  </span>
                  <span className="block text-[9px] text-slate-500">{knownBidSpreads.length}/{savedListings.length} modeled</span>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-400 block">Avg modeled score</span>
                  <span className="font-extrabold text-sm text-white">
                    {averageModeledScore === null ? "Not modeled" : `${averageModeledScore}/99`}
                  </span>
                  <span className="block text-[9px] text-slate-500">{knownScores.length}/{savedListings.length} scored</span>
                </div>
              </div>
              <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                {savedListings.length} tracked opportunities
              </span>
            </div>

            <div className="px-6 py-3 bg-[#F5F6F7] border-b border-[#E5E7EB] flex items-center justify-between">
              <span className="text-xs text-[#6B7280] font-medium">Saved source records</span>
              <div className="flex items-center gap-2">
                <button
                  onClick={exportCsv}
                  className="px-3 py-1.5 bg-white border border-[#E5E7EB] text-xs font-bold text-[#111827] rounded-lg hover:bg-[#F5F6F7] transition flex items-center gap-1 shadow-sm"
                >
                  <FileText className="w-3.5 h-3.5 text-[#0F172A]" />
                  <span>Export CSV</span>
                </button>
                <button
                  onClick={exportJson}
                  className="px-3 py-1.5 bg-white border border-[#E5E7EB] text-xs font-bold text-[#111827] rounded-lg hover:bg-[#F5F6F7] transition flex items-center gap-1 shadow-sm"
                >
                  <Copy className="w-3.5 h-3.5 text-[#0F172A]" />
                  <span>Export JSON</span>
                </button>
              </div>
            </div>
          </>
        )}

        {/* Listings List */}
        <div className="p-6 overflow-y-auto space-y-3 flex-1">
          {savedListings.length === 0 ? (
            <div className="text-center py-12 text-[#6B7280] space-y-2">
              <Bookmark className="w-10 h-10 mx-auto text-[#9CA3AF]" />
              <p className="font-semibold text-[#111827]">No saved properties yet</p>
              <p className="text-xs">Click the bookmark icon on any auction listing or parsed notice to track it here.</p>
            </div>
          ) : (
            savedListings.map((l) => {
              const photoUrl = safeImageUrl(l.photo);
              const score = knownNumber(l.dealScore);
              return (
              <div
                key={l.id}
                className="flex items-center justify-between p-4 rounded-xl border border-[#E5E7EB] hover:border-[#0F172A] bg-white transition group"
              >
                <button
                  type="button"
                  onClick={() => { onSelectListing(l); onClose(); }}
                  className="flex min-w-0 flex-1 cursor-pointer items-center gap-4 text-left"
                >
                  {photoUrl ? (
                    <img src={photoUrl} alt="" className="h-14 w-14 rounded-lg object-cover" />
                  ) : (
                    <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-[#F5F6F7] text-[#9CA3AF]" aria-label="No source photo published">
                      <ImageOff className="h-4 w-4" />
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="font-bold text-sm text-[#111827] truncate">{l.address}</p>
                    <p className="text-xs text-[#6B7280] truncate">
                      {displayMoney(l.openingBid)} · Sale: {displayDate(l.saleDate)}
                    </p>
                  </div>
                </button>

                <div className="flex items-center gap-3">
                  <span className="text-xs font-extrabold px-2.5 py-1 rounded-md bg-[#16A34A]/10 text-[#16A34A]">
                    {score === null ? "Not modeled" : `${Math.round(score)}/99`}
                  </span>
                  <button
                    onClick={() => onRemove(l.id)}
                    aria-label={`Remove ${l.address} from watchlist`}
                    className="p-1.5 text-[#9CA3AF] hover:text-[#B91C1C] transition"
                    title="Remove from watchlist"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
