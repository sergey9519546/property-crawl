"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Box, LoaderCircle, MapPin } from "lucide-react";
import { Listing } from "@/data/listings";

interface Parcel3DProps {
  listing: Listing;
}

type Position = [number, number];

interface ParcelMetadata {
  parcelId: string | null;
  lotSqft: number | null;
  lotAcres: number | null;
  frontageFt: number | null;
  depthFt: number | null;
  zoning: string | null;
  topography: string | null;
  source: "arcgis_rest";
  sourceName: string;
  evidenceStatus: "source_observed";
  surveyStatus: "not_a_survey";
  disclaimer: string;
}

interface ParcelFeature {
  type: "Feature";
  geometry: {
    type: "Polygon" | "MultiPolygon";
    coordinates: number[][][] | number[][][][];
  };
  properties: ParcelMetadata;
}

type LoadState =
  | { status: "loading"; feature: null; message: null }
  | { status: "ready"; feature: ParcelFeature; message: null }
  | { status: "unavailable"; feature: null; message: string };

const NOT_A_SURVEY = "Cadastral reference only — not a boundary survey";

function isPosition(value: unknown): value is Position {
  return Array.isArray(value)
    && value.length >= 2
    && Number.isFinite(value[0])
    && Number.isFinite(value[1]);
}

function outerRing(feature: ParcelFeature | null): Position[] {
  if (!feature) return [];
  const coordinates = feature.geometry.coordinates;
  const ring = feature.geometry.type === "Polygon"
    ? (coordinates as number[][][])[0]
    : (coordinates as number[][][][])[0]?.[0];
  return Array.isArray(ring) ? ring.filter(isPosition) : [];
}

