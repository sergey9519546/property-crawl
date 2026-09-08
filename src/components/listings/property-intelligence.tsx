'use client';

import { useCallback, useEffect, useState } from 'react';
import { sourceDisplayText } from '@/lib/source-display';
import { ArrowRight, Download, ExternalLink, Fingerprint, Loader2, Radar } from 'lucide-react';
import { OpportunitySignalsCard } from '@/components/listings/opportunity-signals-card';
import type { OpportunitySignal } from '@/components/listings/opportunity-signals-card';
import { DiscoveryEvidence, type DiscoveryEvidenceData } from '@/components/listings/discovery-evidence';

type Dossier = DiscoveryEvidenceData & {
  listingId: string; address: string; generatedAt: string; historyUnavailable: boolean;
  source: { status: string; publisher: string; url: string | null; observedAt: string | null; freshness: string; refreshDueAt: string | null };
  facts: { key: string; title: string; value: unknown; evidenceClass: string }[];
  signals: { id: string; title: string; field: string; before: unknown; after: unknown; observedAt: string }[];
  contradictions: { id: string; title: string; listingValue: number; publicRecordValue: number; unit: string; explanation: string; nextAction: string }[];
  gaps: { id: string; title: string; reason: string; nextAction: string }[];
  history: { firstObservedAt: string; observations: number } | null;
  opportunitySignals?: OpportunitySignal[];
  triagePriority?: number;
  opportunityWeights?: Record<string, number>;
  opportunitySummary?: { supported: number; unknown: number; contradicted: number };
  opportunityDisclaimer?: string;
  publicRecords: {
    issues: string[]; sources: { id: string; label: string; url: string; observedAt?: string }[];
    parcel: { status: string; rawParcelId?: string; properties: Record<string, unknown>; source?: { url: string } } | null;
    areaContext: { geographyLabel: string; geographyLevel: string; year: number; period: string; metrics: Record<string, unknown>; marginsOfError?: Record<string, unknown>; label: string } | null;
  } | null;
};

const moneyFields = new Set(['openingBid', 'assessed', 'medianHomeValue', 'medianHouseholdIncome', 'justValue', 'assessedValueSchool', 'assessedValueNonSchool']);
function valueLabel(value: unknown, key?: string): string {
  if (value === null || value === undefined || value === '') return 'Not established';
  if (typeof value === 'number') {
    if (key && moneyFields.has(key)) return value.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
    if (key === 'vacancyRate') return `${(value * 100).toFixed(1)}%`;
    return value.toLocaleString();
  }
  return sourceDisplayText(String(value));
}
const humanize = (value: string) => value.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
const date = (value: string) => new Date(value).toLocaleDateString();

