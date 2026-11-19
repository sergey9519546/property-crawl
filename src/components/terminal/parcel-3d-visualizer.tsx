"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { AlertTriangle, Box, Compass, Layers, LoaderCircle, MapPin, RotateCcw } from "lucide-react";
import { Listing } from "@/data/listings";
import { inspectParcelBoundaryInputs } from "@/lib/listing-map-policy";
import { fetchParcelBoundaryCached } from "@/lib/parcel-boundary-cache";
import { useLocale } from "@/components/i18n/locale-provider";
import { formatLocaleNumber } from "@/lib/i18n/translator";

interface Parcel3DProps {
  listing: Listing;
}

type Position = [number, number];

interface ParcelMetadata {
  parcelId: string | null;
  lotSqft: number | null;
  lotAcres: number | null;
  perimeterFt?: number | null;
  coordinatesCount?: number | null;
  frontageFt: number | null;
  depthFt: number | null;
  zoning: string | null;
  topography: string | null;
  setbacks?: Record<string, number> | null;
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
const DEFAULT_YAW = 34;
const DEFAULT_TILT = 52;
const VIEW_W = 640;
const VIEW_H = 340;

function isPosition(value: unknown): value is Position {
  return Array.isArray(value)
    && value.length >= 2
    && Number.isFinite(value[0])
    && Number.isFinite(value[1]);
}

function allRings(feature: ParcelFeature | null): { ring: Position[]; isHole: boolean }[] {
  if (!feature) return [];
  const out: { ring: Position[]; isHole: boolean }[] = [];
  if (feature.geometry.type === "Polygon") {
    const rings = feature.geometry.coordinates as number[][][];
    rings.forEach((raw, idx) => {
      const clean = Array.isArray(raw) ? raw.filter(isPosition) : [];
      if (clean.length >= 4) out.push({ ring: clean, isHole: idx > 0 });
    });
  } else if (feature.geometry.type === "MultiPolygon") {
    const polys = feature.geometry.coordinates as number[][][][];
    polys.forEach((poly) => {
      if (!Array.isArray(poly)) return;
      poly.forEach((raw, idx) => {
        const clean = Array.isArray(raw) ? raw.filter(isPosition) : [];
        if (clean.length >= 4) out.push({ ring: clean, isHole: idx > 0 });
      });
    });
  }
  return out;
}

function outerRing(feature: ParcelFeature | null): Position[] {
  return allRings(feature)[0]?.ring ?? [];
}

function haversineMeters(pt1: Position, pt2: Position): number {
  const [lng1, lat1] = pt1;
  const [lng2, lat2] = pt2;
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLng = (lng2 - lng1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) *
      Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return 6_371_000 * c;
}

function computeClientPerimeter(ring: Position[]): number | null {
  if (!ring || ring.length < 4) return null;
  let totalMeters = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const pt1 = ring[i];
    const pt2 = ring[i + 1];
    if (!pt1 || !pt2) continue;
    totalMeters += haversineMeters(pt1, pt2);
  }
  const feet = Math.round(totalMeters * 3.28084);
  return feet > 0 ? feet : null;
}

interface LocalVertex {
  x: number; // East (normalized scene units)
  y: number; // North (normalized scene units)
}

interface LocalEdge {
  index: number;
  start: LocalVertex;
  end: LocalVertex;
  midpoint: LocalVertex;
  feet: number;
}

interface LocalParcelGeometry {
  vertices: LocalVertex[];
  edges: LocalEdge[];
  secondaryRings: { vertices: LocalVertex[]; isHole: boolean }[];
  maxSpanFeet: number;
  radius: number;
}

