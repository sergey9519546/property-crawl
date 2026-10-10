"use client";

import * as React from "react";
import {
  ArrowRight,
  Crosshair,
  MapPinned,
  Radar,
  TrendingUp,
} from "lucide-react";
import type {
  Map as MapLibreMap,
  Marker as MapLibreMarker,
} from "maplibre-gl";
import { sourceDisplayText } from "@/lib/source-display";

type Opportunity = {
  id: string;
  address: string;
  area: string;
  source: string;
  sourceKey: "listing";
  signal: string;
  insight: string;
  score: number;
  opening: string;
  arv: string;
  spread: string;
  color: string;
  lng: number;
  lat: number;
};

type ListingRow = {
  id?: string;
  address?: string | null;
  city?: string | null;
  county?: string | null;
  source?: string | null;
  lat?: number | string | null;
  lng?: number | string | null;
  openingBid?: number | string | null;
  estLow?: number | string | null;
  estHigh?: number | string | null;
  dealScore?: number | string | null;
};

type ScanState = "idle" | "playing" | "complete";

const CLEVELAND_CENTER: [number, number] = [-81.6944, 41.4993];
const PIN_COLORS = ["#0F172A", "#1D4ED8", "#0F766E", "#7C3AED", "#B45309"];

function finite(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function moneyOrDash(value: unknown): string {
  const n = finite(value);
  if (n === null || n <= 0) return "—";
  return `$${Math.round(n).toLocaleString()}`;
}

function listingToOpportunity(row: ListingRow, index: number): Opportunity | null {
  const lat = finite(row.lat);
  const lng = finite(row.lng);
  if (lat === null || lng === null || !row.id) return null;
  if (lat < 41.3 || lat > 41.6 || lng < -81.9 || lng > -81.5) return null;
  const low = finite(row.estLow);
  const high = finite(row.estHigh);
  const hasBand = low !== null && low > 0 && high !== null && high >= low;
  const mid = hasBand && low !== null && high !== null ? (low + high) / 2 : null;
  const opening = finite(row.openingBid);
  const spread = mid !== null && opening !== null && opening > 0 ? mid - opening : null;
  const score = finite(row.dealScore);
  return {
    id: String(row.id),
    address: row.address?.trim() || "Address not published",
    area: row.city?.trim() || row.county?.trim() || "Ohio",
    source: row.source?.trim() || "Listing",
    sourceKey: "listing",
    signal: "Published listing",
    insight: "Coordinates and amounts are the fields on the listing record.",
    score: score !== null && score > 0 ? score : 0,
    opening: moneyOrDash(opening),
    arv: mid !== null ? moneyOrDash(mid) : "—",
    spread: spread !== null ? moneyOrDash(spread) : "—",
    color: PIN_COLORS[index % PIN_COLORS.length],
    lng,
    lat,
  };
}

function pinText(score: number): string {
  return score > 0 ? String(score) : "—";
}

const FALLBACK_MAP_TILES = [
  [557, 763], [558, 763], [559, 763], [560, 763], [561, 763],
  [557, 764], [558, 764], [559, 764], [560, 764], [561, 764],
  [557, 765], [558, 765], [559, 765], [560, 765], [561, 765],
] as const;

const FALLBACK_PAD = 0.12;
function fallbackPosition(lng: number, lat: number, deals: Opportunity[]) {
  const bounds = deals.reduce(
    (acc, deal) => ({
      minLng: Math.min(acc.minLng, deal.lng),
      maxLng: Math.max(acc.maxLng, deal.lng),
      minLat: Math.min(acc.minLat, deal.lat),
      maxLat: Math.max(acc.maxLat, deal.lat),
    }),
    { minLng: Infinity, maxLng: -Infinity, minLat: Infinity, maxLat: -Infinity },
  );
  const spanLng = bounds.maxLng - bounds.minLng;
  const spanLat = bounds.maxLat - bounds.minLat;
  const x = spanLng === 0 ? 0.5 : (lng - bounds.minLng) / spanLng;
  const y = spanLat === 0 ? 0.5 : (bounds.maxLat - lat) / spanLat;
  const inset = FALLBACK_PAD * 100;
  return {
    left: `${(inset + x * (100 - inset * 2)).toFixed(2)}%`,
    top: `${(inset + y * (100 - inset * 2)).toFixed(2)}%`,
  };
}

type MarkerEntry = {
  element: HTMLButtonElement;
  marker: MapLibreMarker;
};

export function DealDiscoveryMap() {
  const mapContainerRef = React.useRef<HTMLDivElement>(null);
  const atlasRef = React.useRef<HTMLDivElement>(null);
  const mapRef = React.useRef<MapLibreMap | null>(null);
  const markerEntriesRef = React.useRef<MarkerEntry[]>([]);
  const selectDealRef = React.useRef<(index: number, announce?: boolean) => void>(
    () => undefined,
  );
  const scanTimerRef = React.useRef<number | null>(null);
  const hasPlayedRef = React.useRef(false);

  const [activeIndex, setActiveIndex] = React.useState(0);
  const [deals, setDeals] = React.useState<Opportunity[]>([]);
  const [inventoryNote, setInventoryNote] = React.useState("Reading published listings.");
  const [announcement, setAnnouncement] = React.useState("");
  const [mapReady, setMapReady] = React.useState(false);
  const [mapUnavailable, setMapUnavailable] = React.useState(false);
  const [engineFailed, setEngineFailed] = React.useState(false);
  const [isInView, setIsInView] = React.useState(false);
  const [scanState, setScanState] = React.useState<ScanState>("idle");
  const [scanRun, setScanRun] = React.useState(0);
  const shouldReduceMotion = usePrefersReducedMotion();
  const reduceMotionRef = React.useRef(shouldReduceMotion);
  const activeDeal = deals[activeIndex] ?? null;

  React.useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({
      state: "OH",
      lat: "41.4993",
      lng: "-81.6944",
      radiusKm: "12",
      limit: "40",
      sort: "date",
    });
    void fetch(`/api/listings?${params.toString()}`, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
      .then((data: { listings?: ListingRow[] }) => {
        if (cancelled) return;
        const next = (data.listings ?? [])
          .map((row, index) => listingToOpportunity(row, index))
          .filter((row): row is Opportunity => row !== null)
          .slice(0, 8);
        setDeals(next);
        setActiveIndex(0);
        setInventoryNote(next.length ? "" : "No published listing with coordinates in this window.");
      })
      .catch(() => {
        if (cancelled) return;
        setDeals([]);
        setInventoryNote("The listing feed did not return this window.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  React.useEffect(() => {
    reduceMotionRef.current = shouldReduceMotion;
    if (shouldReduceMotion) {
      setScanState("complete");
      if (scanTimerRef.current !== null) {
        window.clearTimeout(scanTimerRef.current);
        scanTimerRef.current = null;
      }
    }
  }, [shouldReduceMotion]);

  React.useEffect(() => {
    const node = atlasRef.current;
    if (!node || typeof IntersectionObserver === "undefined") {
      setIsInView(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => setIsInView(entry.isIntersecting),
      { threshold: 0.45 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const runDiscovery = React.useCallback(() => {
    if (shouldReduceMotion) {
      setScanState("complete");
      return;
    }
    if (scanTimerRef.current !== null) window.clearTimeout(scanTimerRef.current);
    setScanRun((current) => current + 1);
    setScanState("playing");
    markerEntriesRef.current.forEach(({ element }, index) => {
      element.style.setProperty("--marker-delay", `${index * 60}ms`);
      element.dataset.discovering = "true";
    });
    scanTimerRef.current = window.setTimeout(() => {
      markerEntriesRef.current.forEach(({ element }) => {
        element.dataset.discovering = "false";
      });
      setScanState("complete");
      scanTimerRef.current = null;
    }, 1_300);
  }, [shouldReduceMotion]);

  React.useEffect(() => {
    if (!isInView || !mapReady || hasPlayedRef.current) return;
    hasPlayedRef.current = true;
    runDiscovery();
  }, [isInView, mapReady, runDiscovery]);

  const selectDeal = React.useCallback(
    (index: number, announce = true) => {
      const deal = deals[index];
      if (!deal) return;
      setActiveIndex(index);
      setScanState("complete");
      if (scanTimerRef.current !== null) {
        window.clearTimeout(scanTimerRef.current);
        scanTimerRef.current = null;
      }
      markerEntriesRef.current.forEach(({ element }) => {
        element.dataset.discovering = "false";
      });
      if (announce) {
        setAnnouncement(`${deal.address} selected. ${deal.signal}.`);
      }

      const map = mapRef.current;
      if (!map) return;
      map.stop();
      const camera = {
        center: [deal.lng, deal.lat] as [number, number],
        zoom: Math.max(map.getZoom(), 12.4),
        offset:
          typeof window !== "undefined" && window.innerWidth >= 1024
            ? ([-170, 0] as [number, number])
            : ([0, -40] as [number, number]),
      };
      if (reduceMotionRef.current) {
        map.jumpTo(camera);
      } else {
        map.easeTo({ ...camera, duration: 500 });
      }
    },
    [deals],
  );

  // Ref updates belong in effects — writing during render breaks under
  // React strict/concurrent re-renders.
  React.useEffect(() => {
    selectDealRef.current = selectDeal;
  }, [selectDeal]);

  // Roving keyboard control for the map markers: ArrowRight/Down selects the
  // next opportunity, ArrowLeft/Up the previous, Home/End jump to the ends.
  // Selection follows focus so screen-reader and keyboard users get the same
  // fly-to + announcement as pointer users.
  const handleMarkerKeydown = React.useCallback(
    (event: React.KeyboardEvent) => {
      const navigationKeys: Record<string, number> = {
        ArrowRight: 1,
        ArrowDown: 1,
        ArrowLeft: -1,
        ArrowUp: -1,
        Home: -Infinity,
        End: Infinity,
      };
      const direction = navigationKeys[event.key];
      if (direction === undefined) return;
      const target = event.target as HTMLElement | null;
      if (!target?.dataset?.opportunityMarker) return;
      event.preventDefault();
      const count = deals.length;
      if (count === 0) return;
      let next = activeIndex + direction;
      if (direction === -Infinity) next = 0;
      else if (direction === Infinity) next = count - 1;
      else next = ((next % count) + count) % count;
      selectDealRef.current(next, true);
      // Prefer the imperative MapLibre marker handles; fall back to a DOM
      // query so the engine-failure fallback buttons rove focus identically.
      const markerElement = markerEntriesRef.current[next]?.element;
      const fallback = atlasRef.current?.querySelectorAll<HTMLElement>(
        '[data-opportunity-marker="true"]',
      )?.[next];
      (markerElement ?? fallback)?.focus();
    },
    [activeIndex, deals],
  );

  React.useEffect(() => {
    markerEntriesRef.current.forEach(({ element }, index) => {
      const active = index === activeIndex;
      element.dataset.active = active ? "true" : "false";
      element.setAttribute("aria-pressed", active ? "true" : "false");
    });
  }, [activeIndex]);

  React.useEffect(() => {
    const container = mapContainerRef.current;
    if (!container) return;
    let disposed = false;
    let loadTimeout: number | null = null;

    void import("maplibre-gl")
      .then((maplibre) => {
        if (disposed || !mapContainerRef.current) return;
        const compactMap = window.innerWidth < 768;
        const map = new maplibre.Map({
          container: mapContainerRef.current,
          style: "https://tiles.openfreemap.org/styles/positron",
          center: CLEVELAND_CENTER,
          zoom: compactMap ? 10.2 : 10.8,
          pitch: compactMap ? 0 : 18,
          bearing: compactMap ? 0 : -7,
          minZoom: 8,
          maxZoom: 17,
          attributionControl: false,
        });
        mapRef.current = map;

        if (!compactMap) {
          map.addControl(
            new maplibre.NavigationControl({ showCompass: false }),
            "bottom-left",
          );
        }
        map.addControl(
          new maplibre.AttributionControl({
            compact: true,
            customAttribution: "OpenFreeMap · OpenStreetMap",
          }),
          "bottom-left",
        );
        map.addControl(
          new maplibre.ScaleControl({ maxWidth: 90, unit: "imperial" }),
          "bottom-left",
        );

        markerEntriesRef.current = deals.map((deal, index) => {
          const element = document.createElement("button");
          element.type = "button";
          element.className = "opportunity-map-marker";
          element.dataset.testid = "storyteller-map-marker";
          element.dataset.opportunityMarker = "true";
          element.dataset.active = index === 0 ? "true" : "false";
          element.dataset.discovering = "false";
          element.setAttribute(
            "aria-label",
            `Show ${deal.address} opportunity`,
          );
          element.setAttribute("aria-controls", "storyteller-map-preview");
          element.setAttribute("aria-pressed", index === 0 ? "true" : "false");
          element.style.setProperty("--marker-color", deal.color);
          element.style.setProperty("--marker-delay", `${index * 60}ms`);
          element.innerHTML = `
            <span aria-hidden="true" class="opportunity-map-marker__halo"></span>
            <span aria-hidden="true" class="opportunity-map-marker__pin"></span>
            <span aria-hidden="true" class="opportunity-map-marker__label"></span>
          `;
          const pin = element.querySelector(".opportunity-map-marker__pin");
          const areaLabel = element.querySelector(".opportunity-map-marker__label");
          if (pin) pin.textContent = pinText(deal.score);
          if (areaLabel) areaLabel.textContent = String(deal.area ?? "");
          element.addEventListener("click", (event) => {
            event.stopPropagation();
            selectDealRef.current(index, true);
          });
          const marker = new maplibre.Marker({
            element,
            anchor: "center",
          })
            .setLngLat([deal.lng, deal.lat])
            .addTo(map);
          return { element, marker };
        });

        // Fail fast on style/source errors instead of waiting for the load
        // timeout — the fallback banner and ranked list should appear
        // immediately when tiles are unreachable. One broken zoom tile must
        // NOT trip it, so we only degrade while the style itself is cold.
        const handleMapError = () => {
          if (disposed) return;
          const styleCold = !map.isStyleLoaded();
          if (!styleCold) return;
          if (loadTimeout !== null) {
            window.clearTimeout(loadTimeout);
            loadTimeout = null;
          }
          setMapUnavailable(true);
        };
        map.on("error", handleMapError);

        map.once("load", () => {
          if (disposed) return;
          if (loadTimeout !== null) {
            window.clearTimeout(loadTimeout);
            loadTimeout = null;
          }
          const geojson = {
            type: "FeatureCollection" as const,
            features: deals.map((deal) => ({
              type: "Feature" as const,
              geometry: {
                type: "Point" as const,
                coordinates: [deal.lng, deal.lat],
              },
              properties: { score: deal.score, source: deal.sourceKey },
            })),
          };
          try {
            map.addSource("opportunity-signals", {
              type: "geojson",
              data: geojson,
            });
            map.addLayer({
              id: "opportunity-heat",
              type: "heatmap",
              source: "opportunity-signals",
              maxzoom: 14,
              paint: {
                "heatmap-weight": [
                  "interpolate",
                  ["linear"],
                  ["get", "score"],
                  70,
                  0.45,
                  95,
                  1,
                ],
                "heatmap-intensity": 0.72,
                "heatmap-radius": [
                  "interpolate",
                  ["linear"],
                  ["zoom"],
                  8,
                  28,
                  14,
                  70,
                ],
                "heatmap-opacity": [
                  "interpolate",
                  ["linear"],
                  ["zoom"],
                  8,
                  0.22,
                  14,
                  0.08,
                ],
                "heatmap-color": [
                  "interpolate",
                  ["linear"],
                  ["heatmap-density"],
                  0,
                  "rgba(37,99,235,0)",
                  0.35,
                  "rgba(96,165,250,0.22)",
                  0.7,
                  "rgba(37,99,235,0.38)",
                  1,
                  "rgba(15,23,42,0.44)",
                ],
              },
            });
          } catch {
            // The geographic map and accessible HTML markers remain usable.
          }
          setMapReady(true);
        });

        map.on("dragstart", () => setScanState("complete"));
        map.on("zoomstart", () => setScanState("complete"));

        loadTimeout = window.setTimeout(() => {
          if (!map.loaded()) setMapUnavailable(true);
        }, 8_000);
      })
      .catch(() => {
        if (disposed) return;
        setMapUnavailable(true);
        setEngineFailed(true);
      });

    return () => {
      disposed = true;
      if (loadTimeout !== null) window.clearTimeout(loadTimeout);
      if (scanTimerRef.current !== null) window.clearTimeout(scanTimerRef.current);
      markerEntriesRef.current.forEach(({ marker }) => marker.remove());
      markerEntriesRef.current = [];
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [deals]);

  const shown = activeDeal ?? {
    id: "",
    address: inventoryNote,
    area: "Cleveland window",
    source: "Listings",
    sourceKey: "listing" as const,
    signal: "No pin",
    insight: inventoryNote,
    score: 0,
    opening: "—",
    arv: "—",
    spread: "—",
    color: "#0F172A",
    lng: CLEVELAND_CENTER[0],
    lat: CLEVELAND_CENTER[1],
  };
  const rankedDeals = deals.filter((_, index) => index !== activeIndex).slice(0, 3);

  return (
    <div
      ref={atlasRef}
      onKeyDown={handleMarkerKeydown}
      data-testid="storyteller-deal-map"
      data-map-engine="maplibre"
      data-map-ready={mapReady ? "true" : "false"}
      data-map-unavailable={mapUnavailable ? "true" : "false"}
      data-active-deal={shown.id}
      data-scanning={scanState === "playing" ? "true" : "false"}
      data-scan-state={scanState}
      role="region"
      aria-label="Interactive Cleveland opportunity map"
      className="opportunity-atlas relative w-full overflow-hidden rounded-[18px] border border-[#D9E2EC] bg-[#EAF1F6]"
    >
      <div className="opportunity-atlas__map relative h-[390px] overflow-hidden sm:h-[480px] lg:h-[620px]">
        <div aria-hidden="true" className="opportunity-atlas__fallback-map absolute inset-0 z-0 overflow-hidden bg-[#E8EDF1]">
          <div className="absolute left-1/2 top-1/2 grid aspect-[5/3] min-h-full min-w-full -translate-x-1/2 -translate-y-1/2 grid-cols-5 grid-rows-3">
            {FALLBACK_MAP_TILES.map(([x, y]) => (
              <img
                key={`${x}-${y}`}
                src={`/cleveland-map-tiles/${x}-${y}.png`}
                alt=""
                width={256}
                height={256}
                draggable={false}
                className="block h-full w-full select-none object-cover"
              />
            ))}
          </div>
          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(120deg,rgba(255,255,255,0.38),rgba(226,232,240,0.16))]" />
        </div>
        <div
          ref={mapContainerRef}
          data-testid="maplibre-map"
          aria-label="Real street map of Cleveland"
          className="opportunity-atlas__canvas absolute inset-0 z-[1]"
        />

        {mapUnavailable ? (
          <div
            role="status"
            className="absolute left-3 top-[72px] z-20 rounded-xl border border-white/80 bg-white/90 px-3 py-2 text-[11px] font-semibold text-[#475569] shadow-sm backdrop-blur sm:left-5"
          >
            Map tiles are unavailable. Opportunity coordinates and ranked list remain active.
          </div>
        ) : null}

        {/* Engine-failure fallback: if the map chunk never boots there are no
            MapLibre-mounted markers in the DOM. Render projected buttons over
            the static tile collage so every opportunity stays selectable and
            keyboard/SR reachable even with the map engine fully offline. */}
        {engineFailed ? (
          <div className="absolute inset-0 z-10">
            {deals.map((deal, index) => {
              const position = fallbackPosition(deal.lng, deal.lat, deals);
              const active = index === activeIndex;
              return (
                <button
                  key={deal.id}
                  type="button"
                  onClick={() => selectDeal(index, true)}
                  aria-label={`Show ${deal.address} opportunity`}
                  aria-pressed={active ? "true" : "false"}
                  aria-controls="storyteller-map-preview"
                  className="opportunity-map-marker opportunity-map-marker--fallback absolute"
                  data-testid="storyteller-map-marker-fallback"
                  style={{
                    left: position.left,
                    top: position.top,
                    ["--marker-color" as unknown as string]: deal.color,
                  }}
                  data-active={active ? "true" : "false"}
                  data-opportunity-marker="true"
                >
                  <span aria-hidden="true" className="opportunity-map-marker__halo" />
                  <span aria-hidden="true" className="opportunity-map-marker__pin">
                    {pinText(deal.score)}
                  </span>
                  <span aria-hidden="true" className="opportunity-map-marker__label">
                    {deal.area}
                  </span>
                </button>
              );
            })}
          </div>
        ) : null}

        {scanState === "playing" ? (
          <div
            key={scanRun}
            aria-hidden="true"
            data-testid="opportunity-discovery-scan"
            className="opportunity-discovery-scan pointer-events-none absolute inset-0 z-10"
          />
        ) : null}

        <div className="absolute left-3 right-3 top-3 z-30 flex items-center justify-between gap-3 lg:right-[384px] sm:left-5 sm:top-5">
          <div className="flex min-w-0 items-center gap-2 rounded-xl border border-white/85 bg-white/92 px-3 py-2 shadow-[0_8px_26px_rgba(15,23,42,0.1)] backdrop-blur-md">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-900">
              <MapPinned className="h-4 w-4" aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="truncate text-[10px] font-extrabold uppercase tracking-[0.12em] text-slate-900">
                Map preview
              </p>
              <p className="truncate text-[12px] font-semibold text-[#111827]">
                {deals.length ? `${deals.length} published in this window` : "Cleveland window"}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={runDiscovery}
            disabled={shouldReduceMotion}
            aria-label={
              shouldReduceMotion
                ? "Market discovery animation disabled by reduced motion preference"
                : "Replay market discovery"
            }
            className="opportunity-replay inline-flex h-11 shrink-0 items-center gap-2 rounded-xl border border-white/85 bg-white/92 px-3 text-[12px] font-bold text-[#111827] shadow-[0_8px_26px_rgba(15,23,42,0.1)] backdrop-blur-md disabled:cursor-default disabled:opacity-70"
          >
            {shouldReduceMotion ? (
              <Crosshair className="h-3.5 w-3.5" aria-hidden />
            ) : (
              <Radar className="h-3.5 w-3.5" aria-hidden />
            )}
            <span className="hidden sm:inline">
              {shouldReduceMotion ? "Motion reduced" : "Replay discovery"}
            </span>
          </button>
        </div>

        <div className="absolute bottom-3 left-3 z-20 hidden items-center gap-2 rounded-lg border border-white/80 bg-white/86 px-2.5 py-2 text-[10px] font-semibold text-[#475569] shadow-sm backdrop-blur md:flex lg:bottom-5 lg:left-5">
          Pin = published listing
        </div>
      </div>

      <article
        id="storyteller-map-preview"
        data-testid="storyteller-map-preview"
        data-opportunity-detail="true"
        aria-label={`Selected opportunity: ${shown.address}`}
        className="opportunity-inspector relative z-40 border-t border-[#E2E8F0] bg-white p-4 sm:p-5 lg:absolute lg:bottom-4 lg:right-4 lg:top-4 lg:w-[352px] lg:overflow-y-auto lg:rounded-2xl lg:border lg:border-white/90 lg:bg-white/94 lg:shadow-[0_22px_70px_rgba(15,23,42,0.18)] lg:backdrop-blur-xl"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[10px] font-extrabold uppercase tracking-[0.13em] text-slate-900">
              {sourceDisplayText(shown.source)}
            </p>
            <h3 className="mt-1 truncate text-[20px] font-bold tracking-[-0.02em] text-[#111827]">
              {shown.address}
            </h3>
            <p className="mt-1 text-[12px] font-medium text-[#5B6472]">
              {shown.area}
            </p>
          </div>
          <span className="inline-flex shrink-0 items-center gap-1 rounded-xl bg-emerald-50 px-3 py-2 text-[16px] font-extrabold tabular-nums text-emerald-700">
            <TrendingUp className="h-4 w-4" aria-hidden /> {pinText(shown.score)}
          </span>
        </div>

        <p className="mt-4 rounded-xl bg-[#F8FAFC] px-3.5 py-3 text-[12px] font-medium leading-[1.45] text-[#475569]">
          {shown.signal}. {shown.insight}
        </p>

        <div className="mt-4 grid grid-cols-3 gap-2 text-center">
          <OpportunityStat label="Opening" value={shown.opening} />
          <OpportunityStat label="Value band" value={shown.arv} />
          <OpportunityStat label="Spread" value={shown.spread} green />
        </div>

        <a
          href={shown.id ? `/listings/${encodeURIComponent(shown.id)}` : "/listings"}
          className="opportunity-primary-action mt-3 inline-flex h-11 w-full items-center justify-center gap-1.5 rounded-xl bg-[#0F172A] px-4 text-[12px] font-bold text-white"
        >
          {shown.id ? "Open listing" : "Open the feed"} <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </a>

        <div className="mt-5 border-t border-[#E8EDF3] pt-4">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-extrabold uppercase tracking-[0.12em] text-[#5B6472]">
              Next opportunities
            </p>
            <span className="text-[10px] font-semibold text-[#5B6472]">
              Feed order
            </span>
          </div>
          <div data-testid="opportunity-list" className="mt-2 space-y-1.5">
            {rankedDeals.map((deal) => {
              const index = deals.findIndex((item) => item.id === deal.id);
              return (
                <button
                  key={deal.id}
                  type="button"
                  onClick={() => selectDeal(index)}
                  aria-label={`Inspect ${deal.address} from ranked list`}
                  className="opportunity-list-row flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left"
                >
                  <span
                    aria-hidden="true"
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: deal.color }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12px] font-bold text-[#111827]">
                      {deal.address}
                    </span>
                    <span className="block truncate text-[10px] font-medium text-[#5B6472]">
                      {sourceDisplayText(deal.source)}
                    </span>
                  </span>
                  <span className="text-[12px] font-extrabold tabular-nums text-[#334155]">
                    {pinText(deal.score)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </article>

      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
    </div>
  );
}

function OpportunityStat({
  label,
  value,
  green,
}: {
  label: string;
  value: string;
  green?: boolean;
}) {
  return (
    <div className="rounded-xl bg-[#F3F6F9] px-2 py-2.5">
      <p className="text-[9px] font-bold uppercase tracking-[0.08em] text-[#5B6472]">
        {label}
      </p>
      <p
        className={`mt-0.5 text-[15px] font-extrabold tabular-nums ${
          green ? "text-emerald-600" : "text-[#111827]"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function usePrefersReducedMotion() {
  const [prefersReducedMotion, setPrefersReducedMotion] = React.useState(false);

  React.useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const syncPreference = () => setPrefersReducedMotion(mediaQuery.matches);
    syncPreference();
    mediaQuery.addEventListener("change", syncPreference);
    return () => mediaQuery.removeEventListener("change", syncPreference);
  }, []);

  return prefersReducedMotion;
}
