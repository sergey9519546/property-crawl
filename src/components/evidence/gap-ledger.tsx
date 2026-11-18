"use client";

import * as React from "react";
import Link from "next/link";
import { Check, ExternalLink } from "lucide-react";
import { findGaps, type GapListing } from "@/lib/evidence";
import { useWorkspaceSession } from "@/components/workspace/workspace-shell";
import { readUnderwriteScenario } from "@/lib/underwrite-scenario";
import { useLocale } from "@/components/i18n/locale-provider";

/**
 * "What this listing can't tell you": the facts a buyer needs that the listing
 * does not publish, most important first, each with a way to find out.
 *
 * Rules: rows come only from fields that are actually empty; contacts are never
 * invented (we link the source notice or a generic action, nothing else); ticks
 * persist locally on this device and can also sync to an authenticated research
 * case on the workspace server.
 */
function useTicks(id: string) {
  const key = `pp:gaps:${id}`;
  const [ticks, setTicks] = React.useState<Record<string, boolean>>({});
  React.useEffect(() => {
    try {
      setTicks(JSON.parse(localStorage.getItem(key) || "{}") || {});
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
  const { locale, messages: m } = useLocale();
  const gaps = findGaps(listing);
  const [ticks, toggle] = useTicks(listing.id);
  const done = gaps.filter((g) => ticks[g.key]).length;
  const session = useWorkspaceSession();
  const [linkedCaseId, setLinkedCaseId] = React.useState<string | null>(null);
  const [syncBusy, setSyncBusy] = React.useState(false);
  const [syncNotice, setSyncNotice] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!session.authenticated || !listing.id) {
      setLinkedCaseId(null);
      return;
    }
    let cancelled = false;
    void fetch(`/api/workspace/cases?listingId=${encodeURIComponent(listing.id)}`, {
      cache: "no-store",
      credentials: "same-origin",
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled) return;
        const first = Array.isArray(data?.items) ? data.items[0] : null;
        setLinkedCaseId(typeof first?.id === "string" ? first.id : null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [session.authenticated, listing.id]);

  async function syncToWorkspaceCase() {
    if (!session.authenticated) {
      session.requestUnlock();
      return;
    }
    setSyncBusy(true);
    setSyncNotice(null);
    try {
      const underwriteScenario = readUnderwriteScenario(listing.id);
      const res = await fetch("/api/workspace/cases", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          listingId: listing.id,
          origin: { type: "manual" },
          underwriteScenario: underwriteScenario || undefined,
        }),
      });
      if (res.status === 401) {
        session.requestUnlock();
        throw new Error("Unlock operator session to sync.");
      }
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.case?.id) {
        throw new Error(data?.error || "Could not sync to research workspace.");
      }
      const caseRecord = data.case as {
        id: string;
        revision: number;
        state: string;
        decision?: { reasonCodes?: string[]; note?: string | null } | null;
      };
      setLinkedCaseId(caseRecord.id);

      const summaryLine = `[Gap Ledger: ${done}/${gaps.length} checked]`;
      if (
        (caseRecord.state === "pursue" || caseRecord.state === "pass") &&
        Number.isInteger(caseRecord.revision)
      ) {
        const existingNote = (caseRecord.decision?.note || "").trim();
        const cleanedNote = existingNote.replace(/\s*\[Gap Ledger:[^\]]*\]/g, "").trim();
        const nextNote = [cleanedNote, summaryLine].filter(Boolean).join(" ").slice(0, 2000);
        await fetch(`/api/workspace/cases/${encodeURIComponent(caseRecord.id)}`, {
          method: "PATCH",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            expectedRevision: caseRecord.revision,
            state: caseRecord.state,
            reasonCodes: caseRecord.decision?.reasonCodes || [],
            note: nextNote,
            underwriteScenario: underwriteScenario || undefined,
          }),
        }).catch(() => {});
      }
      setSyncNotice(`Synced with workspace case ${caseRecord.id}`);
    } catch (err) {
      setSyncNotice(err instanceof Error ? err.message : "Sync failed; ticks saved on this device.");
    } finally {
      setSyncBusy(false);
    }
  }

  return (
    <section aria-labelledby={`gaps-${listing.id}`} className={`rounded-card border border-catch/30 bg-card p-5 sm:p-6 ${className}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id={`gaps-${listing.id}`} className="text-title font-semibold tracking-[-0.01em] text-ink">
          {m.detailUi.gapLedgerHeading}
        </h2>
        <div className="flex flex-wrap items-center gap-3">
          {gaps.length ? (
            <p className="text-meta text-ink-3" aria-live="polite">
              {done} of {gaps.length} checked
            </p>
          ) : null}
          {session.authenticated ? (
            <button
              type="button"
              disabled={syncBusy}
              onClick={() => void syncToWorkspaceCase()}
              className="rounded-control border border-line-strong bg-paper px-2.5 py-1 text-xs font-semibold text-ink-2 transition hover:bg-line disabled:opacity-50"
            >
              {syncBusy ? m.common.checking : linkedCaseId ? m.detailUi.openResearchCaseBtn : m.detailUi.syncToResearchBtn}
            </button>
          ) : null}
        </div>
      </div>
      {syncNotice && (
        <p className="mt-1.5 text-meta text-ink-3" role="status">
          {syncNotice}
        </p>
      )}

      {gaps.length === 0 ? (
        <p className="mt-2 text-meta text-ink-2">
          {locale === "en" ? "This listing publishes every fact we track. Title, liens and condition still need your own check." : m.detailUi.allGapsChecked}
        </p>
      ) : (
        <ol className="mt-4 space-y-2">
          {gaps.map((gap) => {
            const checked = !!ticks[gap.key];
            return (
              <li key={gap.key} className={`rounded-control border p-4 transition-colors ${checked ? "border-line bg-paper" : "border-line bg-card"}`}>
                <div className="flex items-start gap-3">
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={checked}
                    aria-label={`I've checked: ${gap.fact}`}
                    onClick={() => toggle(gap.key)}
                    className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-control border transition-colors ${checked ? "border-ink bg-ink text-white" : "border-line-strong bg-card hover:border-ink-3"}`}
                  >
                    {checked ? <Check className="h-4 w-4" aria-hidden /> : null}
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className={`text-body font-semibold ${checked ? "text-ink-3 line-through" : "text-ink"}`}>{gap.fact}</p>
                      <span className="ev-unknown text-label font-semibold">{gap.reason}</span>
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
