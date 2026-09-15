"use client";

import { useCallback, useEffect, useState } from "react";
import {
  confidenceBandColor,
  confidenceBandLabel,
  fetchEnrichmentByParcelKey,
  formatConfidence,
  refreshEnrichmentByParcelKey,
  type EnrichmentAggregateResponse,
  type EnrichmentAdapterOutcome,
} from "@/lib/enrichment-api";

interface EnrichmentViewProps {
  parcelKey: string | null | undefined;
  operatorToken?: string;
  fetchImpl?: typeof fetch;
  showRefreshButton?: boolean;
}

const ADAPTER_LABELS: Record<string, string> = {
  'courtlistener': 'CourtListener',
  'fl-dor-cadastral': 'FL DOR cadastral',
  'ca-controller-tax-sale': 'CA Controller tax-sale',
};

function describeOutcome(outcome: EnrichmentAdapterOutcome): string {
  if (outcome.outcome === 'success') return outcome.records && outcome.records.length ? `${outcome.records.length} record${outcome.records.length === 1 ? '' : 's'}` : 'clean run';
  if (outcome.outcome === 'empty') return 'no new records';
  if (outcome.outcome === 'skipped') return outcome.reason ? `skipped (${outcome.reason})` : 'skipped';
  return outcome.error ? `failed (${outcome.error.slice(0, 80)})` : 'failed';
}

