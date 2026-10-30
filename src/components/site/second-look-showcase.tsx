"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowRight, Check, Clock3, ExternalLink, GitCompareArrows, RotateCcw, SearchCheck } from "lucide-react";
import { useWorkspaceSession } from "@/components/workspace/workspace-shell";

type ChangeItem = {
  id: string;
  label: string;
  before: string;
  after: string;
  reason: string;
  listingId?: string | null;
  observedAt?: string | null;
};

// Sample figures only. They link to search, never to a real listing, so a
// made-up price can't be read as that listing's history.
const DEMO_ITEMS: ChangeItem[] = [
  {
    id: "sample-sheriff",
    label: "Sheriff sale, second try",
    before: "$148,000",
    after: "$98,667",
    reason: "No one bid at the first sale, so the next one opened at two-thirds of the old amount.",
    observedAt: "Second sale",
  },
  {
    id: "sample-tax",
    label: "Tax deed, re-listed",
    before: "$62,500",
    after: "$41,200",
    reason: "The county re-listed the property after it didn't sell and lowered the opening bid.",
    observedAt: "County update",
  },
  {
    id: "sample-trustee",
    label: "Trustee sale, re-posted",
    before: "$210,000",
    after: "$175,000",
    reason: "The lender lowered its opening bid when it re-posted the sale.",
    observedAt: "Sale re-posted",
  },
];

function formatCurrency(val: number | null | undefined): string {
  if (val === null || val === undefined) return "Not listed";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(val);
}

export function SecondLookShowcase() {
  const session = useWorkspaceSession();
  const [items, setItems] = React.useState<ChangeItem[]>(DEMO_ITEMS);
  const [isLive, setIsLive] = React.useState(false);
  const [active, setActive] = React.useState<string>(DEMO_ITEMS[0].id);

  React.useEffect(() => {
    if (!session.authenticated) return;
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
            label: `Opening bid dropped ${Math.abs(Math.round((drop.deltaPct || 0) * 100))}%`,
            before: formatCurrency(drop.previousBid),
            after: formatCurrency(drop.currentBid),
            reason: drop.reason || `The opening bid went down by ${formatCurrency(Math.abs(drop.delta || 0))}.`,
            listingId: drop.listingId,
            observedAt: "Recently"
          }));
          setItems(mapped);
          setActive(mapped[0].id);
          setIsLive(true);
        }
      } catch {
        if (!unmounted) {
          setItems(DEMO_ITEMS);
        }
      }
    }
    void loadLiveFeed();
    return () => { unmounted = true; };
  }, [session.authenticated]);

  const selected = items.find((item) => item.id === active) || items[0] || null;

  return <section id="second-look" className="border-y border-line bg-paper px-5 py-20 sm:px-8 sm:py-28">
    <div className="mx-auto max-w-7xl">
      <div className="grid items-end gap-8 lg:grid-cols-[1fr_0.8fr]"><div><p className="text-xs font-bold uppercase tracking-[0.2em] text-ink-3">Second chances</p><h2 className="mt-4 max-w-4xl text-4xl font-semibold leading-[1.05] tracking-tight text-ink sm:text-6xl">No one bid? The price can come down.</h2></div><div><p className="text-base leading-7 text-ink-3">Properties that don&apos;t sell can come back with a lower opening bid. Members see price drops on saved listings in their portfolio, so they can take a second look before the next sale.</p><Link href="/account" className="mt-5 inline-flex items-center gap-2 text-sm font-bold text-ink underline hover:text-ink-2">Become a member <ArrowRight size={15} /></Link></div></div>
      <div className="mt-12 overflow-hidden rounded-3xl border border-line-strong bg-card shadow-[0_25px_80px_rgba(24,21,41,0.10)]">
        <div className="grid lg:grid-cols-[340px_1fr]">
          <div className="border-b border-line bg-ink p-6 text-white lg:border-b-0 lg:border-r">
            <p className="text-[10px] font-bold uppercase tracking-[0.17em] text-white/60">
              {isLive ? "Recent price drops" : "Sample figures"}
            </p>
            <h3 className="mt-3 text-2xl font-semibold">What changed?</h3>
            <p className="mt-2 text-sm leading-6 text-white/75">
              {isLive ? "Opening bids that recently went down." : "How a drop looks. Sample figures, not real listings."}
            </p>
            <div className="mt-6 space-y-2">
              {items.length === 0 ? <p className="text-sm text-white/75">No price drops to show yet.</p> : null}
              {items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={active === item.id}
                  onClick={() => setActive(item.id)}
                  className={`w-full rounded-xl border p-4 text-left transition ${active === item.id ? "border-white/60 bg-ink text-white" : "border-white/15 bg-white/5 hover:bg-white/10"}`}
                >
                  <span className="block text-xs font-bold">{item.label}</span>
                  <span className={`mt-1 block text-[11px] ${active === item.id ? "text-white" : "text-white/60"}`}>
                    {item.before} → {item.after}
                  </span>
                </button>
              ))}
            </div>
          </div>
          <div className="p-6 sm:p-8">
            {selected ? <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="inline-flex items-center gap-1.5 rounded-full bg-line px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-ink">
                  <RotateCcw size={12} /> Price drop
                </div>
                <h3 className="mt-4 text-2xl font-semibold text-ink">
                  {selected.label}
                </h3>
                {selected.listingId ? (
                  <p className="mt-1 font-mono text-xs font-semibold text-ink-3">
                    Listing: {selected.listingId}
                  </p>
                ) : null}
              </div>
            </div> : <p className="text-sm text-ink-3">No price drops to show yet.</p>}
            {selected ? <div className="mt-7 grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl bg-paper p-4">
                <GitCompareArrows size={17} className="text-ink" />
                <p className="mt-3 text-[10px] font-bold uppercase tracking-wider text-ink-3">Before</p>
                <p className="mt-1 text-lg font-semibold text-ink">{selected.before}</p>
              </div>
              <div className="rounded-xl bg-paper p-4">
                <SearchCheck size={17} className="text-ink" />
                <p className="mt-3 text-[10px] font-bold uppercase tracking-wider text-ink-3">Now</p>
                <p className="mt-1 text-lg font-semibold text-ink">{selected.after}</p>
              </div>
              <div className="rounded-xl bg-paper p-4">
                <Clock3 size={17} className="text-ink" />
                <p className="mt-3 text-[10px] font-bold uppercase tracking-wider text-ink-3">When</p>
                <p className="mt-1 text-lg font-semibold text-ink">{selected.observedAt || "—"}</p>
              </div>
            </div> : null}
            {selected ? <div className="mt-5 rounded-xl border border-line bg-paper p-5">
              <p className="flex items-center gap-2 text-sm font-bold text-ink">
                <Check size={16} /> What happened
              </p>
              <p className="mt-2 text-sm leading-6 text-ink-2">{selected.reason}</p>
            </div> : null}
            <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
              <span />
              {selected?.listingId ? (
                <Link
                  href={`/listings/${encodeURIComponent(selected.listingId)}`}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-ink px-3.5 py-2 text-xs font-semibold text-white hover:bg-ink-2"
                >
                  View listing <ExternalLink size={13} />
                </Link>
              ) : (
                <Link
                  href="/listings"
                  className="inline-flex items-center gap-1.5 rounded-lg bg-ink px-3.5 py-2 text-xs font-semibold text-white hover:bg-ink-2"
                >
                  Browse listings <ArrowRight size={13} />
                </Link>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>;
}
