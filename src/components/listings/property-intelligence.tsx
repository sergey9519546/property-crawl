'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { sourceDisplayText } from '@/lib/source-display';
import { ArrowRight, Download, ExternalLink, Loader2, Radar } from 'lucide-react';
import { OpportunitySignalsCard } from '@/components/listings/opportunity-signals-card';
import type { ComponentScore, OpportunitySignal } from '@/components/listings/opportunity-signals-card';
import { DiscoveryEvidence, type DiscoveryEvidenceData } from '@/components/listings/discovery-evidence';
import { useWorkspaceSession } from '@/components/workspace/workspace-shell';

type Dossier = DiscoveryEvidenceData & {
  listingId: string; address: string; generatedAt: string; historyUnavailable: boolean;
  source: { status: string; publisher: string; url: string | null; observedAt: string | null; freshness: string; refreshDueAt: string | null };
  facts: { key: string; title: string; value: unknown; evidenceClass: string }[];
  signals: { id: string; title: string; field: string; before: unknown; after: unknown; observedAt: string }[];
  contradictions: { id: string; title: string; listingValue: number; publicRecordValue: number; unit: string; explanation: string; nextAction: string }[];
  gaps: { id: string; title: string; reason: string; nextAction: string; potentialPointsGain?: number; priorityTier?: string }[];
  history: { firstObservedAt: string; observations: number } | null;
  trajectory?: { priorPostponements: number; statutoryStayExhausted: boolean; cumulativeBidDropPct: number | null };
  opportunitySignals?: OpportunitySignal[];
  triagePriority?: number;
  opportunityWeights?: Record<string, number>; componentScores?: Record<string, ComponentScore>;
  opportunitySummary?: { supported: number; unknown: number; contradicted: number };
  opportunityDisclaimer?: string;
  hudSafmr?: { zip: string; bedrooms: number; fairMarketRent: number; paymentStandard90: Record<string, number>; paymentStandard110: Record<string, number>; rents: Record<string, number> } | null;
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

export function PropertyIntelligence({ listingId, documentsShown = false }: { listingId: string; documentsShown?: boolean }) {
  const session = useWorkspaceSession();
  const [dossier, setDossier] = useState<Dossier | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const generation = useRef(0);
  const publicRequest = useRef<AbortController | null>(null);
  const researchRequest = useRef<AbortController | null>(null);
  const loadPublic = useCallback(async (requestGeneration: number) => {
    publicRequest.current?.abort();
    const controller = new AbortController(); publicRequest.current = controller;
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/property-intelligence?listingId=${encodeURIComponent(listingId)}`, { cache: 'no-store', signal: controller.signal });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Property investigation could not be completed');
      if (requestGeneration !== generation.current || controller.signal.aborted) return;
      setDossier(result);
    } catch (caught) { if (!(caught instanceof DOMException && caught.name === 'AbortError') && requestGeneration === generation.current) setError(caught instanceof Error ? caught.message : 'Property investigation could not be completed'); }
    finally { if (requestGeneration === generation.current && publicRequest.current === controller) setBusy(false); }
  }, [listingId]);
  useEffect(() => { const requestGeneration=++generation.current;researchRequest.current?.abort();setDossier(null);void loadPublic(requestGeneration);return()=>{publicRequest.current?.abort();researchRequest.current?.abort();}; }, [loadPublic]);

  async function research() {
    if (!session.authenticated) { session.requestUnlock(); return; }
    researchRequest.current?.abort(); const controller=new AbortController();researchRequest.current=controller;
    const requestGeneration=generation.current;setBusy(true);setError('');
    try {
      const response=await fetch('/api/property-intelligence',{method:'POST',cache:'no-store',credentials:'same-origin',signal:controller.signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({listingId})});
      if(response.status===401){await session.refresh();session.requestUnlock();throw new Error('Your workspace session expired. Unlock it to check public records.');}
      const result=await response.json();if(!response.ok)throw new Error(result.error||'Property investigation could not be completed');
      if(requestGeneration!==generation.current||controller.signal.aborted)return;setDossier(result);
    } catch(caught){if(!(caught instanceof DOMException&&caught.name==='AbortError')&&requestGeneration===generation.current)setError(caught instanceof Error?caught.message:'Property investigation could not be completed');}
    finally{if(requestGeneration===generation.current&&researchRequest.current===controller)setBusy(false);}
  }

  function exportDossier() {
    if (!dossier) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(dossier, null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `property-dossier-${dossier.address.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 100)}.json`; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return <section className="overflow-hidden rounded-2xl border border-line bg-card shadow-sm" aria-label="Property intelligence dossier">
    <div className="border-b border-line p-5 sm:p-6">
      <h2 className="text-xl font-semibold tracking-tight text-ink">Research &amp; history</h2>
      <p className="mt-2 text-sm leading-6 text-ink-3">Review changes, compare public records, and check missing details.</p>
      <div className="mt-4 flex flex-wrap gap-3"><button onClick={() => void research()} disabled={busy || dossier?.source.status !== 'source_observed'} className="flex min-h-11 items-center gap-2 rounded-lg bg-ink px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{busy ? <Loader2 size={15} className="animate-spin" /> : <Radar size={15} />}{busy ? 'Checking records…' : 'Check public records'}</button><button onClick={exportDossier} disabled={!dossier} className="flex min-h-11 items-center gap-2 rounded-lg border border-line px-4 py-2.5 text-sm font-semibold text-ink-2 disabled:opacity-40"><Download size={14} /> Download evidence</button></div>
    </div>
    <div className="space-y-5 p-5 sm:p-6">
      {error && <p role="alert" className="rounded-lg bg-catch-wash p-4 text-sm text-catch-ink">{error}</p>}
      {!dossier && !error && <p className="text-sm text-ink-3">Loading the source evidence…</p>}
      {dossier && <>
        {dossier.source.status === 'archived_publisher_snapshot' && <p className="rounded-lg bg-catch-wash p-4 text-xs leading-6 text-catch-ink">This is a dated archive snapshot. Importing it does not verify current inventory, sale terms, bidding, or a completed sale.</p>}
        {dossier.source.freshness === 'stale' && <p className="rounded-lg bg-catch-wash p-4 text-xs leading-6 text-catch-ink">The saved publisher observation needs refreshing. Confirm current availability and terms at the publisher. New public-record research has its own observation date.</p>}
        <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-ink-3"><p>{sourceDisplayText(dossier.source.publisher)} · {dossier.source.observedAt ? `Observed ${date(dossier.source.observedAt)}` : 'Snapshot requires source verification'}</p>{dossier.source.url && <a href={dossier.source.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-ink underline hover:text-ink-2">Publisher record <ExternalLink size={12} /></a>}</div>
        <div className="rounded-xl bg-paper p-4"><h3 className="text-sm font-semibold text-ink">Changes &amp; discrepancies</h3>
          {dossier.trajectory && (dossier.trajectory.priorPostponements > 0 || dossier.trajectory.cumulativeBidDropPct !== null) && (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs" data-testid="dossier-trajectory-summary">
              {dossier.trajectory.priorPostponements > 0 && (
                <span className="rounded-full border border-line bg-card px-2.5 py-0.5 font-semibold text-ink-2">
                  {dossier.trajectory.priorPostponements} prior {dossier.trajectory.priorPostponements === 1 ? 'postponement' : 'postponements'}
                </span>
              )}
              {dossier.trajectory.statutoryStayExhausted && (
                <span className="rounded-full border border-catch/30 bg-catch-wash px-2.5 py-0.5 font-semibold text-catch-ink">
                  Statutory adjournments exhausted
                </span>
              )}
              {dossier.trajectory.cumulativeBidDropPct !== null && (
                <span className="rounded-full border border-line bg-paper px-2.5 py-0.5 font-semibold text-ink-2">
                  Cumulative bid drop: -{dossier.trajectory.cumulativeBidDropPct}%
                </span>
              )}
            </div>
          )}
          {dossier.signals.length || dossier.contradictions.length ? <div className="mt-3 space-y-4">
            {dossier.signals.slice(0, 3).map((signal) => <div key={signal.id}><p className="text-sm font-semibold">{signal.title}</p><p className="mt-1 text-sm text-ink-3">{valueLabel(signal.before, signal.field)} <ArrowRight className="mx-1 inline" size={13} /> {valueLabel(signal.after, signal.field)}</p><p className="mt-1 text-xs text-ink-3">Observed {date(signal.observedAt)}. Confirm the current offering.</p></div>)}
            {dossier.contradictions.map((item) => <div key={item.id}><p className="text-sm font-semibold">{item.title}</p><p className="mt-1 text-sm">Listing: {item.listingValue.toLocaleString()} {item.unit} · Parcel record: {item.publicRecordValue.toLocaleString()} {item.unit}</p><p className="mt-2 text-xs leading-6 text-ink-3">{item.explanation}</p><p className="mt-1 text-xs font-semibold">Next: {item.nextAction}</p></div>)}
          </div> : <p className="mt-2 text-sm leading-6 text-ink-3">{dossier.historyUnavailable ? 'Observation history is temporarily unavailable.' : dossier.history ? `${dossier.history.observations} source ${dossier.history.observations === 1 ? 'observation' : 'observations'} since ${date(dossier.history.firstObservedAt)}. No recorded changes or discrepancies found.` : 'No comparison history yet. Future source captures will show changes here.'}</p>}
        </div>
        <details className="border-b border-line pb-4"><summary className="cursor-pointer text-sm font-semibold text-ink-2">All recorded facts · {dossier.facts.length}</summary><dl className="mt-3 divide-y divide-line">{dossier.facts.map((fact) => <div key={fact.key} className="grid gap-1 py-2.5 text-sm sm:grid-cols-[1fr_1.4fr]"><dt className="text-ink-3">{fact.title}</dt><dd className="break-words font-medium">{valueLabel(fact.value, fact.key)}{fact.evidenceClass === 'unverified_snapshot' && <span className="ml-2 text-catch-ink">Unverified snapshot</span>}</dd></div>)}</dl></details>
        {dossier.publicRecords && <details className="border-b border-line pb-4"><summary className="cursor-pointer text-sm font-semibold text-ink-2">Public records &amp; neighborhood</summary><div className="mt-4 space-y-4">
          {dossier.publicRecords.parcel && <div className="rounded-xl border border-line p-4"><h3 className="text-sm font-bold">Parcel evidence · {humanize(dossier.publicRecords.parcel.status)}</h3>{dossier.publicRecords.parcel.status !== 'matched' && <p className="mt-2 text-xs leading-6 text-catch-ink">Parcel identity is not confirmed. These records are candidates for investigation.</p>}<p className="mt-2 text-xs">Parcel identifier: {dossier.publicRecords.parcel.rawParcelId || 'Not established'}</p><dl className="mt-3 grid grid-cols-2 gap-3">{Object.entries(dossier.publicRecords.parcel.properties || {}).filter(([, value]) => value !== null && value !== undefined).map(([key, value]) => <div key={key}><dt className="text-[10px] text-ink-3">{humanize(key)}</dt><dd className="mt-1 break-words text-xs font-semibold">{valueLabel(value, key)}</dd></div>)}</dl></div>}
          {dossier.publicRecords.areaContext && <div className="rounded-xl border border-line p-4"><h3 className="text-sm font-bold">Neighborhood context</h3><p className="mt-2 text-xs leading-6 text-ink-3">{dossier.publicRecords.areaContext.geographyLabel} · {dossier.publicRecords.areaContext.period}. Area estimates; these do not establish this property’s value, occupancy, or residents’ characteristics.</p><dl className="mt-3 grid grid-cols-2 gap-3">{Object.entries(dossier.publicRecords.areaContext.metrics).map(([key, value]) => <div key={key}><dt className="text-[10px] text-ink-3">{humanize(key)}</dt><dd className="mt-1 text-sm font-semibold">{valueLabel(value, key)}</dd></div>)}</dl>{dossier.publicRecords.areaContext.marginsOfError && <details className="mt-3 text-xs text-ink-3"><summary className="cursor-pointer">Survey margins of error</summary><dl className="mt-2 space-y-1">{Object.entries(dossier.publicRecords.areaContext.marginsOfError).map(([key, value]) => <div key={key}>{humanize(key)}: ±{valueLabel(value, key)}</div>)}</dl></details>}</div>}
          {dossier.publicRecords.issues.length > 0 && <details open={!dossier.publicRecords.parcel && !dossier.publicRecords.areaContext} className="text-xs text-ink-3"><summary className="cursor-pointer font-semibold">Research coverage and unresolved lookups</summary><ul className="mt-3 space-y-2">{dossier.publicRecords.issues.map((issue) => <li key={issue}>{sourceDisplayText(issue)}</li>)}</ul></details>}
          <div className="flex flex-wrap gap-3">{dossier.publicRecords.sources.map((source) => <a key={`${source.id}:${source.url}`} href={source.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[10px] font-semibold text-ink underline hover:text-ink-2">{sourceDisplayText(source.label)}<ExternalLink size={11} /></a>)}</div>
        </div></details>}
        <DiscoveryEvidence evidence={dossier} documentsShown={documentsShown} />
        {dossier.hudSafmr && (
          <div className="rounded-xl border border-line bg-paper p-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-ink">HUD Fair Market Rent Floor · ZIP {dossier.hudSafmr.zip}</h3>
              <span className="rounded-full border border-line bg-surface px-2 py-0.5 text-xs font-semibold text-ink-2">
                FY2025 SAFMR
              </span>
            </div>
            <p className="mt-1 text-xs text-ink-3">
              Section 8 Fair Market Rent baseline and statutory voucher payment standards (90%–110% per 24 CFR § 888.113).
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
              {(['0br', '1br', '2br', '3br', '4br'] as const).map((br) => (
                <div key={br} className="rounded-lg border border-line/60 bg-surface/50 p-2 text-center">
                  <span className="text-xs font-bold uppercase text-ink-3">{br.toUpperCase()}</span>
                  <p className="mt-0.5 text-sm font-bold text-ink">
                    ${(dossier.hudSafmr?.rents?.[br] ?? 0).toLocaleString()}
                  </p>
                  <p className="mt-0.5 text-xs text-ink-3">
                    ${(dossier.hudSafmr?.paymentStandard90?.[br] ?? 0).toLocaleString()} – ${(dossier.hudSafmr?.paymentStandard110?.[br] ?? 0).toLocaleString()}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}
        {dossier.opportunitySignals && dossier.opportunitySignals.length > 0 && (
          <details className="border-b border-line pb-4">
          <summary className="cursor-pointer text-sm font-semibold text-ink-2">Research priority · how it is calculated</summary>
          <div className="mt-4">
          <OpportunitySignalsCard
            listingId={listingId}
            initialData={{
              triagePriority: dossier.triagePriority ?? 0,
              signals: dossier.opportunitySignals,
              weights: dossier.opportunityWeights, componentScores: dossier.componentScores, historyUnavailable: dossier.historyUnavailable,
              summary: dossier.opportunitySummary,
              disclaimer: dossier.opportunityDisclaimer,
            }}
          />
          </div>
          </details>
        )}
        <details className="border-t border-line pt-4">
          <summary className="cursor-pointer text-sm font-semibold text-ink-2">What still needs checking · {dossier.gaps.length}</summary>
          <div className="mt-4 space-y-4">
            {dossier.gaps.map((gap) => (
              <div key={gap.id}>
                <div className="flex flex-wrap items-center gap-2">
                  <h4 className="text-sm font-semibold">{gap.title}</h4>
                  {gap.priorityTier === 'critical_risk' && (
                    <span className="rounded-full border border-catch/30 bg-catch-wash px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-catch-ink">
                      Critical Risk
                    </span>
                  )}
                  {gap.priorityTier === 'high_leverage' && (
                    <span className="rounded-full border border-line-strong bg-paper px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-ink-2">
                      High Leverage
                    </span>
                  )}
                  {typeof gap.potentialPointsGain === 'number' && (
                    <span className="rounded-full border border-line bg-paper px-2 py-0.5 text-[11px] font-semibold text-ink-2">
                      +{gap.potentialPointsGain} priority pts if verified
                    </span>
                  )}
                </div>
                <p className="mt-1 text-sm leading-6 text-ink-3">{gap.reason}</p>
                <p className="mt-1 text-sm leading-6 text-ink-2">Next: {gap.nextAction}</p>
              </div>
            ))}
          </div>
        </details>
      </>}
    </div>
  </section>;
}
