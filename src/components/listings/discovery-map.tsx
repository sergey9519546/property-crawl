"use client";

import * as React from "react";
import { AlertTriangle, MapPin } from "lucide-react";
import type { DiscoveryFilters } from "@/lib/discovery-query";
import { discoverySearchParams } from "@/lib/discovery-query";
import { useLocale } from "@/components/i18n/locale-provider";
import { OPENFREEMAP_POSITRON_STYLE, RASTER_STREET_STYLE } from "@/lib/map-style";
import { SOURCES } from "@/components/terminal/property-data";
import "maplibre-gl/dist/maplibre-gl.css";

type Feature = {
  geometry?: { type?: string; coordinates?: number[] };
  properties?: {
    id?: string;
    count?: number;
    source?: string;
    status?: string;
    address?: string | null;
    city?: string | null;
    state?: string | null;
    openingBid?: number | null;
  };
};
type MapResponse = { type?: string; features?: Feature[]; revision?: string; truncated?: boolean };

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
  const mapRef = React.useRef<any>(null);
  const markerRef = React.useRef<any[]>([]);
  const popupRef = React.useRef<any>(null);
  const onOpenRef = React.useRef(onOpenListing);
  const onCompareRef = React.useRef(onCompare);
  const compareIdsRef = React.useRef(compareIds);
  const compareFullRef = React.useRef(compareFull);
  onOpenRef.current = onOpenListing;
  onCompareRef.current = onCompare;
  compareIdsRef.current = compareIds;
  compareFullRef.current = compareFull;
  const [error, setError] = React.useState("");
  const [notice, setNotice] = React.useState(m.listingsUi.mapLoading);
  const requestRef = React.useRef<{ id: number; controller: AbortController; signature: string } | null>(null);
  const settledRef = React.useRef("");
  const loadRef = React.useRef<(() => Promise<void>) | null>(null);

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
      if (!response.ok) throw new Error((payload as any).error || "Map records are unavailable.");
      if (requestRef.current?.id !== request.id) return;
      settledRef.current = signature;
      popupRef.current?.remove();
      popupRef.current = null;
      markerRef.current.forEach((marker) => marker.remove()); markerRef.current = [];
      const maplibre = await import("maplibre-gl");
      for (const feature of payload.features || []) {
        const point = feature.geometry?.coordinates;
        if (!point || point.length < 2) continue;
        const props = feature.properties || {};
        const button = document.createElement("button");
        button.type = "button";
        button.className = "live-market-marker";
        const clustered = (props.count || 0) > 1;
        const sourceColor = props.source && props.source !== "multiple"
          ? (SOURCES[props.source]?.color ?? "#181529")
          : "#181529";
        button.style.setProperty("--marker-color", sourceColor);
        button.setAttribute("aria-label", clustered ? `${props.count} records in this area — click to zoom` : (props.address ? `Inspect ${props.address}` : "Open property record"));
        const halo = document.createElement("span");
        halo.className = "live-market-marker__halo";
        halo.setAttribute("aria-hidden", "true");
        const pin = document.createElement("span");
        pin.className = "live-market-marker__pin";
        pin.setAttribute("aria-hidden", "true");
        pin.textContent = clustered ? String(props.count) : "•";
        button.append(halo, pin);
        button.onclick = (event) => {
          event.stopPropagation();
          if (!props.id) return;
          if (clustered) {
            const nextZoom = Math.min((map.getZoom?.() ?? 5) + 2.5, 16);
            if (typeof map.easeTo === "function" && nextZoom > (map.getZoom?.() ?? 0) + 0.25) {
              map.easeTo({ center: [point[0], point[1]], zoom: nextZoom, duration: 400 });
              return;
            }
          }
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
              clustered ? `${props.count} records in cluster` : null,
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
            .setLngLat([point[0], point[1]])
            .setDOMContent(root)
            .addTo(map);
        };
        markerRef.current.push(new maplibre.Marker({ element: button }).setLngLat([point[0], point[1]]).addTo(map));
      }
      setNotice(`${payload.features?.length || 0} visible map ${payload.truncated ? "clusters (coverage capped)" : "records"}.`);
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") return;
      if (requestRef.current?.id !== request.id) return;
      requestRef.current = null;
      setError(locale === "en" && caught instanceof Error ? caught.message : m.listingsUi.mapUnavailable); setNotice("");
    }
  }, [filters]);
  loadRef.current = load;

  React.useEffect(() => {
    let disposed = false;
    let fallbackTimer: number | null = null;
    void import("maplibre-gl").then(({ Map, NavigationControl, AttributionControl }) => {
      if (disposed || !ref.current) return;
      const map = new Map({ container: ref.current, style: OPENFREEMAP_POSITRON_STYLE, center: [-98.5795, 39.8283], zoom: 3.25, attributionControl: false });
      map.addControl(new NavigationControl(), "top-right");
      map.addControl(new AttributionControl({ compact: true, customAttribution: "OpenFreeMap · OpenStreetMap · CARTO" }), "bottom-left");
      mapRef.current = map;
      let fallbackApplied = false;
      const applyFallback = () => {
        if (disposed || fallbackApplied) return;
        fallbackApplied = true;
        try { map.setStyle(RASTER_STREET_STYLE); } catch {}
      };
      map.on("error", () => { if (!map.isStyleLoaded()) applyFallback(); });
      fallbackTimer = window.setTimeout(() => { if (!map.isStyleLoaded() && !disposed) applyFallback(); }, 3_500);
      const requestPins = () => { if (!disposed) void loadRef.current?.(); };
      map.once("load", requestPins);
      map.on("moveend", requestPins);
      requestAnimationFrame(requestPins);
    }).catch(() => setError("Map engine could not load. Use the ranked grid to continue research."));
    return () => { disposed = true; if (fallbackTimer !== null) window.clearTimeout(fallbackTimer); requestRef.current?.controller.abort(); popupRef.current?.remove(); markerRef.current.forEach((marker) => marker.remove()); mapRef.current?.remove(); mapRef.current = null; };
  }, []);

  React.useEffect(() => { if (mapRef.current) void load(); }, [load]);
  return <section className="overflow-hidden rounded-2xl border border-line bg-card shadow-sm" aria-label="Map results">
    <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3 text-xs"><span className="flex items-center gap-2 font-semibold"><MapPin size={15} />Viewport-based source records</span><span className="text-ink-3">{notice}</span></div>
    {error && <p role="alert" className="m-4 flex gap-2 rounded-lg bg-catch-wash p-3 text-xs text-catch-ink"><AlertTriangle size={15} />{error}</p>}
    <div ref={ref} className="h-[560px] bg-paper" />
  </section>;
}
