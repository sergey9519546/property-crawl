"use client";

import { ArrowRight } from "lucide-react";
import { GsapReveal } from "./gsap-reveal";

/**
 * Pre-footer CTA: shallow neutral gray strip, horizontal composition.
 * Single dark button (no Talk to sales, no blue).
 */
export function FinalCta() {
  return (
    <section className="bg-[#F5F6F7] py-24">
      <div className="mx-auto flex max-w-[1080px] flex-col items-start justify-between gap-6 px-5 sm:flex-row sm:items-center lg:px-8">
        <GsapReveal>
          <h2 className="text-[26px] font-medium leading-[1.17] tracking-[-0.015em] text-[#111827] sm:text-[32px] lg:text-[36px]">
            From posted notice to bid, in one afternoon.
          </h2>
        </GsapReveal>
        <div className="flex shrink-0 items-center gap-3">
          <a
            href="#live-feed"
            className="inline-flex h-10 items-center justify-center rounded-[12px] bg-[#0F172A] px-5 text-[14px] font-semibold text-white transition-colors hover:bg-[#1E293B]"
          >
            Open the live feed
            <ArrowRight className="ml-1.5 h-4 w-4" />
          </a>
        </div>
      </div>
    </section>
  );
}
