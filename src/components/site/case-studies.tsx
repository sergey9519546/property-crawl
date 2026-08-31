"use client";

import { GsapReveal, GsapStaggerGroup } from "./gsap-reveal";
import { ArrowRight } from "lucide-react";

type Metric = {
  value: string;
  label: string;
  desc: string;
  tint: string;
};

const METRICS: Metric[] = [
  {
    value: "Live",
    label: "Connected property feed",
    desc: "A transparent beta dataset for exercising market search, filters, underwriting, and exports.",
    tint: "#DBEAFE",
  },
  {
    value: "11",
    label: "Source categories modeled",
    desc: "Federal, GSE, and county-source schemas normalized into one consistent property format.",
    tint: "#e7faef",
  },
  {
    value: "3",
    label: "Core beta workflows",
    desc: "Market discovery, supported notice parsing, and persistent watchlist exports are available today.",
    tint: "#E9D5FF",
  },
];

const CASES = [
  {
    metric: "Search",
    text: "City, county, state, ZIP, country, and nearby-address scopes",
    company: "Market discovery",
    href: "#hero",
  },
  {
    metric: "Parse",
    text: "Structured extraction for supported court notice formats",
    company: "Notice parser",
    href: "#live-feed",
  },
  {
    metric: "Export",
    text: "Persistent watchlists with CSV and JSON downloads",
    company: "Watchlist workflow",
    href: "#live-feed",
  },
];

export function CaseStudies() {
  return (
    <section id="customers" className="pt-24 pb-28 sm:pt-24 sm:pb-28">
      <div className="mx-auto max-w-[1080px] px-5 lg:px-8">
        <GsapReveal className="mx-auto max-w-[760px] text-center">
          <h2 className="text-[26px] font-medium leading-[1.17] tracking-[-0.015em] text-[#111827] sm:text-[32px] lg:text-[36px]">
            What is working in the beta today
          </h2>
        </GsapReveal>

        {/* Big metric cards */}
        <GsapStaggerGroup
          className="mt-12 grid grid-cols-1 gap-4 md:grid-cols-3"
          stagger={0.12}
        >
          {METRICS.map((m) => (
            <div
              key={m.label}
              data-stagger-item
              className="rounded-2xl border border-[#E5E7EB] bg-white p-7 transition-all duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] hover:-translate-y-0.5 hover:shadow-[0_1px_2px_rgba(17,24,39,0.05),0_12px_32px_rgba(17,24,39,0.08)]"
            >
              <span
                className="inline-block rounded-lg px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-[#111827]"
                style={{ backgroundColor: m.tint }}
              >
                Beta snapshot
              </span>
              <p className="mt-4 text-[44px] font-bold tracking-[-0.03em] text-[#111827]">
                {m.value}
              </p>
              <p className="mt-1 text-[15px] font-semibold text-[#111827]">{m.label}</p>
              <p className="mt-2 text-[14px] leading-[1.6] text-[#6B7280]">{m.desc}</p>
            </div>
          ))}
        </GsapStaggerGroup>

        {/* Case study links */}
        <GsapStaggerGroup
          className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3"
          stagger={0.1}
          delay={0.4}
        >
          {CASES.map((c) => (
            <a
              key={c.company}
              href={c.href}
              data-stagger-item
              className="group flex items-center gap-4 rounded-2xl border border-[#E5E7EB] bg-white p-5 transition-all duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] hover:-translate-y-0.5 hover:shadow-[0_1px_2px_rgba(17,24,39,0.05),0_8px_24px_rgba(17,24,39,0.06)]"
            >
              <span className="text-[28px] font-bold tracking-[-0.02em] text-[#0F172A]">
                {c.metric}
              </span>
              <div className="flex-1">
                <p className="text-[14px] font-medium text-[#111827]">{c.text}</p>
                <p className="text-[12px] text-[#6B7280]">Open the workflow</p>
              </div>
              <ArrowRight className="h-4 w-4 text-[#9CA3AF] transition-colors group-hover:text-[#0F172A]" />
            </a>
          ))}
        </GsapStaggerGroup>
      </div>
    </section>
  );
}
