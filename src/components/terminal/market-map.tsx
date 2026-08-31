"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, LocateFixed, MapPin, Minus, Plus, X } from "lucide-react";
import { PropertyListing, SOURCES } from "./property-data";

type MarketMapProps = {
  listings: PropertyListing[];
  onUnderwrite: (listing: PropertyListing) => void;
};

const US_BOUNDS = { west: -125, east: -66, north: 50, south: 24 };

function project(listing: PropertyListing) {
  const x = ((listing.lng - US_BOUNDS.west) / (US_BOUNDS.east - US_BOUNDS.west)) * 100;
  const y = ((US_BOUNDS.north - listing.lat) / (US_BOUNDS.north - US_BOUNDS.south)) * 100;
  return {
    left: `${Math.max(2, Math.min(98, x))}%`,
    top: `${Math.max(3, Math.min(96, y))}%`,
  };
}

export function MarketMap({ listings, onUnderwrite }: MarketMapProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const mappable = useMemo(
    () => listings.filter((listing) => Number.isFinite(listing.lat) && Number.isFinite(listing.lng) && listing.lat !== 0 && listing.lng !== 0),
    [listings],
  );
  const selected = mappable.find((listing) => listing.id === selectedId) ?? null;

  return (
    <section data-testid="market-map" aria-label="Filtered listings map" className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
        <div>
          <h3 className="font-bold text-slate-950">Market map</h3>
          <p className="text-xs text-slate-500">{mappable.length} geocoded {mappable.length === 1 ? "listing" : "listings"} · filtered with the feed</p>
        </div>
        <div className="flex items-center gap-1 rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
          <button aria-label="Zoom map out" disabled={zoom <= 1} onClick={() => setZoom((value) => Math.max(1, value - 0.25))} className="grid h-9 w-9 place-items-center rounded-lg hover:bg-slate-100 disabled:opacity-35"><Minus className="h-4 w-4" /></button>
          <button aria-label="Reset map view" onClick={() => setZoom(1)} className="grid h-9 min-w-9 place-items-center rounded-lg px-2 text-[11px] font-bold hover:bg-slate-100"><LocateFixed className="h-4 w-4" /></button>
          <button aria-label="Zoom map in" disabled={zoom >= 1.75} onClick={() => setZoom((value) => Math.min(1.75, value + 0.25))} className="grid h-9 w-9 place-items-center rounded-lg hover:bg-slate-100 disabled:opacity-35"><Plus className="h-4 w-4" /></button>
        </div>
      </div>

      <div className="relative h-[520px] overflow-hidden bg-[#E8F2F5] sm:h-[580px]" data-map-zoom={zoom.toFixed(2)}>
        <div className="absolute inset-0 origin-center transition-transform duration-300" style={{ transform: `scale(${zoom})` }}>
          <svg aria-hidden="true" viewBox="0 0 1000 560" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
            <defs>
              <linearGradient id="map-water" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#E6F3F5" /><stop offset="1" stopColor="#D5E8EC" /></linearGradient>
              <linearGradient id="map-land" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#F8FAF3" /><stop offset="1" stopColor="#E6EBDD" /></linearGradient>
              <pattern id="map-grid" width="50" height="50" patternUnits="userSpaceOnUse"><path d="M 50 0 L 0 0 0 50" fill="none" stroke="#8AA0A5" strokeOpacity="0.13" strokeWidth="1" /></pattern>
            </defs>
            <rect width="1000" height="560" fill="url(#map-water)" />
            <path d="M70 80 L170 50 250 90 350 70 450 95 550 80 650 105 760 80 850 100 925 70 970 115 955 170 980 220 950 270 905 290 875 330 850 345 820 390 845 470 820 525 780 485 775 415 730 390 690 420 650 505 610 480 580 420 540 400 500 380 450 390 400 370 350 395 300 380 260 420 220 405 180 380 140 340 100 310 75 250 55 190 Z" fill="url(#map-land)" stroke="#AAB8AC" strokeWidth="3" />
            <path d="M170 50 L180 380 M250 90 L260 420 M350 70 L350 395 M450 95 L450 390 M550 80 L540 400 M650 105 L650 505 M760 80 L730 390 M850 100 L820 390 M925 70 L875 330 M100 310 L300 380 M300 380 L500 380 M500 380 L730 390" fill="none" stroke="#AAB8AC" strokeOpacity="0.48" strokeWidth="1.4" />
            <rect width="1000" height="560" fill="url(#map-grid)" />
            <g fill="#688087" fontSize="18" fontWeight="700" opacity="0.55"><text x="170" y="210">WEST</text><text x="455" y="220">CENTRAL</text><text x="790" y="210">EAST</text><text x="565" y="405">SOUTH</text></g>
          </svg>

          {mappable.map((listing) => {
            const source = SOURCES[listing.source] ?? SOURCES.sheriff;
            const active = listing.id === selectedId;
            return (
              <button
                key={listing.id}
                type="button"
                data-testid="map-marker"
                aria-label={`Show ${listing.address} on map`}
                aria-pressed={active}
                onClick={() => setSelectedId(listing.id)}
                className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-white shadow-[0_4px_14px_rgba(15,23,42,0.3)] transition hover:z-20 hover:scale-125 focus:z-20 focus:outline-none focus:ring-4 focus:ring-blue-500/35"
                style={{ ...project(listing), width: active ? 24 : 19, height: active ? 24 : 19, backgroundColor: source.color }}
              >
                <span className="sr-only">{source.label}</span>
              </button>
            );
          })}
        </div>

        <div className="absolute bottom-4 left-4 rounded-xl border border-white/70 bg-white/90 px-3 py-2 text-[11px] font-semibold text-slate-600 shadow-md backdrop-blur">
          Markers are colored by source
        </div>

        {selected && (
          <article data-testid="map-listing-preview" className="absolute bottom-4 right-4 left-4 z-30 rounded-2xl border border-slate-200 bg-white/95 p-4 shadow-2xl backdrop-blur sm:left-auto sm:w-[390px]">
            <button onClick={() => setSelectedId(null)} aria-label="Close map listing preview" className="absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-lg text-slate-500 hover:bg-slate-100"><X className="h-4 w-4" /></button>
            <div className="pr-9">
              <p className="text-[10px] font-extrabold uppercase tracking-wider text-emerald-700">{SOURCES[selected.source]?.label ?? selected.source} · {selected.dealScore}/100</p>
              <h4 className="mt-1 font-bold text-slate-950">{selected.address}</h4>
              <p className="mt-1 flex items-center gap-1 text-xs text-slate-500"><MapPin className="h-3.5 w-3.5" /> {selected.county} County</p>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button onClick={() => onUnderwrite(selected)} className="inline-flex h-10 items-center justify-center gap-1 rounded-xl bg-slate-950 text-xs font-bold text-white">Underwrite <ArrowRight className="h-3.5 w-3.5" /></button>
              <Link href={`/listings/${encodeURIComponent(selected.id)}`} className="inline-flex h-10 items-center justify-center gap-1 rounded-xl border border-slate-300 text-xs font-bold text-slate-950">Listing page <ArrowRight className="h-3.5 w-3.5" /></Link>
            </div>
          </article>
        )}

        {mappable.length === 0 && (
          <div className="absolute inset-0 grid place-items-center px-6 text-center"><div><MapPin className="mx-auto h-8 w-8 text-slate-400" /><p className="mt-3 font-bold text-slate-700">No geocoded listings match these filters.</p></div></div>
        )}
      </div>
    </section>
  );
}
