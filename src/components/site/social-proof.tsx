"use client";

import * as React from "react";
import { GsapReveal } from "./gsap-reveal";
import { SOURCES as SOURCE_TAXONOMY } from "@/components/terminal/property-data";
import { sourceDisplayText } from "@/lib/source-display";
import { fetchHealthSnapshot } from "@/lib/health-client";
import { useLocale } from "@/components/i18n/locale-provider";
import { formatLocaleNumber } from "@/lib/i18n/translator";

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
  const { locale, messages } = useLocale();
  const s = messages.home.socialProof;
  const [listings, setListings] = React.useState("…");
  const [sources, setSources] = React.useState("…");
  const [activeSources, setActiveSources] = React.useState<ActiveSourceItem[]>(
    DEFAULT_SOURCES.map((label) => ({ key: label, label, count: null })),
  );

  React.useEffect(() => {
    let cancelled = false;
    const fmt = (n: unknown) => (typeof n === "number" && Number.isFinite(n) ? formatLocaleNumber(locale, n) : "—");
    fetch("/api/listings?limit=1&summary=1", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: { total?: number | null }) => !cancelled && setListings(fmt(d.total)))
      .catch(() => !cancelled && setListings("—"));
    fetch("/api/coverage", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: { catalog?: { total?: number } }) => !cancelled && setSources(fmt(d.catalog?.total)))
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
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [locale]);

  return {
    counts: [
      { value: listings, label: s.listingsLabel },
      { value: sources, label: s.sourcesLabel },
    ],
    activeSources,
  };
}

export function SocialProof() {
  const { locale, messages } = useLocale();
  const s = messages.home.socialProof;
  const { counts, activeSources } = useLiveCounts();
  return (
    <section id="proof" className="px-5 pt-12 pb-16 lg:px-8">
      <GsapReveal className="mx-auto max-w-[1080px] rounded-card border border-line bg-card p-6 shadow-card sm:p-8">
        <div className="grid gap-8 lg:grid-cols-[auto_1fr] lg:items-center lg:gap-12">
          <dl className="flex gap-8 sm:gap-12">
            {counts.map((c) => (
              <div key={c.label} className="flex flex-col-reverse">
                <dt className="mt-1 text-meta text-ink-3">
                  <span className="mr-1.5 inline-flex rounded-full bg-go-wash px-2 py-0.5 text-label font-bold uppercase tracking-wider text-go">{s.liveBadge}</span>
                  {c.label}
                </dt>
                <dd className="text-title font-semibold tracking-[-0.02em] text-ink tabular-nums">{c.value}</dd>
              </div>
            ))}
          </dl>
          <div>
            <h2 className="text-lead font-semibold text-ink">{s.whereTitle}</h2>
            <ul className="mt-3 flex flex-wrap gap-2">
              {activeSources.map((src) => (
                <li key={src.key} className="rounded-full border border-line bg-paper px-3 py-1.5 text-meta font-medium text-ink">
                  {src.label}
                  {src.count !== null ? (
                    <span className="ml-1.5 text-ink-3 tabular-nums">({formatLocaleNumber(locale, src.count)})</span>
                  ) : null}
                </li>
              ))}
            </ul>
            <p className="mt-3 text-meta leading-5 text-ink-3">
              {locale === "en"
                ? "Public sale notices and government listings. Coverage varies by county. Names are for reference, not endorsements."
                : s.whereNote}
            </p>
          </div>
        </div>
      </GsapReveal>
    </section>
  );
}
