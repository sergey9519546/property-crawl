"use client";

import { ArrowRight } from "lucide-react";
import { GsapReveal } from "./gsap-reveal";

/**
 * Pre-footer CTA: shallow neutral gray strip, horizontal composition.
 * Single dark button (no Talk to sales, no blue).
 */
export function FinalCta() {
  return (
    <section className="bg-paper py-24">
      <div className="mx-auto flex max-w-[1080px] flex-col items-start justify-between gap-6 px-5 sm:flex-row sm:items-center lg:px-8">
        <GsapReveal>
          <h2 className="text-title font-semibold tracking-[-0.02em] text-ink sm:text-display">
            Find your next auction deal.
          </h2>
          <p className="mt-3 max-w-[520px] text-body leading-relaxed text-ink-3">
            Browse upcoming sales free, or become a member to get an email when a new one fits.
          </p>
        </GsapReveal>
        <div className="flex shrink-0 items-center gap-3">
          <a
            href="/listings"
            className="inline-flex h-10 items-center justify-center rounded-control bg-ink px-5 text-meta font-semibold text-white transition-colors hover:bg-ink-2"
          >
            Browse listings
            <ArrowRight className="ml-1.5 h-4 w-4" />
          </a>
          <a
            href="/account"
            className="inline-flex h-10 items-center justify-center rounded-control border border-line-strong px-4 text-meta font-semibold text-ink-2 transition-colors hover:bg-card"
          >
            Become a member
          </a>
        </div>
      </div>
    </section>
  );
}
