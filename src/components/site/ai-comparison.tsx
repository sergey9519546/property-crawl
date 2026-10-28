"use client";

import { GsapStaggerGroup } from "./gsap-reveal";
import { SectionHeading } from "./section-heading";
import { Check, Sparkles } from "lucide-react";
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
      { label: "Search, map and sale calendar", ok: true },
      { label: "The catch on every listing page", ok: true },
      { label: "Deal Score where a value range is published", ok: true },
      { label: "Watchlist saved on this device", ok: true },
    ],
  },
  {
    name: "Member",
    tag: "Membership",
    highlight: true,
    cta: true,
    features: [
      { label: "Everything in Free", ok: true },
      { label: "Hunts that re-check for new listings", ok: true },
      { label: "Email when a new listing fits, or a saved one changes", ok: true },
      { label: "Price-drop alerts on saved listings", ok: true },
      { label: "Account watchlist and portfolio on any device", ok: true },
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
    <section id="pricing" className="scroll-mt-24 px-5 pt-24 pb-28 lg:px-8">
      <div className="mx-auto max-w-[880px]">
        <SectionHeading eyebrow="Pricing" title="Browse free. Pay when you want us to watch for you.">
          Everything you need to find a sale and see its catch is free. Members get an email the moment a new
          listing fits their hunt, or a saved one changes.
        </SectionHeading>

        <GsapStaggerGroup className="mt-12 grid grid-cols-1 gap-4 md:grid-cols-2" stagger={0.15}>
          {COLS.map((col) => (
            <div
              key={col.name}
              data-stagger-item
              className={`flex flex-col rounded-3xl border p-7 ${
                col.highlight
                  ? "border-ink bg-white shadow-[0_0_0_1px_#0F172A,0_18px_48px_rgba(15,23,42,0.12)]"
                  : "border-line bg-white/70"
              }`}
            >
              <div className="flex items-center justify-between">
                <h3 className="text-[18px] font-semibold text-ink">{col.name}</h3>
                {col.highlight && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-ink px-2.5 py-0.5 text-[11px] font-semibold text-white">
                    <Sparkles className="h-3 w-3" /> Alerts
                  </span>
                )}
              </div>
              <p className="mt-3 text-[28px] font-semibold tracking-[-0.02em] text-ink">
                {col.cta ? memberPrice ?? "Membership" : "$0"}
              </p>
              <p className="text-[13px] font-medium text-ink-3">{col.cta ? "Cancel any time from your account" : col.tag}</p>
              <ul className="mt-6 flex-1 space-y-3">
                {col.features.map((f) => (
                  <li key={f.label} className="flex items-start gap-2.5">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500/15">
                      <Check className="h-3 w-3 text-emerald-700" />
                    </span>
                    <span className="text-[14px] leading-6 text-ink">{f.label}</span>
                  </li>
                ))}
              </ul>
              {col.cta ? (
                <Link href="/account" className="mt-7 inline-flex h-11 w-full items-center justify-center rounded-xl bg-ink text-sm font-semibold text-white hover:bg-ink-2">
                  Become a member
                </Link>
              ) : (
                <Link href="/listings" className="mt-7 inline-flex h-11 w-full items-center justify-center rounded-xl border border-line-strong text-sm font-semibold text-ink hover:bg-white">
                  Start searching
                </Link>
              )}
            </div>
          ))}
        </GsapStaggerGroup>
        <p className="mt-6 text-center text-[13px] text-ink-3">
          Not included in either plan: title reports, comps, or a sale in every county. <a href="#faq" className="font-semibold text-ink underline underline-offset-4">Why?</a>
        </p>
      </div>
    </section>
  );
}
