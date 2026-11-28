"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowRight, Check, Clock3, ExternalLink, GitCompareArrows, RotateCcw, SearchCheck } from "lucide-react";
import { useResolvedWorkspaceSession } from "@/components/workspace/workspace-shell";
import { useLocale } from "@/components/i18n/locale-provider";
import type { Locale } from "@/lib/i18n/config";
import { formatUsd } from "@/lib/i18n/translator";

type ChangeItem = {
  id: string;
  label: string;
  before: string;
  after: string;
  reason: string;
  listingId?: string | null;
  observedAt?: string | null;
};

function formatCurrency(val: number | null | undefined, notListedLabel: string, locale: Locale): string {
  if (val === null || val === undefined) return notListedLabel;
  return formatUsd(locale, val);
}

export function SecondLookShowcase() {
  const session = useResolvedWorkspaceSession();
  const { locale, messages, format } = useLocale();
  const sl = messages.home.secondLook;
  const demoItems: ChangeItem[] = React.useMemo(
    () => sl.demoItems.map((d) => ({ ...d })),
    [sl.demoItems],
  );
  const [liveItems, setLiveItems] = React.useState<ChangeItem[] | null>(null);
  const [active, setActive] = React.useState<string>(sl.demoItems[0].id);

  React.useEffect(() => {
    if (!(session?.memberTools || session?.authenticated)) return;
    let unmounted = false;
    async function loadLiveFeed() {
      try {
        const response = await fetch("/api/price-drops", { cache: "no-store", credentials: "same-origin" });
        if (!response.ok) return;
        const data = await response.json();
        const liveDrops = (data.drops || []).filter((d: { dropped: boolean; currentBid: number | null }) => d.dropped && d.currentBid != null);
        if (liveDrops.length > 0 && !unmounted) {
          const mapped: ChangeItem[] = liveDrops.slice(0, 4).map((drop: { listingId: string; previousBid: number | null; currentBid: number | null; deltaPct: number | null; delta: number | null; reason: string | null }, idx: number) => ({
            id: drop.listingId || `drop-${idx}`,
            label: format(sl.liveDropLabel, { pct: Math.abs(Math.round((drop.deltaPct || 0) * 100)) }),
            before: formatCurrency(drop.previousBid, messages.common.notPublished, locale),
            after: formatCurrency(drop.currentBid, messages.common.notPublished, locale),
            reason: drop.reason || format(sl.liveDropReason, { amount: formatCurrency(Math.abs(drop.delta || 0), messages.common.notPublished, locale) }),
            listingId: drop.listingId,
            observedAt: sl.observedRecently,
          }));
          setLiveItems(mapped);
          setActive(mapped[0].id);
        }
      } catch {
        if (!unmounted) setLiveItems(null);
      }
    }
    void loadLiveFeed();
    return () => { unmounted = true; };
  }, [session?.memberTools, session?.authenticated, locale, format, messages.common.notPublished, sl.liveDropLabel, sl.liveDropReason, sl.observedRecently]);

  const isLive = liveItems !== null && liveItems.length > 0;
  const items = isLive ? liveItems : demoItems;
  const selected = items.find((item) => item.id === active) || items[0] || null;

  return (
    <section id="second-look" className="border-y border-line bg-paper px-5 py-20 sm:px-8 sm:py-28">
      <div className="mx-auto max-w-7xl">
        <div className="grid items-end gap-8 lg:grid-cols-[1fr_0.8fr]">
          <div>
            <p className="text-label font-bold uppercase tracking-wider text-ink-3">{sl.eyebrow}</p>
            <h2 className="mt-4 max-w-4xl text-title font-semibold text-ink sm:text-display">{sl.title}</h2>
          </div>
          <div>
            <p className="text-body text-ink-2">
              {sl.subtitle}
            </p>
            <Link href="/account" className="mt-5 inline-flex items-center gap-2 text-meta font-bold text-ink underline hover:text-ink-2">
              {sl.becomeMember} <ArrowRight size={15} />
            </Link>
          </div>
        </div>

        <div className="mt-12 overflow-hidden rounded-card border border-line-strong bg-card shadow-raised">
          <div className="grid lg:grid-cols-[340px_1fr]">
            <div className="border-b border-line bg-paper p-6 text-ink lg:border-b-0 lg:border-r">
              <p className="text-label font-bold uppercase tracking-wider text-ink-3">
                {isLive ? sl.recentDrops : sl.sampleFigures}
              </p>
              <h3 className="mt-2 text-title font-semibold text-ink">{sl.whatChanged}</h3>
              <p className="mt-2 text-meta text-ink-2">
                {isLive ? sl.dropsLiveSub : sl.dropsSampleSub}
              </p>
              <div className="mt-6 space-y-2">
                {items.length === 0 ? <p className="text-meta text-ink-3">{sl.noDrops}</p> : null}
                {items.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    aria-pressed={active === item.id}
                    onClick={() => setActive(item.id)}
                    className={`w-full rounded-control border p-4 text-left transition ${
                      active === item.id
                        ? "border-line-strong bg-card text-ink shadow-sm ring-1 ring-ink/5"
                        : "border-transparent bg-paper/60 hover:bg-card/70 text-ink-2"
                    }`}
                  >
                    <span className="block text-meta font-bold">{item.label}</span>
                    <span className={`mt-1 block font-mono text-label ${active === item.id ? "text-ink font-semibold" : "text-ink-3"}`}>
                      {item.before} → {item.after}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div className="p-6 sm:p-8">
              {selected ? (
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="inline-flex items-center gap-1.5 rounded-full bg-line px-3 py-1 text-label font-bold uppercase tracking-wider text-ink">
                      <RotateCcw size={12} /> {sl.priceDropBadge}
                    </div>
                    <h3 className="mt-4 text-title font-semibold text-ink">
                      {selected.label}
                    </h3>
                    {selected.listingId ? (
                      <p className="mt-1 font-mono text-meta font-semibold text-ink-3">
                        {sl.listingPrefix} {selected.listingId}
                      </p>
                    ) : null}
                  </div>
                </div>
              ) : (
                <p className="text-meta text-ink-3">{sl.noDrops}</p>
              )}

              {selected ? (
                <div className="mt-7 grid gap-3 sm:grid-cols-3">
                  <div className="rounded-control border border-line bg-paper p-4">
                    <GitCompareArrows size={17} className="text-ink" />
                    <p className="mt-3 text-label font-bold uppercase tracking-wider text-ink-3">{sl.before}</p>
                    <p className="mt-1 font-mono text-lead font-semibold text-ink">{selected.before}</p>
                  </div>
                  <div className="rounded-control border border-line bg-paper p-4">
                    <SearchCheck size={17} className="text-ink" />
                    <p className="mt-3 text-label font-bold uppercase tracking-wider text-ink-3">{sl.now}</p>
                    <p className="mt-1 font-mono text-lead font-semibold text-ink">{selected.after}</p>
                  </div>
                  <div className="rounded-control border border-line bg-paper p-4">
                    <Clock3 size={17} className="text-ink" />
                    <p className="mt-3 text-label font-bold uppercase tracking-wider text-ink-3">{sl.when}</p>
                    <p className="mt-1 font-mono text-lead font-semibold text-ink">{selected.observedAt || "—"}</p>
                  </div>
                </div>
              ) : null}

              {selected ? (
                <div className="mt-5 rounded-control border border-line bg-paper p-5">
                  <p className="flex items-center gap-2 text-meta font-bold text-ink">
                    <Check size={16} /> {sl.whatHappened}
                  </p>
                  <p className="mt-2 text-body text-ink-2">{selected.reason}</p>
                </div>
              ) : null}

              <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
                <span />
                {selected?.listingId ? (
                  <Link
                    href={`/listings/${encodeURIComponent(selected.listingId)}`}
                    className="inline-flex items-center gap-1.5 rounded-control bg-ink px-4 py-2 text-meta font-semibold text-white hover:bg-ink-2"
                  >
                    {sl.viewListing} <ExternalLink size={13} />
                  </Link>
                ) : (
                  <Link
                    href="/listings"
                    className="inline-flex items-center gap-1.5 rounded-control bg-ink px-4 py-2 text-meta font-semibold text-white hover:bg-ink-2"
                  >
                    {messages.common.browseListings} <ArrowRight size={13} />
                  </Link>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