function buildLocalParcelGeometry(
  ring: Position[],
  extraRings: { ring: Position[]; isHole: boolean }[] = [],
): LocalParcelGeometry | null {
  if (ring.length < 4) return null;
  const unique = ring.slice(0, -1);
  if (unique.length < 3) return null;

  const meanLng = unique.reduce((acc, [lng]) => acc + lng, 0) / unique.length;
  const meanLat = unique.reduce((acc, [, lat]) => acc + lat, 0) / unique.length;
  const metersPerLat = 111_320;
  const metersPerLng = Math.max(111_320 * Math.cos((meanLat * Math.PI) / 180), 1e-3);

  const meterPts = unique.map(([lng, lat]) => ({
    x: (lng - meanLng) * metersPerLng,
    y: (lat - meanLat) * metersPerLat,
  }));

  const xs = meterPts.map((p) => p.x);
  const ys = meterPts.map((p) => p.y);
  const spanX = Math.max(...xs) - Math.min(...xs);
  const spanY = Math.max(...ys) - Math.min(...ys);
  const maxSpan = Math.max(spanX, spanY, 1);
  const normScale = 230 / maxSpan;
  const centerX = (Math.min(...xs) + Math.max(...xs)) / 2;
  const centerY = (Math.min(...ys) + Math.max(...ys)) / 2;

  const vertices: LocalVertex[] = meterPts.map((p) => ({
    x: (p.x - centerX) * normScale,
    y: (p.y - centerY) * normScale,
  }));

  const secondaryRings = extraRings
    .map(({ ring: r, isHole }) => {
      const pts = r.slice(0, -1).map(([lng, lat]) => ({
        x: ((lng - meanLng) * metersPerLng - centerX) * normScale,
        y: ((lat - meanLat) * metersPerLat - centerY) * normScale,
      }));
      return { vertices: pts, isHole };
    })
    .filter((entry) => entry.vertices.length >= 3);

  const edges: LocalEdge[] = [];
  for (let i = 0; i < unique.length; i++) {
    const nextIdx = (i + 1) % unique.length;
    const v1 = vertices[i];
    const v2 = vertices[nextIdx];
    const feet = Math.round(haversineMeters(unique[i], unique[nextIdx]) * 3.28084);
    edges.push({
      index: i,
      start: v1,
      end: v2,
      midpoint: {
        x: (v1.x + v2.x) / 2,
        y: (v1.y + v2.y) / 2,
      },
      feet,
    });
  }

  return { vertices, edges, secondaryRings, maxSpanFeet: Math.max(1, Math.round(maxSpan * 3.28084)), radius: 115 };
}

interface ProjectedPoint {
  sx: number;
  sy: number;
  depth: number;
}

function projectPoint(
  wx: number,
  wy: number,
  wz: number,
  yawDeg: number,
  tiltDeg: number,
  is2d: boolean,
): ProjectedPoint {
  const yaw = is2d ? 0 : (yawDeg * Math.PI) / 180;
  const tilt = is2d ? Math.PI / 2 : (tiltDeg * Math.PI) / 180;

  const rx = wx * Math.cos(yaw) - wy * Math.sin(yaw);
  const ry = wx * Math.sin(yaw) + wy * Math.cos(yaw);

  const cosTilt = Math.cos(tilt);
  const sinTilt = Math.sin(tilt);
  const perspectiveDenom = is2d ? 1 : Math.max(0.55, 1 - (ry * cosTilt) / 860);
  const perspective = 1 / perspectiveDenom;

  const cx = VIEW_W / 2;
  const cy = is2d ? VIEW_H / 2 : VIEW_H * 0.57;

  return {
    sx: cx + rx * perspective,
    sy: cy - (ry * sinTilt + wz * cosTilt) * perspective,
    depth: ry,
  };
}

function polygonString(pts: ProjectedPoint[]): string {
  return pts.map((p) => `${p.sx.toFixed(1)},${p.sy.toFixed(1)}`).join(" ");
}

function formatNumber(value: number | null) {
  return value === null || !Number.isFinite(value) ? "Not reported" : value.toLocaleString();
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-[118px]">
      <span className="block text-xs font-semibold uppercase tracking-wider text-white/60">{label}</span>
      <span className="mt-1 block font-mono text-xs font-semibold text-white">{value}</span>
    </div>
  );
}

