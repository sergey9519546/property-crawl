'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { sourceDisplayText } from '@/lib/source-display';
import { ArrowRight, Download, ExternalLink, Loader2, Radar } from 'lucide-react';
import { OpportunitySignalsCard } from '@/components/listings/opportunity-signals-card';
import type { ComponentScore, OpportunitySignal } from '@/components/listings/opportunity-signals-card';
import { DiscoveryEvidence, type DiscoveryEvidenceData } from '@/components/listings/discovery-evidence';
import { useWorkspaceSession } from '@/components/workspace/workspace-shell';
import { useLocale } from '@/components/i18n/locale-provider';
import type { Locale } from '@/lib/i18n/config';
import { formatLocaleDate, formatLocaleNumber, formatUsd, interpolate } from '@/lib/i18n/translator';
import { cn } from '@/lib/utils';

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
  possessionTimeline?: {
    state: string | null;
    saleType: string | null;
    quietTitle?: { minDays: number | null; maxDays: number | null; statutory: string | null; notes: string | null };
    writOfPossession?: { minDays: number | null; maxDays: number | null; statutory: string | null; notes: string | null };
    carryCost?: {
      estimatedHoldDays: number;
      requiresQuietTitle: boolean;
      missingInputs: string[];
      basis: string;
      totalEstimatedCost: number | null;
    };
    summary?: string;
  };
  auctionDepositTerms?: {
    rules?: {
      platform: string;
      depositPercent: number;
      minimumDeposit: number;
      maximumDeposit: number | null;
      paymentMethod: string;
      leadTimeHours: number;
      refundTurnaroundDays: number;
      settlementWindowDays: number;
      statutoryCitation?: string;
      forfeitureRiskTerms?: string;
    };
    requiredDeposit?: {
      targetBid: number;
      requiredDeposit: number;
      depositPercent: number;
      basis: string;
      paymentMethod: string;
      depositDeadline: string | null;
      leadTimeHours: number;
      refundTurnaroundDays: number;
      settlementWindowDays: number;
    };
  };
  auctionMicrostructure?: {
    probability: number | null;
    confidence: string;
    factors: { factor: string; impact: string; weight: number; description: string }[];
    statutoryContext?: {
      state: string;
      statute: string;
      maxDebtorAdjournments: number;
      adjournmentDurationDays: number;
      rule: string;
    } | null;
    notes?: string;
  };
  surplusWaterfall?: {
    winningBid: number;
    openingBid: number;
    grossSurplus: number;
    adjudgedDebtSatisfied: number;
    deficiencyAmount: number;
    allocatedJuniorClaims: number;
    formerOwnerEquity: number;
    uncoveredClaims: number;
    constitutionalBasis?: {
      landmarkCase: string;
      constitutionalClause: string;
      holding: string;
    };
  };
  publicBenchmarks?: {
    benchmarkType: string;
    isAppraisal: boolean;
    evidenceAvailabilityRatio: number;
    availableSourceCount: number;
    sourcesAvailable: string[];
    unobservedReasons: string[];
    assessorRoll?: {
      assessedValue: number;
      landValue?: number | null;
      improvementValue?: number | null;
      county?: string | null;
      apn?: string | null;
      citation?: string | null;
    } | null;
    assessedTrajectory?: {
      state: string;
      baselinePeriod: string;
      currentPeriod: string;
      baselineHpi: number;
      currentHpi: number;
      hpiMultiplier: number;
      hpiAppreciationPct: number;
      hpiAdjustedAssessedValue: number;
      source: string;
      provenance?: { sourceUrl?: string; retrievedAt?: string };
    } | null;
    stateMacroHpi?: {
      state: string;
      quarterPct: number;
      yoyPct: number;
      fiveYearPct: number;
      since1991Pct: number;
      sourceUrl: string;
    } | null;
    hudSafmr?: unknown;
    impliedGrm?: number | null;
  } | null;
  publicRecords: {
    issues: string[]; sources: { id: string; label: string; url: string; observedAt?: string }[];
    parcel: { status: string; rawParcelId?: string; properties: Record<string, unknown>; source?: { url: string } } | null;
    areaContext: { geographyLabel: string; geographyLevel: string; year: number; period: string; metrics: Record<string, unknown>; marginsOfError?: Record<string, unknown>; label: string } | null;
  } | null;
};

const moneyFields = new Set(['openingBid', 'assessed', 'medianHomeValue', 'medianHouseholdIncome', 'justValue', 'assessedValueSchool', 'assessedValueNonSchool']);
function valueLabel(value: unknown, key: string | undefined, locale: Locale, notEstablished: string): string {
  if (value === null || value === undefined || value === '') return notEstablished;
  if (typeof value === 'number') {
    if (key && moneyFields.has(key)) {
      return locale === 'en'
        ? value.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
        : formatUsd(locale, value);
    }
    if (key === 'vacancyRate') return `${(value * 100).toFixed(1)}%`;
    return locale === 'en' ? value.toLocaleString() : formatLocaleNumber(locale, value);
  }
  return sourceDisplayText(String(value));
}
const humanize = (value: string) => value.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
const signedPct = (n: number) => `${n > 0 ? '+' : ''}${n}%`;

function hasValidUsCoordinates(lat: number | null | undefined, lng: number | null | undefined): boolean {
  return (
    typeof lat === 'number' && Number.isFinite(lat) && lat >= 15 && lat <= 72 &&
    typeof lng === 'number' && Number.isFinite(lng) && lng >= -180 && lng <= -65
  );
}

