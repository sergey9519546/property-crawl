"use client";

import * as React from "react";
import { GsapReveal } from "./gsap-reveal";

// Plain-text list of the public source types we read. No logos: these are
// agencies and sale types, not partners.
const SOURCES: string[] = [
  "HUD homes",
  "Fannie Mae and Freddie Mac bank-owned homes",
  "Sheriff sales",
  "Trustee sales",
  "County tax sales",
  "IRS and Treasury seizures",
  "USDA and VA homes",
  "GSA and US Marshals sales",
  "Land banks",
];

type Count = { value: string; label: string };

function format(n: unknown): string {
  return typeof n === "number" && Number.isFinite(n) ? n.toLocaleString() : "—";
}

/** Live numbers from the API. Shows "—" rather than a made-up figure when one can't load. */
function useLiveCounts(): Count[] {
  const [listings, setListings] = React.useState("…");
  const [sources, setSources] = React.useState("…");
  React.useEffect(() => {
    let cancelled = false;
    fetch("/api/health", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: { inventoryFreshness?: { listings?: number | null } }) => !cancelled && setListings(format(d.inventoryFreshness?.listings)))
      .catch(() => !cancelled && setListings("—"));
    fetch("/api/coverage", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: { catalog?: { total?: number } }) => !cancelled && setSources(format(d.catalog?.total)))
      .catch(() => !cancelled && setSources("—"));
    return () => {
      cancelled = true;
    };
  }, []);
  return [
    { value: listings, label: "listings on the site now" },
    { value: sources, label: "public sources we track" },
  ];
}

export function SocialProof() {
  const counts = useLiveCounts();
  return (
    <section id="proof" className="px-5 pt-12 pb-16 lg:px-8">
      <GsapReveal className="mx-auto max-w-[1080px] rounded-3xl border border-line bg-white/70 p-6 backdrop-blur sm:p-8">
        <div className="grid gap-8 lg:grid-cols-[auto_1fr] lg:items-center lg:gap-12">
          <dl className="flex gap-8 sm:gap-12">
            {counts.map((c) => (
              <div key={c.label} className="flex flex-col-reverse">
                <dt className="mt-1 text-[13px] text-ink-3">
                  <span className="mr-1.5 inline-flex rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-800">Live count</span>
                  {c.label}
                </dt>
                <dd className="text-[34px] font-semibold tracking-[-0.03em] text-ink tabular-nums">{c.value}</dd>
              </div>
            ))}
          </dl>
          <div>
            <h2 className="text-[15px] font-semibold text-ink">Where the listings come from</h2>
            <ul className="mt-3 flex flex-wrap gap-2">
              {SOURCES.map((name) => (
                <li key={name} className="rounded-full border border-[rgba(17,24,39,0.10)] bg-white px-3 py-1.5 text-[13px] font-medium text-ink">
                  {name}
                </li>
              ))}
            </ul>
            <p className="mt-3 text-[12px] leading-5 text-ink-3">
              Public sale notices and government listings. Coverage varies by county. Names are for reference, not endorsements.
            </p>
          </div>
        </div>
      </GsapReveal>
    </section>
  );
}
