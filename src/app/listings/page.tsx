import React from "react";
import { Metadata } from "next";
import { GrainOverlay } from "@/components/site/grain-overlay";
import { SiteHeader } from "@/components/site/site-header";
import { InteractiveTerminal } from "@/components/terminal/interactive-terminal";
import { SiteFooter } from "@/components/site/site-footer";
import { Building2, ShieldCheck, Sparkles } from "lucide-react";

export const metadata: Metadata = {
  title: "Live Distressed Property Feed & Auction Terminal | PerfectProperty",
  description: "Browse 580+ live foreclosure auctions, sheriff sales, and government-seized properties across 15 sources. Filter by Deal Score, equity spread, and redemption delays.",
  openGraph: {
    title: "Live Distressed Property Feed | PerfectProperty",
    description: "Real-time distressed foreclosure inventory across 15 government & county auction sources.",
  }
};

export default function ListingsDirectoryPage() {
  return (
    <main className="relative min-h-screen max-w-full overflow-x-hidden bg-[#F5F6F7] text-[#111827]">
      <GrainOverlay />
      <SiteHeader />

      {/* Directory Banner Header */}
      <div className="pt-28 pb-8 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto">
        <div className="p-6 sm:p-8 rounded-3xl bg-[#0F172A] text-white shadow-xl relative overflow-hidden">
          <div className="relative z-10 max-w-3xl space-y-3">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-300 text-xs font-bold uppercase tracking-wider">
              <Sparkles className="w-3.5 h-3.5" />
              <span>Live Auction Directory</span>
            </div>
            <h1 className="text-2xl sm:text-4xl font-extrabold tracking-tight">
              Live National Distressed Property Inventory
            </h1>
            <p className="text-sm sm:text-base text-slate-300 leading-relaxed">
              Synthesizing 15 federal, GSE, and county sheriff dockets. Every deal is analyzed with built-in equity spreads, Deal Scores, and Puter AI title risk assessments.
            </p>
            <div className="flex flex-wrap items-center gap-4 pt-2 text-xs text-slate-400">
              <span className="flex items-center gap-1.5">
                <Building2 className="w-4 h-4 text-emerald-400" />
                <span>580+ Verified Assets</span>
              </span>
              <span className="flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                <span>15 Scraper Sources Active</span>
              </span>
            </div>
          </div>
          {/* Subtle background glow */}
          <div className="absolute -right-20 -bottom-20 w-80 h-80 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />
        </div>
      </div>

      {/* Live Interactive Terminal */}
      <section className="pb-16">
        <InteractiveTerminal />
      </section>

      <SiteFooter />
    </main>
  );
}
