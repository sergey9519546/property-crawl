"use client";

import * as React from "react";
import { AlertTriangle, Layers, MapPin } from "lucide-react";
import type { GeoJSONSource, Map as MapLibreMap, MapMouseEvent, Popup } from "maplibre-gl";
import type { Feature, FeatureCollection, Point } from "geojson";
import type { DiscoveryFilters } from "@/lib/discovery-query";
import { discoverySearchParams } from "@/lib/discovery-query";
import { useLocale } from "@/components/i18n/locale-provider";
import { AERIAL_IMAGERY_STYLE, OPENFREEMAP_POSITRON_STYLE, RASTER_STREET_STYLE } from "@/lib/map-style";
import { attachBasemapFallback, switchBasemapStyle, toggleFemaFloodOverlay } from "@/lib/map-controller";
import { SOURCES } from "@/components/terminal/property-data";
import "maplibre-gl/dist/maplibre-gl.css";

type MapFeatureProps = {
  id?: string;
  count?: number;
  isCluster?: boolean;
  pinColor?: string;
  source?: string;
  status?: string;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  openingBid?: number | null;
};

type ApiFeature = {
  geometry?: { type?: string; coordinates?: number[] };
  properties?: MapFeatureProps;
};
type MapResponse = { type?: string; features?: ApiFeature[]; revision?: string; truncated?: boolean };

const DISCOVERY_SOURCE_ID = "discovery-listings";
const DISCOVERY_CLUSTER_LAYER_ID = "discovery-clusters";
const DISCOVERY_COUNT_LAYER_ID = "discovery-cluster-count";
const DISCOVERY_PIN_LAYER_ID = "discovery-pins";
const EMPTY_COLLECTION: FeatureCollection<Point, MapFeatureProps> = { type: "FeatureCollection", features: [] };

function toGeoJsonCollection(features: ApiFeature[] | undefined): FeatureCollection<Point, MapFeatureProps> {
  const out: Feature<Point, MapFeatureProps>[] = [];
  for (const item of features || []) {
    const coords = item.geometry?.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) continue;
    const lng = Number(coords[0]);
    const lat = Number(coords[1]);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
    const props = item.properties || {};
    const count = Number(props.count) || 1;
    const isCluster = count > 1;
    const pinColor = props.source && props.source !== "multiple"
      ? (SOURCES[props.source]?.color ?? "#181529")
      : "#181529";
    out.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [lng, lat] },
      properties: { ...props, count, isCluster, pinColor },
    });
  }
  return { type: "FeatureCollection", features: out };
}

function ensureDiscoveryLayers(
  map: MapLibreMap,
  collection: FeatureCollection<Point, MapFeatureProps>,
  floodEnabled: boolean,
) {
  try {
    const existingSource = map.getSource(DISCOVERY_SOURCE_ID) as GeoJSONSource | undefined;
    if (existingSource) {
      existingSource.setData(collection);
    } else if (map.isStyleLoaded()) {
      map.addSource(DISCOVERY_SOURCE_ID, { type: "geojson", data: collection });
      map.addLayer({
        id: DISCOVERY_CLUSTER_LAYER_ID,
        type: "circle",
        source: DISCOVERY_SOURCE_ID,
        filter: ["==", ["get", "isCluster"], true],
        paint: {
          "circle-color": "#181529",
          "circle-radius": ["step", ["get", "count"], 16, 10, 20, 50, 25, 250, 30],
          "circle-stroke-width": 2.5,
          "circle-stroke-color": "#ffffff",
          "circle-opacity": 0.92,
        },
      });
      map.addLayer({
        id: DISCOVERY_COUNT_LAYER_ID,
        type: "symbol",
        source: DISCOVERY_SOURCE_ID,
        filter: ["==", ["get", "isCluster"], true],
        layout: {
          "text-field": ["to-string", ["get", "count"]],
          "text-size": 12,
          "text-allow-overlap": true,
        },
        paint: {
          "text-color": "#ffffff",
        },
      });
      map.addLayer({
        id: DISCOVERY_PIN_LAYER_ID,
        type: "circle",
        source: DISCOVERY_SOURCE_ID,
        filter: ["!=", ["get", "isCluster"], true],
        paint: {
          "circle-color": ["coalesce", ["get", "pinColor"], "#181529"],
          "circle-radius": 7.5,
          "circle-stroke-width": 2,
          "circle-stroke-color": "#ffffff",
        },
      });
    }
    toggleFemaFloodOverlay(map, floodEnabled);
  } catch {
    // Wait until style.load finishes rehydrating.
  }
}

