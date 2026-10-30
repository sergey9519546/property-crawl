"use client";

import * as React from "react";
import { AlertTriangle, MapPin } from "lucide-react";
import type { DiscoveryFilters } from "@/lib/discovery-query";
import { discoverySearchParams } from "@/lib/discovery-query";
import "maplibre-gl/dist/maplibre-gl.css";

type Feature = { geometry?: { type?: string; coordinates?: number[] }; properties?: { id?: string; count?: number; source?: string; status?: string } };
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
  const [notice, setNotice] = React.useState("Loading visible map area…");
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
        button.type = "button"; button.className = "live-market-marker";
        const clustered = (props.count || 0) > 1;
        button.setAttribute("aria-label", clustered ? `${props.count} records in this area` : "Open property record");
        button.textContent = clustered ? String(props.count) : "•";
        button.onclick = (event) => {
          event.stopPropagation();
          if (!props.id) return;
          if (clustered) {
            onOpenRef.current(props.id);
            return;
          }
          popupRef.current?.remove();
          const root = document.createElement("div");
          root.className = "grid gap-2 p-1";
          const listingId = props.id;
          const selected = compareIdsRef.current.includes(listingId);
          const blocked = compareFullRef.current && !selected;
          const compareBtn = document.createElement("button");
          compareBtn.type = "button";
          compareBtn.className = "inline-flex min-h-11 items-center justify-center rounded-lg border border-line-strong bg-card px-3 text-xs font-semibold text-ink";
          compareBtn.setAttribute("aria-pressed", selected ? "true" : "false");
          compareBtn.disabled = blocked;
          compareBtn.textContent = selected ? "In compare" : blocked ? "Compare is full" : "Compare";
          compareBtn.onclick = (click) => {
            click.stopPropagation();
            if (compareBtn.disabled) return;
            onCompareRef.current(listingId);
            const next = compareBtn.getAttribute("aria-pressed") !== "true";
            compareBtn.setAttribute("aria-pressed", next ? "true" : "false");
            compareBtn.textContent = next ? "In compare" : "Compare";
          };
          const openBtn = document.createElement("button");
          openBtn.type = "button";
          openBtn.className = "inline-flex min-h-11 items-center justify-center rounded-lg bg-ink px-3 text-xs font-semibold text-white";
          openBtn.textContent = "Open listing";
          openBtn.onclick = (click) => {
            click.stopPropagation();
            onOpenRef.current(listingId);
          };
          root.append(compareBtn, openBtn);
          popupRef.current = new maplibre.Popup({ closeButton: true, offset: 12, maxWidth: "220px" })
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
      setError(caught instanceof Error ? caught.message : "Map records are unavailable."); setNotice("");
    }
  }, [filters]);
  loadRef.current = load;

  React.useEffect(() => {
    let disposed = false;
    void import("maplibre-gl").then(({ Map, NavigationControl }) => {
      if (disposed || !ref.current) return;
      const map = new Map({ container: ref.current, style: "https://tiles.openfreemap.org/styles/positron", center: [-98.5795, 39.8283], zoom: 3.25, attributionControl: false });
      map.addControl(new NavigationControl(), "top-right"); mapRef.current = map;
      const requestPins = () => { if (!disposed) void loadRef.current?.(); };
      map.once("load", requestPins);
      map.on("moveend", requestPins);
      requestAnimationFrame(requestPins);
    }).catch(() => setError("Map engine could not load. Use the ranked grid to continue research."));
    return () => { disposed = true; requestRef.current?.controller.abort(); popupRef.current?.remove(); markerRef.current.forEach((marker) => marker.remove()); mapRef.current?.remove(); mapRef.current = null; };
  }, []);

  React.useEffect(() => { if (mapRef.current) void load(); }, [load]);
  return <section className="overflow-hidden rounded-2xl border border-line bg-card shadow-sm" aria-label="Map results">
    <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3 text-xs"><span className="flex items-center gap-2 font-semibold"><MapPin size={15} />Viewport-based source records</span><span className="text-ink-3">{notice}</span></div>
    {error && <p role="alert" className="m-4 flex gap-2 rounded-lg bg-catch-wash p-3 text-xs text-catch-ink"><AlertTriangle size={15} />{error}</p>}
    <div ref={ref} className="h-[560px] bg-paper" />
  </section>;
}
