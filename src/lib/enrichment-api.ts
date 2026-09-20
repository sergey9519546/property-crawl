// src/lib/enrichment-api.ts
//
// Client-side helper for the P3-3 enrichment gateway (GET
// /api/enrichment/:parcelKey + POST /api/enrichment/:parcelKey/refresh).
// The view shape is server-defined; this module only types it and forwards
// the request through the canonical Next API route.

export type ConfidenceBand = 'high' | 'medium' | 'low' | 'unknown';

export interface EnrichmentSourceSummary {
  source: string;
  observedAt: string | null;
  openingBid: number | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  county: string | null;
  apn: string | null;
  evidenceCount: number;
}

export interface EnrichmentSource {
  source: string;
  summary: EnrichmentSourceSummary;
  listingIds: string[];
  crossSourceMatches: Array<Record<string, unknown>>;
  bakeOff: Record<string, unknown> | null;
  evidence: Array<Record<string, unknown>>;
  confidence?: number;
  confidenceBand?: ConfidenceBand;
  rank?: number;
  score?: Record<string, number>;
}

export interface EnrichmentAdapterOutcome {
  source: string;
  outcome: 'success' | 'empty' | 'failed' | 'skipped';
  records?: Array<Record<string, unknown>>;
  error?: string | null;
  reason?: string;
  startedAt: string;
}

export interface EnrichmentAggregateView {
  parcelKey: string;
  sourceCount: number;
  listingCount: number;
  freshestObservation: (EnrichmentSourceSummary & {
    confidence?: number | null;
    confidenceBand?: ConfidenceBand;
    rank?: number | null;
  }) | null;
  sources: EnrichmentSource[];
}

export interface EnrichmentAggregateResponse extends EnrichmentAggregateView {
  found: boolean;
}

export interface EnrichmentAdapterInfo {
  source: string;
}

export interface EnrichmentAdaptersResponse {
  adapters: EnrichmentAdapterInfo[];
  schema: string;
}

export interface EnrichmentRefreshResponse {
  parcelKey: string;
  scrapedAt: string;
  durationMs?: number;
  adapterOutcomes: EnrichmentAdapterOutcome[];
  view: EnrichmentAggregateResponse;
}

interface ApiOptions {
  fetchImpl?: typeof fetch;
  operatorToken?: string;
  signal?: AbortSignal;
}

async function callApi(path: string, init: RequestInit, options: ApiOptions = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const headers = new Headers(init.headers || {});
  if (!headers.has('content-type') && init.body && typeof init.body === 'string') {
    headers.set('content-type', 'application/json');
  }
  // Never attach operator bearer tokens from browser/client code. Session
  // cookie + Next private proxy inject credentials server-side.
  return fetchImpl(path, { ...init, headers, signal: options.signal, credentials: options.fetchImpl ? undefined : 'same-origin' });
}

export async function fetchEnrichmentAdapters(options: ApiOptions = {}): Promise<EnrichmentAdaptersResponse> {
  const res = await callApi('/api/enrichment', { method: 'GET' }, options);
  if (!res.ok) throw new Error(`Enrichment adapters request failed: ${res.status}`);
  return res.json();
}

export async function fetchEnrichmentByParcelKey(parcelKey: string, options: ApiOptions = {}): Promise<EnrichmentAggregateResponse | null> {
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(parcelKey)) throw new Error('parcelKey must match /^[A-Za-z0-9._:-]{1,128}$/');
  const res = await callApi(`/api/enrichment/${encodeURIComponent(parcelKey)}`, { method: 'GET' }, options);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Enrichment aggregate request failed: ${res.status}`);
  return res.json();
}

export async function refreshEnrichmentByParcelKey(
  parcelKey: string,
  options: ApiOptions & { sources?: string[] } = {}
): Promise<EnrichmentRefreshResponse> {
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(parcelKey)) throw new Error('parcelKey must match /^[A-Za-z0-9._:-]{1,128}$/');
  const body = options.sources && options.sources.length ? JSON.stringify({ sources: options.sources }) : '{}';
  const res = await callApi(
    `/api/enrichment/${encodeURIComponent(parcelKey)}/refresh`,
    { method: 'POST', body },
    options
  );
  const parsed = await res.json().catch(() => null);
  if (!res.ok) {
    const reason = parsed && (parsed.error || parsed.reason) ? (parsed.error || parsed.reason) : `HTTP ${res.status}`;
    throw new Error(`Enrichment refresh failed: ${reason}`);
  }
  return parsed;
}

export function formatConfidence(confidence: number | null | undefined): string {
  if (confidence == null || Number.isNaN(confidence)) return '—';
  return confidence.toFixed(2);
}

export function confidenceBandLabel(band: ConfidenceBand | undefined): string {
  switch (band) {
    case 'high': return 'High confidence';
    case 'medium': return 'Medium confidence';
    case 'low': return 'Low confidence';
    default: return 'Unknown confidence';
  }
}

export function confidenceBandColor(band: ConfidenceBand | undefined): string {
  switch (band) {
    case 'high': return 'bg-emerald-100 text-emerald-900';
    case 'medium': return 'bg-amber-100 text-amber-900';
    case 'low': return 'bg-rose-100 text-rose-900';
    default: return 'bg-stone-100 text-stone-600';
  }
}
