"use client";

import React, { useState } from "react";
import { Listing } from "@/data/listings";
import { Calculator, AlertTriangle, CheckCircle2, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { computeCashToClose } from "@/lib/underwriting";

interface BiddingSimulatorProps {
  listing: Listing;
}

export function BiddingSimulator({ listing }: BiddingSimulatorProps) {
  const [rehabBudget, setRehabBudget] = useState<number>(25000);
  const [targetMargin, setTargetMargin] = useState<number>(30); // 30% margin (70% ARV rule)
  const [aiStrategy, setAiStrategy] = useState<string | null>(null);
  const [loadingStrategy, setLoadingStrategy] = useState<boolean>(false);
  
  const arv = listing.estHigh || listing.mid || 0;
  const targetPercentage = 1 - (targetMargin / 100);

  // Statutory closing-cost estimate (buyer's premium, poundage, transfer, deed fees).
  const feeSchedule = computeCashToClose({ openingBid: listing.openingBid, state: listing.state, source: listing.source });
  const closingCosts = feeSchedule.total - feeSchedule.openingBid;

  const targetProfit = Math.round(arv * (targetMargin / 100));
  const mao = Math.max(0, Math.floor(arv * targetPercentage - rehabBudget - closingCosts));
  
  // Calculate clearing probability
  let upsetBidCeiling = 0;
  if (listing.judgment && listing.judgment > 0) {
    upsetBidCeiling = Math.min(listing.judgment, arv * 0.8);
  } else if (listing.openingBid > 0) {
    upsetBidCeiling = listing.openingBid;
  }
  
  const marketClearingFloor = arv * 0.6;
  const expectedClearingPrice = Math.max(upsetBidCeiling, marketClearingFloor);
  
  let winProbability = 0;
  if (mao < listing.openingBid) {
    winProbability = 0;
  } else if (mao >= expectedClearingPrice * 1.2) {
    winProbability = 99;
  } else if (mao >= expectedClearingPrice) {
    const excess = mao - expectedClearingPrice;
    const margin = (expectedClearingPrice * 1.2) - expectedClearingPrice;
    winProbability = 50 + (excess / margin) * 49;
  } else if (mao >= upsetBidCeiling) {
    const excess = mao - upsetBidCeiling;
    const margin = expectedClearingPrice - upsetBidCeiling;
    winProbability = 10 + (margin > 0 ? (excess / margin) * 40 : 0);
  } else {
    winProbability = 5;
  }
  
  winProbability = Math.min(100, Math.floor(winProbability));

  const handleRunAiStrategy = async () => {
    setLoadingStrategy(true);
    try {
      if (typeof window !== "undefined" && (window as any).puter?.ai?.chat) {
        const prompt = `You are a seasoned real estate auction bidding strategist advising on this upcoming sheriff auction:
Address: ${listing.address}, ${listing.city}, ${listing.state}
Opening Upset Bid: $${listing.openingBid.toLocaleString()}
Estimated Market ARV: $${arv.toLocaleString()}
Target MAO: $${mao.toLocaleString()} (Win Probability: ${winProbability}%, Margin Target: ${targetMargin}%)
Rehab Budget: $${rehabBudget.toLocaleString()}
Deposit Terms: ${listing.deposit || 'Certified funds required'}

Provide a 3-point tactical auction floor gameplan:
1. **Opening Phase Strategy**: Wait or open aggressively?
2. **Counter-Bidding Pace**: Optimal increment jumps ($1k vs $5k) to deter amateur flippers.
3. **Hard Walk-Away**: Exact maximum bid ceiling before margin erosion.`;

        const resp = await (window as any).puter.ai.chat(prompt, { model: 'claude-3-5-sonnet' });
        const text = typeof resp === 'string' ? resp : resp?.message?.content || resp?.toString();
        if (text && text.trim().length > 30) {
          setAiStrategy(text);
          setLoadingStrategy(false);
          return;
        }
      }
    } catch (e) {
      console.warn("Puter AI strategy error:", e);
    }
    setAiStrategy(`• **Opening Phase Strategy**: Hold paddle until the second call to observe competing institutional bidders.
• **Counter-Bidding Pace**: Use aggressive $2,500 jump increments above $${listing.openingBid.toLocaleString()} to shake out emotional retail bidders.
• **Hard Walk-Away**: Strictly drop your paddle at $${mao.toLocaleString()} to protect your ${targetMargin}% margin.`);
    setLoadingStrategy(false);
  };

  return (
    <div className="space-y-6 animate-in fade-in">
      <div className="p-5 bg-white rounded-2xl border border-[#E5E7EB] shadow-sm space-y-5">
        <div className="flex items-center gap-2 mb-2">
          <Calculator className="w-5 h-5 text-[#0F172A]" />
          <h3 className="text-base font-bold text-[#111827]">Max Allowable Offer (MAO) Simulator</h3>
        </div>
        
        <div className="space-y-4">
          <div className="space-y-2">
            <div className="flex justify-between items-center text-sm font-semibold text-[#374151]">
              <label>Estimated Rehab Scope</label>
              <span>${rehabBudget.toLocaleString()}</span>
            </div>
            <input 
              type="range" 
              min="0" 
              max="150000" 
              step="5000"
              value={rehabBudget}
              onChange={(e) => setRehabBudget(Number(e.target.value))}
              className="w-full accent-[#0F172A]"
            />
            <div className="flex justify-between text-xs text-[#9CA3AF]">
              <span>$0</span>
              <span>$150k+</span>
            </div>
          </div>
          
          <div className="space-y-2">
            <div className="flex justify-between items-center text-sm font-semibold text-[#374151]">
              <label>Target Net Profit Margin</label>
              <span>{targetMargin}% (Target: ${targetProfit.toLocaleString()})</span>
            </div>
            <input 
              type="range" 
              min="10" 
              max="40" 
              step="5"
              value={targetMargin}
              onChange={(e) => setTargetMargin(Number(e.target.value))}
              className="w-full accent-[#0F172A]"
            />
            <div className="flex justify-between text-xs text-[#9CA3AF]">
              <span>10% (Risky)</span>
              <span>40% (Safe)</span>
            </div>
          </div>
        </div>

        <div className="pt-4 border-t border-[#E5E7EB] grid grid-cols-2 gap-4">
          <div className="p-3 bg-[#F8FAFC] rounded-xl border border-[#E5E7EB]">
            <p className="text-[11px] font-bold text-[#6B7280] uppercase">Target MAO</p>
            <p className="text-xl font-extrabold text-[#111827]">${mao.toLocaleString()}</p>
          </div>
          <div className="p-3 bg-[#F8FAFC] rounded-xl border border-[#E5E7EB]">
            <p className="text-[11px] font-bold text-[#6B7280] uppercase">Win Probability</p>
            <div className="flex items-center gap-1.5">
              <p className={cn("text-xl font-extrabold", winProbability >= 50 ? "text-[#16A34A]" : "text-amber-500")}>
                {winProbability}%
              </p>
            </div>
          </div>
        </div>
      </div>
      
      {/* Alert logic */}
      {mao < listing.openingBid ? (
        <div className="p-4 rounded-xl border border-red-200 bg-red-50 text-red-900 flex gap-3 text-sm">
          <AlertTriangle className="w-5 h-5 text-red-600 shrink-0" />
          <p>
            <strong>Warning: Underwater Deal.</strong> Your Max Allowable Offer (${mao.toLocaleString()}) is below the county upset bid (${listing.openingBid.toLocaleString()}). This deal does not pencil for your current rehab and margin constraints.
          </p>
        </div>
      ) : winProbability > 60 ? (
        <div className="p-4 rounded-xl border border-green-200 bg-green-50 text-green-900 flex gap-3 text-sm">
          <CheckCircle2 className="w-5 h-5 text-green-600 shrink-0" />
          <p>
            <strong>Strong Acquisition Profile.</strong> Your MAO (${mao.toLocaleString()}) clears the expected competitive threshold. You have a {winProbability}% chance of winning the deed.
          </p>
        </div>
      ) : (
        <div className="p-4 rounded-xl border border-amber-200 bg-amber-50 text-amber-900 flex gap-3 text-sm">
          <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />
          <p>
            <strong>Competitive Risk.</strong> Your MAO (${mao.toLocaleString()}) meets opening bid requirements but is likely to face competitive overbidding in this county.
          </p>
        </div>
      )}

      {/* AI Auction Strategy Card */}
      <div className="p-4 rounded-xl border border-slate-200 bg-[#F8FAFC] space-y-2.5 shadow-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-xs font-bold text-[#0F172A] uppercase tracking-wide">
            <Sparkles className="w-3.5 h-3.5 text-amber-500 fill-amber-500" />
            <span>Auction Room Tactics (Claude 3.5 Sonnet)</span>
          </div>
          {!aiStrategy && !loadingStrategy ? (
            <button
              onClick={handleRunAiStrategy}
              className="px-2.5 py-1 bg-[#0F172A] text-white text-[11px] font-bold rounded-lg hover:bg-slate-800 transition shadow-sm"
            >
              Simulate Floor Tactics
            </button>
          ) : !loadingStrategy && (
            <button
              onClick={handleRunAiStrategy}
              className="text-[11px] font-semibold text-slate-600 hover:text-slate-900 underline"
            >
              Re-simulate
            </button>
          )}
        </div>
        {loadingStrategy && (
          <p className="text-xs text-slate-500 animate-pulse">Synthesizing bidder psychology and increment strategies...</p>
        )}
        {aiStrategy && (
          <div className="text-xs text-slate-700 leading-relaxed space-y-1.5 pt-2 border-t border-slate-200 whitespace-pre-line">
            {aiStrategy}
          </div>
        )}
      </div>
    </div>
  );
}
