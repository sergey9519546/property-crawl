"use client";

import { GsapReveal, GsapStaggerGroup } from "./gsap-reveal";
import { Check, X, Sparkles } from "lucide-react";

type Col = {
  name: string;
  tag: string;
  features: { label: string; ok: boolean }[];
  highlight?: boolean;
};

const COLS: Col[] = [
  {
    name: "Research workspace",
    tag: "Available in this beta",
    features: [
      { label: "Market and source filters", ok: true },
      { label: "Source-observed record labels", ok: true },
      { label: "Exact listing detail pages", ok: true },
      { label: "Local watchlists and saved searches", ok: true },
      { label: "CSV and JSON watchlist exports", ok: true },
    ],
  },
  {
    name: "Evidence and judgment",
    tag: "Review required for each property",
    features: [
      { label: "Published facts separated from models", ok: true },
      { label: "Notice extraction for supported formats", ok: true },
      { label: "Publisher photos when source-matched", ok: true },
      { label: "Qualified Street View fallback", ok: true },
      { label: "Title and valuation require verification", ok: false },
    ],
  },
  {
    name: "Not connected yet",
    tag: "These are not active services",
    highlight: false,
    features: [
      { label: "Cloud accounts and device sync", ok: false },
      { label: "Email and background search alerts", ok: false },
      { label: "Guaranteed complete national coverage", ok: false },
      { label: "Verified title reports and live comps", ok: false },
    ],
  },
];

export function AiComparison() {
  return (
    <section id="pricing" className="pt-24 pb-28 sm:pt-24 sm:pb-28">
      <div className="mx-auto max-w-[1080px] px-5 lg:px-8">
        <GsapReveal className="mx-auto max-w-[760px] text-center">
          <h2 className="text-[26px] font-medium leading-[1.17] tracking-[-0.015em] text-[#111827] sm:text-[32px] lg:text-[36px]">
            Know what is ready. Know what needs review.
          </h2>
          <p className="mx-auto mt-4 max-w-[600px] text-[16px] leading-[1.6] text-[#6B7280] sm:text-[18px]">
            The research workspace is free during beta. Source evidence, modeled
            scenarios, and unfinished services are kept separate so you can make
            an informed next move.
          </p>
        </GsapReveal>

        <GsapStaggerGroup
          className="mt-12 grid grid-cols-1 gap-4 md:grid-cols-3"
          stagger={0.15}
        >
          {COLS.map((col) => (
            <div
              key={col.name}
              data-stagger-item
              className={`rounded-2xl border p-6 transition-all duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] ${
                col.highlight
                  ? "border-[#0F172A] bg-white shadow-[0_0_0_1px_#0F172A,0_12px_32px_rgba(15,23,42,0.10)]"
                  : "border-[#E5E7EB] bg-white"
              }`}
            >
              <div className="flex items-center justify-between">
                <h3 className="text-[18px] font-semibold text-[#111827]">{col.name}</h3>
                {col.highlight && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-[#0F172A] px-2.5 py-0.5 text-[11px] font-semibold text-white">
                    <Sparkles className="h-3 w-3" /> Best
                  </span>
                )}
              </div>
              <p className="mt-1 text-[13px] font-medium text-[#6B7280]">{col.tag}</p>
              <ul className="mt-5 space-y-3">
                {col.features.map((f) => (
                  <li key={f.label} className="flex items-center gap-2.5">
                    {f.ok ? (
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#0F172A]/10">
                        <Check className="h-3 w-3 text-[#0F172A]" />
                      </span>
                    ) : (
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#F3F4F6]">
                        <X className="h-3 w-3 text-[#9CA3AF]" />
                      </span>
                    )}
                    <span
                      className={`text-[14px] ${
                        f.ok ? "text-[#111827]" : "text-[#9CA3AF]"
                      }`}
                    >
                      {f.label}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </GsapStaggerGroup>
      </div>
    </section>
  );
}
