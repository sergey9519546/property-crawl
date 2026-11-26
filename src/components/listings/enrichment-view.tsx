"use client";

/**
 * Cross-source parcel enrichment view.
 * Mounted on /listings/[id] whenever listing.parcelKey is present
 * (see src/app/listings/[id]/page.tsx and test/enrichment-mount-contract.test.js).
 */

import { useCallback, useEffect, useState } from "react";
import {
  confidenceBandColor,
  confidenceBandLabel,
  fetchEnrichmentAdapters,
  fetchEnrichmentByParcelKey,
  formatConfidence,
  refreshEnrichmentByParcelKey,
  type EnrichmentAggregateResponse,
  type EnrichmentAdapterOutcome,
} from "@/lib/enrichment-api";
import { useWorkspaceSession } from "@/components/workspace/workspace-shell";
import { useLocale } from "@/components/i18n/locale-provider";

interface EnrichmentViewProps {
  parcelKey: string | null | undefined;
  fetchImpl?: typeof fetch;
  showRefreshButton?: boolean;
}

const ADAPTER_LABELS: Record<string, string> = {
  'courtlistener': 'CourtListener',
  'fl-dor-cadastral': 'FL DOR cadastral',
  'ca-controller-tax-sale': 'CA Controller tax-sale',
};

