"use client";

import { useEffect, useRef, useState } from 'react';
import { ExternalLink, RotateCcw } from 'lucide-react';
import { parsePanoramaxCandidate, type PanoramaxCandidate } from '@/lib/panoramax-client';
import { loadPanoramaxViewer, mountPanoramaxViewer, type ViewerState } from '@/lib/panoramax-viewer';

type State = { status: 'loading' } | { status: 'unavailable'; reason: string } | { status: 'available'; candidate: PanoramaxCandidate };

export function AlternativeStreetView({ listingId, address }: { listingId: string; address: string }) {
  const [state, setState] = useState<State>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const viewerHost = useRef<HTMLDivElement>(null);
  const [viewerState, setViewerState] = useState<ViewerState>('loading');
  const [selectedPicture, setSelectedPicture] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 12000);
    let active = true;
    setState({ status: 'loading' });
    setViewerState('loading'); setSelectedPicture(null);
    void fetch('/api/property-image?mode=alternatives&listingId=' + encodeURIComponent(listingId), {
      cache: 'no-store', signal: controller.signal,
    }).then(async response => {
      const body = await response.json();
      if (!active) return;
      if (!response.ok) {
        setState({ status: 'unavailable', reason: typeof body.reason === 'string' ? body.reason : 'Other street imagery could not be checked.' });
        return;
      }
      const panorama = parsePanoramaxCandidate(body.candidate);
      const directional = Array.isArray(body.directionalSequences)
        ? body.directionalSequences.map(parsePanoramaxCandidate).find(Boolean) : null;
      const candidate = panorama || directional;
      setState(candidate ? { status: 'available', candidate } : {
        status: 'unavailable', reason: 'No eligible Panoramax street imagery was found within 100 m of the recorded location.',
      });
    }).catch(() => {
      if (active) setState({ status: 'unavailable', reason: 'Panoramax could not be checked right now. Try again or use the property map.' });
    }).finally(() => window.clearTimeout(timeout));
    return () => { active = false; controller.abort(); window.clearTimeout(timeout); };
  }, [listingId, attempt]);

  useEffect(() => {
    if (state.status !== 'available') return;
    let active = true;
    let dispose: (() => void) | undefined;
    setViewerState('loading'); setSelectedPicture(state.candidate.pictureId);
    void loadPanoramaxViewer().then(() => {
      if (active && viewerHost.current) dispose = mountPanoramaxViewer(viewerHost.current, state.candidate, setViewerState, setSelectedPicture);
    }).catch(() => { if (active) setViewerState('failed'); });
    return () => { active = false; dispose?.(); };
  }, [state]);

  if (state.status !== 'available') return <div className="grid h-full min-h-[220px] place-items-center bg-slate-100 p-5 text-center">
    <div><p className="text-sm font-semibold text-slate-950">Other street imagery</p>
      <p role="status" className="mt-2 max-w-md text-xs leading-6 text-slate-600">{state.status === 'loading' ? 'Checking nearby Panoramax coverage...' : state.reason}</p>
      {state.status === 'unavailable' && <button type="button" onClick={() => setAttempt(value => value + 1)} className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold"><RotateCcw size={14} />Retry other imagery</button>}
    </div>
  </div>;

  const { candidate } = state;
  const kind = candidate.mediaType === 'panorama_360' ? '360 street panorama' : 'Directional street photos';
  const captured = candidate.capturedAt ? new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(candidate.capturedAt)) : 'Capture date unknown';
  return <div className="flex h-full min-h-[250px] flex-col bg-slate-100" data-testid="alternative-street-view">
    <div className="relative min-h-0 flex-1">
      <div ref={viewerHost} aria-label={'Street imagery near ' + address} className="h-full min-h-[280px] w-full" />
      {viewerState !== 'loaded' && <div role="status" className="absolute bottom-3 left-3 right-3 rounded-lg bg-white p-3 text-xs shadow">
        {viewerState === 'loading' ? 'Loading street photograph...' : 'The street photograph could not load. Open Panoramax below or try again.'}
        {viewerState === 'failed' && <button type="button" className="ml-2 font-semibold underline" onClick={() => setAttempt(value => value + 1)}>Try again</button>}
      </div>}
    </div>
    <div className="shrink-0 border-t border-slate-200 bg-white px-4 py-3 text-xs leading-5">
      <p className="font-semibold">{selectedPicture === candidate.pictureId ? kind : 'Exploring nearby street imagery'}</p>
      <p className="text-slate-600">Starting image: {Math.round(candidate.distanceMeters)} m from recorded location / {captured}</p>
      <p className="text-slate-600">Panoramax{candidate.attribution.producer ? ' / ' + candidate.attribution.producer : ''} / {candidate.license.id || 'Recorded license'}. Current photo details appear in the viewer.</p>
      <p className="text-slate-500">Street context; property frontage and condition are not verified.</p>
      <a href={candidate.viewerUrl} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 font-semibold underline">Open Panoramax<ExternalLink size={12} /></a>
    </div>
  </div>;
}
