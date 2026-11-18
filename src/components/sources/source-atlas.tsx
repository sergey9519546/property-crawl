"use client";

import { BookOpen, ExternalLink, Layers3 } from "lucide-react";
import { useLocale } from "@/components/i18n/locale-provider";
import type { Messages } from "@/lib/i18n/messages";
import { sourceDisplayText } from "@/lib/source-display";

export type AtlasSource = { id: string; label: string; urls?: string[]; access?: string; authorStatus?: string; automationStatus?: string; evidenceClass?: string; capabilityClaim?: string; limitations?: string };
export type SourceAtlasData = { sources: AtlasSource[]; total: number; ledgerRows?: number; unmappedLedgerRows?: number };

function accessLabels(t: Messages["sourceAtlas"]): Record<string, string> {
  return {
    manual: t.accessManual,
    public: t.accessPublic,
    account: t.accessAccount,
    licensed: t.accessLicensed,
    jurisdiction: t.accessJurisdiction,
  };
}

function connectionLabels(t: Messages["sourceAtlas"]): Record<string, string> {
  return {
    backlog: t.connBacklog,
    manual: t.connManual,
    blocked: t.connBlocked,
    operational: t.connOperational,
  };
}

function reviewState(value: string | undefined, t: Messages["sourceAtlas"]) {
  if (!value) return { label: t.notReviewed, detail: t.noReviewRecorded };
  const prefixes: [string, string][] = [
    ["VERIFIED - official", t.revVerifiedOfficial],
    ["VERIFIED - first-party", t.revVerifiedFirstParty],
    ["VERIFIED - scope limited", t.revVerifiedScopeLimited],
    ["VERIFIED SOURCE - dynamic claim", t.revVerifiedDynamic],
    ["LIVE SOURCE - claim limited", t.revLiveLimited],
    ["INCONCLUSIVE - access blocked", t.revInconclusiveBlocked],
    ["DISCOVERY ONLY", t.revDiscoveryOnly],
  ];
  const match = prefixes.find(([prefix]) => value.startsWith(prefix));
  if (!match) return { label: t.needsReview, detail: value };
  return { label: match[1], detail: value.slice(match[0].length).trim() || t.noAdditionalLimitation };
}

function classification(value: string | undefined, labels: Record<string, string>, fallback: string) {
  return value ? labels[value.toLowerCase()] || value.replaceAll("_", " ") : fallback;
}

export function SourceAtlas({ atlas, storageMode }: { atlas?: SourceAtlasData; storageMode?: string }) {
  const { messages, format } = useLocale();
  const t = messages.sourceAtlas;
  if (!atlas) return null;
  const accessMap = accessLabels(t);
  const connectionMap = connectionLabels(t);
  return <section className="mt-9" aria-labelledby="source-atlas-heading">
    <details className="rounded-card border border-line bg-card px-5 shadow-sm sm:px-7">
      <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-4 py-5">
        <span><span className="flex items-center gap-2 text-xs font-bold uppercase tracking-[.15em] text-ink-2"><Layers3 size={16} />{t.eyebrow}</span><span id="source-atlas-heading" className="mt-1 block text-xl font-semibold">{t.heading}</span><span className="mt-1 block max-w-3xl text-sm leading-6 text-ink-2">{t.subtitle}</span></span>
        <span className="rounded-control bg-paper px-4 py-3 text-right text-xs"><strong className="block">{format(t.sourceRefsCount, { count: atlas.total })}</strong><span className="mt-1 block text-ink-3">{format(t.mentionsUnmapped, { mentions: atlas.ledgerRows ?? 0, unmapped: atlas.unmappedLedgerRows ?? 0 })}</span></span>
      </summary>
      <div className="border-t border-line pb-6 pt-5">
        {storageMode ? <p className="mb-4 text-xs text-ink-3">{format(t.coverageStoreLabel, { mode: storageMode })}</p> : null}
        <div className="grid min-w-0 gap-3 md:grid-cols-2 xl:grid-cols-3">{atlas.sources.map((source) => {
          const review = reviewState(source.authorStatus, t);
          return <article key={source.id} className="min-w-0 overflow-hidden break-words rounded-control border border-line bg-card p-4"><p className="text-label font-bold uppercase tracking-wide text-ink-2">{source.evidenceClass === "document_claim" ? t.referenceOnly : classification(source.evidenceClass, {}, t.referenceOnly)}</p><h3 className="mt-2 break-words font-semibold">{sourceDisplayText(source.label)}</h3>{source.capabilityClaim ? <p className="mt-2 break-words text-xs leading-5 text-ink-2">{sourceDisplayText(source.capabilityClaim)}</p> : null}<dl className="mt-3 space-y-2 text-xs text-ink-2"><div className="flex justify-between gap-3"><dt>{t.accessLabel}</dt><dd className="min-w-0 break-words text-right font-medium">{classification(source.access, accessMap, t.notEstablished)}</dd></div><div className="flex justify-between gap-3"><dt>{t.connectionLabel}</dt><dd className="min-w-0 break-words text-right font-medium">{classification(source.automationStatus, connectionMap, t.notConnected)}</dd></div><div className="flex justify-between gap-3"><dt>{t.reviewLabel}</dt><dd className="min-w-0 break-words text-right font-medium">{review.label}</dd></div></dl><p className="mt-3 break-words rounded-control bg-catch-wash p-3 text-xs leading-5 text-catch-ink">{sourceDisplayText(review.detail || source.limitations || t.reviewNeededFallback)}</p>{source.urls?.[0] ? <a href={source.urls[0]} target="_blank" rel="noreferrer" className="mt-4 inline-flex items-center gap-1 text-xs font-bold text-ink underline hover:text-ink-2">{t.reviewSourceLink} <ExternalLink size={12} /></a> : <p className="mt-4 flex items-center gap-1 text-xs text-ink-3"><BookOpen size={12} />{t.noPublicUrl}</p>}</article>;
        })}</div>
        {!atlas.sources.length ? <p className="rounded-control bg-paper p-4 text-sm text-ink-2">{t.emptyAtlas}</p> : null}
      </div>
    </details>
  </section>;
}