export function PropertyIntelligence({ listingId }: { listingId: string }) {
  const [dossier, setDossier] = useState<Dossier | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(async (research = false) => {
    setBusy(true); setError('');
    try {
      const response = await fetch(research ? '/api/property-intelligence' : `/api/property-intelligence?listingId=${encodeURIComponent(listingId)}`, {
        method: research ? 'POST' : 'GET', cache: 'no-store',
        ...(research ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ listingId }) } : {}),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Property investigation could not be completed');
      setDossier(result);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Property investigation could not be completed'); }
    finally { setBusy(false); }
  }, [listingId]);
  useEffect(() => { setDossier(null); void load(); }, [load]);

  function exportDossier() {
    if (!dossier) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(dossier, null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `property-dossier-${dossier.address.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 100)}.json`; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm" aria-label="Property intelligence dossier">
    <div className="bg-[#0F172A] p-6 text-white">
      <p className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-400"><Fingerprint size={16} /> The evidence dossier</p>
      <h2 className="mt-2 text-2xl font-semibold tracking-tight">Find the angle. Understand the catch.</h2>
      <p className="mt-3 text-sm leading-6 text-slate-300">Connect the publisher’s record, observed changes, parcel evidence, and local context before deciding what to investigate next.</p>
      <div className="mt-5 flex flex-wrap gap-3"><button onClick={() => void load(true)} disabled={busy || dossier?.source.status !== 'source_observed'} className="flex items-center gap-2 rounded-lg bg-white px-4 py-2.5 text-xs font-bold text-[#0F172A] disabled:opacity-50">{busy ? <Loader2 size={15} className="animate-spin" /> : <Radar size={15} />}{busy ? 'Reading evidence…' : 'Investigate public records'}</button><button onClick={exportDossier} disabled={!dossier} className="flex items-center gap-2 rounded-lg border border-white/30 px-4 py-2.5 text-xs font-semibold disabled:opacity-40"><Download size={14} /> Export dossier</button></div>
    </div>
    <div className="space-y-6 p-6">
      {error && <p role="alert" className="rounded-lg bg-amber-50 p-4 text-sm text-amber-900">{error}</p>}
      {!dossier && !error && <p className="text-sm text-slate-500">Loading the source evidence…</p>}
      {dossier && <>
        {dossier.source.status === 'archived_publisher_snapshot' && <p className="rounded-lg bg-amber-50 p-4 text-xs leading-6 text-amber-900">This is a dated archive snapshot. Importing it does not verify current inventory, sale terms, bidding, or a completed sale.</p>}
        {dossier.source.freshness === 'stale' && <p className="rounded-lg bg-amber-50 p-4 text-xs leading-6 text-amber-900">The saved publisher observation needs refreshing. Confirm current availability and terms at the publisher. New public-record research has its own observation date.</p>}
        <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500"><p>{sourceDisplayText(dossier.source.publisher)} · {dossier.source.observedAt ? `Observed ${date(dossier.source.observedAt)}` : 'Snapshot requires source verification'}</p>{dossier.source.url && <a href={dossier.source.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-slate-900 underline hover:text-slate-700">Publisher record <ExternalLink size={12} /></a>}</div>
        {dossier.opportunitySignals && dossier.opportunitySignals.length > 0 && (
          <OpportunitySignalsCard
            listingId={listingId}
            initialData={{
              triagePriority: dossier.triagePriority ?? 0,
              signals: dossier.opportunitySignals,
              weights: dossier.opportunityWeights,
              summary: dossier.opportunitySummary,
              disclaimer: dossier.opportunityDisclaimer,
            }}
          />
        )}
        <div className="rounded-xl bg-slate-100 p-5"><h3 className="text-sm font-bold text-slate-950">The angle</h3>
          {dossier.signals.length || dossier.contradictions.length ? <div className="mt-3 space-y-4">
            {dossier.signals.slice(0, 3).map((signal) => <div key={signal.id}><p className="text-sm font-semibold">{signal.title}</p><p className="mt-1 text-sm text-slate-600">{valueLabel(signal.before, signal.field)} <ArrowRight className="mx-1 inline" size={13} /> {valueLabel(signal.after, signal.field)}</p><p className="mt-1 text-xs text-slate-500">Observed {date(signal.observedAt)}. Confirm the current offering.</p></div>)}
            {dossier.contradictions.map((item) => <div key={item.id}><p className="text-sm font-semibold">{item.title}</p><p className="mt-1 text-sm">Listing: {item.listingValue.toLocaleString()} {item.unit} · Parcel record: {item.publicRecordValue.toLocaleString()} {item.unit}</p><p className="mt-2 text-xs leading-6 text-slate-600">{item.explanation}</p><p className="mt-1 text-xs font-semibold">Next: {item.nextAction}</p></div>)}
          </div> : <p className="mt-2 text-sm leading-6 text-slate-600">{dossier.historyUnavailable ? 'Observation history is temporarily unavailable.' : dossier.history ? `${dossier.history.observations} source ${dossier.history.observations === 1 ? 'observation' : 'observations'} since ${date(dossier.history.firstObservedAt)}. No supported change or matched-record discrepancy has been established.` : 'No comparison history yet. Collect this source again to reveal changes; investigate public records to check the property evidence.'}</p>}
        </div>
        <div><h3 className="text-sm font-bold text-slate-950">Recorded facts and evidence status</h3><dl className="mt-3 divide-y divide-slate-100">{dossier.facts.map((fact) => <div key={fact.key} className="grid gap-1 py-2.5 text-xs sm:grid-cols-[1fr_1.4fr]"><dt className="text-slate-500">{fact.title}</dt><dd className="break-words font-medium">{valueLabel(fact.value, fact.key)}{fact.evidenceClass === 'unverified_snapshot' && <span className="ml-2 text-amber-700">Unverified snapshot</span>}</dd></div>)}</dl></div>
        {dossier.publicRecords && <>
          {dossier.publicRecords.parcel && <div className="rounded-xl border border-slate-200 p-4"><h3 className="text-sm font-bold">Parcel evidence · {humanize(dossier.publicRecords.parcel.status)}</h3>{dossier.publicRecords.parcel.status !== 'matched' && <p className="mt-2 text-xs leading-6 text-amber-800">Parcel identity is not confirmed. These records are candidates for investigation.</p>}<p className="mt-2 text-xs">Parcel identifier: {dossier.publicRecords.parcel.rawParcelId || 'Not established'}</p><dl className="mt-3 grid grid-cols-2 gap-3">{Object.entries(dossier.publicRecords.parcel.properties || {}).filter(([, value]) => value !== null && value !== undefined).map(([key, value]) => <div key={key}><dt className="text-[10px] text-slate-500">{humanize(key)}</dt><dd className="mt-1 break-words text-xs font-semibold">{valueLabel(value, key)}</dd></div>)}</dl></div>}
          {dossier.publicRecords.areaContext && <div className="rounded-xl border border-slate-200 p-4"><h3 className="text-sm font-bold">Neighborhood context</h3><p className="mt-2 text-xs leading-6 text-slate-500">{dossier.publicRecords.areaContext.geographyLabel} · {dossier.publicRecords.areaContext.period}. Area estimates; these do not establish this property’s value, occupancy, or residents’ characteristics.</p><dl className="mt-3 grid grid-cols-2 gap-3">{Object.entries(dossier.publicRecords.areaContext.metrics).map(([key, value]) => <div key={key}><dt className="text-[10px] text-slate-500">{humanize(key)}</dt><dd className="mt-1 text-sm font-semibold">{valueLabel(value, key)}</dd></div>)}</dl>{dossier.publicRecords.areaContext.marginsOfError && <details className="mt-3 text-xs text-slate-500"><summary className="cursor-pointer">Survey margins of error</summary><dl className="mt-2 space-y-1">{Object.entries(dossier.publicRecords.areaContext.marginsOfError).map(([key, value]) => <div key={key}>{humanize(key)}: ±{valueLabel(value, key)}</div>)}</dl></details>}</div>}
          {dossier.publicRecords.issues.length > 0 && <details open={!dossier.publicRecords.parcel && !dossier.publicRecords.areaContext} className="text-xs text-slate-600"><summary className="cursor-pointer font-semibold">Research coverage and unresolved lookups</summary><ul className="mt-3 space-y-2">{dossier.publicRecords.issues.map((issue) => <li key={issue}>{sourceDisplayText(issue)}</li>)}</ul></details>}
          <div className="flex flex-wrap gap-3">{dossier.publicRecords.sources.map((source) => <a key={`${source.id}:${source.url}`} href={source.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[10px] font-semibold text-slate-900 underline hover:text-slate-700">{sourceDisplayText(source.label)}<ExternalLink size={11} /></a>)}</div>
        </>}
        <DiscoveryEvidence evidence={dossier} />
        <details className="rounded-xl border border-slate-200 p-4"><summary className="cursor-pointer text-sm font-bold text-slate-950">The catch and the next move · {dossier.gaps.length} research questions</summary><div className="mt-4 space-y-4">{dossier.gaps.map((gap) => <div key={gap.id}><h4 className="text-xs font-bold">{gap.title}</h4><p className="mt-1 text-xs leading-6 text-slate-500">{gap.reason}</p><p className="mt-1 text-xs leading-6 text-emerald-800">Next: {gap.nextAction}</p></div>)}</div></details>
      </>}
    </div>
  </section>;
}
