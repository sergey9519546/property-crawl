"use client";

import Link from "next/link";
import * as React from "react";
import { ArrowRight, LocateFixed, MapPin, Minus, Plus, X } from "lucide-react";
import type { LngLatBoundsLike, Map as MapLibreMap, Marker as MapLibreMarker } from "maplibre-gl";
import { PropertyListing, SOURCES } from "./property-data";

type MarketMapProps = {
  listings: PropertyListing[];
  onUnderwrite: (listing: PropertyListing) => void;
};

type MarkerEntry = { id: string; element: HTMLButtonElement; marker: MapLibreMarker };
type MapView = { center: string; zoom: string };

const DEFAULT_VIEW: MapView = { center: "-98.5795,39.8283", zoom: "3.25" };

function isGeocoded(listing: PropertyListing) {
  return Number.isFinite(listing.lat) && Number.isFinite(listing.lng) && listing.lat !== 0 && listing.lng !== 0;
}

function usePrefersReducedMotion() {
  const [reduced, setReduced] = React.useState(false);
  React.useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);
  return reduced;
}

export function MarketMap({ listings, onUnderwrite }: MarketMapProps) {
  const mapContainerRef = React.useRef<HTMLDivElement>(null);
  const mapRef = React.useRef<MapLibreMap | null>(null);
  const maplibreRef = React.useRef<typeof import("maplibre-gl") | null>(null);
  const markersRef = React.useRef<MarkerEntry[]>([]);
  const listingsRef = React.useRef<PropertyListing[]>([]);
  const reducedMotionRef = React.useRef(false);
  const fitListingsRef = React.useRef<() => void>(() => undefined);
  const homeViewRef = React.useRef<MapView>(DEFAULT_VIEW);

  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [mapReady, setMapReady] = React.useState(false);
  const [mapCreated, setMapCreated] = React.useState(false);
  const [mapUnavailable, setMapUnavailable] = React.useState(false);
  const [mapView, setMapView] = React.useState<MapView>(DEFAULT_VIEW);
  const [announcement, setAnnouncement] = React.useState("");
  const shouldReduceMotion = usePrefersReducedMotion();

  const mappable = React.useMemo(() => listings.filter(isGeocoded), [listings]);
  const selected = mappable.find((listing) => listing.id === selectedId) ?? null;

  listingsRef.current = mappable;
  reducedMotionRef.current = shouldReduceMotion;

  const syncView = React.useCallback((map: MapLibreMap) => {
    const center = map.getCenter();
    setMapView({ center: `${center.lng.toFixed(4)},${center.lat.toFixed(4)}`, zoom: map.getZoom().toFixed(2) });
  }, []);

  const selectListing = React.useCallback((listing: PropertyListing, focus = true) => {
    setSelectedId(listing.id);
    setAnnouncement(`${listing.address} selected. Deal score ${listing.dealScore}.`);
    if (!focus || !mapRef.current) return;
    const map = mapRef.current;
    map.stop();
    const camera = {
      center: [listing.lng, listing.lat] as [number, number],
      zoom: Math.max(map.getZoom(), 10.5),
      offset: typeof window !== "undefined" && window.innerWidth >= 900 ? ([-150, 0] as [number, number]) : ([0, -90] as [number, number]),
    };
    if (reducedMotionRef.current) map.jumpTo(camera);
    else map.easeTo({ ...camera, duration: 500 });
  }, []);

  React.useEffect(() => {
    markersRef.current.forEach(({ id, element }) => {
      const active = id === selectedId;
      element.dataset.active = active ? "true" : "false";
      element.setAttribute("aria-pressed", active ? "true" : "false");
    });
  }, [selectedId]);

  React.useEffect(() => {
    const container = mapContainerRef.current;
    if (!container) return;
    let disposed = false;
    let loadTimeout: number | null = null;

    void import("maplibre-gl")
      .then((maplibre) => {
        if (disposed || !mapContainerRef.current) return;
        const map = new maplibre.Map({
          container: mapContainerRef.current,
          style: "https://tiles.openfreemap.org/styles/positron",
          center: [-98.5795, 39.8283],
          zoom: 3.25,
          minZoom: 2,
          maxZoom: 18,
          attributionControl: false,
        });
        maplibreRef.current = maplibre;
        mapRef.current = map;
        setMapCreated(true);
        map.addControl(new maplibre.AttributionControl({ compact: true, customAttribution: "OpenFreeMap · OpenStreetMap contributors" }), "bottom-left");

        const updateView = () => syncView(map);
        map.on("moveend", updateView);
        map.on("zoomend", updateView);
        map.once("load", () => {
          if (disposed) return;
          setMapReady(true);
          setMapUnavailable(false);
          syncView(map);
        });
        map.on("error", () => {
          if (!map.loaded() && !disposed) setMapUnavailable(true);
        });
        loadTimeout = window.setTimeout(() => {
          if (!map.loaded() && !disposed) setMapUnavailable(true);
        }, 6_000);
      })
      .catch(() => {
        if (!disposed) setMapUnavailable(true);
      });

    return () => {
      disposed = true;
      if (loadTimeout !== null) window.clearTimeout(loadTimeout);
      markersRef.current.forEach(({ marker }) => marker.remove());
      markersRef.current = [];
      mapRef.current?.remove();
      mapRef.current = null;
      maplibreRef.current = null;
    };
  }, [syncView]);

  React.useEffect(() => {
    const map = mapRef.current;
    const maplibre = maplibreRef.current;
    if (!mapCreated || !map || !maplibre) return;
    markersRef.current.forEach(({ marker }) => marker.remove());
    markersRef.current = [];

    mappable.forEach((listing) => {
      const source = SOURCES[listing.source] ?? SOURCES.sheriff;
      const element = document.createElement("button");
      element.type = "button";
      element.className = "live-market-marker";
      element.dataset.testid = "map-marker";
      element.dataset.active = listing.id === selectedId ? "true" : "false";
      element.setAttribute("aria-label", `Show ${listing.address} on map`);
      element.setAttribute("aria-controls", "live-market-map-preview");
      element.setAttribute("aria-pressed", listing.id === selectedId ? "true" : "false");
      element.style.setProperty("--marker-color", source.color);
      element.innerHTML = `<span aria-hidden="true" class="live-market-marker__halo"></span><span aria-hidden="true" class="live-market-marker__pin">${listing.dealScore}</span><span aria-hidden="true" class="live-market-marker__label">${listing.city}, ${listing.state}</span>`;
      element.addEventListener("click", (event) => {
        event.stopPropagation();
        selectListing(listing);
      });
      const marker = new maplibre.Marker({ element, anchor: "center" }).setLngLat([listing.lng, listing.lat]).addTo(map);
      markersRef.current.push({ id: listing.id, element, marker });
    });

    const fitListings = () => {
      const current = listingsRef.current;
      if (current.length === 0) {
        const camera = { center: [-98.5795, 39.8283] as [number, number], zoom: 3.25 };
        homeViewRef.current = DEFAULT_VIEW;
        setMapView(DEFAULT_VIEW);
        if (reducedMotionRef.current) map.jumpTo(camera);
        else map.easeTo({ ...camera, duration: 450 });
        return;
      }
      if (current.length === 1) {
        const listing = current[0];
        const camera = { center: [listing.lng, listing.lat] as [number, number], zoom: 10.75 };
        const home = { center: `${listing.lng.toFixed(4)},${listing.lat.toFixed(4)}`, zoom: "10.75" };
        homeViewRef.current = home;
        setMapView(home);
        if (reducedMotionRef.current) map.jumpTo(camera);
        else map.easeTo({ ...camera, duration: 450 });
        return;
      }
      const bounds = new MapLibreBounds();
      current.forEach((listing) => bounds.extend([listing.lng, listing.lat]));
      const boundsArray = bounds.toArray() as LngLatBoundsLike;
      const padding = { top: 72, right: window.innerWidth >= 900 ? 400 : 54, bottom: 72, left: 54 };
      const homeCamera = map.cameraForBounds(boundsArray, { padding, maxZoom: 11.5 });
      if (homeCamera?.center) {
        const center = homeCamera.center;
        const [homeLng, homeLat] = Array.isArray(center)
          ? center
          : "lng" in center
            ? [center.lng, center.lat]
            : [center.lon, center.lat];
        const home = {
          center: `${homeLng.toFixed(4)},${homeLat.toFixed(4)}`,
          zoom: (homeCamera.zoom ?? map.getZoom()).toFixed(2),
        };
        homeViewRef.current = home;
        setMapView(home);
      }
      map.fitBounds(boundsArray, {
        padding,
        maxZoom: 11.5,
        duration: reducedMotionRef.current ? 0 : 500,
      });
    };
    fitListingsRef.current = fitListings;
    fitListings();

    return () => {
      markersRef.current.forEach(({ marker }) => marker.remove());
      markersRef.current = [];
    };
  }, [mapCreated, mappable, selectListing]);

  const changeZoom = (delta: number) => {
    const map = mapRef.current;
    if (!map) return;
    map.stop();
    const nextZoom = Math.max(2, Math.min(18, map.getZoom() + delta));
    const center = map.getCenter();
    setMapView({
      center: `${center.lng.toFixed(4)},${center.lat.toFixed(4)}`,
      zoom: nextZoom.toFixed(2),
    });
    if (reducedMotionRef.current) map.jumpTo({ zoom: nextZoom });
    else map.easeTo({ zoom: nextZoom, duration: 300 });
  };

  const resetView = () => {
    setSelectedId(null);
    setMapView(homeViewRef.current);
    fitListingsRef.current();
  };

  return (
    <section
      data-testid="market-map"
      data-map-engine="maplibre"
      data-map-ready={mapReady ? "true" : "false"}
      data-map-unavailable={mapUnavailable ? "true" : "false"}
      data-map-center={mapView.center}
      data-map-zoom={mapView.zoom}
      data-map-motion={shouldReduceMotion ? "reduced" : "full"}
      aria-label="Interactive filtered listings map"
      className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
        <div>
          <div className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden /><p className="text-[10px] font-extrabold uppercase tracking-[0.12em] text-emerald-700">Live geographic view</p></div>
          <h3 className="mt-1 font-bold text-slate-950">Market map</h3>
          <p className="text-xs text-slate-500">{mappable.length} geocoded {mappable.length === 1 ? "listing" : "listings"} · synced with the feed</p>
        </div>
        <div className="flex items-center gap-1 rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
          <MapControl label="Zoom map out" onClick={() => changeZoom(-1)}><Minus className="h-4 w-4" aria-hidden /></MapControl>
          <MapControl label="Reset map view" onClick={resetView}><LocateFixed className="h-4 w-4" aria-hidden /></MapControl>
          <MapControl label="Zoom map in" onClick={() => changeZoom(1)}><Plus className="h-4 w-4" aria-hidden /></MapControl>
        </div>
      </div>

      <div className="relative h-[520px] overflow-hidden bg-[#E8EEF2] sm:h-[600px] lg:h-[660px]" data-map-center={mapView.center} data-map-zoom={mapView.zoom} data-map-motion={shouldReduceMotion ? "reduced" : "full"}>
        <div className="absolute inset-0 z-0 grid place-items-center bg-[radial-gradient(circle_at_50%_45%,#f8fafc,#e2e8f0)] text-center"><div className="max-w-sm px-6 text-slate-500"><MapPin className="mx-auto h-7 w-7" aria-hidden /><p className="mt-2 text-xs font-semibold">Loading the geographic listing layer…</p></div></div>
        <div ref={mapContainerRef} data-testid="live-market-maplibre" aria-label="Interactive street map of filtered listings" className="live-market-maplibre absolute inset-0 z-[1]" />

        {mapUnavailable ? (
          <div className="absolute inset-0 z-20 overflow-auto bg-slate-50/95 p-5 backdrop-blur-sm">
            <div role="status" className="mx-auto max-w-3xl rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><p className="font-bold text-slate-950">Street tiles are temporarily unavailable.</p><p className="mt-1 text-xs leading-5 text-slate-500">The listing coordinates and actions remain available below. Reconnect to restore the interactive street map.</p></div>
            <div data-testid="map-fallback-list" className="mx-auto mt-3 grid max-w-3xl gap-2 sm:grid-cols-2">
              {mappable.map((listing) => (
                <button key={listing.id} type="button" onClick={() => selectListing(listing, false)} className="flex min-h-16 items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500" aria-label={`Inspect ${listing.address} without map tiles`}>
                  <span className="min-w-0"><span className="block truncate text-sm font-bold text-slate-950">{listing.address}</span><span className="block text-xs text-slate-500">{listing.city}, {listing.state} · {listing.county} County</span></span>
                  <span className="shrink-0 rounded-lg bg-emerald-50 px-2 py-1 text-xs font-extrabold text-emerald-700">{listing.dealScore}</span>
                </button>
              ))}
            </div>
            <p className="mx-auto mt-4 max-w-3xl text-[10px] font-semibold text-slate-500">Map data © OpenStreetMap contributors.</p>
          </div>
        ) : null}

        {selected ? <MapPreview listing={selected} onClose={() => setSelectedId(null)} onUnderwrite={onUnderwrite} /> : null}

        {mappable.length === 0 ? <div className="absolute inset-0 z-20 grid place-items-center bg-slate-50 px-6 text-center"><div><MapPin className="mx-auto h-8 w-8 text-slate-400" aria-hidden /><p className="mt-3 font-bold text-slate-700">No geocoded listings match these filters.</p></div></div> : null}
      </div>
      <p className="sr-only" aria-live="polite">{announcement}</p>
    </section>
  );
}