export function EnrichmentView({ parcelKey, operatorToken, fetchImpl, showRefreshButton = true }: EnrichmentViewProps) {
  const [view, setView] = useState<EnrichmentAggregateResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshStatus, setRefreshStatus] = useState<string | null>(null);

  const isValidKey = typeof parcelKey === "string" && /^[A-Za-z0-9._:-]{1,128}$/.test(parcelKey);

  const load = useCallback(async () => {
    if (!isValidKey) return;
    setLoading(true);
    setError(null);
    try {
      const result = await fetchEnrichmentByParcelKey(parcelKey as string, { fetchImpl, operatorToken });
      setView(result);
    } catch (err) {
      setError((err as Error).message);
      setView(null);
    } finally {
      setLoading(false);
    }
  }, [parcelKey, fetchImpl, operatorToken, isValidKey]);

  useEffect(() => {
    void load();
  }, [load]);

  const onRefresh = useCallback(async () => {
    if (!isValidKey) return;
    setRefreshing(true);
    setRefreshStatus(null);
    setError(null);
    try {
      const refreshed = await refreshEnrichmentByParcelKey(parcelKey as string, { fetchImpl, operatorToken });
      setView(refreshed.view);
      const counts = refreshed.adapterOutcomes.reduce<Record<string, number>>((acc, outcome) => {
        acc[outcome.outcome] = (acc[outcome.outcome] || 0) + 1;
        return acc;
      }, {});
      const parts = Object.entries(counts).map(([k, v]) => `${v} ${k}`);
      const elapsed = typeof refreshed.durationMs === 'number' ? ` in ${refreshed.durationMs}ms` : '';
      setRefreshStatus(`Refreshed ${refreshed.adapterOutcomes.length} adapter${refreshed.adapterOutcomes.length === 1 ? '' : 's'}${elapsed}: ${parts.join(', ')}.`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRefreshing(false);
    }
  }, [parcelKey, fetchImpl, operatorToken, isValidKey]);

  if (!isValidKey) {
    return (
      <section className="rounded-2xl border border-[#E5E7EB] bg-white p-6 text-sm text-slate-600">
        <header className="mb-2 text-base font-semibold text-slate-800">Enrichment view</header>
        <p>No parcelKey is attached to this listing yet, so the cross-source enrichment view is unavailable.</p>
      </section>
    );
  }

  if (loading && !view) {
    return (
      <section className="rounded-2xl border border-[#E5E7EB] bg-white p-6 text-sm text-slate-600">
        Loading enrichment view for <code>{parcelKey}</code>...
      </section>
    );
  }

  if (error && !view) {
    return (
      <section className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-900">
        <header className="mb-2 text-base font-semibold">Enrichment view failed</header>
        <p>{error}</p>
      </section>
    );
  }

  if (!view || !view.found) {
    return (
      <section className="rounded-2xl border border-[#E5E7EB] bg-white p-6 text-sm text-slate-600">
        <header className="mb-2 text-base font-semibold text-slate-800">Enrichment view</header>
        <p>No other source has reported a listing that shares the parcelKey <code>{parcelKey}</code>.</p>
        {showRefreshButton && (
          <button onClick={onRefresh} disabled={refreshing} className="mt-3 rounded-lg border border-[#E5E7EB] bg-white px-3 py-1.5 text-sm font-semibold">
            {refreshing ? 'Refreshing...' : 'Refresh from adapters'}
          </button>
        )}
        {refreshStatus && <p className="mt-2 text-xs text-slate-500">{refreshStatus}</p>}
      </section>
    );
  }

  const sortedSources = [...view.sources].sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity));

  return (
    <section aria-labelledby="enrichment-view-heading" className="rounded-2xl border border-[#E5E7EB] bg-white p-6">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="enrichment-view-heading" className="text-base font-semibold text-slate-800">
            Cross-source enrichment
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            parcelKey <code>{parcelKey}</code> · {view.listingCount} listing{view.listingCount === 1 ? '' : 's'} across {view.sourceCount} source{view.sourceCount === 1 ? '' : 's'}
          </p>
        </div>
        {showRefreshButton && (
          <button
            onClick={onRefresh}
            disabled={refreshing}
            className="rounded-lg border border-[#E5E7EB] bg-white px-3 py-1.5 text-sm font-semibold"
          >
            {refreshing ? 'Refreshing...' : 'Refresh from adapters'}
          </button>
        )}
      </header>

      {refreshStatus && <p className="mb-3 rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-900">{refreshStatus}</p>}
      {error && <p className="mb-3 rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-900">{error}</p>}

      {view.freshestObservation && (
        <div className="mb-4 rounded-xl bg-slate-50 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold text-slate-800">
              Freshest cross-source observation
            </p>
            {view.freshestObservation.confidenceBand && (
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${confidenceBandColor(view.freshestObservation.confidenceBand)}`}>
                {confidenceBandLabel(view.freshestObservation.confidenceBand)}
              </span>
            )}
          </div>
          <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1 text-xs text-slate-600 sm:grid-cols-2">
            <div><dt className="inline font-semibold">Source:</dt> <dd className="inline">{view.freshestObservation.source}</dd></div>
            <div><dt className="inline font-semibold">Observed:</dt> <dd className="inline">{view.freshestObservation.observedAt || 'unknown'}</dd></div>
            <div><dt className="inline font-semibold">Address:</dt> <dd className="inline">{[view.freshestObservation.address, view.freshestObservation.city, view.freshestObservation.state, view.freshestObservation.zip].filter(Boolean).join(', ') || 'unknown'}</dd></div>
            <div><dt className="inline font-semibold">Opening bid:</dt> <dd className="inline">{view.freshestObservation.openingBid == null ? 'unknown' : `$${view.freshestObservation.openingBid}`}</dd></div>
          </dl>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[480px] text-left text-xs">
          <thead>
            <tr className="border-b border-[#E5E7EB] bg-slate-50">
              <th className="px-3 py-2 font-semibold">Rank</th>
              <th className="px-3 py-2 font-semibold">Source</th>
              <th className="px-3 py-2 font-semibold">Observed</th>
              <th className="px-3 py-2 font-semibold">Evidence</th>
              <th className="px-3 py-2 font-semibold">Confidence</th>
            </tr>
          </thead>
          <tbody>
            {sortedSources.map((entry) => (
              <tr key={entry.source} className="border-b border-slate-100 last:border-b-0">
                <td className="px-3 py-2 align-top font-mono text-[11px] text-slate-500">#{entry.rank ?? '?'}</td>
                <td className="px-3 py-2 align-top font-medium text-slate-800">
                  {ADAPTER_LABELS[entry.source] || entry.source}
                  <p className="mt-0.5 text-[10px] font-normal text-slate-500">{entry.listingIds.length} listing{entry.listingIds.length === 1 ? '' : 's'}</p>
                </td>
                <td className="px-3 py-2 align-top text-slate-600">{entry.summary.observedAt || 'unknown'}</td>
                <td className="px-3 py-2 align-top text-slate-600">{entry.summary.evidenceCount}</td>
                <td className="px-3 py-2 align-top">
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${confidenceBandColor(entry.confidenceBand)}`}>
                    {formatConfidence(entry.confidence)} · {entry.confidenceBand || 'unknown'}
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
