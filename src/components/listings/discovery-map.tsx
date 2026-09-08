"use client";

import * as React from "react";
import { AlertTriangle, MapPin } from "lucide-react";
import type { DiscoveryFilters } from "@/lib/discovery-query";
import { discoverySearchParams } from "@/lib/discovery-query";

type Feature = { geometry?: { type?: string; coordinates?: number[] }; properties?: { id?: string; count?: number; source?: string; status?: string } };
type MapResponse = { type?: string; features?: Feature[]; revision?: string; truncated?: boolean };

export function DiscoveryMap({ filters, onOpenListing }: { filters: DiscoveryFilters; onOpenListing: (id: string) => void }) {
  const ref = React.useRef<HTMLDivElement>(null);
  const mapRef = React.useRef<any>(null);
  const markerRef = React.useRef<any[]>([]);
  const requestRef = React.useRef<AbortController | null>(null);
  const loadRef = React.useRef<() => void>(() => {});
  const [error, setError] = React.useState("");
  const [backgroundError, setBackgroundError] = React.useState("");
  const [notice, setNotice] = React.useState("Loading visible map area…");
  const appliedQuery = React.useRef<string | null>(null);
  const clearMarkers = React.useCallback(() => {
    markerRef.current.forEach((marker) => marker.remove());
    markerRef.current = [];
  }, []);

  const load = React.useCallback(async () => {
    const map = mapRef.current;
    if (!map) return;
    const queryKey = discoverySearchParams(filters).toString();
    if (appliedQuery.current !== queryKey) clearMarkers();
    const bounds = map.getBounds();
    const wrap = (value: number) => ((value + 180) % 360 + 360) % 360 - 180;
    const world = bounds.getEast() - bounds.getWest() >= 360;
    const bbox = [world ? -180 : wrap(bounds.getWest()), Math.max(-90, bounds.getSouth()), world ? 180 : wrap(bounds.getEast()), Math.min(90, bounds.getNorth())].map((value: number) => value.toFixed(5)).join(",");
    const params = discoverySearchParams(filters, { bbox, zoom: Math.floor(map.getZoom()), limit: 500 });
    requestRef.current?.abort();
    const controller = new AbortController(); requestRef.current = controller;
    try {
      setError(""); setNotice("Loading visible map area…");
      const response = await fetch(`/api/listings/map?${params}`, { cache: "no-store", signal: controller.signal });
      const payload = await response.json() as MapResponse;
      if (!response.ok) throw new Error((payload as any).error || "Map records are unavailable.");
      if (!Array.isArray(payload.features)) throw new Error("Map results could not be read. Try again.");
      const { Marker } = await import("maplibre-gl");
      if (controller.signal.aborted) return;
      clearMarkers();
      appliedQuery.current = queryKey;
      for (const feature of payload.features || []) {
        const point = feature.geometry?.coordinates;
        if (!Array.isArray(point) || point.length < 2 || !Number.isFinite(point[0]) || !Number.isFinite(point[1]) || Math.abs(point[0]) > 180 || Math.abs(point[1]) > 90) continue;
        const props = feature.properties || {};
        const button = document.createElement("button");
        button.type = "button"; button.className = "live-market-marker";
        button.setAttribute("aria-label", props.count && props.count > 1 ? `${props.count} records in this area` : `Open property record`);
        button.textContent = props.count && props.count > 1 ? String(props.count) : "•";
        button.onclick = () => {
          if (props.count && props.count > 1) map.easeTo({ center: [point[0], point[1]], zoom: Math.min(20, map.getZoom() + 2) });
          else if (props.id) onOpenListing(props.id);
        };
        markerRef.current.push(new Marker({ element: button }).setLngLat([point[0], point[1]]).addTo(map));
      }
      setNotice(`${markerRef.current.length} ${payload.truncated ? "points and clusters · zoom in for more" : "points and clusters in view"}`);
    } catch (caught) { if (!controller.signal.aborted) { clearMarkers(); setError(caught instanceof TypeError ? "Map results could not be reached. Try again." : caught instanceof Error ? caught.message : "Map records are unavailable."); setNotice("Results unavailable"); } }
  }, [filters, onOpenListing, clearMarkers]);
  loadRef.current = () => void load();

  React.useEffect(() => {
    let disposed = false;
    void import("maplibre-gl").then(({ Map, NavigationControl }) => {
      if (disposed || !ref.current) return;
      const map = new Map({ container: ref.current, style: "https://tiles.openfreemap.org/styles/positron", center: [-98.5795, 39.8283], zoom: 3.25 });
      map.addControl(new NavigationControl(), "top-right"); mapRef.current = map;
      map.once("load", () => { setBackgroundError(""); loadRef.current(); }); map.on("moveend", () => loadRef.current());
      map.on("error", () => { setBackgroundError("The map background could not fully load. Use Grid to browse properties."); setNotice("Map background unavailable"); });
    }).catch(() => setError("Map engine could not load. Use the ranked grid to continue research."));
    return () => { disposed = true; requestRef.current?.abort(); markerRef.current.forEach((marker) => marker.remove()); mapRef.current?.remove(); mapRef.current = null; };
  }, []);

  React.useEffect(() => { if (mapRef.current?.loaded()) void load(); }, [load]);
  return <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm" aria-label="Map results">
    <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 text-xs"><span className="flex items-center gap-2 font-semibold"><MapPin size={15} />Properties in this area</span><span className="text-slate-500">{notice}</span></div>
    {backgroundError && <p role="alert" className="m-4 rounded-lg bg-amber-50 p-3 text-xs text-amber-950">{backgroundError}</p>}
    {error && <div role="alert" className="m-4 flex flex-wrap items-center gap-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-950"><AlertTriangle size={15} />{error}<button type="button" className="font-semibold underline" onClick={() => void load()}>Retry map</button></div>}
    <div ref={ref} className="h-[560px] bg-slate-100" />
  </section>;
}
