"use client";

import * as React from "react";
import { GsapReveal } from "./gsap-reveal";
import { SOURCES as SOURCE_TAXONOMY } from "@/components/terminal/property-data";
import { sourceDisplayText } from "@/lib/source-display";
import { fetchHealthSnapshot } from "@/lib/health-client";

// Fallback labels shown before /api/health resolves or when the API is unavailable.
const DEFAULT_SOURCES: string[] = [
  "HUD Home",
  "Sheriff Sale",
  "Public Auction Network",
  "USDA RD/FSA REO",
  "GSA Surplus",
  "IRS Seized",
  "Treasury Forfeiture",
];

type Count = { value: string; label: string };
type ActiveSourceItem = { key: string; label: string; count: number | null };

function format(n: unknown): string {
  return typeof n === "number" && Number.isFinite(n) ? n.toLocaleString() : "—";
}

function sourceCount(entry: unknown): number {
  if (typeof entry === "number" && Number.isFinite(entry)) return entry;
  if (entry && typeof entry === "object") {
    const rec = entry as Record<string, unknown>;
    const raw = rec.total ?? rec.count ?? rec.fresh;
    if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  }
  return 0;
}

/** Live numbers and active sources from the API. Shows "—" rather than a made-up figure when one can't load. */
function useLiveCounts(): { counts: Count[]; activeSources: ActiveSourceItem[] } {
  const [listings, setListings] = React.useState("…");
  const [sources, setSources] = React.useState("…");
  const [activeSources, setActiveSources] = React.useState<ActiveSourceItem[]>(
    DEFAULT_SOURCES.map((label) => ({ key: label, label, count: null })),
  );

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
    fetchHealthSnapshot()
      .then((d: { inventoryFreshness?: { bySource?: Record<string, unknown> } }) => {
        if (cancelled) return;
        const bySource = d?.inventoryFreshness?.bySource;
        if (!bySource || typeof bySource !== "object") return;
        const resolved = Object.entries(bySource)
          .map(([key, entry]) => ({
            key,
            count: sourceCount(entry),
            label: sourceDisplayText(SOURCE_TAXONOMY[key]?.label || key),
          }))
          .filter((item) => item.count > 0)
          .sort((a, b) => b.count - a.count);
        if (resolved.length > 0) setActiveSources(resolved);
      })
      .catch(() => {
        // Preserve fallback source labels when /api/health is unavailable.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return {
    counts: [
      { value: listings, label: "listings on the site now" },
      { value: sources, label: "public sources on our list" },
    ],
    activeSources,
  };
}

export function SocialProof() {
  const { counts, activeSources } = useLiveCounts();
  return (
    <section id="proof" className="px-5 pt-12 pb-16 lg:px-8">
      <GsapReveal className="mx-auto max-w-[1080px] rounded-card border border-line bg-card p-6 shadow-card sm:p-8">
        <div className="grid gap-8 lg:grid-cols-[auto_1fr] lg:items-center lg:gap-12">
          <dl className="flex gap-8 sm:gap-12">
            {counts.map((c) => (
              <div key={c.label} className="flex flex-col-reverse">
                <dt className="mt-1 text-meta text-ink-3">
                  <span className="mr-1.5 inline-flex rounded-full bg-go-wash px-2 py-0.5 text-label font-bold uppercase tracking-wider text-go">Live count</span>
                  {c.label}
                </dt>
                <dd className="text-title font-semibold tracking-[-0.02em] text-ink tabular-nums">{c.value}</dd>
              </div>
            ))}
          </dl>
          <div>
            <h2 className="text-lead font-semibold text-ink">Where the listings come from</h2>
            <ul className="mt-3 flex flex-wrap gap-2">
              {activeSources.map((src) => (
                <li key={src.key} className="rounded-full border border-line bg-paper px-3 py-1.5 text-meta font-medium text-ink">
                  {src.label}
                  {src.count !== null ? (
                    <span className="ml-1.5 text-ink-3 tabular-nums">({src.count.toLocaleString()})</span>
                  ) : null}
                </li>
              ))}
            </ul>
            <p className="mt-3 text-meta leading-5 text-ink-3">
              Public sale notices and government listings. Coverage varies by county. Names are for reference, not endorsements.
            </p>
          </div>
        </div>
      </GsapReveal>
    </section>
  );
}