function toSvgPoints(ring: Position[]) {
  if (ring.length < 4) return "";
  const unique = ring.slice(0, -1);
  const lngs = unique.map(([lng]) => lng);
  const lats = unique.map(([, lat]) => lat);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const lngSpan = Math.max(maxLng - minLng, Number.EPSILON);
  const latSpan = Math.max(maxLat - minLat, Number.EPSILON);
  const scale = Math.min(520 / lngSpan, 190 / latSpan);
  const width = lngSpan * scale;
  const height = latSpan * scale;
  const offsetX = (640 - width) / 2;
  const offsetY = (280 - height) / 2;

  return unique
    .map(([lng, lat]) => {
      const x = offsetX + (lng - minLng) * scale;
      const y = offsetY + (maxLat - lat) * scale;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
}

function formatNumber(value: number | null) {
  return value === null || !Number.isFinite(value) ? "Not reported" : value.toLocaleString();
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-[118px]">
      <span className="block text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">{label}</span>
      <span className="mt-1 block font-mono text-xs font-semibold text-slate-100">{value}</span>
    </div>
  );
}

export function Parcel3DVisualizer({ listing }: Parcel3DProps) {
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading", feature: null, message: null });

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setLoadState({ status: "loading", feature: null, message: null });

    void fetch(`/api/parcel-boundary?listingId=${encodeURIComponent(listing.id)}`, { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(body?.error || "No source-provided parcel geometry is available for this listing.");
        }
        return body as ParcelFeature;
      })
      .then((feature) => {
        if (!active) return;
        const ring = outerRing(feature);
        if (feature?.type !== "Feature" || ring.length < 4 || feature.properties?.evidenceStatus !== "source_observed") {
          throw new Error("The parcel source did not return usable cadastral geometry.");
        }
        setLoadState({ status: "ready", feature, message: null });
      })
      .catch((error: unknown) => {
        if (!active || controller.signal.aborted) return;
        const message = error instanceof Error ? error.message : "Parcel geometry is unavailable.";
        setLoadState({ status: "unavailable", feature: null, message });
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [listing.id]);

  const ring = useMemo(() => outerRing(loadState.feature), [loadState.feature]);
  const points = useMemo(() => toSvgPoints(ring), [ring]);
  const metadata = loadState.feature?.properties ?? null;
  const dimensions = metadata?.frontageFt !== null && metadata?.frontageFt !== undefined
    && metadata?.depthFt !== null && metadata?.depthFt !== undefined
    ? `${metadata.frontageFt.toLocaleString()}′ × ${metadata.depthFt.toLocaleString()}′`
    : "Not reported";

  return (
    <section className="overflow-hidden rounded-2xl border border-[#E5E7EB] bg-[#0F172A] text-white shadow-xl" aria-label="Parcel geometry reference">
      <div className="relative min-h-[280px]">
        {loadState.status === "loading" ? (
          <div className="flex min-h-[280px] items-center justify-center gap-2 text-sm text-slate-300" role="status">
            <LoaderCircle className="h-4 w-4 animate-spin" />
            Checking the public parcel source…
          </div>
        ) : null}

        {loadState.status === "unavailable" ? (
          <div className="mx-auto flex min-h-[280px] max-w-lg flex-col items-center justify-center px-6 text-center">
            <span className="mb-4 grid h-11 w-11 place-items-center rounded-full border border-amber-400/20 bg-amber-400/10">
              <AlertTriangle className="h-5 w-5 text-amber-300" />
            </span>
            <h3 className="text-base font-semibold">Parcel geometry unavailable</h3>
            <p className="mt-2 text-sm leading-6 text-slate-400">{loadState.message}</p>
            <p className="mt-3 text-xs text-slate-500">No boundary, dimensions, zoning, slope, setbacks, or parcel number have been estimated.</p>
          </div>
        ) : null}

        {loadState.status === "ready" && points ? (
          <>
            <svg className="h-[280px] w-full" viewBox="0 0 640 280" role="img" aria-label="Source-provided cadastral parcel polygon">
              <defs>
                <pattern id="parcel-grid" width="20" height="20" patternUnits="userSpaceOnUse">
                  <path d="M 20 0 L 0 0 0 20" fill="none" stroke="#334155" strokeOpacity="0.38" strokeWidth="0.7" />
                </pattern>
                <filter id="parcel-glow" x="-20%" y="-20%" width="140%" height="140%">
                  <feGaussianBlur stdDeviation="5" result="blur" />
                  <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
                </filter>
              </defs>
              <rect width="640" height="280" fill="url(#parcel-grid)" />
              <polygon points={points} fill="#22c55e" fillOpacity="0.14" stroke="#4ade80" strokeWidth="2.5" filter="url(#parcel-glow)" />
            </svg>
            <div className="pointer-events-none absolute inset-x-3 top-3 flex flex-wrap items-center justify-between gap-2">
              <span className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-black/60 px-3 py-2 text-xs font-semibold backdrop-blur-md">
                <Box className="h-3.5 w-3.5 text-emerald-300" />
                Source cadastral footprint
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-xl border border-amber-300/15 bg-black/60 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-amber-200 backdrop-blur-md">
                <MapPin className="h-3.5 w-3.5" />
                {NOT_A_SURVEY}
              </span>
            </div>
          </>
        ) : null}
      </div>

      {metadata ? (
        <div className="border-t border-white/10 bg-[#0B1120] p-4">
          <div className="flex flex-wrap gap-x-7 gap-y-4">
            <Fact
              label="Lot area"
              value={metadata.lotSqft !== null ? `${formatNumber(metadata.lotSqft)} sq ft` : metadata.lotAcres !== null ? `${formatNumber(metadata.lotAcres)} ac` : "Not reported"}
            />
            <Fact label="Dimensions" value={dimensions} />
            <Fact label="Zoning" value={metadata.zoning || "Not reported"} />
            <Fact label="Parcel / APN" value={metadata.parcelId || "Not reported"} />
          </div>
          <div className="mt-4 flex flex-wrap items-start justify-between gap-2 border-t border-white/10 pt-3 text-[11px] leading-5 text-slate-400">
            <span>{metadata.sourceName}</span>
            <span className="max-w-xl text-right">{metadata.disclaimer || NOT_A_SURVEY}</span>
          </div>
        </div>
      ) : null}
    </section>
  );
}
