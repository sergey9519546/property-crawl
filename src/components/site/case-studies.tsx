"use client";

import * as React from "react";
import { GsapReveal, GsapStaggerGroup } from "./gsap-reveal";
import { ArrowRight } from "lucide-react";

type Metric = {
  value: string;
  label: string;
  desc: string;
  tint: string;
};

const INITIAL_METRICS: Metric[] = [
  {
    value: "…",
    label: "Listings right now",
    desc: "Checking the current number.",
    tint: "#E2E8F0",
  },
  {
    value: "…",
    label: "Sources on our list",
    desc: "Checking the current number.",
    tint: "#e7faef",
  },
  {
    value: "…",
    label: "Kinds of sources",
    desc: "Checking the current number.",
    tint: "#E9D5FF",
  },
];

const CASES = [
  {
    metric: "Search",
    text: "A first-time buyer in Ohio searches her county and sees upcoming sheriff sales on a list and a map.",
    company: "Market discovery",
    href: "#hero",
  },
  {
    metric: "Judge",
    text: "A small landlord opens a bank-owned home, reads the catch, and spots a lien risk before bidding.",
    company: "Notice parser",
    href: "/listings",
  },
  {
    metric: "Watch",
    text: "A flipper saves five listings and, as a member, gets an email if one changes its sale date.",
    company: "Watchlist workflow",
    href: "/listings",
  },
];

export function CaseStudies() {
  const [metrics, setMetrics] = React.useState<Metric[]>(INITIAL_METRICS);
  React.useEffect(() => {
    let cancelled = false;
    void fetch("/api/health", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
      .then((data: { dataMode?: string; inventoryFreshness?: { listings?: number | null } }) => {
        if (cancelled) return;
        const count = data.inventoryFreshness?.listings;
        setMetrics((current) => [
          {
            value: typeof count === "number" ? count.toLocaleString() : "Unavailable",
            label: "Listings right now",
            desc: typeof count === "number" ? "Listings on the site right now. The number changes as sales are added and end." : "We could not load this number right now.",
            tint: "#E2E8F0",
          },
          current[1],
          current[2],
        ]);
      })
      .catch(() => {
        if (cancelled) return;
        setMetrics((current) => [
          {
            value: "Unavailable",
            label: "Listings right now",
            desc: "We could not load this number right now.",
            tint: "#E2E8F0",
          },
          current[1],
          current[2],
        ]);
      });
    void fetch("/api/coverage", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
      .then((data: { catalog?: { total?: number; byCategory?: Record<string, number> } }) => {
        if (cancelled) return;
        const total = data.catalog?.total;
        const categories = data.catalog?.byCategory ? Object.keys(data.catalog.byCategory).length : null;
        setMetrics((current) => [
          current[0],
          {
            value: typeof total === "number" ? total.toLocaleString() : "Unavailable",
            label: "Sources on our list",
            desc: typeof total === "number" ? "Public websites and notices we know about. Not every one is collected yet." : "We could not load this number right now.",
            tint: "#e7faef",
          },
          {
            value: typeof categories === "number" ? String(categories) : "Unavailable",
            label: "Kinds of sources",
            desc: typeof categories === "number" ? "Groups the sources fall into, such as courts and federal agencies." : "We could not load this number right now.",
            tint: "#E9D5FF",
          },
        ]);
      })
      .catch(() => {
        if (cancelled) return;
        setMetrics((current) => [
          current[0],
          { value: "Unavailable", label: "Sources on our list", desc: "We could not load this number right now.", tint: "#e7faef" },
          { value: "Unavailable", label: "Kinds of sources", desc: "We could not load this number right now.", tint: "#E9D5FF" },
        ]);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return (
    <section id="customers" className="pt-24 pb-28 sm:pt-24 sm:pb-28">
      <div className="mx-auto max-w-[1080px] px-5 lg:px-8">
        <GsapReveal className="mx-auto max-w-[760px] text-center">
          <h2 className="text-[26px] font-medium leading-[1.17] tracking-[-0.015em] text-[#111827] sm:text-[32px] lg:text-[36px]">
            Ways buyers use it
          </h2>
          <p className="mt-3 text-[16px] leading-[1.6] text-[#5B6472]">
            These are made-up examples, not stories from real customers.
          </p>
        </GsapReveal>

        {/* Big metric cards */}
        <GsapStaggerGroup
          className="mt-12 grid grid-cols-1 gap-4 md:grid-cols-3"
          stagger={0.12}
        >
          {metrics.map((m) => (
            <div
              key={m.label}
              data-stagger-item
              className="rounded-2xl border border-[#E5E7EB] bg-white p-7 transition-all duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] hover:-translate-y-0.5 hover:shadow-[0_1px_2px_rgba(17,24,39,0.05),0_12px_32px_rgba(17,24,39,0.08)]"
            >
              <span
                className="inline-block rounded-lg px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-[#111827]"
                style={{ backgroundColor: m.tint }}
              >
                Live count
              </span>
              <p className="mt-4 text-[44px] font-bold tracking-[-0.03em] text-[#111827]">
                {m.value}
              </p>
              <p className="mt-1 text-[15px] font-semibold text-[#111827]">{m.label}</p>
              <p className="mt-2 text-[14px] leading-[1.6] text-[#5B6472]">{m.desc}</p>
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
                <p className="text-[12px] text-[#5B6472]">Example only. Open listings</p>
              </div>
              <ArrowRight className="h-4 w-4 text-[#5B6472] transition-colors group-hover:text-[#0F172A]" />
            </a>
          ))}
        </GsapStaggerGroup>
      </div>
    </section>
  );
}
