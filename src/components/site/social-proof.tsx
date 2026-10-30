"use client";

import * as React from "react";
import { GsapReveal } from "./gsap-reveal";

// Only source types that supply listings today (/api/health
// inventoryFreshness.bySource). No logos: these are agencies and sale types,
// not partners. Add one here when it starts serving listings, not before.
const SOURCES: string[] = [
  "HUD homes",
  "Foreclosure auctions",
  "Sheriff sales",
  "USDA homes",
  "GSA sales",
  "IRS seizures",
  "Treasury forfeitures",
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
    // The search total, not /api/health's count, which also counts court and parcel evidence rows.
    fetch("/api/listings?limit=1", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: { total?: number | null }) => !cancelled && setListings(format(d.total)))
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
    { value: sources, label: "public sources on our list" },
  ];
}

export function SocialProof() {
  const counts = useLiveCounts();
  return (
    <section id="proof" className="px-5 pt-12 pb-16 lg:px-8">
      <GsapReveal className="mx-auto max-w-[1080px] rounded-3xl border border-line bg-card/70 p-6 backdrop-blur sm:p-8">
        <div className="grid gap-8 lg:grid-cols-[auto_1fr] lg:items-center lg:gap-12">
          <dl className="flex gap-8 sm:gap-12">
            {counts.map((c) => (
              <div key={c.label} className="flex flex-col-reverse">
                <dt className="mt-1 text-[13px] text-ink-3">
                  <span className="mr-1.5 inline-flex rounded bg-go-wash px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-go">Live count</span>
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
                <li key={name} className="rounded-full border border-line bg-card px-3 py-1.5 text-[13px] font-medium text-ink">
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
