"use client";

import { useState } from "react";
import { Video, Sparkles, CheckCircle2, RefreshCw, AlertTriangle } from "lucide-react";
import { Listing } from "@/data/listings";
import { displayText, knownNumber, positiveNumber } from "@/lib/listing-display";

interface DealVideoProps {
  listing: Listing;
}

export function DealVideoGenerator({ listing }: DealVideoProps) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [videoGenerated, setVideoGenerated] = useState(false);
  const [currentSlide, setCurrentSlide] = useState(0);

  const openingBid = positiveNumber(listing.openingBid);
  const estLow = positiveNumber(listing.estLow);
  const estHigh = positiveNumber(listing.estHigh);
  const dealScore = knownNumber(listing.dealScore);

  const generateVideo = () => {
    setIsGenerating(true);
    setTimeout(() => {
      setIsGenerating(false);
      setVideoGenerated(true);
      setCurrentSlide(0);
    }, 1200);
  };

  if (openingBid === null || estLow === null || estHigh === null || estLow > estHigh) {
    return (
      <div className="rounded-2xl border border-white/10 bg-[#0F172A] p-5 text-white shadow-xl">
        <div className="flex items-start gap-3 rounded-xl border border-amber-300/20 bg-amber-300/10 p-4">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
          <div>
            <h4 className="text-sm font-bold">Deal storyboard unavailable</h4>
            <p className="mt-1 text-xs leading-relaxed text-slate-300">
              A published opening amount and complete valuation range are required before financial scenes can be created.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const highValueDifference = estHigh - openingBid;
  const highValueComparison = `$${Math.abs(highValueDifference).toLocaleString()} ${highValueDifference >= 0 ? "above" : "below"} opening`;
  const location = [listing.city, listing.state].filter(Boolean).join(", ");
  const slides = [
    {
      title: "OPPORTUNITY REVEAL",
      badge: dealScore === null ? "SOURCE RECORD" : `MODELED SCORE ${Math.round(dealScore)}/99`,
      content: `${listing.address}${location ? `, ${location}` : ""}`,
      stat: `$${openingBid.toLocaleString()} Opening Bid`,
      color: "bg-[#16A34A]"
    },
    {
      title: "VALUATION SPREAD",
      badge: "ESTIMATED VALUE",
      content: `Modeled high value is ${highValueComparison}`,
      stat: `$${estLow.toLocaleString()} – $${estHigh.toLocaleString()}`,
      color: "bg-slate-800"
    },
    {
      title: "DUE-DILIGENCE CHECKPOINT",
      badge: "VERIFY BEFORE BIDDING",
      content: "Confirm title, occupancy, redemption rights, documents, and auction terms with the official source.",
      stat: `Occupancy: ${displayText(listing.occupancy)}`,
      color: "bg-[#0F172A]"
    }
  ];

  return (
    <div className="rounded-2xl border border-[#E5E7EB] bg-[#0F172A] p-5 text-white shadow-xl">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Video className="w-4 h-4 text-[#22C55E]" />
          <h4 className="text-sm font-bold">15s deal storyboard</h4>
        </div>
        <span className="text-[11px] font-mono bg-white/10 px-2 py-0.5 rounded text-slate-300">
          Preview only
        </span>
      </div>

      {!videoGenerated ? (
        <div className="text-center py-6 px-4 bg-white/5 rounded-xl border border-white/10">
          <p className="text-xs text-slate-300 mb-4 leading-relaxed">
            Build a local three-scene preview from the published opening amount and modeled valuation range. This does not produce or publish a finished video.
          </p>
          <button
            onClick={generateVideo}
            disabled={isGenerating}
            className="inline-flex items-center gap-2 bg-[#22C55E] hover:bg-[#16a34a] text-black font-bold px-4 py-2.5 rounded-xl text-xs transition"
          >
            {isGenerating ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                <span>Building storyboard...</span>
              </>
            ) : (
              <>
                <Sparkles className="w-3.5 h-3.5" />
                <span>Build storyboard preview</span>
              </>
            )}
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="relative aspect-video rounded-xl overflow-hidden border border-white/15 bg-gradient-to-br from-slate-900 via-slate-800 to-black flex flex-col justify-between p-4">
            <div className="flex items-center justify-between">
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded text-white ${slides[currentSlide].color}`}>
                {slides[currentSlide].badge}
              </span>
              <span className="text-[10px] font-mono text-slate-400">Scene {currentSlide + 1} / 3</span>
            </div>

            <div className="my-auto text-center space-y-1">
              <span className="text-[11px] font-mono text-[#22C55E] uppercase tracking-wider">{slides[currentSlide].title}</span>
              <h5 className="text-base font-bold text-white leading-tight">{slides[currentSlide].content}</h5>
              <p className="text-sm font-extrabold text-emerald-400">{slides[currentSlide].stat}</p>
            </div>

            <div className="flex items-center justify-between text-[11px] text-slate-400">
              <div className="flex items-center gap-1">
                {slides.map((_, idx) => (
                  <button
                    key={idx}
                    type="button"
                    aria-label={`Show storyboard scene ${idx + 1}`}
                    aria-pressed={idx === currentSlide}
                    onClick={() => setCurrentSlide(idx)}
                    className={`h-1.5 rounded-full transition-all ${idx === currentSlide ? "w-6 bg-[#22C55E]" : "w-2 bg-white/30"}`}
                  />
                ))}
              </div>
              <span className="font-mono">0:15 preview</span>
            </div>
          </div>

          <div className="flex items-center justify-between pt-1 text-xs">
            <div className="flex items-center gap-1.5 text-[#22C55E] font-medium">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Storyboard ready</span>
            </div>
            <button
              onClick={() => setVideoGenerated(false)}
              className="text-slate-400 hover:text-white text-[11px]"
            >
              Re-generate
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
