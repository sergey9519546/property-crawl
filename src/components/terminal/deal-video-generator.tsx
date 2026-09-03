"use client";

import { useState } from "react";
import { Video, Sparkles, CheckCircle2, RefreshCw } from "lucide-react";
import { Listing } from "@/data/listings";

interface DealVideoProps {
  listing: Listing;
}

export function DealVideoGenerator({ listing }: DealVideoProps) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [videoGenerated, setVideoGenerated] = useState(false);
  const [currentSlide, setCurrentSlide] = useState(0);

  const generateVideo = () => {
    setIsGenerating(true);
    setTimeout(() => {
      setIsGenerating(false);
      setVideoGenerated(true);
      setCurrentSlide(0);
    }, 1200);
  };

  const slides = [
    {
      title: "OPPORTUNITY REVEAL",
      badge: "DEAL SCORE " + listing.dealScore + "/100",
      content: `${listing.address}, ${listing.city} ${listing.state}`,
      stat: `$${listing.openingBid.toLocaleString()} Opening Bid`,
      color: "bg-[#16A34A]"
    },
    {
      title: "VALUATION SPREAD",
      badge: "ESTIMATED VALUE",
      content: `Spread: +$${(listing.estHigh - listing.openingBid).toLocaleString()} Potential Margin`,
      stat: `$${listing.estLow.toLocaleString()} - $${listing.estHigh.toLocaleString()}`,
      color: "bg-slate-800"
    },
    {
      title: "AI FINE-PRINT ANALYSIS",
      badge: "THE CATCH",
      content: "Clear title with standard tax lien subordination and estimated repairs factored.",
      stat: "Underwritten by PerfectProperty AI",
      color: "bg-[#0F172A]"
    }
  ];

  return (
    <div className="rounded-2xl border border-[#E5E7EB] bg-[#0F172A] p-5 text-white shadow-xl">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Video className="w-4 h-4 text-[#22C55E]" />
          <h4 className="text-sm font-bold">AI 15s Deal Teaser Generator</h4>
        </div>
        <span className="text-[11px] font-mono bg-white/10 px-2 py-0.5 rounded text-slate-300">
          HyperFrames v2
        </span>
      </div>

      {!videoGenerated ? (
        <div className="text-center py-6 px-4 bg-white/5 rounded-xl border border-white/10">
          <p className="text-xs text-slate-300 mb-4 leading-relaxed">
            Auto-synthesize parcel photography, valuation bands, and risk highlights into a 15-second deal video reel for investor outreach.
          </p>
          <button
            onClick={generateVideo}
            disabled={isGenerating}
            className="inline-flex items-center gap-2 bg-[#22C55E] hover:bg-[#16a34a] text-black font-bold px-4 py-2.5 rounded-xl text-xs transition"
          >
            {isGenerating ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                <span>Synthesizing Kinetic Reel...</span>
              </>
            ) : (
              <>
                <Sparkles className="w-3.5 h-3.5" />
                <span>Generate 15s Deal Video Reel</span>
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
                    onClick={() => setCurrentSlide(idx)}
                    className={`h-1.5 rounded-full transition-all ${idx === currentSlide ? "w-6 bg-[#22C55E]" : "w-2 bg-white/30"}`}
                  />
                ))}
              </div>
              <span className="font-mono">0:15 HD Ready</span>
            </div>
          </div>

          <div className="flex items-center justify-between pt-1 text-xs">
            <div className="flex items-center gap-1.5 text-[#22C55E] font-medium">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Reel generated</span>
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
