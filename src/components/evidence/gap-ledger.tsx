"use client";

import * as React from "react";
import Link from "next/link";
import { Check, ExternalLink } from "lucide-react";
import { findGaps, type GapListing } from "@/lib/evidence";

/**
 * "What this listing can't tell you": the facts a buyer needs that the listing
 * does not publish, most important first, each with a way to find out.
 *
 * Rules: rows come only from fields that are actually empty; contacts are never
 * invented (we link the source notice or a generic action, nothing else); ticks
 * are stored on this device only.
 */
function useTicks(id: string) {
  const key = `pp:gaps:${id}`;
  const [ticks, setTicks] = React.useState<Record<string, boolean>>({});
  React.useEffect(() => {
    try {
      setTicks(JSON.parse(localStorage.getItem(key) || "{}"));
    } catch {
      /* Private mode or blocked storage: ticks just don't persist. */
    }
  }, [key]);
  const toggle = (gap: string) =>
    setTicks((current) => {
      const next = { ...current, [gap]: !current[gap] };
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        /* see above */
      }
      return next;
    });
  return [ticks, toggle] as const;
}

export function GapLedger({ listing, className = "" }: { listing: GapListing; className?: string }) {
  const gaps = findGaps(listing);
  const [ticks, toggle] = useTicks(listing.id);
  const done = gaps.filter((g) => ticks[g.key]).length;

  return (
    <section aria-labelledby={`gaps-${listing.id}`} className={`rounded-[var(--radius-card)] border border-[var(--catch-border)] bg-card p-5 sm:p-6 ${className}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id={`gaps-${listing.id}`} className="text-[18px] font-semibold tracking-[-0.01em] text-ink">
          What this listing can&apos;t tell you
        </h2>
        {gaps.length ? (
          <p className="text-meta text-ink-3" aria-live="polite">
            {done} of {gaps.length} checked
          </p>
        ) : null}
      </div>

      {gaps.length === 0 ? (
        <p className="mt-2 text-meta text-ink-2">
          This listing publishes every fact we track. Title, liens and condition still need your own check.
        </p>
      ) : (
        <ol className="mt-4 space-y-2">
          {gaps.map((gap) => {
            const checked = !!ticks[gap.key];
            return (
              <li key={gap.key} className={`rounded-xl border p-4 transition-colors ${checked ? "border-line bg-paper" : "border-line bg-card"}`}>
                <div className="flex items-start gap-3">
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={checked}
                    aria-label={`I've checked: ${gap.fact}`}
                    onClick={() => toggle(gap.key)}
                    className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border transition-colors ${checked ? "border-ink bg-ink text-white" : "border-line-strong bg-card hover:border-ink-3"}`}
                  >
                    {checked ? <Check className="h-4 w-4" aria-hidden /> : null}
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className={`text-body font-semibold ${checked ? "text-ink-3 line-through" : "text-ink"}`}>{gap.fact}</p>
                      <span className="ev-unknown text-[11px] font-semibold">{gap.reason}</span>
                    </div>
                    <p className="mt-1 text-meta text-ink-2">{gap.why}</p>
                    {gap.action.external ? (
                      <a href={gap.action.href} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-meta font-semibold text-ink underline underline-offset-4">
                        {gap.action.label} <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                      </a>
                    ) : (
                      <Link href={gap.action.href} className="mt-2 inline-flex text-meta font-semibold text-ink underline underline-offset-4">
                        {gap.action.label}
                      </Link>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