function MapControl({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" aria-label={label} onClick={onClick} className="grid h-11 w-11 place-items-center rounded-lg text-slate-700 transition-colors hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">{children}</button>;
}

function MapPreview({ listing, onClose, onUnderwrite }: { listing: PropertyListing; onClose: () => void; onUnderwrite: (listing: PropertyListing) => void }) {
  return (
    <article id="live-market-map-preview" data-testid="map-listing-preview" aria-label={`Selected listing: ${listing.address}`} className="absolute bottom-4 left-4 right-4 z-30 rounded-2xl border border-white/80 bg-white/95 p-4 shadow-[0_24px_80px_rgba(15,23,42,0.24)] backdrop-blur-xl sm:left-auto sm:w-[390px]">
      <button type="button" onClick={onClose} aria-label="Close map listing preview" className="absolute right-3 top-3 grid h-10 w-10 place-items-center rounded-xl text-slate-500 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"><X className="h-4 w-4" aria-hidden /></button>
      <div className="pr-11"><p className="text-[10px] font-extrabold uppercase tracking-[0.12em] text-emerald-700">{SOURCES[listing.source]?.label ?? listing.source} · Score {listing.dealScore}</p><h4 className="mt-1 text-lg font-bold tracking-[-0.02em] text-slate-950">{listing.address}</h4><p className="mt-1 flex items-center gap-1 text-xs text-slate-500"><MapPin className="h-3.5 w-3.5" aria-hidden /> {listing.city}, {listing.state} · {listing.county} County</p></div>
      <div className="mt-4 grid grid-cols-3 gap-2 text-center"><MapStat label="Opening" value={`$${Math.round(listing.openingBid / 1000)}k`} /><MapStat label="Value" value={`$${Math.round(listing.mid / 1000)}k`} /><MapStat label="Equity" value={`$${Math.round(listing.equity / 1000)}k`} green /></div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button type="button" onClick={() => onUnderwrite(listing)} className="inline-flex h-11 items-center justify-center gap-1 rounded-xl bg-slate-950 px-3 text-xs font-bold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2">Underwrite <ArrowRight className="h-3.5 w-3.5" aria-hidden /></button>
        <Link href={`/listings/${encodeURIComponent(listing.id)}`} className="inline-flex h-11 items-center justify-center gap-1 rounded-xl border border-slate-300 px-3 text-xs font-bold text-slate-950 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">Listing page <ArrowRight className="h-3.5 w-3.5" aria-hidden /></Link>
      </div>
    </article>
  );
}

function MapStat({ label, value, green = false }: { label: string; value: string; green?: boolean }) {
  return <div className="rounded-xl bg-slate-100 px-2 py-2.5"><p className="text-[9px] font-bold uppercase tracking-[0.08em] text-slate-400">{label}</p><p className={`mt-0.5 text-sm font-extrabold tabular-nums ${green ? "text-emerald-600" : "text-slate-950"}`}>{value}</p></div>;
}

class MapLibreBounds {
  private west = Number.POSITIVE_INFINITY;
  private south = Number.POSITIVE_INFINITY;
  private east = Number.NEGATIVE_INFINITY;
  private north = Number.NEGATIVE_INFINITY;
  extend([lng, lat]: [number, number]) {
    this.west = Math.min(this.west, lng); this.south = Math.min(this.south, lat); this.east = Math.max(this.east, lng); this.north = Math.max(this.north, lat); return this;
  }
  toArray(): [[number, number], [number, number]] { return [[this.west, this.south], [this.east, this.north]]; }
}
