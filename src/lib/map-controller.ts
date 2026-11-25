import type { Map as MapLibreMap, StyleSpecification } from "maplibre-gl";
import {
  FEMA_NFHL_LAYER_ID,
  FEMA_NFHL_OVERLAY_SOURCE,
  FEMA_NFHL_SOURCE_ID,
} from "@/lib/map-style";

export const BASEMAP_SOURCE_IDS: ReadonlySet<string> = new Set([
  "openmaptiles",
  "usgs-topo",
  "usgs-imagery",
]);

const styleGenerationMap = new WeakMap<object, number>();

export function currentStyleGeneration(map: MapLibreMap): number {
  return styleGenerationMap.get(map as unknown as object) ?? 0;
}

export function isBasemapErrorEvent(
  event: unknown,
  map?: Pick<MapLibreMap, "isStyleLoaded"> | null,
  basemapSourceIds: ReadonlySet<string> = BASEMAP_SOURCE_IDS,
): boolean {
  if (!event || typeof event !== "object") return false;
  const sourceId = typeof (event as { sourceId?: unknown }).sourceId === "string"
    ? (event as { sourceId: string }).sourceId
    : null;
  if (sourceId) {
    return basemapSourceIds.has(sourceId);
  }
  if (map && typeof map.isStyleLoaded === "function") {
    return !map.isStyleLoaded();
  }
  return true;
}

/**
 * Attaches a single-shot error listener that switches to the USGSTopo fallback
 * ONLY on basemap source/style errors. Overlay errors (FEMA NFHL, parcel
 * boundaries, discovery GeoJSON clusters) are isolated and ignored.
 */
export function attachBasemapFallback(
  map: MapLibreMap,
  fallbackStyle: StyleSpecification | string,
  options?: {
    basemapSourceIds?: ReadonlySet<string>;
    shouldFallback?: () => boolean;
    onFallback?: () => void;
    onRehydrate?: () => void;
  },
): () => void {
  let applied = false;
  const allowedSources = options?.basemapSourceIds ?? BASEMAP_SOURCE_IDS;

  const onError = (event: unknown) => {
    if (applied) return;
    if (options?.shouldFallback && !options.shouldFallback()) return;
    if (!isBasemapErrorEvent(event, map, allowedSources)) return;
    applied = true;
    options?.onFallback?.();
    if (options?.onRehydrate) {
      switchBasemapStyle(map, fallbackStyle, options.onRehydrate);
    } else {
      map.setStyle(fallbackStyle, { diff: false });
    }
  };

  map.on("error", onError);
  return () => {
    map.off("error", onError);
  };
}

/**
 * Switches basemap style in-place without recreating the WebGL map instance.
 * Tracks a monotonic style generation per map so rapid toggles drop stale
 * `style.load` rehydrations before touching custom sources/layers.
 */
export function switchBasemapStyle(
  map: MapLibreMap,
  nextStyle: StyleSpecification | string,
  onRehydrate?: () => void,
): number {
  const key = map as unknown as object;
  const targetGeneration = (styleGenerationMap.get(key) ?? 0) + 1;
  styleGenerationMap.set(key, targetGeneration);

  if (onRehydrate) {
    map.once("style.load", () => {
      if ((styleGenerationMap.get(key) ?? 0) !== targetGeneration) return;
      onRehydrate();
    });
  }

  map.setStyle(nextStyle, { diff: false });
  return targetGeneration;
}

/**
 * Adds or removes the opt-in FEMA National Flood Hazard Layer (NFHL) raster
 * overlay without disturbing underlying basemap or parcel layers.
 */
export function toggleFemaFloodOverlay(map: MapLibreMap, enabled: boolean): void {
  try {
    if (!enabled) {
      if (map.getLayer(FEMA_NFHL_LAYER_ID)) {
        map.removeLayer(FEMA_NFHL_LAYER_ID);
      }
      if (map.getSource(FEMA_NFHL_SOURCE_ID)) {
        map.removeSource(FEMA_NFHL_SOURCE_ID);
      }
      return;
    }

    if (typeof map.isStyleLoaded === "function" && !map.isStyleLoaded()) {
      return;
    }

    if (!map.getSource(FEMA_NFHL_SOURCE_ID)) {
      map.addSource(FEMA_NFHL_SOURCE_ID, FEMA_NFHL_OVERLAY_SOURCE);
    }
    if (!map.getLayer(FEMA_NFHL_LAYER_ID)) {
      map.addLayer({
        id: FEMA_NFHL_LAYER_ID,
        type: "raster",
        source: FEMA_NFHL_SOURCE_ID,
        minzoom: 12,
        maxzoom: 22,
        paint: {
          "raster-opacity": 0.55,
        },
      });
    }
  } catch {
    // Style may still be transitioning during unmount or rapid basemap toggle.
  }
}
