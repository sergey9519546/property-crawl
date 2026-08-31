"use client";

import { GsapReveal, GsapStaggerGroup } from "./gsap-reveal";
import { ArrowRight } from "lucide-react";

const INTEGRATIONS = [
  "Scrapy",
  "Zyte",
  "Realie",
  "Attom",
  "PropStream",
  "BatchLeads",
  "Census",
  "FHFA",
  "Zillow",
  "Redfin",
  "OpenStreetMap",
  "Resend",
  "Stripe",
  "Supabase",
  "Cloudflare",
  "GitHub",
];

export function Integrations() {
  return (
    <section className="pt-24 pb-28 sm:pt-24 sm:pb-28">
      <div className="mx-auto max-w-[1080px] px-5 lg:px-8">
        <GsapReveal>
          <h2 className="text-center text-[26px] font-medium leading-[1.17] tracking-[-0.015em] text-[#111827] sm:text-[32px] lg:text-[36px]">
            Integrated with the tools you rely on.
          </h2>
        </GsapReveal>
        <GsapReveal delay={0.7}>
          <p className="mx-auto mt-4 max-w-[600px] text-center text-[16px] leading-[1.6] text-[#6B7280] sm:text-[18px]">
            Gather deep insights, drive action, and get more done with native
            integrations to the data sources and tools your stack already runs on.
          </p>
        </GsapReveal>

        {/* Logo wall — grayscale wordmarks, arcade-style */}
        <GsapStaggerGroup
          className="mt-12 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4"
          stagger={0.06}
        >
          {INTEGRATIONS.map((name) => (
            <div data-stagger-item key={name}>
              <div className="flex h-24 items-center justify-center rounded-2xl border border-[#E5E7EB] bg-white px-4 transition-all duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] hover:-translate-y-0.5 hover:shadow-[0_1px_2px_rgba(17,24,39,0.05),0_8px_24px_rgba(17,24,39,0.06)]">
                <span className="text-[17px] font-bold tracking-[-0.02em] text-[#111827] opacity-50 grayscale transition-all duration-200 hover:opacity-100 hover:grayscale-0">
                  {name}
                </span>
              </div>
            </div>
          ))}
        </GsapStaggerGroup>

        <GsapReveal delay={0.7}>
          <div className="mt-8 flex justify-center">
            <a
              href="#"
              className="inline-flex items-center gap-1.5 rounded-xl border border-[#E5E7EB] bg-white px-4 py-2.5 text-[14px] font-semibold text-[#111827] transition-colors hover:bg-[#F5F6F7]"
            >
              Explore all integrations
              <ArrowRight className="h-4 w-4" />
            </a>
          </div>
        </GsapReveal>
      </div>
    </section>
  );
}
