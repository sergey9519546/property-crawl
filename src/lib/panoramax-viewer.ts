import type { PanoramaxCandidate } from './panoramax-client';

export const PANORAMAX_SCRIPT = 'https://cdn.jsdelivr.net/npm/@panoramax/web-viewer@5.2.0/build/esm/index_photoviewer.js';
// Published 5.2.0 package import map. Pin its floating font entry as well.
export const PANORAMAX_IMPORTS = Object.fromEntries(Object.entries({
  '@fortawesome/fontawesome-svg-core': '@fortawesome/fontawesome-svg-core@6.7.2/index.mjs',
  '@fortawesome/free-regular-svg-icons': '@fortawesome/free-regular-svg-icons@6.7.2/index.mjs',
  '@fortawesome/free-solid-svg-icons': '@fortawesome/free-solid-svg-icons@6.7.2/index.mjs',
  '@maplibre/vt-pbf': '@maplibre/vt-pbf@4.3.0/dist/index.es.js',
  '@mapbox/vector-tile': '@mapbox/vector-tile@2.0.4/index.js',
  '@photo-sphere-viewer/core': '@photo-sphere-viewer/core@5.15.1/index.module.js',
  '@photo-sphere-viewer/core/': '@photo-sphere-viewer/core@5.15.1/',
  '@photo-sphere-viewer/equirectangular-tiles-adapter': '@photo-sphere-viewer/equirectangular-tiles-adapter@5.15.1/index.module.js',
  '@photo-sphere-viewer/markers-plugin': '@photo-sphere-viewer/markers-plugin@5.15.1/index.module.js',
  '@photo-sphere-viewer/markers-plugin/': '@photo-sphere-viewer/markers-plugin@5.15.1/',
  '@photo-sphere-viewer/virtual-tour-plugin': '@photo-sphere-viewer/virtual-tour-plugin@5.15.1/index.module.js',
  '@photo-sphere-viewer/virtual-tour-plugin/': '@photo-sphere-viewer/virtual-tour-plugin@5.15.1/',
  'geojson-vt': 'geojson-vt@4.0.2/src/index.js',
  'iconify-icon': 'iconify-icon@3.0.2/dist/iconify-icon.mjs',
  'json5': 'json5@2.2.3/dist/index.min.mjs',
  'lit': 'lit@3.3.2/index.js', 'lit/': 'lit@3.3.2/',
  'lit-html': 'lit-html@3.3.2/lit-html.js', 'lit-html/': 'lit-html@3.3.2/',
  'lit-element/': 'lit-element@4.2.2/',
  'maplibre-gl': 'maplibre-gl@5.21.1/dist/maplibre-gl.js', 'maplibre-gl/': 'maplibre-gl@5.21.1/',
  '@fontsource/atkinson-hyperlegible-next/': '@fontsource/atkinson-hyperlegible-next@5.2.2/',
  'pmtiles': 'pmtiles@4.4.0/dist/esm/index.js',
  '@lit/reactive-element': '@lit/reactive-element@2.1.2/reactive-element.js',
  '@mapbox/point-geometry': '@mapbox/point-geometry@1.1.0/index.js',
  'fflate': 'fflate@0.8.2/esm/browser.js', 'pbf': 'pbf@4.0.1/index.js',
  'three': 'three@0.179.1/build/three.module.js',
  'get-promisable-result': 'get-promisable-result@2.0.0/dist/esm/index.js',
}).map(([name, path]) => [name, 'https://cdn.jsdelivr.net/npm/' + path]));
let libraryLoad: Promise<void> | null = null;
let importMapInstalled = false;

export function loadPanoramaxViewer(): Promise<void> {
  if (customElements.get('pnx-photo-viewer')) return Promise.resolve();
  if (libraryLoad) return libraryLoad;
  libraryLoad = new Promise<void>((resolve, reject) => {
    if (!importMapInstalled) {
      const map = document.createElement('script');
      map.type = 'importmap';
      // Scope bare-name resolution to this provider's CDN module graph.
      map.textContent = JSON.stringify({ scopes: { 'https://cdn.jsdelivr.net/npm/': PANORAMAX_IMPORTS } });
      document.head.appendChild(map); importMapInstalled = true;
    }
    const script = document.createElement('script');
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      script.onload = null; script.onerror = null;
      if (error) { script.remove(); reject(error); } else resolve();
    };
    const timer = window.setTimeout(() => finish(new Error('Street viewer timed out')), 20000);
    script.type = 'module'; script.async = true; script.src = PANORAMAX_SCRIPT;
    script.referrerPolicy = 'no-referrer';
    script.onload = () => {
      // A module load event can precede custom-element registration. Keep the
      // bounded deadline active until the component itself becomes available.
      void customElements.whenDefined('pnx-photo-viewer').then(() => finish(), () => finish(new Error('Street viewer did not initialize')));
    };
    script.onerror = () => finish(new Error('Street viewer could not load'));
    document.head.appendChild(script);
  }).catch(error => { libraryLoad = null; throw error; });
  return libraryLoad;
}

export type ViewerState = 'loading' | 'loaded' | 'failed';

// Library readiness does not prove a photograph rendered. Only the provider's
// picture-loaded event for the currently selected picture clears the timeout.
export function mountPanoramaxViewer(
  host: HTMLElement, candidate: PanoramaxCandidate,
  onState: (state: ViewerState) => void,
  onSelection: (pictureId: string) => void,
  timeoutMs = 20000,
): () => void {
  const viewer = document.createElement('pnx-photo-viewer');
  let active = true;
  let selected = candidate.pictureId;
  let timer: ReturnType<typeof setTimeout>;
  const fail = () => {
    if (!active) return;
    clearTimeout(timer); onState('failed');
  };
  const startLoading = () => {
    clearTimeout(timer); onState('loading');
    timer = setTimeout(fail, timeoutMs);
  };
  const select = (event: Event) => {
    const pictureId = (event as CustomEvent<{ picId?: unknown }>).detail?.picId;
    if (!active || typeof pictureId !== 'string' || !pictureId.trim()) return;
    if (pictureId !== selected) { selected = pictureId; onSelection(pictureId); startLoading(); }
  };
  const loaded = (event: Event) => {
    if (!active || (event as CustomEvent<{ picId?: unknown }>).detail?.picId !== selected) return;
    clearTimeout(timer); onState('loaded');
  };
  viewer.addEventListener('select', select);
  viewer.addEventListener('psv:picture-loaded', loaded);
  viewer.addEventListener('psv:picture-failed', fail);
  viewer.addEventListener('broken', fail);
  viewer.setAttribute('url-parameters', 'false');
  viewer.setAttribute('keyboard-shortcuts', 'false');
  viewer.setAttribute('sequence', candidate.collectionId);
  viewer.setAttribute('picture', candidate.pictureId);
  viewer.style.cssText = 'display:block;width:100%;height:100%;min-height:280px';
  viewer.setAttribute('endpoint', 'https://api.panoramax.xyz/api');
  startLoading(); host.appendChild(viewer);
  return () => {
    active = false; clearTimeout(timer);
    viewer.removeEventListener('select', select);
    viewer.removeEventListener('psv:picture-loaded', loaded);
    viewer.removeEventListener('psv:picture-failed', fail);
    viewer.removeEventListener('broken', fail);
    viewer.remove();
  };
}