export function Parcel3DVisualizer({ listing }: Parcel3DProps) {
  const { locale, messages, format } = useLocale();
  const t = messages.docketParcel;
  const preflight = useMemo(() => inspectParcelBoundaryInputs(listing), [listing]);
  const unavailableMessage = preflight.message || t.parcelUnavailableMsg;
  const [loadState, setLoadState] = useState<LoadState>(() =>
    preflight.eligible
      ? { status: "loading", feature: null, message: null }
      : { status: "unavailable", feature: null, message: unavailableMessage }
  );

  const [viewMode, setViewMode] = useState<"3d" | "2d">("3d");
  const [yawDeg, setYawDeg] = useState<number>(DEFAULT_YAW);
  const [tiltDeg, setTiltDeg] = useState<number>(DEFAULT_TILT);
  const [extruded, setExtruded] = useState<boolean>(true);
  const [showSetbackGuide, setShowSetbackGuide] = useState<boolean>(true);
  const [showContours, setShowContours] = useState<boolean>(true);
  const [dragging, setDragging] = useState<boolean>(false);
  const dragOrigin = useRef<{ x: number; y: number; yaw: number; tilt: number } | null>(null);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();

    if (!preflight.eligible) {
      setLoadState({ status: "unavailable", feature: null, message: unavailableMessage });
      return () => {
        active = false;
        controller.abort();
      };
    }

    setLoadState({ status: "loading", feature: null, message: null });

    const query = new URLSearchParams();
    if (listing.id) query.set("listingId", listing.id);
    if (preflight.apn) query.set("apn", preflight.apn);
    if (preflight.state) query.set("state", preflight.state);
    if (preflight.county) query.set("county", preflight.county);
    if (preflight.lat !== null) query.set("lat", String(preflight.lat));
    if (preflight.lng !== null) query.set("lng", String(preflight.lng));

    const cacheKey = listing.id || query.toString();
    void fetchParcelBoundaryCached(`/api/parcel-boundary?${query.toString()}`, cacheKey)
      .then((body) => {
        if (!body || body.__error) {
          throw new Error(body?.__error || t.parcelNoSourceGeo);
        }
        return body as ParcelFeature;
      })
      .then((feature) => {
        if (!active) return;
        const ring = outerRing(feature);
        if (feature?.type !== "Feature" || ring.length < 4 || feature.properties?.evidenceStatus !== "source_observed") {
          throw new Error(t.parcelUnusableGeo);
        }
        setLoadState({ status: "ready", feature, message: null });
      })
      .catch((error: unknown) => {
        if (!active || controller.signal.aborted) return;
        const message = error instanceof Error ? error.message : t.parcelUnavailableMsg;
        setLoadState({ status: "unavailable", feature: null, message });
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [listing.id, preflight.eligible, unavailableMessage, preflight.state, preflight.county, preflight.apn, preflight.lat, preflight.lng, t.parcelNoSourceGeo, t.parcelUnusableGeo, t.parcelUnavailableMsg]);

  const rings = useMemo(() => allRings(loadState.feature), [loadState.feature]);
  const ring = rings[0]?.ring ?? [];
  const localGeo = useMemo(() => buildLocalParcelGeometry(ring, rings.slice(1)), [ring, rings]);
  const metadata = loadState.feature?.properties ?? null;
  const perimeter = metadata?.perimeterFt ?? computeClientPerimeter(ring);
  const coordCount = metadata?.coordinatesCount ?? (ring.length > 0 ? ring.length : null);
  const dimensions = metadata?.frontageFt !== null && metadata?.frontageFt !== undefined
    && metadata?.depthFt !== null && metadata?.depthFt !== undefined
    ? `${formatLocaleNumber(locale, metadata.frontageFt)}′ × ${formatLocaleNumber(locale, metadata.depthFt)}′`
    : t.parcelNotReported;
  const resolvedApn = (metadata?.parcelId || preflight.apn || "").toString().trim();
  const hasObservedTopography = Boolean(metadata?.topography && metadata.topography.trim());

  const glowId = useId().replace(/:/g, "_");
  const is2d = viewMode === "2d";
  const effectiveExtrusion = !is2d && extruded ? 44 : 0;

  const scene = useMemo(() => {
    if (!localGeo) return null;
    const { vertices, edges, secondaryRings, maxSpanFeet } = localGeo;

    const secondaryPolygons = secondaryRings.map((entry, idx) => {
      const pts = entry.vertices.map((v) =>
        projectPoint(v.x, v.y, effectiveExtrusion, yawDeg, tiltDeg, is2d),
      );
      return {
        key: `sec-${idx}`,
        points: polygonString(pts),
        isHole: entry.isHole,
      };
    });
    const scaleBarFeet = Math.max(10, Math.round((maxSpanFeet * (92 / 230)) / 10) * 10);

    const baseProjected = vertices.map((v) => projectPoint(v.x, v.y, 0, yawDeg, tiltDeg, is2d));
    const topProjected = vertices.map((v) =>
      projectPoint(v.x, v.y, effectiveExtrusion, yawDeg, tiltDeg, is2d),
    );
    const setbackProjected = vertices.map((v) =>
      projectPoint(v.x * 0.86, v.y * 0.86, effectiveExtrusion, yawDeg, tiltDeg, is2d),
    );

    // Side walls sorted back-to-front by mid-depth for painter's order + directional lighting.
    const walls = effectiveExtrusion > 0
      ? edges
          .map((edge, idx) => {
            const nextIdx = (idx + 1) % vertices.length;
            const b1 = baseProjected[idx];
            const b2 = baseProjected[nextIdx];
            const t2 = topProjected[nextIdx];
            const t1 = topProjected[idx];
            const avgDepth = (b1.depth + b2.depth) / 2;
            const dx = edge.end.x - edge.start.x;
            const dy = edge.end.y - edge.start.y;
            const len = Math.hypot(dx, dy) || 1;
            const nx = dy / len;
            const ny = -dx / len;
            const yawRad = (yawDeg * Math.PI) / 180;
            const rnx = nx * Math.cos(yawRad) - ny * Math.sin(yawRad);
            const rny = nx * Math.sin(yawRad) + ny * Math.cos(yawRad);
            const light = 0.24 + 0.16 * Math.max(0, rnx * 0.65 - rny * 0.75);
            return {
              key: idx,
              points: polygonString([b1, b2, t2, t1]),
              avgDepth,
              fillOpacity: Number(light.toFixed(3)),
            };
          })
          .sort((a, b) => b.avgDepth - a.avgDepth)
      : [];

    // Reference ground grid lines (5x5 grid in 3D ground plane)
    const gridLines: { key: string; p1: ProjectedPoint; p2: ProjectedPoint }[] = [];
    for (let g = -140; g <= 140; g += 35) {
      gridLines.push({
        key: `x-${g}`,
        p1: projectPoint(g, -140, 0, yawDeg, tiltDeg, is2d),
        p2: projectPoint(g, 140, 0, yawDeg, tiltDeg, is2d),
      });
      gridLines.push({
        key: `y-${g}`,
        p1: projectPoint(-140, g, 0, yawDeg, tiltDeg, is2d),
        p2: projectPoint(140, g, 0, yawDeg, tiltDeg, is2d),
      });
    }

    // Terrain contour bands (strictly gated on observed metadata.topography)
    const contourPolygons = hasObservedTopography && showContours
      ? [0.74, 0.56, 0.38].map((scale, idx) => {
          const zLift = effectiveExtrusion > 0 ? effectiveExtrusion + (idx + 1) * 5 : (idx + 1) * 4;
          const pts = vertices.map((v) =>
            projectPoint(v.x * scale, v.y * scale, is2d ? 0 : zLift, yawDeg, tiltDeg, is2d),
          );
          return { key: `contour-${scale}`, points: polygonString(pts) };
        })
      : [];

    // Major edges sorted descending by length so callout labels stay legible without clutter
    const maxFeet = Math.max(...edges.map((e) => e.feet), 1);
    const labeledEdges = [...edges]
      .filter((e) => e.feet > 0 && (edges.length <= 8 || e.feet >= maxFeet * 0.18))
      .sort((a, b) => b.feet - a.feet)
      .slice(0, 8)
      .map((edge) => {
        const pt = projectPoint(
          edge.midpoint.x * 1.12,
          edge.midpoint.y * 1.12,
          effectiveExtrusion > 0 ? 4 : 0,
          yawDeg,
          tiltDeg,
          is2d,
        );
        return {
          key: `edge-${edge.index}`,
          feet: edge.feet,
          sx: pt.sx,
          sy: pt.sy,
        };
      });

    // Compass directions projected around center (top-right HUD)
    const compassYaw = is2d ? 0 : (yawDeg * Math.PI) / 180;
    const compassDirs = [
      { label: "N", wx: 0, wy: 1, highlight: true },
      { label: "E", wx: 1, wy: 0, highlight: false },
      { label: "S", wx: 0, wy: -1, highlight: false },
      { label: "W", wx: -1, wy: 0, highlight: false },
    ].map((d) => {
      const rx = d.wx * Math.cos(compassYaw) - d.wy * Math.sin(compassYaw);
      const ry = d.wx * Math.sin(compassYaw) + d.wy * Math.cos(compassYaw);
      return {
        label: d.label,
        highlight: d.highlight,
        x: 590 + rx * 20,
        y: 288 - ry * 20,
      };
    });

    return {
      basePoints: polygonString(baseProjected),
      topPoints: polygonString(topProjected),
      setbackPoints: polygonString(setbackProjected),
      topVertices: topProjected,
      walls,
      gridLines,
      contourPolygons,
      labeledEdges,
      secondaryPolygons,
      scaleBarFeet,
      compassDirs,
      compassNorthEnd: compassDirs[0],
    };
  }, [localGeo, yawDeg, tiltDeg, is2d, effectiveExtrusion, hasObservedTopography, showContours]);

  function handlePointerDown(e: ReactPointerEvent<SVGSVGElement>) {
    if (e.pointerType === "touch") return;
    setDragging(true);
    dragOrigin.current = {
      x: e.clientX,
      y: e.clientY,
      yaw: yawDeg,
      tilt: is2d ? 52 : tiltDeg,
    };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* ignore synthetic events without pointer capture */
    }
  }

  function handlePointerMove(e: ReactPointerEvent<SVGSVGElement>) {
    if (!dragging || !dragOrigin.current) return;
    const dx = e.clientX - dragOrigin.current.x;
    const dy = e.clientY - dragOrigin.current.y;
    if (viewMode === "2d" && (Math.abs(dx) > 3 || Math.abs(dy) > 3)) {
      setViewMode("3d");
    }
    const nextYaw = ((dragOrigin.current.yaw + dx * 0.55) % 360 + 360) % 360;
    const nextTilt = Math.max(15, Math.min(85, Math.round(dragOrigin.current.tilt + dy * 0.35)));
    setYawDeg(Math.round(nextYaw));
    setTiltDeg(nextTilt);
  }

  function handlePointerEnd(e: ReactPointerEvent<SVGSVGElement>) {
    if (!dragging) return;
    setDragging(false);
    dragOrigin.current = null;
    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch {
      /* ignore */
    }
  }

  function resetView() {
    setViewMode("3d");
    setYawDeg(DEFAULT_YAW);
    setTiltDeg(DEFAULT_TILT);
    setExtruded(true);
    setShowSetbackGuide(true);
    setShowContours(true);
  }

  return (
    <section
      className={`overflow-hidden rounded-card border border-line shadow-sm ${loadState.status === "ready" ? "bg-ink text-white shadow-xl" : "bg-card text-ink"}`}
      aria-label={t.parcelSectionAria}
      data-testid="parcel-3d-visualizer"
    >
      <div className={`flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3 ${loadState.status === "ready" ? "border-white/10 bg-black/25" : "border-line bg-paper"}`}>
        <div>
          <p className={`text-xs font-bold uppercase tracking-wider ${loadState.status === "ready" ? "text-white/60" : "text-ink-3"}`}>
            {t.parcelEyebrow}
          </p>
          <h2 className={`text-sm font-bold ${loadState.status === "ready" ? "text-white" : "text-ink"}`}>{t.parcelHeading}</h2>
        </div>
        <span className={`inline-flex items-center gap-1.5 rounded-control border px-3 py-1.5 text-xs font-semibold uppercase tracking-wider ${loadState.status === "ready" ? "border-catch/30 bg-black/60 text-catch" : "border-catch/30 bg-catch-wash text-catch-ink"}`}>
          <MapPin className="h-3.5 w-3.5" />
          {t.parcelNotSurvey || NOT_A_SURVEY}
        </span>
      </div>

      <div className="relative">
        {loadState.status === "loading" ? (
          <div className="flex min-h-[160px] items-center justify-center gap-2 text-sm text-ink-3" role="status">
            <LoaderCircle className="h-4 w-4 animate-spin" />
            {t.parcelLoading}
          </div>
        ) : null}

        {loadState.status === "unavailable" ? (
          <div className="mx-auto flex min-h-[160px] max-w-lg flex-col items-center justify-center px-6 py-6 text-center">
            <span className="mb-3 grid h-10 w-10 place-items-center rounded-full border border-catch/30 bg-catch-wash">
              <AlertTriangle className="h-5 w-5 text-catch-ink" />
            </span>
            <h3 className="text-base font-semibold">{t.parcelUnavailableHeading}</h3>
            <p className="mt-1.5 text-sm leading-6 text-ink-2">{loadState.message}</p>
            <p className="mt-2 text-xs text-ink-3">{t.parcelUnavailableSub}</p>
          </div>
        ) : null}

        {loadState.status === "ready" && scene ? (
          <>
            <svg
              className={`h-[340px] w-full select-none touch-none ${dragging ? "cursor-grabbing" : "cursor-grab"}`}
              viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
              role="img"
              aria-label={`Interactive ${is2d ? "2D top-down" : "3D extruded"} cadastral parcel geometry`}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerEnd}
              onPointerCancel={handlePointerEnd}
            >
              <defs>
                <filter id={glowId} x="-20%" y="-20%" width="140%" height="140%">
                  <feGaussianBlur stdDeviation="4" result="blur" />
                  <feMerge>
                    <feMergeNode in="blur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>

              {/* Projected 3D ground reference grid */}
              <g>
                {scene.gridLines.map((line) => (
                  <line
                    key={line.key}
                    x1={line.p1.sx.toFixed(1)}
                    y1={line.p1.sy.toFixed(1)}
                    x2={line.p2.sx.toFixed(1)}
                    y2={line.p2.sy.toFixed(1)}
                    stroke="#6b7280"
                    strokeOpacity="0.22"
                    strokeWidth="0.75"
                  />
                ))}
              </g>

              {/* Base cadastral footprint */}
              <polygon
                points={scene.basePoints}
                fill="#0b1220"
                fillOpacity="0.55"
                stroke="#9ca3af"
                strokeOpacity="0.6"
                strokeWidth="1.25"
              />

              {/* Painter-sorted 3D extruded prism side walls */}
              {scene.walls.map((wall) => (
                <polygon
                  key={wall.key}
                  points={wall.points}
                  fill="#93c5fd"
                  fillOpacity={wall.fillOpacity}
                  stroke="#dbeafe"
                  strokeOpacity="0.45"
                  strokeWidth="1"
                />
              ))}

              {/* Top prism face / footprint */}
              <polygon
                points={scene.topPoints}
                fill="#fbf9f5"
                fillOpacity={effectiveExtrusion > 0 ? "0.2" : "0.14"}
                stroke="#fbf9f5"
                strokeWidth="2.4"
                filter={`url(#${glowId})`}
              />

              {/* MultiPolygon secondary parcels & interior holes */}
              {scene.secondaryPolygons.map((poly) => (
                <polygon
                  key={poly.key}
                  points={poly.points}
                  fill={poly.isHole ? "#090d16" : "#fbf9f5"}
                  fillOpacity={poly.isHole ? "0.75" : "0.16"}
                  stroke={poly.isHole ? "#94a3b8" : "#fbf9f5"}
                  strokeWidth={poly.isHole ? "1.3" : "2"}
                  strokeDasharray={poly.isHole ? "3 3" : undefined}
                />
              ))}

              {/* Illustrative interior setback ring (visual reference only) */}
              {showSetbackGuide ? (
                <polygon
                  points={scene.setbackPoints}
                  fill="none"
                  stroke="#fbbf24"
                  strokeOpacity="0.65"
                  strokeWidth="1.2"
                  strokeDasharray="4 4"
                />
              ) : null}

              {/* Terrain contour lines (only rendered when metadata.topography is reported) */}
              {scene.contourPolygons.map((c) => (
                <polygon
                  key={c.key}
                  points={c.points}
                  fill="none"
                  stroke="#34d399"
                  strokeOpacity="0.6"
                  strokeWidth="1.1"
                  strokeDasharray="3 3"
                />
              ))}

              {/* Vertex beacons */}
              {scene.topVertices.map((pt, idx) => (
                <circle
                  key={`v-${idx}`}
                  cx={pt.sx.toFixed(1)}
                  cy={pt.sy.toFixed(1)}
                  r="3"
                  fill="#fbf9f5"
                  fillOpacity="0.9"
                />
              ))}

              {/* Haversine edge-footage callouts */}
              {scene.labeledEdges.map((edge) => {
                const labelWidth = Math.max(46, String(edge.feet).length * 7 + 18);
                return (
                <g key={edge.key}>
                  <rect
                    x={(edge.sx - labelWidth / 2).toFixed(1)}
                    y={(edge.sy - 9).toFixed(1)}
                    width={labelWidth}
                    height="18"
                    rx="4"
                    fill="#090d16"
                    fillOpacity="0.82"
                    stroke="#ffffff"
                    strokeOpacity="0.22"
                    strokeWidth="0.75"
                  />
                  <text
                    x={edge.sx.toFixed(1)}
                    y={(edge.sy + 3).toFixed(1)}
                    textAnchor="middle"
                    fill="#fbf9f5"
                    fontSize="10"
                    fontFamily="monospace"
                    fontWeight="600"
                  >
                    {edge.feet}&prime;
                  </text>
                </g>
                );
              })}

              {/* Scale bar & illustrative setback legend */}
              <g aria-label="Parcel scale bar">
                <rect x="16" y="294" width="112" height="28" rx="6" fill="#090d16" fillOpacity="0.78" stroke="#ffffff" strokeOpacity="0.16" strokeWidth="0.75" />
                <line x1="26" y1="312" x2="118" y2="312" stroke="#fbf9f5" strokeWidth="1.5" />
                <line x1="26" y1="308" x2="26" y2="315" stroke="#fbf9f5" strokeWidth="1.5" />
                <line x1="118" y1="308" x2="118" y2="315" stroke="#fbf9f5" strokeWidth="1.5" />
                <text x="72" y="306" textAnchor="middle" fill="#cbd5e1" fontSize="9.5" fontFamily="monospace" fontWeight="600">
                  ~{scene.scaleBarFeet} ft
                </text>
              </g>
              {showSetbackGuide ? (
                <g aria-label="Illustrative setback legend">
                  <rect x="136" y="294" width="136" height="28" rx="6" fill="#090d16" fillOpacity="0.78" stroke="#fbbf24" strokeOpacity="0.35" strokeWidth="0.75" />
                  <line x1="145" y1="308" x2="165" y2="308" stroke="#fbbf24" strokeWidth="1.4" strokeDasharray="3 3" />
                  <text x="171" y="311" fill="#fde68a" fontSize="9.5" fontWeight="600">
                    Illustrative setback
                  </text>
                </g>
              ) : null}

              {/* Interactive rotating N / E / S / W Compass Rose */}
              <g aria-label={t.parcelCompassAria}>
                <circle cx="590" cy="288" r="29" fill="#090d16" fillOpacity="0.8" stroke="#ffffff" strokeOpacity="0.2" strokeWidth="1" />
                <line
                  x1="590"
                  y1="288"
                  x2={scene.compassNorthEnd.x.toFixed(1)}
                  y2={scene.compassNorthEnd.y.toFixed(1)}
                  stroke="#ef4444"
                  strokeWidth="2"
                />
                {scene.compassDirs.map((d) => (
                  <text
                    key={d.label}
                    x={d.x.toFixed(1)}
                    y={(d.y + 3).toFixed(1)}
                    textAnchor="middle"
                    fill={d.highlight ? "#f87171" : "#cbd5e1"}
                    fontSize="10"
                    fontWeight="700"
                  >
                    {d.label}
                  </text>
                ))}
              </g>
            </svg>

            <div className="pointer-events-none absolute inset-x-3 top-3 flex flex-wrap items-center justify-between gap-2">
              <span className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-black/65 px-3 py-1.5 text-xs font-semibold backdrop-blur-md">
                <Box className="h-3.5 w-3.5 text-white/75" />
                {t.parcelOrbitHint}
              </span>
              {effectiveExtrusion > 0 ? (
                <span className="rounded-xl border border-white/10 bg-black/65 px-2.5 py-1 text-xs text-white/75 backdrop-blur-md">
                  {t.parcelExtrusionNote}
                </span>
              ) : null}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 bg-black/35 px-4 py-2.5 text-xs">
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  aria-pressed={viewMode === "3d"}
                  onClick={() => setViewMode("3d")}
                  className={`rounded-lg border px-2.5 py-1 font-semibold transition ${viewMode === "3d" ? "border-white/40 bg-white/15 text-white" : "border-white/10 bg-transparent text-white/65 hover:text-white"}`}
                >
                  {t.parcel3dIsometric || "3D Isometric"}
                </button>
                <button
                  type="button"
                  aria-pressed={viewMode === "2d"}
                  onClick={() => setViewMode("2d")}
                  className={`rounded-lg border px-2.5 py-1 font-semibold transition ${viewMode === "2d" ? "border-white/40 bg-white/15 text-white" : "border-white/10 bg-transparent text-white/65 hover:text-white"}`}
                >
                  {t.parcel2dTopDown || "2D Top-Down"}
                </button>
                <button
                  type="button"
                  aria-pressed={extruded}
                  disabled={is2d}
                  onClick={() => setExtruded((prev) => !prev)}
                  className="inline-flex items-center gap-1 rounded-lg border border-white/15 px-2.5 py-1 font-medium text-white/85 hover:bg-white/10 disabled:opacity-40"
                >
                  <Layers className="h-3.5 w-3.5" />
                  {extruded ? t.parcelExtrudeOn : t.parcelFlatFootprint}
                </button>
                <button
                  type="button"
                  aria-pressed={showSetbackGuide}
                  onClick={() => setShowSetbackGuide((prev) => !prev)}
                  className="rounded-lg border border-white/15 px-2.5 py-1 font-medium text-white/85 hover:bg-white/10"
                >
                  {showSetbackGuide ? t.parcelHideSetback : t.parcelShowSetback}
                </button>
                {hasObservedTopography ? (
                  <button
                    type="button"
                    aria-pressed={showContours}
                    onClick={() => setShowContours((prev) => !prev)}
                    className="rounded-lg border border-white/35 bg-white/10 px-2.5 py-1 font-medium text-white hover:bg-white/20"
                  >
                    {showContours ? t.parcelContoursOn : t.parcelContoursOff}
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={resetView}
                  className="inline-flex items-center gap-1 rounded-lg border border-white/15 px-2.5 py-1 font-medium text-white/75 hover:bg-white/10 hover:text-white"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  {t.parcelReset}
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-4 text-xs text-white/80">
                <label className="flex items-center gap-2">
                  <Compass className="h-3.5 w-3.5 text-white/60" />
                  <span>{t.parcelAzimuth} {yawDeg}&deg;</span>
                  <input
                    type="range"
                    aria-label={t.parcelAzimuthAria}
                    min={0}
                    max={360}
                    value={yawDeg}
                    onChange={(e) => {
                      if (viewMode === "2d") setViewMode("3d");
                      setYawDeg(Number(e.target.value));
                    }}
                    className="h-1.5 w-20 cursor-pointer accent-white"
                  />
                </label>
                <label className="flex items-center gap-2">
                  <span>{t.parcelTilt} {is2d ? 90 : tiltDeg}&deg;</span>
                  <input
                    type="range"
                    aria-label={t.parcelTiltAria}
                    min={15}
                    max={85}
                    value={is2d ? 85 : tiltDeg}
                    onChange={(e) => {
                      if (viewMode === "2d") setViewMode("3d");
                      setTiltDeg(Number(e.target.value));
                    }}
                    className="h-1.5 w-20 cursor-pointer accent-white"
                  />
                </label>
              </div>
            </div>
          </>
        ) : null}
      </div>

      {metadata ? (
        <div className="border-t border-white/10 bg-black/20 p-4">
          <div className="flex flex-wrap gap-x-7 gap-y-4">
            <Fact
              label={t.parcelLotArea}
              value={metadata.lotAcres !== null ? `${metadata.lotAcres !== null ? formatLocaleNumber(locale, metadata.lotAcres) : t.parcelNotReported} ac (${metadata.lotSqft !== null ? formatLocaleNumber(locale, metadata.lotSqft) : t.parcelNotReported} sq ft)` : metadata.lotSqft !== null ? `${formatLocaleNumber(locale, metadata.lotSqft)} sq ft` : t.parcelNotReported}
            />
            <Fact
              label={t.parcelPerimeter}
              value={perimeter !== null ? `${formatLocaleNumber(locale, perimeter)} ft` : t.parcelNotReported}
            />
            <Fact
              label={t.parcelVertices}
              value={coordCount !== null ? format(t.parcelPoints, { count: coordCount }) : t.parcelNotReported}
            />
            <Fact label={t.parcelDimensions} value={dimensions} />
            <Fact label={t.parcelZoning} value={metadata.zoning || t.parcelNotReported} />
            <Fact label={t.parcelTopography} value={metadata.topography || t.parcelNotReportedGis} />
            <Fact label={t.parcelApn} value={resolvedApn || t.parcelNotReported} />
          </div>
          <div className="mt-4 flex flex-wrap items-start justify-between gap-2 border-t border-white/10 pt-3 text-xs leading-5 text-white/60">
            <span className="font-semibold text-white/80">{format(t.parcelCadastralSource, { source: metadata.sourceName })}</span>
            <span className="max-w-xl text-right">{metadata.disclaimer || t.parcelNotSurvey || NOT_A_SURVEY}</span>
          </div>
        </div>
      ) : null}
    </section>
  );
}

export { Parcel3DVisualizer as ParcelBoundaryCard };