export function PropertyIntelligence({ listingId, documentsShown = false, lat, lng }: { listingId: string; documentsShown?: boolean; lat?: number | null; lng?: number | null }) {
  const { locale, messages } = useLocale();
  const t = messages.intelUi;
  const fmtDate = (value: string) => (locale === 'en' ? new Date(value).toLocaleDateString() : formatLocaleDate(locale, value));
  const fmtNum = (n: number) => (locale === 'en' ? n.toLocaleString() : formatLocaleNumber(locale, n));
  const fmtUsdVal = (n: number) => (locale === 'en' ? `$${Math.round(n).toLocaleString()}` : formatUsd(locale, n));

  const session = useWorkspaceSession();
  const [dossier, setDossier] = useState<Dossier | null>(null);
  const [hazards, setHazards] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);
  const [showAllSignals, setShowAllSignals] = useState(false);
  const [showAllFactors, setShowAllFactors] = useState(false);
  const [error, setError] = useState('');
  const generation = useRef(0);
  const publicRequest = useRef<AbortController | null>(null);
  const researchRequest = useRef<AbortController | null>(null);
  const loadPublic = useCallback(async (requestGeneration: number) => {
    publicRequest.current?.abort();
    if (!listingId || listingId.startsWith('custom-')) {
      setDossier(null);
      setHazards(null);
      setBusy(false);
      setError('');
      return;
    }
    const controller = new AbortController(); publicRequest.current = controller;
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/property-intelligence?listingId=${encodeURIComponent(listingId)}`, { cache: 'no-store', signal: controller.signal });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || t.investFailed);
      if (requestGeneration !== generation.current || controller.signal.aborted) return;
      setDossier(result);
      const coordinatesProvided = lat !== undefined || lng !== undefined;
      if (!coordinatesProvided || hasValidUsCoordinates(lat, lng)) {
        void fetch(`/api/federal-hazards?listingId=${encodeURIComponent(listingId)}`, { signal: controller.signal })
          .then((r) => r.ok ? r.json() : null)
          .then((h) => { if (requestGeneration === generation.current && h?.status === 'success') setHazards(h); })
          .catch(() => {});
      }
    } catch (caught) { if (!(caught instanceof DOMException && caught.name === 'AbortError') && requestGeneration === generation.current) setError(caught instanceof Error ? caught.message : t.investFailed); }
    finally { if (requestGeneration === generation.current && publicRequest.current === controller) setBusy(false); }
  }, [listingId, lat, lng, t.investFailed]);
  useEffect(() => { const requestGeneration=++generation.current;researchRequest.current?.abort();setDossier(null);setHazards(null);void loadPublic(requestGeneration);return()=>{publicRequest.current?.abort();researchRequest.current?.abort();}; }, [loadPublic]);

  async function research() {
    if (!listingId || listingId.startsWith('custom-')) return;
    if (!session.authenticated) { session.requestUnlock(); return; }
    researchRequest.current?.abort(); const controller=new AbortController();researchRequest.current=controller;
    const requestGeneration=generation.current;setBusy(true);setError('');
    try {
      const response=await fetch('/api/property-intelligence',{method:'POST',cache:'no-store',credentials:'same-origin',signal:controller.signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({listingId})});
      if(response.status===401){await session.refresh();session.requestUnlock();throw new Error(t.sessionExpired);}
      const result=await response.json();if(!response.ok)throw new Error(result.error||t.investFailed);
      if(requestGeneration!==generation.current||controller.signal.aborted)return;setDossier(result);
    } catch(caught){if(!(caught instanceof DOMException&&caught.name==='AbortError')&&requestGeneration===generation.current)setError(caught instanceof Error?caught.message:t.investFailed);}
    finally{if(requestGeneration===generation.current&&researchRequest.current===controller)setBusy(false);}
  }

  function exportDossier() {
    if (!dossier) return;
    const payload = hazards ? { ...dossier, federalHazards: hazards } : dossier;
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `property-dossier-${dossier.address.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 100)}.json`; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return <section className="overflow-hidden rounded-card border border-line bg-card shadow-sm" aria-label={t.sectionAria}>
    <div className="border-b border-line p-5 sm:p-6">
      <h2 className="text-xl font-semibold tracking-tight text-ink">{t.heading}</h2>
      <p className="mt-2 text-sm leading-6 text-ink-3">{t.subtitle}</p>
      <div className="mt-4 flex flex-wrap items-center gap-3"><button onClick={() => void research()} disabled={busy || dossier?.source.status !== 'source_observed'} className="flex min-h-11 items-center gap-2 rounded-control bg-ink px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{busy ? <Loader2 size={15} className="animate-spin" /> : <Radar size={15} />}{busy ? t.checkingBtn : t.checkPublicBtn}</button><button onClick={exportDossier} disabled={!dossier} className="flex min-h-11 items-center gap-2 rounded-control border border-line px-4 py-2.5 text-sm font-semibold text-ink-2 disabled:opacity-40"><Download size={14} /> {t.downloadBtn}</button>{!session.authenticated && <button type="button" onClick={() => session.requestUnlock()} className="text-xs font-semibold text-ink-3 underline underline-offset-2 hover:text-ink">{t.unlockAdaptersBtn}</button>}</div>
    </div>
    <div className="space-y-5 p-5 sm:p-6">
      {error && <p role="alert" className="rounded-control bg-catch-wash p-4 text-sm text-catch-ink">{error}</p>}
      {!dossier && !error && <p className="text-sm text-ink-3">{t.loadingEvidence}</p>}
      {dossier && <>
        {dossier.source.status === 'archived_publisher_snapshot' && <p className="rounded-control bg-catch-wash p-4 text-xs leading-6 text-catch-ink">{t.archiveSnapshotWarn}</p>}
        {dossier.source.freshness === 'stale' && <p className="rounded-control bg-catch-wash p-4 text-xs leading-6 text-catch-ink">{t.staleWarn}</p>}
        <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-ink-3"><p>{sourceDisplayText(dossier.source.publisher)} · {dossier.source.observedAt ? interpolate(t.observedAt, { date: fmtDate(dossier.source.observedAt) }) : t.snapshotVerifyNeeded}</p>{dossier.source.url && <a href={dossier.source.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-ink underline hover:text-ink-2">{t.publisherRecordLink} <ExternalLink size={12} /></a>}</div>
        <div className="rounded-control bg-paper p-4"><h3 className="text-sm font-semibold text-ink">{t.changesHeading}</h3>
          {dossier.trajectory && (dossier.trajectory.priorPostponements > 0 || dossier.trajectory.cumulativeBidDropPct !== null) && (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs" data-testid="dossier-trajectory-summary">
              {dossier.trajectory.priorPostponements > 0 && (
                <span className="rounded-full border border-line bg-card px-2.5 py-0.5 font-semibold text-ink-2">
                  {interpolate(dossier.trajectory.priorPostponements === 1 ? t.priorPostponementSingle : t.priorPostponementPlural, { count: dossier.trajectory.priorPostponements })}
                </span>
              )}
              {dossier.trajectory.statutoryStayExhausted && (
                <span className="rounded-full border border-catch/30 bg-catch-wash px-2.5 py-0.5 font-semibold text-catch-ink">
                  {t.stayExhausted}
                </span>
              )}
              {dossier.trajectory.cumulativeBidDropPct !== null && (
                <span className="rounded-full border border-line bg-paper px-2.5 py-0.5 font-semibold text-ink-2">
                  {interpolate(t.cumBidDrop, { pct: dossier.trajectory.cumulativeBidDropPct })}
                </span>
              )}
            </div>
          )}
          {dossier.signals.length || dossier.contradictions.length ? <div className="mt-3 space-y-4">
            {(showAllSignals ? dossier.signals : dossier.signals.slice(0, 3)).map((signal) => <div key={signal.id}><p className="text-sm font-semibold">{signal.title}</p><p className="mt-1 text-sm text-ink-3">{valueLabel(signal.before, signal.field, locale, t.notEstablished)} <ArrowRight className="mx-1 inline" size={13} /> {valueLabel(signal.after, signal.field, locale, t.notEstablished)}</p><p className="mt-1 text-xs text-ink-3">{interpolate(t.signalObservedConfirm, { date: fmtDate(signal.observedAt) })}</p></div>)}
            {dossier.signals.length > 3 && (
              <button
                type="button"
                onClick={() => setShowAllSignals((prev) => !prev)}
                className="text-xs font-semibold text-ink underline underline-offset-2 hover:text-ink-2"
              >
                {showAllSignals ? t.showFewerChanges : interpolate(t.showAllChanges, { count: dossier.signals.length })}
              </button>
            )}
            {dossier.contradictions.map((item) => <div key={item.id}><p className="text-sm font-semibold">{item.title}</p><p className="mt-1 text-sm">{interpolate(t.contradictionLine, { listingVal: fmtNum(item.listingValue), publicVal: fmtNum(item.publicRecordValue), unit: item.unit })}</p><p className="mt-2 text-xs leading-6 text-ink-3">{item.explanation}</p><p className="mt-1 text-xs font-semibold">{t.nextPrefix} {item.nextAction}</p></div>)}
          </div> : <p className="mt-2 text-sm leading-6 text-ink-3">{dossier.historyUnavailable ? t.historyUnavailable : dossier.history ? interpolate(dossier.history.observations === 1 ? t.noChangesObsSingle : t.noChangesObsPlural, { count: dossier.history.observations, date: fmtDate(dossier.history.firstObservedAt) }) : t.noComparisonHistory}</p>}
        </div>
        <details className="border-b border-line pb-4"><summary className="cursor-pointer text-sm font-semibold text-ink-2">{interpolate(t.allFactsSummary, { count: dossier.facts.length })}</summary><dl className="mt-3 divide-y divide-line">{dossier.facts.map((fact) => <div key={fact.key} className="grid gap-1 py-2.5 text-sm sm:grid-cols-[1fr_1.4fr]"><dt className="text-ink-3">{fact.title}</dt><dd className="break-words font-medium">{valueLabel(fact.value, fact.key, locale, t.notEstablished)}{fact.evidenceClass === 'unverified_snapshot' && <span className="ml-2 text-catch-ink">{t.unverifiedSnapshot}</span>}</dd></div>)}</dl></details>
        {dossier.publicRecords && <details className="border-b border-line pb-4"><summary className="cursor-pointer text-sm font-semibold text-ink-2">{t.publicRecordsSummary}</summary><div className="mt-4 space-y-4">
          {dossier.publicRecords.parcel && <div className="rounded-control border border-line p-4"><h3 className="text-sm font-bold">{interpolate(t.parcelEvidenceHeading, { status: humanize(dossier.publicRecords.parcel.status) })}</h3>{dossier.publicRecords.parcel.status !== 'matched' && <p className="mt-2 text-xs leading-6 text-catch-ink">{t.parcelUnconfirmedWarn}</p>}<p className="mt-2 text-xs">{interpolate(t.parcelIdLine, { id: dossier.publicRecords.parcel.rawParcelId || t.notEstablished })}</p><dl className="mt-3 grid grid-cols-2 gap-3">{Object.entries(dossier.publicRecords.parcel.properties || {}).filter(([, value]) => value !== null && value !== undefined).map(([key, value]) => <div key={key}><dt className="text-meta text-ink-3">{humanize(key)}</dt><dd className="mt-1 break-words text-xs font-semibold">{valueLabel(value, key, locale, t.notEstablished)}</dd></div>)}</dl></div>}
          {dossier.publicRecords.areaContext && <div className="rounded-control border border-line p-4"><h3 className="text-sm font-bold">{t.neighborhoodHeading}</h3><p className="mt-2 text-xs leading-6 text-ink-3">{interpolate(t.areaEstimateNote, { geo: dossier.publicRecords.areaContext.geographyLabel, period: dossier.publicRecords.areaContext.period })}</p><dl className="mt-3 grid grid-cols-2 gap-3">{Object.entries(dossier.publicRecords.areaContext.metrics).map(([key, value]) => <div key={key}><dt className="text-meta text-ink-3">{humanize(key)}</dt><dd className="mt-1 text-sm font-semibold">{valueLabel(value, key, locale, t.notEstablished)}</dd></div>)}</dl>{dossier.publicRecords.areaContext.marginsOfError && <details className="mt-3 text-xs text-ink-3"><summary className="cursor-pointer">{t.surveyMargins}</summary><dl className="mt-2 space-y-1">{Object.entries(dossier.publicRecords.areaContext.marginsOfError).map(([key, value]) => <div key={key}>{humanize(key)}: ±{valueLabel(value, key, locale, t.notEstablished)}</div>)}</dl></details>}</div>}
          {dossier.publicRecords.issues.length > 0 && <details open={!dossier.publicRecords.parcel && !dossier.publicRecords.areaContext} className="text-xs text-ink-3"><summary className="cursor-pointer font-semibold">{t.unresolvedLookups}</summary><ul className="mt-3 space-y-2">{dossier.publicRecords.issues.map((issue) => <li key={issue}>{sourceDisplayText(issue)}</li>)}</ul></details>}
          <div className="flex flex-wrap gap-3">{dossier.publicRecords.sources.map((source) => <a key={`${source.id}:${source.url}`} href={source.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-meta font-semibold text-ink underline hover:text-ink-2">{sourceDisplayText(source.label)}<ExternalLink size={11} /></a>)}</div>
        </div></details>}
        <DiscoveryEvidence evidence={dossier} documentsShown={documentsShown} />
        {dossier.publicBenchmarks && (dossier.publicBenchmarks.assessorRoll || dossier.publicBenchmarks.impliedGrm != null || dossier.publicBenchmarks.evidenceAvailabilityRatio !== undefined) && (
          <div className="rounded-control border border-line bg-paper p-4" data-testid="public-benchmarks-summary-card">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-bold text-ink">{t.benchHeading}</h3>
              <span className="rounded-full border border-line bg-card px-2.5 py-0.5 text-xs font-semibold text-ink-2">
                {interpolate(t.benchObservedPct, { pct: Math.round((dossier.publicBenchmarks.evidenceAvailabilityRatio ?? 0) * 100), count: dossier.publicBenchmarks.availableSourceCount })}
              </span>
            </div>
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
              <div className="rounded-control border border-line bg-card p-2.5">
                <span className="text-label font-bold uppercase text-ink-3">{t.assessorRollLabel}</span>
                <p className="mt-1 text-sm font-bold text-ink">
                  {dossier.publicBenchmarks.assessorRoll?.assessedValue != null
                    ? fmtUsdVal(dossier.publicBenchmarks.assessorRoll.assessedValue)
                    : t.notObserved}
                </p>
                <p className="mt-0.5 text-xs text-ink-3">
                  {dossier.publicBenchmarks.assessorRoll?.apn
                    ? `${interpolate(t.apnPrefix, { apn: dossier.publicBenchmarks.assessorRoll.apn })}${dossier.publicBenchmarks.assessorRoll.county ? ` · ${dossier.publicBenchmarks.assessorRoll.county}` : ''}`
                    : (dossier.publicBenchmarks.assessorRoll?.citation || t.assessorAbsent)}
                </p>
              </div>
              <div className="rounded-control border border-line bg-card p-2.5">
                <span className="text-label font-bold uppercase text-ink-3">{t.landImprovLabel}</span>
                <p className="mt-1 text-sm font-bold text-ink">
                  {dossier.publicBenchmarks.assessorRoll?.landValue != null || dossier.publicBenchmarks.assessorRoll?.improvementValue != null
                    ? `${dossier.publicBenchmarks.assessorRoll?.landValue != null ? fmtUsdVal(dossier.publicBenchmarks.assessorRoll.landValue) : '—'} / ${dossier.publicBenchmarks.assessorRoll?.improvementValue != null ? fmtUsdVal(dossier.publicBenchmarks.assessorRoll.improvementValue) : '—'}`
                    : t.notItemized}
                </p>
                <p className="mt-0.5 text-xs text-ink-3">
                  {dossier.publicBenchmarks.benchmarkType || t.publicBenchFallback}
                </p>
              </div>
              <div className="rounded-control border border-line bg-card p-2.5">
                <span className="text-label font-bold uppercase text-ink-3">{t.impliedGrmLabel}</span>
                <p className="mt-1 text-sm font-bold text-ink">
                  {dossier.publicBenchmarks.impliedGrm != null ? `${dossier.publicBenchmarks.impliedGrm}x` : t.naLabel}
                </p>
                <p className="mt-0.5 text-xs text-ink-3">
                  {t.grmFormula}
                </p>
              </div>
            </div>
            {Array.isArray(dossier.publicBenchmarks.unobservedReasons) && dossier.publicBenchmarks.unobservedReasons.length > 0 && (
              <details className="mt-2.5 text-xs text-ink-3">
                <summary className="cursor-pointer font-semibold">{interpolate(t.unobservedChecks, { count: dossier.publicBenchmarks.unobservedReasons.length })}</summary>
                <ul className="mt-1.5 list-disc pl-4 space-y-0.5">
                  {dossier.publicBenchmarks.unobservedReasons.map((reason) => <li key={reason}>{reason}</li>)}
                </ul>
              </details>
            )}
          </div>
        )}
        {dossier.publicBenchmarks?.assessedTrajectory && (
          <div className="rounded-control border border-line bg-paper p-4" data-testid="hpi-trajectory-card">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-ink">
                {interpolate(t.hpiTrajectoryHeading, { state: dossier.publicBenchmarks.assessedTrajectory.state })}
              </h3>
              <span className="rounded-full border border-yours/40 bg-yours-wash px-2 py-0.5 text-xs font-semibold text-yours">
                {interpolate(t.trajectoryBadge, { pct: signedPct(dossier.publicBenchmarks.assessedTrajectory.hpiAppreciationPct) })}
              </span>
            </div>
            <p className="mt-1 text-xs text-ink-3">
              {interpolate(t.hpiTrajectoryDesc, {
                from: dossier.publicBenchmarks.assessedTrajectory.baselinePeriod,
                to: dossier.publicBenchmarks.assessedTrajectory.currentPeriod,
                mult: dossier.publicBenchmarks.assessedTrajectory.hpiMultiplier,
              })}
            </p>
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
              <div className="rounded-control border border-line bg-card p-2.5">
                <span className="text-label font-bold uppercase text-ink-3">{t.baselineHpiLabel}</span>
                <p className="mt-1 text-sm font-bold text-ink">
                  {dossier.publicBenchmarks.assessedTrajectory.baselineHpi}
                </p>
                <p className="mt-0.5 text-xs text-ink-3">
                  {interpolate(t.periodLine, { period: dossier.publicBenchmarks.assessedTrajectory.baselinePeriod })}
                </p>
              </div>
              <div className="rounded-control border border-line bg-card p-2.5">
                <span className="text-label font-bold uppercase text-ink-3">{t.currentHpiLabel}</span>
                <p className="mt-1 text-sm font-bold text-ink">
                  {dossier.publicBenchmarks.assessedTrajectory.currentHpi}
                </p>
                <p className="mt-0.5 text-xs text-ink-3">
                  {interpolate(t.periodLine, { period: dossier.publicBenchmarks.assessedTrajectory.currentPeriod })}
                </p>
              </div>
              <div className="rounded-control border border-line bg-card p-2.5">
                <span className="text-label font-bold uppercase text-ink-3">{t.hpiIndexedValueLabel}</span>
                <p className="mt-1 text-sm font-bold text-yours">
                  {fmtUsdVal(dossier.publicBenchmarks.assessedTrajectory.hpiAdjustedAssessedValue)}
                </p>
                <p className="mt-0.5 text-xs text-ink-3">
                  {t.hpiBaselineDesc}
                </p>
              </div>
            </div>
            <p className="mt-2 text-label text-ink-3">
              {interpolate(t.hpiSourceNote, { source: dossier.publicBenchmarks.assessedTrajectory.source })}
            </p>
          </div>
        )}
        {!dossier.publicBenchmarks?.assessedTrajectory && dossier.publicBenchmarks?.stateMacroHpi && (
          <div className="rounded-control border border-line bg-paper p-4" data-testid="fhfa-macro-hpi-card">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-ink">
                {interpolate(t.fhfaMacroHeading, { state: dossier.publicBenchmarks.stateMacroHpi.state })}
              </h3>
              <span className="rounded-full border border-line bg-card px-2 py-0.5 text-xs font-semibold text-ink-2">
                {t.officialSummaryBadge}
              </span>
            </div>
            <p className="mt-1 text-xs text-ink-3">
              {interpolate(t.fhfaMacroDesc, { state: dossier.publicBenchmarks.stateMacroHpi.state })}
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div className="rounded-control border border-line bg-card p-2 text-center">
                <span className="text-xs font-bold uppercase text-ink-3">{t.oneQuarter}</span>
                <p className="mt-0.5 text-sm font-bold text-ink">{dossier.publicBenchmarks.stateMacroHpi.quarterPct > 0 ? '+' : ''}{dossier.publicBenchmarks.stateMacroHpi.quarterPct}%</p>
              </div>
              <div className="rounded-control border border-line bg-card p-2 text-center">
                <span className="text-xs font-bold uppercase text-ink-3">{t.oneYearYoy}</span>
                <p className="mt-0.5 text-sm font-bold text-ink">{dossier.publicBenchmarks.stateMacroHpi.yoyPct > 0 ? '+' : ''}{dossier.publicBenchmarks.stateMacroHpi.yoyPct}%</p>
              </div>
              <div className="rounded-control border border-line bg-card p-2 text-center">
                <span className="text-xs font-bold uppercase text-ink-3">{t.fiveYears}</span>
                <p className="mt-0.5 text-sm font-bold text-ink">{signedPct(dossier.publicBenchmarks.stateMacroHpi.fiveYearPct)}</p>
              </div>
              <div className="rounded-control border border-line bg-card p-2 text-center">
                <span className="text-xs font-bold uppercase text-ink-3">{t.since1991}</span>
                <p className="mt-0.5 text-sm font-bold text-ink">{signedPct(dossier.publicBenchmarks.stateMacroHpi.since1991Pct)}</p>
              </div>
            </div>
          </div>
        )}
        {dossier.hudSafmr && (
          <div className="rounded-control border border-line bg-paper p-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-ink">{interpolate(t.hudRentHeading, { zip: dossier.hudSafmr.zip })}</h3>
              <span className="rounded-full border border-line bg-card px-2 py-0.5 text-xs font-semibold text-ink-2">
                FY2025 SAFMR
              </span>
            </div>
            <p className="mt-1 text-xs text-ink-3">
              {t.hudRentDesc}
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
              {(['0br', '1br', '2br', '3br', '4br'] as const).map((br) => (
                <div key={br} className="rounded-control border border-line bg-card p-2 text-center">
                  <span className="text-xs font-bold uppercase text-ink-3">{br.toUpperCase()}</span>
                  <p className="mt-0.5 text-sm font-bold text-ink">
                    {fmtUsdVal(dossier.hudSafmr?.rents?.[br] ?? 0)}
                  </p>
                  <p className="mt-0.5 text-xs text-ink-3">
                    {fmtUsdVal(dossier.hudSafmr?.paymentStandard90?.[br] ?? 0)} – {fmtUsdVal(dossier.hudSafmr?.paymentStandard110?.[br] ?? 0)}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}
        {hazards && hazards.status === 'success' && (
          <div className="rounded-control border border-line bg-paper p-4" data-testid="federal-hazard-gis-card">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-ink">{t.hazardsHeading}</h3>
              <span className={cn(
                "rounded-full border px-2 py-0.5 text-xs font-semibold",
                hazards.overallTier === 'critical_hazard' ? "border-catch/60 bg-catch-wash text-catch-ink" :
                hazards.overallTier === 'high_hazard' ? "border-catch/40 bg-catch-wash text-catch-ink" :
                "border-line bg-card text-ink-2"
              )}>
                {interpolate(t.gisScoreBadge, { score: hazards.compositeScore })}
              </span>
            </div>
            <p className="mt-1 text-xs text-ink-3">
              {t.hazardsDesc}
            </p>
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
              <div className="rounded-control border border-line bg-card p-2.5">
                <span className="text-label font-bold uppercase text-ink-3">{t.femaFloodZoneLabel}</span>
                <p className="mt-1 text-sm font-bold text-ink">
                  {hazards.layers?.femaFlood?.floodRisk?.zone || (hazards.layers?.femaFlood?.status === 'unavailable' ? t.unavailableLabel : t.zoneXLabel)}
                </p>
                <p className="mt-0.5 text-xs text-ink-3">
                  {hazards.layers?.femaFlood?.status === 'unavailable' ? t.femaQueryUnavailable : (hazards.layers?.femaFlood?.floodRisk?.isSpecialFloodHazardArea ? t.mandatoryNfip : t.minimalFlood)}
                </p>
              </div>
              <div className="rounded-control border border-line bg-card p-2.5">
                <span className="text-label font-bold uppercase text-ink-3">{t.epaEnvLabel}</span>
                <p className="mt-1 text-sm font-bold text-ink capitalize">
                  {hazards.layers?.epaHazard?.environmentalLiability?.liabilityTier || (hazards.layers?.epaHazard?.status === 'unavailable' ? t.unavailableLabel : t.cleanLabel)}
                </p>
                <p className="mt-0.5 text-xs text-ink-3">
                  {hazards.layers?.epaHazard?.status === 'unavailable' ? t.epaUnavailable : (hazards.underwritingImpact?.phaseOneEsaRequired ? t.phaseOneRec : t.noSuperfund)}
                </p>
              </div>
              <div className="rounded-control border border-line bg-card p-2.5">
                <span className="text-label font-bold uppercase text-ink-3">{t.usgsSlopeLabel}</span>
                <p className="mt-1 text-sm font-bold text-ink">
                  {hazards.layers?.usgsTerrain?.status === 'unavailable' ? t.naLabel : interpolate(t.slopeGradePct, { pct: hazards.layers?.usgsTerrain?.slopeAnalysis?.slopePct ?? 0 })}
                </p>
                <p className="mt-0.5 text-xs text-ink-3">
                  {hazards.layers?.usgsTerrain?.status === 'unavailable' ? t.usgsUnavailable : (hazards.underwritingImpact?.gradingContingencyRequired ? t.steepSlope : t.standardGrade)}
                </p>
              </div>
            </div>
          </div>
        )}
        {dossier.auctionDepositTerms && dossier.auctionDepositTerms.rules && (
          <div className="rounded-control border border-line bg-paper p-4" data-testid="auction-deposit-card">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-ink">
                {interpolate(t.escrowHeading, { platform: humanize(dossier.auctionDepositTerms.rules.platform || t.judicialSheriff) })}
              </h3>
              <span className="rounded-full border border-line bg-card px-2 py-0.5 text-xs font-semibold text-ink-2">
                {dossier.auctionDepositTerms.requiredDeposit?.depositPercent
                  ? interpolate(t.depositPctBadge, { pct: Math.round(dossier.auctionDepositTerms.requiredDeposit.depositPercent * 100) })
                  : t.statutoryFloorBadge}
              </span>
            </div>
            <p className="mt-1 text-xs text-ink-3">
              {t.escrowDesc}
            </p>
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
              <div className="rounded-control border border-line bg-card p-2.5">
                <span className="text-label font-bold uppercase text-ink-3">{t.requiredDepositLabel}</span>
                <p className="mt-1 text-sm font-bold text-ink">
                  {dossier.auctionDepositTerms.requiredDeposit?.requiredDeposit != null
                    ? fmtUsdVal(dossier.auctionDepositTerms.requiredDeposit.requiredDeposit)
                    : t.calculatedAtBid}
                </p>
                <p className="mt-0.5 text-xs text-ink-3">
                  {interpolate(t.basisLine, { basis: humanize(dossier.auctionDepositTerms.requiredDeposit?.basis || 'percentage') })}
                </p>
              </div>
              <div className="rounded-control border border-line bg-card p-2.5">
                <span className="text-label font-bold uppercase text-ink-3">{t.paymentMethodLabel}</span>
                <p className="mt-1 text-sm font-bold text-ink capitalize">
                  {(dossier.auctionDepositTerms.requiredDeposit?.paymentMethod || dossier.auctionDepositTerms.rules.paymentMethod || 'cashier_check').replace(/_/g, ' ')}
                </p>
                <p className="mt-0.5 text-xs text-ink-3">
                  {interpolate(t.leadTimeLine, { hours: dossier.auctionDepositTerms.rules.leadTimeHours ?? 24 })}
                </p>
              </div>
              <div className="rounded-control border border-line bg-card p-2.5">
                <span className="text-label font-bold uppercase text-ink-3">{t.settlementRefundLabel}</span>
                <p className="mt-1 text-sm font-bold text-ink">
                  {interpolate(t.settlementWindow, { days: dossier.auctionDepositTerms.rules.settlementWindowDays ?? 30 })}
                </p>
                <p className="mt-0.5 text-xs text-ink-3">
                  {interpolate(t.refundTurnaround, { days: dossier.auctionDepositTerms.rules.refundTurnaroundDays ?? 5 })}
                </p>
              </div>
            </div>
            {dossier.auctionDepositTerms.rules.forfeitureRiskTerms && (
              <p className="mt-2 rounded border border-catch/30 bg-catch-wash px-2.5 py-1.5 text-xs text-catch-ink">
                <strong>{t.forfeiturePrefix}</strong> {dossier.auctionDepositTerms.rules.forfeitureRiskTerms}
              </p>
            )}
            {dossier.auctionDepositTerms.rules.statutoryCitation && (
              <p className="mt-2 text-label text-ink-3">
                {interpolate(t.citationLine, { citation: dossier.auctionDepositTerms.rules.statutoryCitation })}
              </p>
            )}
          </div>
        )}
        {dossier.possessionTimeline && (
          <div className="rounded-control border border-line bg-paper p-4" data-testid="possession-timeline-card">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-ink">
                {t.possessionHeading}
              </h3>
              <span className="rounded-full border border-line bg-card px-2 py-0.5 text-xs font-semibold text-ink-2">
                {interpolate(t.jurisdictionBadge, { state: dossier.possessionTimeline.state || t.statutoryFallback })}
              </span>
            </div>
            <p className="mt-1 text-xs text-ink-3">
              {t.possessionDesc}
            </p>
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
              <div className="rounded-control border border-line bg-card p-2.5">
                <span className="text-label font-bold uppercase text-ink-3">{t.quietTitleLabel}</span>
                <p className="mt-1 text-sm font-bold text-ink">
                  {dossier.possessionTimeline.quietTitle?.minDays != null
                    ? interpolate(t.daysRange, { min: dossier.possessionTimeline.quietTitle.minDays, max: dossier.possessionTimeline.quietTitle.maxDays })
                    : t.directDeedNotReq}
                </p>
                <p className="mt-0.5 text-xs text-ink-3">
                  {dossier.possessionTimeline.quietTitle?.statutory || t.directConveyance}
                </p>
              </div>
              <div className="rounded-control border border-line bg-card p-2.5">
                <span className="text-label font-bold uppercase text-ink-3">{t.writPossessionLabel}</span>
                <p className="mt-1 text-sm font-bold text-ink">
                  {dossier.possessionTimeline.writOfPossession?.minDays != null
                    ? interpolate(t.daysRange, { min: dossier.possessionTimeline.writOfPossession.minDays, max: dossier.possessionTimeline.writOfPossession.maxDays })
                    : t.unencodedTimeline}
                </p>
                <p className="mt-0.5 text-xs text-ink-3">
                  {dossier.possessionTimeline.writOfPossession?.statutory || t.sheriffWritExec}
                </p>
              </div>
              <div className="rounded-control border border-line bg-card p-2.5">
                <span className="text-label font-bold uppercase text-ink-3">{t.holdingCarryLabel}</span>
                <p className="mt-1 text-sm font-bold text-ink">
                  {dossier.possessionTimeline.carryCost?.totalEstimatedCost != null
                    ? fmtUsdVal(dossier.possessionTimeline.carryCost.totalEstimatedCost)
                    : t.unconfirmedLabel}
                </p>
                <p className="mt-0.5 text-xs text-ink-3">
                  {dossier.possessionTimeline.carryCost?.missingInputs && dossier.possessionTimeline.carryCost.missingInputs.length > 0
                    ? interpolate(t.missingInputsLine, { fields: dossier.possessionTimeline.carryCost.missingInputs.join(', ') })
                    : interpolate(t.basisLine, { basis: dossier.possessionTimeline.carryCost?.basis || t.observedCarryFallback })}
                </p>
              </div>
            </div>
          </div>
        )}
        {dossier.auctionMicrostructure && (
          <div className="rounded-control border border-line bg-paper p-4" data-testid="auction-microstructure-card">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-ink">{t.microHeading}</h3>
              <span className={cn(
                "rounded-full border px-2 py-0.5 text-xs font-semibold",
                dossier.auctionMicrostructure.probability != null && dossier.auctionMicrostructure.probability >= 0.7 ? "border-line-strong bg-card text-ink-2" :
                dossier.auctionMicrostructure.probability != null && dossier.auctionMicrostructure.probability <= 0.4 ? "border-catch/40 bg-catch-wash text-catch-ink" :
                "border-line bg-card text-ink-2"
              )}>
                {dossier.auctionMicrostructure.probability != null
                  ? interpolate(t.proceedProbBadge, { pct: Math.round(dossier.auctionMicrostructure.probability * 100), conf: dossier.auctionMicrostructure.confidence })
                  : t.insufficientDocketData}
              </span>
            </div>
            <p className="mt-1 text-xs text-ink-3">
              {t.microDesc}
            </p>
            {dossier.auctionMicrostructure.statutoryContext && (
              <p className="mt-2 text-xs font-medium text-ink-2">
                {interpolate(t.statutoryCtxLine, { state: dossier.auctionMicrostructure.statutoryContext.state, rule: dossier.auctionMicrostructure.statutoryContext.rule })}
              </p>
            )}
            {dossier.auctionMicrostructure.factors && dossier.auctionMicrostructure.factors.length > 3 && (
              <div className="mt-2">
                <button
                  type="button"
                  onClick={() => setShowAllFactors((prev) => !prev)}
                  className="text-xs font-semibold text-ink underline underline-offset-2 hover:text-ink-2"
                >
                  {showAllFactors
                    ? t.showTop3Factors
                    : interpolate(t.showAllFactors, { count: dossier.auctionMicrostructure.factors.length })}
                </button>
              </div>
            )}
            {dossier.auctionMicrostructure.factors && dossier.auctionMicrostructure.factors.length > 0 && (
              <div className="mt-2 space-y-1">
                {(showAllFactors ? dossier.auctionMicrostructure.factors : dossier.auctionMicrostructure.factors.slice(0, 3)).map((f, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs text-ink-3">
                    <span className={cn(
                      "font-semibold",
                      f.impact === 'positive' ? "text-ink" : "text-catch-ink"
                    )}>
                      {f.impact === 'positive' ? '▲' : '▼'} {f.weight > 0 ? `+${(f.weight * 100).toFixed(0)}%` : `${(f.weight * 100).toFixed(0)}%`}
                    </span>
                    <span>{f.description}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        {dossier.surplusWaterfall && (
          <div className="rounded-control border border-line bg-paper p-4" data-testid="surplus-waterfall-card">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-ink">{t.surplusHeading}</h3>
              <span className="rounded-full border border-line bg-card px-2 py-0.5 text-xs font-semibold text-ink-2">
                Tyler v. Hennepin County (2023)
              </span>
            </div>
            <p className="mt-1 text-xs text-ink-3">
              {t.surplusDesc}
            </p>
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
              <div className="rounded-control border border-line bg-card p-2.5">
                <span className="text-label font-bold uppercase text-ink-3">{t.adjudgedDebtLabel}</span>
                <p className="mt-1 text-sm font-bold text-ink">
                  {dossier.surplusWaterfall.adjudgedDebtSatisfied != null
                    ? fmtUsdVal(dossier.surplusWaterfall.adjudgedDebtSatisfied)
                    : t.notPublished}
                </p>
                <p className="mt-0.5 text-xs text-ink-3">
                  {dossier.surplusWaterfall.deficiencyAmount > 0
                    ? interpolate(t.deficiencyLine, { amount: fmtUsdVal(dossier.surplusWaterfall.deficiencyAmount) })
                    : t.debtSatisfied}
                </p>
              </div>
              <div className="rounded-control border border-line bg-card p-2.5">
                <span className="text-label font-bold uppercase text-ink-3">{t.juniorLienClaimsLabel}</span>
                <p className="mt-1 text-sm font-bold text-ink">
                  {dossier.surplusWaterfall.allocatedJuniorClaims != null
                    ? fmtUsdVal(dossier.surplusWaterfall.allocatedJuniorClaims)
                    : fmtUsdVal(0)}
                </p>
                <p className="mt-0.5 text-xs text-ink-3">
                  {dossier.surplusWaterfall.uncoveredClaims > 0
                    ? interpolate(t.uncoveredLine, { amount: fmtUsdVal(dossier.surplusWaterfall.uncoveredClaims) })
                    : t.juniorPriorityClaims}
                </p>
              </div>
              <div className="rounded-control border border-line bg-card p-2.5">
                <span className="text-label font-bold uppercase text-ink-3">{t.formerOwnerEquityLabel}</span>
                <p className="mt-1 text-sm font-bold text-ink">
                  {dossier.surplusWaterfall.formerOwnerEquity != null
                    ? fmtUsdVal(dossier.surplusWaterfall.formerOwnerEquity)
                    : fmtUsdVal(0)}
                </p>
                <p className="mt-0.5 text-xs text-ink-3">
                  {t.protectedSurplus}{dossier.surplusWaterfall.grossSurplus != null ? interpolate(t.grossSurplusPart, { amount: fmtUsdVal(dossier.surplusWaterfall.grossSurplus) }) : ''}
                </p>
              </div>
            </div>
            {dossier.surplusWaterfall.constitutionalBasis && (
              <p className="mt-2.5 text-xs text-ink-3">
                <strong className="text-ink-2">{dossier.surplusWaterfall.constitutionalBasis.landmarkCase}</strong> ({dossier.surplusWaterfall.constitutionalBasis.constitutionalClause}): {dossier.surplusWaterfall.constitutionalBasis.holding}
              </p>
            )}
          </div>
        )}
        {dossier.opportunitySignals && dossier.opportunitySignals.length > 0 && (
          <details className="border-b border-line pb-4">
          <summary className="cursor-pointer text-sm font-semibold text-ink-2">{t.prioritySummary}</summary>
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
          <summary className="cursor-pointer text-sm font-semibold text-ink-2">{interpolate(t.gapsSummary, { count: dossier.gaps.length })}</summary>
          <div className="mt-4 space-y-4">
            {dossier.gaps.map((gap) => (
              <div key={gap.id}>
                <div className="flex flex-wrap items-center gap-2">
                  <h4 className="text-sm font-semibold">{gap.title}</h4>
                  {gap.priorityTier === 'critical_risk' && (
                    <span className="rounded-full border border-catch/30 bg-catch-wash px-2 py-0.5 text-label font-bold uppercase tracking-wide text-catch-ink">
                      {t.criticalRiskBadge}
                    </span>
                  )}
                  {gap.priorityTier === 'high_leverage' && (
                    <span className="rounded-full border border-line-strong bg-paper px-2 py-0.5 text-label font-bold uppercase tracking-wide text-ink-2">
                      {t.highLeverageBadge}
                    </span>
                  )}
                  {typeof gap.potentialPointsGain === 'number' && (
                    <span className="rounded-full border border-line bg-paper px-2 py-0.5 text-label font-semibold text-ink-2">
                      {interpolate(t.potentialPtsBadge, { pts: gap.potentialPointsGain })}
                    </span>
                  )}
                </div>
                <p className="mt-1 text-sm leading-6 text-ink-3">{gap.reason}</p>
                <p className="mt-1 text-sm leading-6 text-ink-2">{t.nextPrefix} {gap.nextAction}</p>
              </div>
            ))}
          </div>
        </details>
      </>}
    </div>
  </section>;
}
