"use client";
import React from "react";
import { X, CheckCircle2, ShieldAlert, Sparkles } from "lucide-react";

interface VideoModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type WalkthroughListing = {
  id?: string;
  address?: string | null;
  county?: string | null;
  state?: string | null;
  source?: string | null;
  openingBid?: number | string | null;
  saleDate?: string | null;
  dealScore?: number | string | null;
  occupancy?: string | null;
};

function money(value: unknown): string {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return "Not published";
  return `$${Math.round(n).toLocaleString()}`;
}

export function VideoModal({ isOpen, onClose }: VideoModalProps) {
  const [listing, setListing] = React.useState<WalkthroughListing | null>(null);
  const [note, setNote] = React.useState("Reading the listing feed.");

  React.useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setNote("Reading the listing feed.");
    void fetch("/api/listings?limit=1&sort=date", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
      .then((data: { listings?: WalkthroughListing[] }) => {
        if (cancelled) return;
        const row = data.listings?.[0] ?? null;
        setListing(row);
        setNote(row ? "" : "The feed returned no listing.");
      })
      .catch(() => {
        if (!cancelled) {
          setListing(null);
          setNote("The listing feed did not return a record.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  React.useEffect(() => {
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

  return (
    <div
      className="fixed inset-0 z-50 overflow-hidden flex items-center justify-center bg-black/50 backdrop-blur-md p-4 animate-in fade-in"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="video-preview-title"
        className="w-full max-w-3xl bg-white rounded-3xl shadow-2xl border border-[#E5E7EB] overflow-hidden flex flex-col"
      >
        <div className="px-6 py-4 border-b border-[#E5E7EB] flex items-center justify-between bg-white">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-[#15803D]" />
            <h3 id="video-preview-title" className="text-lg font-bold text-[#111827]">Listing record</h3>
          </div>
          <button onClick={onClose} aria-label="Close preview" className="p-2 rounded-xl text-[#5B6472] hover:text-[#111827] hover:bg-[#F5F6F7]">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-8 space-y-6 bg-[#F5F6F7]">
          <div className="bg-white rounded-2xl p-6 border border-[#E5E7EB] shadow-sm space-y-4">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs font-mono font-bold px-2.5 py-1 bg-[#16A34A]/10 text-[#15803D] rounded-md">
                {listing?.source || note || "Listing"}
              </span>
              <span className="text-xs font-bold text-[#5B6472]">Score: {Number(listing?.dealScore) > 0 ? String(listing?.dealScore) : "—"}</span>
            </div>

            <h4 className="text-xl font-bold text-[#111827]">{listing?.address || note || "No listing returned"}</h4>

            <div className="grid grid-cols-3 gap-3 text-xs">
              <div className="p-3 bg-[#F5F6F7] rounded-xl"><span className="text-[#5B6472] block">Opening</span><strong className="text-sm font-bold text-[#111827]">{money(listing?.openingBid)}</strong></div>
              <div className="p-3 bg-[#F5F6F7] rounded-xl"><span className="text-[#5B6472] block">Sale date</span><strong className="text-sm font-bold text-[#111827]">{listing?.saleDate || "Not published"}</strong></div>
              <div className="p-3 bg-[#F5F6F7] rounded-xl"><span className="text-[#5B6472] block">Occupancy</span><strong className="text-sm font-bold text-[#111827]">{listing?.occupancy || "Not published"}</strong></div>
            </div>

            <div className="p-4 bg-[#F8FAFC] rounded-xl border border-[#E5E7EB] text-xs leading-relaxed space-y-2">
              <p className="font-bold text-[#111827]">Published fields</p>
              <div className="space-y-1.5 text-[#374151]">
                <p className="flex items-center gap-1.5"><CheckCircle2 className="w-3.5 h-3.5 text-[#15803D]" /> {[listing?.county, listing?.state].filter(Boolean).join(", ") || "County and state are not published."}</p>
                <p className="flex items-center gap-1.5"><ShieldAlert className="w-3.5 h-3.5 text-[#B91C1C]" /> No appraisal, comp, or lien amount is attached to this preview.</p>
              </div>
            </div>
            {listing?.id ? (
              <a href={`/listings/${encodeURIComponent(listing.id)}`} className="inline-flex text-xs font-bold text-[#0F172A] underline">Open this listing</a>
            ) : null}
          </div>

          <div className="flex justify-end">
            <button
              onClick={onClose}
              className="px-6 py-2.5 bg-[#0F172A] text-white font-bold text-xs rounded-xl hover:bg-[#1E293B] transition"
            >
              Close Walkthrough
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
