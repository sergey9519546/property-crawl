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
  const [error, setError] = React.useState("");
  const [notice, setNotice] = React.useState("Loading visible map area…");

  const load = React.useCallback(async () => {
    const map = mapRef.current;
    if (!map) return;
    const bounds = map.getBounds();
    const bbox = [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()].map((value: number) => value.toFixed(5)).join(",");
    const params = discoverySearchParams(filters, { bbox, limit: 500 });
    try {
      setError(""); setNotice("Loading visible map area…");
      const response = await fetch(`/api/listings/map?${params}`, { cache: "no-store" });
      const payload = await response.json() as MapResponse;
      if (!response.ok) throw new Error((payload as any).error || "Map records are unavailable.");
      markerRef.current.forEach((marker) => marker.remove()); markerRef.current = [];
      for (const feature of payload.features || []) {
        const point = feature.geometry?.coordinates;
        if (!point || point.length < 2) continue;
        const props = feature.properties || {};
        const button = document.createElement("button");
        button.type = "button"; button.className = "live-market-marker";
        button.setAttribute("aria-label", props.count && props.count > 1 ? `${props.count} records in this area` : `Open property record`);
        button.textContent = props.count && props.count > 1 ? String(props.count) : "•";
        button.onclick = () => { if (props.id) onOpenListing(props.id); };
        markerRef.current.push(new (await import("maplibre-gl")).Marker({ element: button }).setLngLat([point[0], point[1]]).addTo(map));
      }
      setNotice(`${payload.features?.length || 0} visible map ${payload.truncated ? "clusters (coverage capped)" : "records"}.`);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Map records are unavailable."); setNotice(""); }
  }, [filters, onOpenListing]);

  React.useEffect(() => {
    let disposed = false;
    void import("maplibre-gl").then(({ Map, NavigationControl }) => {
      if (disposed || !ref.current) return;
      const map = new Map({ container: ref.current, style: "https://tiles.openfreemap.org/styles/positron", center: [-98.5795, 39.8283], zoom: 3.25, attributionControl: false });
      map.addControl(new NavigationControl(), "top-right"); mapRef.current = map;
      map.once("load", () => void load()); map.on("moveend", () => void load());
    }).catch(() => setError("Map engine could not load. Use the ranked grid to continue research."));
    return () => { disposed = true; markerRef.current.forEach((marker) => marker.remove()); mapRef.current?.remove(); mapRef.current = null; };
  }, [load]);

  React.useEffect(() => { if (mapRef.current?.loaded()) void load(); }, [load]);
  return <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm" aria-label="Map results">
    <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 text-xs"><span className="flex items-center gap-2 font-semibold"><MapPin size={15} />Viewport-based source records</span><span className="text-slate-500">{notice}</span></div>
    {error && <p role="alert" className="m-4 flex gap-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-950"><AlertTriangle size={15} />{error}</p>}
    <div ref={ref} className="h-[560px] bg-slate-100" />
  </section>;
}
