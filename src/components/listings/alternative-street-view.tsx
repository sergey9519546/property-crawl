"use client";

import { useEffect, useRef, useState } from 'react';
import { ExternalLink, RotateCcw } from 'lucide-react';
import {
  fetchAlternativeStreetView,
  type AlternativeCandidate,
  type AlternativeImageryPayload,
} from '@/lib/panoramax-client';
import { loadPanoramaxViewer, mountPanoramaxViewer, type ViewerState } from '@/lib/panoramax-viewer';
import { useNonce } from '@/components/security/nonce-context';

type State =
  | { status: 'loading' }
  | { status: 'unavailable'; reason: string }
  | { status: 'available'; data: AlternativeImageryPayload; selectedProvider: 'panoramax' | 'mapillary' };

export function AlternativeStreetView({ listingId, address }: { listingId: string; address: string }) {
  const nonce = useNonce();
  const [state, setState] = useState<State>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const viewerHost = useRef<HTMLDivElement>(null);
  const [viewerState, setViewerState] = useState<ViewerState>('loading');
  const [selectedPicture, setSelectedPicture] = useState<string | null>(null);
  const [mapillaryFailed, setMapillaryFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 12_000);
    let active = true;
    setState({ status: 'loading' });
    setViewerState('loading');
    setSelectedPicture(null);
    setMapillaryFailed(false);

    void fetchAlternativeStreetView(listingId, controller.signal)
      .then((result) => {
        if (!active) return;
        if (!result.ok) {
          setState({ status: 'unavailable', reason: result.reason });
          return;
        }
        const { data } = result;
        if (!data.available || !data.primary) {
          setState({ status: 'unavailable', reason: data.unavailableReason });
          return;
        }
        setState({
          status: 'available',
          data,
          selectedProvider: data.panoramax ? 'panoramax' : 'mapillary',
        });
      })
      .catch(() => {
        if (active) {
          setState({
            status: 'unavailable',
            reason: 'Open street imagery could not be checked right now. Try again or use the property map.',
          });
        }
      })
      .finally(() => window.clearTimeout(timeout));

    return () => {
      active = false;
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [listingId, attempt]);

  const activeCandidate: AlternativeCandidate | null = state.status === 'available'
    ? (state.selectedProvider === 'panoramax' ? state.data.panoramax : state.data.mapillary) || state.data.primary
    : null;

  useEffect(() => {
    setMapillaryFailed(false);
    if (!activeCandidate || activeCandidate.provider !== 'panoramax') return;
    let active = true;
    let dispose: (() => void) | undefined;
    setViewerState('loading');
    setSelectedPicture(activeCandidate.pictureId);
    void loadPanoramaxViewer(nonce)
      .then(() => {
        if (active && viewerHost.current) {
          dispose = mountPanoramaxViewer(viewerHost.current, activeCandidate, setViewerState, setSelectedPicture);
        }
      })
      .catch(() => {
        if (active) setViewerState('failed');
      });
    return () => {
      active = false;
      dispose?.();
    };
  }, [activeCandidate, nonce]);

  if (state.status !== 'available' || !activeCandidate) {
    return (
      <div className="grid h-full min-h-[220px] place-items-center bg-paper p-5 text-center">
        <div>
          <p className="text-sm font-semibold text-ink">Other street imagery</p>
          <p role="status" className="mt-2 max-w-md text-xs leading-6 text-ink-3">
            {state.status === 'loading'
              ? 'Checking nearby Panoramax and Mapillary coverage...'
              : state.status === 'unavailable'
                ? state.reason
                : 'No eligible Panoramax or Mapillary street imagery was found within 100 m of the recorded location.'}
          </p>
          {state.status === 'unavailable' ? (
            <button
              type="button"
              onClick={() => setAttempt((value) => value + 1)}
              className="mt-3 inline-flex min-h-9 items-center gap-2 rounded-control border border-line-strong bg-card px-3 py-1.5 text-xs font-semibold text-ink-2 transition-colors hover:bg-paper hover:text-ink"
            >
              <RotateCcw size={14} />Retry other imagery
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  const kind = activeCandidate.mediaType === 'panorama_360' ? '360 street panorama' : 'Directional street photos';
  const captured = activeCandidate.capturedAt
    ? new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(activeCandidate.capturedAt))
    : 'Capture date unknown';
  const hasBoth = Boolean(state.data.panoramax && state.data.mapillary);

  return (
    <div className="flex h-full min-h-[250px] flex-col bg-paper" data-testid="alternative-street-view">
      <div className="relative min-h-0 flex-1">
        {activeCandidate.provider === 'panoramax' ? (
          <>
            <div ref={viewerHost} aria-label={'Street imagery near ' + address} className="h-full min-h-[280px] w-full" />
            {viewerState !== 'loaded' ? (
              <div role="status" className="absolute bottom-3 left-3 right-3 rounded-lg bg-card p-3 text-xs shadow">
                {viewerState === 'loading'
                  ? 'Loading street photograph...'
                  : 'The street photograph could not load. Open Panoramax below or try again.'}
                {viewerState === 'failed' ? (
                  <button type="button" className="ml-2 font-semibold underline" onClick={() => setAttempt((value) => value + 1)}>
                    Try again
                  </button>
                ) : null}
              </div>
            ) : null}
          </>
        ) : activeCandidate.thumbUrl && !mapillaryFailed ? (
          <div className="relative flex h-full min-h-[280px] w-full items-center justify-center bg-paper p-2">
            <img
              src={activeCandidate.thumbUrl}
              alt={'Mapillary street imagery near ' + address}
              className="max-h-full max-w-full rounded object-contain"
              onError={() => setMapillaryFailed(true)}
            />
          </div>
        ) : (
          <div className="grid h-full min-h-[280px] place-items-center bg-paper p-5 text-center">
            <div>
              <p className="text-sm font-semibold text-ink">Mapillary street capture</p>
              <p className="mt-1 max-w-md text-xs text-ink-3">
                {mapillaryFailed
                  ? 'The Mapillary preview thumbnail could not load directly.'
                  : 'Mapillary matched an approved capture near this location.'}
              </p>
              <a
                href={activeCandidate.viewerUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-3 inline-flex min-h-10 items-center gap-1 rounded-lg border border-line-strong bg-card px-3 py-2 text-xs font-semibold underline"
              >
                Open Mapillary<ExternalLink size={12} />
              </a>
            </div>
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-line bg-card px-4 py-3 text-xs leading-5">
        {hasBoth ? (
          <div className="mb-2 flex flex-wrap gap-2">
            {(['panoramax', 'mapillary'] as const).map((provider) => (
              <button
                key={provider}
                type="button"
                aria-pressed={activeCandidate.provider === provider}
                onClick={() => setState((prev) => prev.status === 'available' ? { ...prev, selectedProvider: provider } : prev)}
                className={`rounded-md border px-2.5 py-1 text-xs font-semibold ${
                  activeCandidate.provider === provider
                    ? 'border-ink bg-ink text-white'
                    : 'border-line-strong bg-paper text-ink-2'
                }`}
              >
                {provider === 'panoramax' ? 'Panoramax' : 'Mapillary'}
              </button>
            ))}
          </div>
        ) : null}
        <p className="font-semibold">
          {activeCandidate.provider === 'panoramax' && selectedPicture !== activeCandidate.pictureId
            ? 'Exploring nearby street imagery'
            : kind}
        </p>
        <p className="text-ink-3">
          Starting image: {Math.round(activeCandidate.distanceMeters)} m from recorded location / {captured}
        </p>
        <p className="text-ink-3">
          {activeCandidate.attribution.provider}
          {activeCandidate.attribution.producer ? ' / ' + activeCandidate.attribution.producer : ''}
          {' / '}
          {activeCandidate.license.id || 'Recorded license'}
          {activeCandidate.provider === 'panoramax' ? '. Current photo details appear in the viewer.' : '.'}
        </p>
        <p className="text-ink-3">Street context; property frontage and condition are not verified.</p>
        <a
          href={activeCandidate.viewerUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-1 inline-flex items-center gap-1 font-semibold underline"
        >
          Open {activeCandidate.attribution.provider}<ExternalLink size={12} />
        </a>
      </div>
    </div>
  );
}
