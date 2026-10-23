"use client";

import { GsapReveal, GsapStaggerGroup } from "./gsap-reveal";
import { Check, X, Sparkles } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

type Col = {
  name: string;
  tag: string;
  features: { label: string; ok: boolean }[];
  highlight?: boolean;
  cta?: boolean;
};

const COLS: Col[] = [
  {
    name: "Free",
    tag: "No account needed",
    features: [
      { label: "Market and source filters, map, calendar", ok: true },
      { label: "Listing pages with Deal Score and the catch", ok: true },
      { label: "Watchlist saved on this device", ok: true },
      { label: "Hunts and email alerts", ok: false },
    ],
  },
  {
    name: "Member",
    tag: "Monthly subscription",
    highlight: true,
    cta: true,
    features: [
      { label: "Hunts that re-run after every collection", ok: true },
      { label: "Email alerts on new matches and changes", ok: true },
      { label: "Saved searches with match alerts", ok: true },
      { label: "Account watchlist, portfolio, and price drops", ok: true },
    ],
  },
  {
    name: "Not connected yet",
    tag: "These are not active services",
    features: [
      { label: "Guaranteed complete national coverage", ok: false },
      { label: "Verified title reports and live comps", ok: false },
      { label: "Title and valuation still need verification", ok: false },
    ],
  },
];

function useMemberPrice() {
  const [label, setLabel] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/checkout", { cache: "no-store" })
      .then((response) => response.json())
      .then((body) => {
        const price = body?.price;
        if (cancelled || !price || typeof price.unitAmount !== "number" || typeof price.currency !== "string") return;
        const amount = new Intl.NumberFormat("en-US", { style: "currency", currency: price.currency.toUpperCase() }).format(price.unitAmount / 100);
        setLabel(price.interval ? `${amount} / ${price.interval}` : amount);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);
  return label;
}

export function AiComparison() {
  const memberPrice = useMemberPrice();
  return (
    <section id="pricing" className="pt-24 pb-28 sm:pt-24 sm:pb-28">
      <div className="mx-auto max-w-[1080px] px-5 lg:px-8">
        <GsapReveal className="mx-auto max-w-[760px] text-center">
          <h2 className="text-[26px] font-medium leading-[1.17] tracking-[-0.015em] text-[#111827] sm:text-[32px] lg:text-[36px]">
            Know what is ready. Know what needs review.
          </h2>
          <p className="mx-auto mt-4 max-w-[600px] text-[16px] leading-[1.6] text-[#5B6472] sm:text-[18px]">
            Browsing is free. A membership adds hunts that watch the inventory for
            you and email you when something changes. Unfinished services are
            listed as unfinished.
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
              <p className="mt-1 text-[13px] font-medium text-[#5B6472]">{col.cta && memberPrice ? memberPrice : col.tag}</p>
              <ul className="mt-5 space-y-3">
                {col.features.map((f) => (
                  <li key={f.label} className="flex items-center gap-2.5">
                    {f.ok ? (
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#0F172A]/10">
                        <Check className="h-3 w-3 text-[#0F172A]" />
                      </span>
                    ) : (
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#F3F4F6]">
                        <X className="h-3 w-3 text-[#5B6472]" />
                      </span>
                    )}
                    <span
                      className={`text-[14px] ${
                        f.ok ? "text-[#111827]" : "text-[#5B6472]"
                      }`}
                    >
                      {f.label}
                    </span>
                  </li>
                ))}
              </ul>
              {col.cta && (
                <Link href="/account" className="mt-6 inline-flex h-11 w-full items-center justify-center rounded-xl bg-[#0F172A] text-sm font-semibold text-white hover:bg-[#1E293B]">
                  Become a member
                </Link>
              )}
            </div>
          ))}
        </GsapStaggerGroup>
      </div>
    </section>
  );
}