export function DiscoveryMap({
  filters,
  onOpenListing,
  onCompare,
  compareIds,
  compareFull,
}: {
  filters: DiscoveryFilters;
  onOpenListing: (id: string) => void;
  onCompare: (id: string) => void;
  compareIds: string[];
  compareFull: boolean;
}) {
  const { locale, messages: m } = useLocale();
  const ref = React.useRef<HTMLDivElement>(null);
  const mapRef = React.useRef<MapLibreMap | null>(null);
  const maplibreRef = React.useRef<typeof import("maplibre-gl") | null>(null);
  const popupRef = React.useRef<Popup | null>(null);
  const filtersRef = React.useRef(filters);
  const onOpenRef = React.useRef(onOpenListing);
  const onCompareRef = React.useRef(onCompare);
  const compareIdsRef = React.useRef(compareIds);
  const compareFullRef = React.useRef(compareFull);
  const collectionRef = React.useRef<FeatureCollection<Point, MapFeatureProps>>(EMPTY_COLLECTION);
  const [mapLayer, setMapLayer] = React.useState<"street" | "aerial">("street");
  const [floodOverlay, setFloodOverlay] = React.useState(false);
  const floodOverlayRef = React.useRef(false);
  const fallbackUsedRef = React.useRef(false);
  const initializedLayerRef = React.useRef<"street" | "aerial" | null>(null);

  filtersRef.current = filters;
  onOpenRef.current = onOpenListing;
  onCompareRef.current = onCompare;
  compareIdsRef.current = compareIds;
  compareFullRef.current = compareFull;
  floodOverlayRef.current = floodOverlay;

  const [error, setError] = React.useState("");
  const [notice, setNotice] = React.useState(m.listingsUi.mapLoading);
  const requestRef = React.useRef<{ id: number; controller: AbortController; signature: string } | null>(null);
  const settledRef = React.useRef("");
  const loadRef = React.useRef<(() => Promise<void>) | null>(null);

  const openClusterPopup = React.useCallback((coords: [number, number], props: MapFeatureProps) => {
    const map = mapRef.current;
    const maplibre = maplibreRef.current;
    if (!map || !maplibre || !props.id) return;
    const currentZoom = map.getZoom?.() ?? 5;
    if (currentZoom < 15 && typeof map.easeTo === "function") {
      const nextZoom = Math.min(currentZoom + (currentZoom < 8 ? 3 : 2), 16);
      map.easeTo({ center: coords, zoom: nextZoom, duration: 400 });
      return;
    }
    popupRef.current?.remove();
    const clusterRoot = document.createElement("div");
    clusterRoot.className = "grid max-h-64 w-64 gap-2 overflow-y-auto p-1 text-left";
    const header = document.createElement("p");
    header.className = "text-label font-bold text-ink";
    header.textContent = `${props.count} records at this location`;
    const status = document.createElement("p");
    status.className = "text-label text-ink-3";
    status.textContent = "Loading records…";
    clusterRoot.append(header, status);
    popupRef.current = new maplibre.Popup({ offset: 14, closeButton: true, maxWidth: "290px" })
      .setLngLat(coords)
      .setDOMContent(clusterRoot)
      .addTo(map);
    const eps = 0.0008;
    const clusterBbox = [coords[0] - eps, coords[1] - eps, coords[0] + eps, coords[1] + eps].map((v) => v.toFixed(5)).join(",");
    const clusterParams = discoverySearchParams(filtersRef.current, { bbox: clusterBbox, limit: 20 });
    void fetch(`/api/listings?${clusterParams}`, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        const items = Array.isArray(data?.listings) ? data.listings : [];
        status.remove();
        if (items.length === 0) {
          const fallbackLink = document.createElement("a");
          fallbackLink.href = `/listings/${encodeURIComponent(props.id!)}`;
          fallbackLink.className = "inline-flex min-h-10 items-center justify-center rounded-lg bg-ink px-3 text-xs font-semibold text-white";
          fallbackLink.textContent = m.listingsUi.openRecordBtn;
          fallbackLink.onclick = (click) => {
            click.preventDefault();
            click.stopPropagation();
            onOpenRef.current(props.id!);
          };
          clusterRoot.append(fallbackLink);
          return;
        }
        for (const item of items) {
          const row = document.createElement("div");
          row.className = "grid gap-1 border-t border-line pt-2 first:border-t-0 first:pt-0";
          const link = document.createElement("a");
          link.href = `/listings/${encodeURIComponent(item.id)}`;
          link.className = "text-xs font-bold text-ink hover:underline";
          link.textContent = item.address || item.id;
          link.onclick = (click) => {
            click.preventDefault();
            click.stopPropagation();
            onOpenRef.current(item.id);
          };
          const sub = document.createElement("p");
          sub.className = "text-label text-ink-3";
          sub.textContent = [
            [item.city, item.state].filter(Boolean).join(", "),
            typeof item.openingBid === "number" && Number.isFinite(item.openingBid) && item.openingBid > 0
              ? `$${Math.round(item.openingBid).toLocaleString("en-US")}`
              : null,
          ].filter(Boolean).join(" · ");
          row.append(link, sub);
          clusterRoot.append(row);
        }
      })
      .catch(() => {
        status.textContent = "Unable to expand cluster records.";
      });
  }, [m.listingsUi.openRecordBtn]);

  const openPinPopup = React.useCallback((coords: [number, number], props: MapFeatureProps) => {
    const map = mapRef.current;
    const maplibre = maplibreRef.current;
    if (!map || !maplibre || !props.id) return;
    popupRef.current?.remove();
    const root = document.createElement("div");
    root.className = "grid gap-2 p-1 text-left";
    const listingId = props.id;
    if (props.address) {
      const heading = document.createElement("a");
      heading.href = `/listings/${encodeURIComponent(listingId)}`;
      heading.className = "text-xs font-bold text-ink hover:underline";
      heading.textContent = props.address;
      heading.onclick = (click) => {
        click.preventDefault();
        click.stopPropagation();
        onOpenRef.current(listingId);
      };
      root.append(heading);
      const metaParts = [
        [props.city, props.state].filter(Boolean).join(", "),
        typeof props.openingBid === "number" && Number.isFinite(props.openingBid) && props.openingBid > 0
          ? `$${Math.round(props.openingBid).toLocaleString("en-US")}`
          : null,
      ].filter(Boolean);
      if (metaParts.length > 0) {
        const meta = document.createElement("p");
        meta.className = "text-label text-ink-3";
        meta.textContent = metaParts.join(" · ");
        root.append(meta);
      }
    }
    const selected = compareIdsRef.current.includes(listingId);
    const blocked = compareFullRef.current && !selected;
    const compareBtn = document.createElement("button");
    compareBtn.type = "button";
    compareBtn.className = "inline-flex min-h-10 items-center justify-center rounded-lg border border-line-strong bg-card px-3 text-xs font-semibold text-ink";
    compareBtn.setAttribute("aria-pressed", selected ? "true" : "false");
    compareBtn.disabled = blocked;
    compareBtn.textContent = selected ? m.listingsUi.inCompareBtn : blocked ? m.listingsUi.compareFullBtn : m.listingsUi.compareBtn;
    compareBtn.onclick = (click) => {
      click.stopPropagation();
      if (compareBtn.disabled) return;
      onCompareRef.current(listingId);
      const next = compareBtn.getAttribute("aria-pressed") !== "true";
      compareBtn.setAttribute("aria-pressed", next ? "true" : "false");
      compareBtn.textContent = next ? m.listingsUi.inCompareBtn : m.listingsUi.compareBtn;
    };
    const openBtn = document.createElement("a");
    openBtn.href = `/listings/${encodeURIComponent(listingId)}`;
    openBtn.className = "inline-flex min-h-10 items-center justify-center rounded-lg bg-ink px-3 text-xs font-semibold text-white";
    openBtn.textContent = m.listingsUi.openRecordBtn;
    openBtn.onclick = (click) => {
      click.preventDefault();
      click.stopPropagation();
      onOpenRef.current(listingId);
    };
    root.append(compareBtn, openBtn);
    popupRef.current = new maplibre.Popup({ closeButton: true, offset: 12, maxWidth: "250px" })
      .setLngLat(coords)
      .setDOMContent(root)
      .addTo(map);
  }, [m.listingsUi.compareBtn, m.listingsUi.compareFullBtn, m.listingsUi.inCompareBtn, m.listingsUi.openRecordBtn]);

  const load = React.useCallback(async () => {
    const map = mapRef.current;
    if (!map) return;
    const bounds = map.getBounds();
    const bbox = [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()].map((value: number) => value.toFixed(5)).join(",");
    const params = discoverySearchParams(filters, { bbox, limit: 500, zoom: Math.round(map.getZoom()) });
    const signature = params.toString();
    if (signature === settledRef.current || signature === requestRef.current?.signature) return;
    requestRef.current?.controller.abort();
    const request = { id: (requestRef.current?.id || 0) + 1, controller: new AbortController(), signature };
    requestRef.current = request;
    try {
      setError(""); setNotice("Loading visible map area…");
      const response = await fetch(`/api/listings/map?${params}`, { cache: "no-store", signal: request.controller.signal });
      const payload = await response.json() as MapResponse;
      if (!response.ok) throw new Error((payload as { error?: string }).error || "Map records are unavailable.");
      if (requestRef.current?.id !== request.id) return;
      settledRef.current = signature;
      popupRef.current?.remove();
      popupRef.current = null;
      const collection = toGeoJsonCollection(payload.features);
      collectionRef.current = collection;
      ensureDiscoveryLayers(map, collection, floodOverlayRef.current);
      setNotice(`${collection.features.length} visible map ${payload.truncated ? "clusters (coverage capped)" : "records"}.`);
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") return;
      if (requestRef.current?.id !== request.id) return;
      requestRef.current = null;
      setError(locale === "en" && caught instanceof Error ? caught.message : m.listingsUi.mapUnavailable); setNotice("");
    }
  }, [filters, locale, m.listingsUi.mapUnavailable]);
  loadRef.current = load;

  React.useEffect(() => {
    let disposed = false;
    let fallbackTimer: number | null = null;
    let secondaryTimer: number | null = null;
    let detachFallback: (() => void) | null = null;

    void import("maplibre-gl").then((maplibre) => {
      if (disposed || !ref.current) return;
      maplibreRef.current = maplibre;
      const map = new maplibre.Map({
        container: ref.current,
        style: OPENFREEMAP_POSITRON_STYLE,
        center: [-98.5795, 39.8283],
        zoom: 3.25,
        attributionControl: false,
      });
      initializedLayerRef.current = "street";
      map.addControl(new maplibre.NavigationControl(), "top-right");
      map.addControl(
        new maplibre.AttributionControl({
          compact: true,
          customAttribution: "OpenFreeMap · OpenStreetMap · U.S. Geological Survey · FEMA NFHL",
        }),
        "bottom-left",
      );
      mapRef.current = map;

      const rehydrate = () => {
        if (!disposed) {
          ensureDiscoveryLayers(map, collectionRef.current, floodOverlayRef.current);
        }
      };

      let fallbackApplied = false;
      detachFallback = attachBasemapFallback(map, RASTER_STREET_STYLE, {
        onFallback: () => {
          fallbackApplied = true;
          fallbackUsedRef.current = true;
        },
        onRehydrate: rehydrate,
      });

      const applyFallback = () => {
        if (disposed || fallbackApplied) return;
        fallbackApplied = true;
        fallbackUsedRef.current = true;
        try {
          switchBasemapStyle(map, RASTER_STREET_STYLE, rehydrate);
        } catch {
          setError(m.listingsUi.mapUnavailable);
          return;
        }
        secondaryTimer = window.setTimeout(() => {
          if (!disposed && !map.isStyleLoaded() && !map.loaded()) setError(m.listingsUi.mapUnavailable);
        }, 5_000);
      };

      fallbackTimer = window.setTimeout(() => {
        if (!map.isStyleLoaded() && !disposed) applyFallback();
      }, 3_500);

      const handleClusterClick = (e: MapMouseEvent & { features?: Array<{ geometry?: unknown; properties?: unknown }> }) => {
        const feat = e.features?.[0];
        if (!feat || !feat.geometry || (feat.geometry as Point).type !== "Point") return;
        const coords = (feat.geometry as Point).coordinates as [number, number];
        openClusterPopup(coords, (feat.properties || {}) as MapFeatureProps);
      };
      const handlePinClick = (e: MapMouseEvent & { features?: Array<{ geometry?: unknown; properties?: unknown }> }) => {
        const feat = e.features?.[0];
        if (!feat || !feat.geometry || (feat.geometry as Point).type !== "Point") return;
        const coords = (feat.geometry as Point).coordinates as [number, number];
        openPinPopup(coords, (feat.properties || {}) as MapFeatureProps);
      };
      const setPointer = () => { map.getCanvas().style.cursor = "pointer"; };
      const clearPointer = () => { map.getCanvas().style.cursor = ""; };

      map.on("click", DISCOVERY_CLUSTER_LAYER_ID, handleClusterClick);
      map.on("click", DISCOVERY_PIN_LAYER_ID, handlePinClick);
      map.on("mouseenter", DISCOVERY_CLUSTER_LAYER_ID, setPointer);
      map.on("mouseleave", DISCOVERY_CLUSTER_LAYER_ID, clearPointer);
      map.on("mouseenter", DISCOVERY_PIN_LAYER_ID, setPointer);
      map.on("mouseleave", DISCOVERY_PIN_LAYER_ID, clearPointer);

      const requestPins = () => { if (!disposed) void loadRef.current?.(); };
      map.once("load", () => {
        rehydrate();
        requestPins();
      });
      map.on("moveend", requestPins);
      requestAnimationFrame(requestPins);
    }).catch(() => setError("Map engine could not load. Use the ranked grid to continue research."));

    return () => {
      disposed = true;
      detachFallback?.();
      if (fallbackTimer !== null) window.clearTimeout(fallbackTimer);
      if (secondaryTimer !== null) window.clearTimeout(secondaryTimer);
      requestRef.current?.controller.abort();
      popupRef.current?.remove();
      popupRef.current = null;
      mapRef.current?.remove();
      mapRef.current = null;
      maplibreRef.current = null;
      initializedLayerRef.current = null;
    };
  }, [m.listingsUi.mapUnavailable, openClusterPopup, openPinPopup]);

  React.useEffect(() => {
    const map = mapRef.current;
    if (!map || initializedLayerRef.current === mapLayer) return;
    initializedLayerRef.current = mapLayer;
    const nextStyle = mapLayer === "aerial"
      ? AERIAL_IMAGERY_STYLE
      : (fallbackUsedRef.current ? RASTER_STREET_STYLE : OPENFREEMAP_POSITRON_STYLE);
    switchBasemapStyle(map, nextStyle, () => {
      ensureDiscoveryLayers(map, collectionRef.current, floodOverlayRef.current);
    });
  }, [mapLayer]);

  React.useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    toggleFemaFloodOverlay(map, floodOverlay);
  }, [floodOverlay]);

  React.useEffect(() => { if (mapRef.current) void load(); }, [load]);

  return <section className="overflow-hidden rounded-2xl border border-line bg-card shadow-sm" aria-label="Map results">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3 text-xs">
      <span className="flex items-center gap-2 font-semibold"><MapPin size={15} />Viewport-based source records</span>
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Map basemap" className="inline-flex rounded-control border border-line bg-paper p-0.5">
          <button
            type="button"
            aria-pressed={mapLayer === "street"}
            onClick={() => setMapLayer("street")}
            className={`rounded-control px-2.5 py-1 text-xs font-semibold transition-colors ${mapLayer === "street" ? "bg-ink text-white" : "text-ink-2 hover:text-ink"}`}
          >
            Street
          </button>
          <button
            type="button"
            aria-pressed={mapLayer === "aerial"}
            onClick={() => setMapLayer("aerial")}
            className={`rounded-control px-2.5 py-1 text-xs font-semibold transition-colors ${mapLayer === "aerial" ? "bg-ink text-white" : "text-ink-2 hover:text-ink"}`}
          >
            Aerial
          </button>
        </div>
        <button
          type="button"
          aria-pressed={floodOverlay}
          onClick={() => setFloodOverlay((prev) => !prev)}
          className={`inline-flex items-center gap-1 rounded-control border px-2.5 py-1 text-xs font-semibold transition-colors ${floodOverlay ? "border-ink bg-ink text-white" : "border-line bg-paper text-ink-2 hover:text-ink"}`}
        >
          <Layers size={13} aria-hidden /> Flood zones
        </button>
        <span className="text-ink-3">{notice}</span>
      </div>
    </div>
    {error && <p role="alert" className="m-4 flex gap-2 rounded-lg bg-catch-wash p-3 text-xs text-catch-ink"><AlertTriangle size={15} />{error}</p>}
    <div ref={ref} className="h-[560px] bg-paper" />
  </section>;
}
