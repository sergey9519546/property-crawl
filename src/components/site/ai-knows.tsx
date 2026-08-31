"use client";

import { GsapReveal } from "./gsap-reveal";
import { Play } from "lucide-react";

const TAGS = ["ARVs", "Visuals", "Deal Stacks"];

export function AiKnows() {
  return (
    <section className="pt-24 pb-28 sm:pt-24 sm:pb-28">
      <div className="mx-auto max-w-[1080px] px-5 lg:px-8">
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-2 lg:items-center lg:gap-16">
          <GsapReveal>
            <h2 className="text-[26px] font-medium leading-[1.17] tracking-[-0.015em] text-[#111827] sm:text-[32px] lg:text-[36px]">
              AI that reads the legal notice. AI that knows the catch.
            </h2>
          </GsapReveal>
          <GsapReveal delay={0.1}>
            <p className="text-[16px] leading-[1.6] text-[#4B5563] sm:text-[18px]">
              Most distress deals are buried in legal prose &mdash; statutory
              publication, certified funds, redemption periods, confirmation-of-sale
              delays. PerfectProperty reads the notice the way an experienced
              investor would, and surfaces the parts that matter before you wire
              the deposit.
            </p>
          </GsapReveal>
        </div>

        <GsapReveal delay={0.15} y={32}>
          <div className="relative mt-12 overflow-hidden rounded-2xl border border-[#E5E7EB] bg-[#e7faef] shadow-[0_1px_2px_rgba(0,0,0,0.05),0_8px_24px_rgba(0,0,0,0.06)]">
            <div className="relative flex h-[300px] items-center justify-center sm:h-[400px]">
              {/* property backdrop */}
              <img
                src="https://images.unsplash.com/photo-1518780664697-55e3ad937233?auto=format&fit=crop&w=1400&q=70"
                alt="Property underwriting preview"
                className="absolute inset-0 h-full w-full object-cover opacity-[0.18]"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-[#e7faef] via-[#e7faef]/30 to-transparent" />

              <button
                aria-label="Play preview"
                className="group relative z-10 inline-flex h-16 w-16 items-center justify-center rounded-full bg-white text-[#111827] shadow-[0_8px_30px_rgba(0,0,0,0.18)] transition-transform duration-300 hover:scale-105"
              >
                <span className="absolute inset-0 rounded-full bg-white/60 blur-md" />
                <Play className="relative h-6 w-6 translate-x-[1px] fill-[#111827]" />
              </button>

              <div className="absolute bottom-5 left-5 right-5 z-10 flex flex-wrap items-end justify-between gap-3">
                <div>
                  <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[#3F6B00]">
                    Underwriting preview
                  </p>
                  <p className="text-[18px] font-bold text-[#111827]">
                    123 Main St &mdash; ARV $340k &middot; Profit $52k
                  </p>
                </div>
                <span className="rounded-full bg-white/80 px-3 py-1 text-[12px] font-semibold text-[#111827] backdrop-blur">
                  Generated in 6 min
                </span>
              </div>
            </div>
          </div>
        </GsapReveal>

        <GsapReveal delay={0.2}>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
            {TAGS.map((t) => (
              <span
                key={t}
                className="rounded-full border border-[#E5E7EB] bg-white px-4 py-1.5 text-[13px] font-semibold text-[#111827]"
              >
                {t}
              </span>
            ))}
          </div>
        </GsapReveal>
      </div>
    </section>
  );
}
