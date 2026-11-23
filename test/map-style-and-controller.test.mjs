import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@/lib/map-style") {
      return nextResolve(new URL("../src/lib/map-style.ts", import.meta.url).href, context);
    }
    return nextResolve(specifier, context);
  },
});

const {
  OPENFREEMAP_POSITRON_STYLE,
  RASTER_STREET_STYLE,
  AERIAL_IMAGERY_STYLE,
  FEMA_NFHL_OVERLAY_SOURCE,
  FEMA_NFHL_SOURCE_ID,
  FEMA_NFHL_LAYER_ID,
} = await import("../src/lib/map-style.ts");

const {
  attachBasemapFallback,
  switchBasemapStyle,
  toggleFemaFloodOverlay,
  isBasemapErrorEvent,
  currentStyleGeneration,
} = await import("../src/lib/map-controller.ts");

function createMockMap({ initialLoaded = false } = {}) {
  let loaded = initialLoaded;
  const listeners = new Map();
  const onceListeners = new Map();
  const sources = new Map();
  const layers = new Map();
  const setStyleCalls = [];

  return {
    setStyleCalls,
    sources,
    layers,
    isStyleLoaded: () => loaded,
    setStyleLoaded: (v) => { loaded = v; },
    on(event, fn) {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event).push(fn);
    },
    once(event, fn) {
      if (!onceListeners.has(event)) onceListeners.set(event, []);
      onceListeners.get(event).push(fn);
    },
    off(event, fn) {
      if (listeners.has(event)) listeners.set(event, listeners.get(event).filter((f) => f !== fn));
      if (onceListeners.has(event)) onceListeners.set(event, onceListeners.get(event).filter((f) => f !== fn));
    },
    emit(event, payload) {
      for (const fn of [...(listeners.get(event) || [])]) fn(payload);
      const onces = onceListeners.get(event) || [];
      onceListeners.set(event, []);
      for (const fn of onces) fn(payload);
    },
    setStyle(style, opts) {
      setStyleCalls.push({ style, opts });
      sources.clear();
      layers.clear();
    },
    getSource: (id) => sources.get(id),
    addSource(id, spec) { sources.set(id, spec); },
    removeSource(id) { sources.delete(id); },
    getLayer: (id) => layers.get(id),
    addLayer(spec) { layers.set(spec.id, spec); },
    removeLayer(id) { layers.delete(id); },
  };
}

test("map-style uses 100% free public-domain USGS & FEMA endpoints with zero CARTO or Esri tiles", () => {
  const streetTiles = RASTER_STREET_STYLE.sources["usgs-topo"].tiles.join(" ");
  assert.match(streetTiles, /^https:\/\/basemap\.nationalmap\.gov\/arcgis\/rest\/services\/USGSTopo\//);
  assert.equal(RASTER_STREET_STYLE.sources["usgs-topo"].maxzoom, 16);
  assert.doesNotMatch(JSON.stringify(RASTER_STREET_STYLE), /cartocdn|carto\.com|arcgisonline\.com/i);

  const aerialTiles = AERIAL_IMAGERY_STYLE.sources["usgs-imagery"].tiles.join(" ");
  assert.match(aerialTiles, /^https:\/\/basemap\.nationalmap\.gov\/arcgis\/rest\/services\/USGSImageryOnly\//);
  assert.equal(AERIAL_IMAGERY_STYLE.sources["usgs-imagery"].maxzoom, 16);
  assert.doesNotMatch(JSON.stringify(AERIAL_IMAGERY_STYLE), /World_Imagery|arcgisonline\.com|Esri/i);

  assert.equal(OPENFREEMAP_POSITRON_STYLE, "https://tiles.openfreemap.org/styles/positron");
  assert.equal(FEMA_NFHL_OVERLAY_SOURCE.minzoom, 12);
  assert.equal(FEMA_NFHL_OVERLAY_SOURCE.tileSize, 512);
  assert.match(FEMA_NFHL_OVERLAY_SOURCE.tiles[0], /^https:\/\/hazards\.fema\.gov\/.*transparent=true/);
});

test("attachBasemapFallback isolates FEMA/overlay errors and triggers single-shot fallback only on basemap errors", () => {
  const map = createMockMap({ initialLoaded: true });
  let fallbackCount = 0;
  let rehydrateCount = 0;

  attachBasemapFallback(map, RASTER_STREET_STYLE, {
    onFallback: () => { fallbackCount += 1; },
    onRehydrate: () => { rehydrateCount += 1; },
  });

  // Overlay source error while basemap is loaded MUST be ignored
  assert.equal(isBasemapErrorEvent({ sourceId: FEMA_NFHL_SOURCE_ID }, map), false);
  assert.equal(isBasemapErrorEvent({ sourceId: "parcel-boundary" }, map), false);
  map.emit("error", { sourceId: FEMA_NFHL_SOURCE_ID });
  map.emit("error", { sourceId: "parcel-boundary" });
  map.emit("error", { message: "transient overlay warning" }); // no sourceId when style is already loaded
  assert.equal(fallbackCount, 0);
  assert.equal(map.setStyleCalls.length, 0);

  // Basemap source failure MUST trigger single-shot fallback with diff:false
  map.emit("error", { sourceId: "openmaptiles" });
  map.emit("error", { sourceId: "openmaptiles" });
  assert.equal(fallbackCount, 1);
  assert.equal(map.setStyleCalls.length, 1);
  assert.equal(map.setStyleCalls[0].style, RASTER_STREET_STYLE);
  assert.deepEqual(map.setStyleCalls[0].opts, { diff: false });

  map.emit("style.load");
  assert.equal(rehydrateCount, 1);
});

test("switchBasemapStyle passes diff:false and drops stale style.load rehydration under rapid toggles", () => {
  const map = createMockMap({ initialLoaded: true });
  const hydrated = [];

  const gen1 = switchBasemapStyle(map, AERIAL_IMAGERY_STYLE, () => hydrated.push("gen1"));
  const gen2 = switchBasemapStyle(map, RASTER_STREET_STYLE, () => hydrated.push("gen2"));

  assert.equal(gen2, gen1 + 1);
  assert.equal(currentStyleGeneration(map), gen2);
  assert.deepEqual(map.setStyleCalls.map((c) => c.opts), [{ diff: false }, { diff: false }]);

  // Emit style.load -> gen1 listener fires FIRST during event loop, sees gen !== gen2, and drops itself
  map.emit("style.load");
  assert.deepEqual(hydrated, ["gen2"]);
});

test("toggleFemaFloodOverlay adds and removes FEMA NFHL source and raster layer cleanly", () => {
  const map = createMockMap({ initialLoaded: true });

  toggleFemaFloodOverlay(map, true);
  assert.ok(map.sources.has(FEMA_NFHL_SOURCE_ID));
  assert.ok(map.layers.has(FEMA_NFHL_LAYER_ID));
  assert.equal(map.layers.get(FEMA_NFHL_LAYER_ID).paint["raster-opacity"], 0.55);

  toggleFemaFloodOverlay(map, false);
  assert.equal(map.sources.has(FEMA_NFHL_SOURCE_ID), false);
  assert.equal(map.layers.has(FEMA_NFHL_LAYER_ID), false);
});