export function EnrichmentView({ parcelKey, fetchImpl, showRefreshButton = true }: EnrichmentViewProps) {
  const { locale, messages: m } = useLocale();
  const session = useWorkspaceSession();
  const [view, setView] = useState<EnrichmentAggregateResponse | null>(null);
  const [adapters, setAdapters] = useState<string[]>(() => Object.keys(ADAPTER_LABELS));
  const [selectedSources, setSelectedSources] = useState<string[]>(() => Object.keys(ADAPTER_LABELS));
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshStatus, setRefreshStatus] = useState<string | null>(null);

  const isValidKey = typeof parcelKey === "string" && /^[A-Za-z0-9._:-]{1,128}$/.test(parcelKey);

  useEffect(() => {
    let active = true;
    fetchEnrichmentAdapters({ fetchImpl })
      .then((res) => {
        if (!active || !Array.isArray(res?.adapters)) return;
        const names = res.adapters
          .map((item) => item?.source)
          .filter((name): name is string => typeof name === "string" && name.trim().length > 0);
        if (names.length > 0) {
          setAdapters(names);
          setSelectedSources(names);
        }
      })
      .catch(() => {
        // Keep static label fallback if /api/enrichment metadata is temporarily unreachable
      });
    return () => {
      active = false;
    };
  }, [fetchImpl]);

  const toggleSource = useCallback((source: string) => {
    setSelectedSources((prev) =>
      prev.includes(source) ? prev.filter((item) => item !== source) : [...prev, source]
    );
  }, []);

  const load = useCallback(async () => {
    if (!isValidKey) return;
    setLoading(true);
    setError(null);
    try {
      const result = await fetchEnrichmentByParcelKey(parcelKey as string, { fetchImpl });
      setView(result);
    } catch (err) {
      setError((err as Error).message);
      setView(null);
    } finally {
      setLoading(false);
    }
  }, [parcelKey, fetchImpl, isValidKey]);

  useEffect(() => {
    void load();
  }, [load]);

  const onRefresh = useCallback(async () => {
    if (!isValidKey) return;
    if (!fetchImpl && !session.authenticated) {
      session.requestUnlock();
      return;
    }
    const sourcesToRun = selectedSources.length > 0 ? selectedSources : adapters;
    setRefreshing(true);
    setRefreshStatus(null);
    setError(null);
    try {
      const refreshed = await refreshEnrichmentByParcelKey(parcelKey as string, {
        fetchImpl,
        sources: sourcesToRun,
      });
      setView(refreshed.view);
      const counts = refreshed.adapterOutcomes.reduce<Record<string, number>>((acc, outcome: EnrichmentAdapterOutcome) => {
        acc[outcome.outcome] = (acc[outcome.outcome] || 0) + 1;
        return acc;
      }, {});
      const parts = Object.entries(counts).map(([k, v]) => `${v} ${k}`);
      const unit = refreshed.adapterOutcomes.length === 1 ? m.detailUi.enrichmentAdapterSingular : m.detailUi.enrichmentAdapterPlural;
      const elapsed = typeof refreshed.durationMs === 'number'
        ? m.detailUi.enrichmentInMs.replace('{ms}', String(refreshed.durationMs))
        : '';
      setRefreshStatus(
        m.detailUi.enrichmentRefreshedStatus
          .replace('{count}', String(refreshed.adapterOutcomes.length))
          .replace('{unit}', unit)
          .replace('{elapsed}', elapsed)
          .replace('{parts}', parts.join(', ')),
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRefreshing(false);
    }
  }, [parcelKey, fetchImpl, isValidKey, session, selectedSources, adapters, m.detailUi]);

  if (!isValidKey) {
    return (
      <section className="rounded-card border border-line bg-card p-6 text-sm text-ink-3">
        <header className="mb-2 text-base font-semibold text-ink-2">{m.detailUi.enrichmentTitle}</header>
        <p>{m.detailUi.enrichmentNoParcelKey}</p>
      </section>
    );
  }

  if (loading && !view) {
    return (
      <section className="rounded-card border border-line bg-card p-6 text-sm text-ink-3">
        {m.detailUi.enrichmentLoading} <code>{parcelKey}</code>...
      </section>
    );
  }

  if (error && !view) {
    return (
      <section className="rounded-card border border-catch/30 bg-catch-wash p-6 text-sm text-catch-ink">
        <header className="mb-2 text-base font-semibold">{m.detailUi.enrichmentFailed}</header>
        <p>{error}</p>
      </section>
    );
  }

  const refreshLabel = refreshing
    ? m.detailUi.enrichmentRefreshing
    : (!fetchImpl && !session.authenticated ? (m.detailUi.enrichmentUnlockRefresh || 'Unlock to refresh adapters') : m.detailUi.enrichmentRefreshAdapters);

  const adapterSelector = showRefreshButton && adapters.length > 0 ? (
    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-ink-3">
      <span className="font-semibold text-ink-2">{m.detailUi.enrichmentAdaptersLabel}</span>
      {adapters.map((source) => {
        const checked = selectedSources.includes(source);
        return (
          <label
            key={source}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-control border border-line bg-paper px-2 py-1 text-ink-2"
          >
            <input
              type="checkbox"
              checked={checked}
              onChange={() => toggleSource(source)}
              className="h-3.5 w-3.5 accent-ink"
            />
            <span>{ADAPTER_LABELS[source] || source}</span>
          </label>
        );
      })}
    </div>
  ) : null;

  if (!view || !view.found) {
    return (
      <section className="rounded-card border border-line bg-card p-6 text-sm text-ink-3">
        <header className="mb-2 text-base font-semibold text-ink-2">{m.detailUi.enrichmentTitle}</header>
        <p>{m.detailUi.enrichmentNoSharedSource} <code>{parcelKey}</code>.</p>
        {error ? <p className="mt-2 text-xs text-catch-ink">{error}</p> : null}
        {adapterSelector}
        {showRefreshButton && (
          <button
            onClick={onRefresh}
            disabled={refreshing || selectedSources.length === 0}
            className="mt-3 rounded-control border border-line bg-card px-3 py-1.5 text-sm font-semibold disabled:opacity-50"
          >
            {refreshLabel}
          </button>
        )}
        {refreshStatus && <p className="mt-2 text-xs text-ink-3">{refreshStatus}</p>}
      </section>
    );
  }

  const sortedSources = [...view.sources].sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity));

  return (
    <section aria-labelledby="enrichment-view-heading" className="rounded-card border border-line bg-card p-6">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="enrichment-view-heading" className="text-base font-semibold text-ink-2">
            {m.detailUi.crossSourceEnrichment}
          </h2>
          <p className="mt-1 text-xs text-ink-3">
            parcelKey <code>{parcelKey}</code> · {(view.listingCount === 1 ? m.detailUi.enrichmentListingSingular : m.detailUi.enrichmentListingPlural).replace('{count}', String(view.listingCount))} {m.detailUi.enrichmentAcrossWord} {(view.sourceCount === 1 ? m.detailUi.enrichmentSourceSingular : m.detailUi.enrichmentSourcePlural).replace('{count}', String(view.sourceCount))}
          </p>
        </div>
        {showRefreshButton && (
          <button
            onClick={onRefresh}
            disabled={refreshing || selectedSources.length === 0}
            className="rounded-control border border-line bg-card px-3 py-1.5 text-sm font-semibold disabled:opacity-50"
          >
            {refreshLabel}
          </button>
        )}
      </header>

      {adapterSelector}

      {refreshStatus && <p className="mt-3 mb-3 rounded-control bg-go-wash px-3 py-2 text-xs text-go">{refreshStatus}</p>}
      {error && <p className="mt-3 mb-3 rounded-control bg-catch-wash px-3 py-2 text-xs text-catch-ink">{error}</p>}

      {view.freshestObservation && (
        <div className="my-4 rounded-control bg-paper p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold text-ink-2">
              {m.detailUi.enrichmentFreshestObs}
            </p>
            {view.freshestObservation.confidenceBand && (
              <span className={`rounded-full px-2 py-0.5 text-label font-semibold ${confidenceBandColor(view.freshestObservation.confidenceBand)}`}>
                {confidenceBandLabel(view.freshestObservation.confidenceBand)}
              </span>
            )}
          </div>
          <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1 text-xs text-ink-3 sm:grid-cols-2">
            <div><dt className="inline font-semibold">{m.detailUi.enrichmentSourceLabel}</dt> <dd className="inline">{view.freshestObservation.source}</dd></div>
            <div><dt className="inline font-semibold">{m.detailUi.enrichmentObservedLabel}</dt> <dd className="inline">{view.freshestObservation.observedAt || m.detailUi.enrichmentUnknown}</dd></div>
            <div><dt className="inline font-semibold">{m.detailUi.enrichmentAddressLabel}</dt> <dd className="inline">{[view.freshestObservation.address, view.freshestObservation.city, view.freshestObservation.state, view.freshestObservation.zip].filter(Boolean).join(', ') || m.detailUi.enrichmentUnknown}</dd></div>
            <div><dt className="inline font-semibold">{m.detailUi.enrichmentOpeningBidLabel}</dt> <dd className="inline">{view.freshestObservation.openingBid == null ? m.detailUi.enrichmentUnknown : `$${view.freshestObservation.openingBid}`}</dd></div>
          </dl>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[480px] text-left text-xs">
          <thead>
            <tr className="border-b border-line bg-paper">
              <th className="px-3 py-2 font-semibold">{m.detailUi.enrichmentColRank}</th>
              <th className="px-3 py-2 font-semibold">{m.detailUi.enrichmentColSource}</th>
              <th className="px-3 py-2 font-semibold">{m.detailUi.enrichmentColObserved}</th>
              <th className="px-3 py-2 font-semibold">{m.detailUi.enrichmentColEvidence}</th>
              <th className="px-3 py-2 font-semibold">{m.detailUi.enrichmentColConfidence}</th>
            </tr>
          </thead>
          <tbody>
            {sortedSources.map((entry) => (
              <tr key={entry.source} className="border-b border-line last:border-b-0">
                <td className="px-3 py-2 align-top font-mono text-label text-ink-3">#{entry.rank ?? '?'}</td>
                <td className="px-3 py-2 align-top font-medium text-ink-2">
                  {ADAPTER_LABELS[entry.source] || entry.source}
                  <p className="mt-0.5 text-meta font-normal text-ink-3">{(entry.listingIds.length === 1 ? m.detailUi.enrichmentListingSingular : m.detailUi.enrichmentListingPlural).replace('{count}', String(entry.listingIds.length))}</p>
                </td>
                <td className="px-3 py-2 align-top text-ink-3">{entry.summary.observedAt || m.detailUi.enrichmentUnknown}</td>
                <td className="px-3 py-2 align-top text-ink-3">{entry.summary.evidenceCount}</td>
                <td className="px-3 py-2 align-top">
                  <span className={`rounded-full px-2 py-0.5 text-label font-semibold ${confidenceBandColor(entry.confidenceBand)}`}>
                    {formatConfidence(entry.confidence)} · {entry.confidenceBand || m.detailUi.enrichmentUnknown}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
