"use client";
import React, { useEffect } from "react";
import { PropertyListing, SOURCES } from "./property-data";
import { computeCashToClose } from "@/lib/underwriting";
import { X, Bookmark, FileText, Copy, Trash2 } from "lucide-react";

interface WatchlistProps {
  isOpen: boolean;
  onClose: () => void;
  savedListings: PropertyListing[];
  onRemove: (id: string) => void;
  onSelectListing: (listing: PropertyListing) => void;
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

  const exportCsv = () => {
    if (!savedListings.length) return;
    const headers = ["ID", "Address", "City", "State", "ZIP", "Source", "Opening Bid", "Est Low", "Est High", "Built-in Equity", "Deal Score", "Cash to Close", "Redemption Days", "Senior Lien Risk", "Sale Date", "Plaintiff", "Defendant"];
    const rows = savedListings.map(l => [
      l.id, `"${(l.address||'').replace(/"/g, '""')}"`, `"${l.city||''}"`, l.state, l.zip,
      `"${SOURCES[l.source]?.label||l.source}"`, l.openingBid, l.estLow, l.estHigh, l.equity ?? Math.max(0, (l.estLow + l.estHigh) / 2 - l.openingBid), l.dealScore,
      l.cashToClose ?? computeCashToClose({ openingBid: l.openingBid, state: l.state, source: l.source }).total, l.redemptionDays || 0, `"${(l.seniorLienRisk || 'normal').toLowerCase()}"`,
      l.saleDate, `"${(l.plaintiff||'').replace(/"/g, '""')}"`, `"${(l.defendant||'').replace(/"/g, '""')}"`
    ].join(","));
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
    const blob = new Blob([JSON.stringify(savedListings, null, 2)], { type: "application/json" });
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
                  <span className="text-[10px] uppercase font-bold text-slate-400 block">Total Required Capital</span>
                  <span className="font-extrabold text-sm text-white">
                    ${savedListings.reduce((sum, l) => sum + l.openingBid, 0).toLocaleString()}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-bold text-emerald-400 block">Total Built-in Equity</span>
                  <span className="font-extrabold text-sm text-[#22C55E]">
                    +${savedListings.reduce((sum, l) => sum + l.equity, 0).toLocaleString()}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-400 block">Avg Deal Score</span>
                  <span className="font-extrabold text-sm text-white">
                    {Math.round(savedListings.reduce((sum, l) => sum + l.dealScore, 0) / savedListings.length)}/100
                  </span>
                </div>
              </div>
              <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                {savedListings.length} tracked opportunities
              </span>
            </div>

            <div className="px-6 py-3 bg-[#F5F6F7] border-b border-[#E5E7EB] flex items-center justify-between">
              <span className="text-xs text-[#6B7280] font-medium">Sorted by soonest auction date</span>
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
            savedListings.map((l) => (
              <div
                key={l.id}
                className="flex items-center justify-between p-4 rounded-xl border border-[#E5E7EB] hover:border-[#0F172A] bg-white transition group"
              >
                <button
                  type="button"
                  onClick={() => { onSelectListing(l); onClose(); }}
                  className="flex min-w-0 flex-1 cursor-pointer items-center gap-4 text-left"
                >
                  <img src={l.photo} alt="" className="w-14 h-14 rounded-lg object-cover" />
                  <div className="min-w-0">
                    <p className="font-bold text-sm text-[#111827] truncate">{l.address}</p>
                    <p className="text-xs text-[#6B7280] truncate">
                      ${l.openingBid.toLocaleString()} · Sale: {l.saleDate}
                    </p>
                  </div>
                </button>

                <div className="flex items-center gap-3">
                  <span className="text-xs font-extrabold px-2.5 py-1 rounded-md bg-[#16A34A]/10 text-[#16A34A]">
                    {l.dealScore}/100
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
            ))
          )}
        </div>
      </div>
    </div>
  );
}
