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

type Opportunity = {
  id: string;
  address: string;
  area: string;
  source: string;
  sourceKey: "county" | "tax" | "sheriff" | "code" | "estate";
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

type ScanState = "idle" | "playing" | "complete";

const CLEVELAND_CENTER: [number, number] = [-81.6944, 41.4993];

const OPPORTUNITIES: Opportunity[] = [
  {
    id: "clark",
    address: "4120 Clark Ave",
    area: "Detroit–Shoreway",
    source: "County notice",
    sourceKey: "county",
    signal: "Sale window opens in 8 days",
    insight: "Strongest bid-to-value spread in the current west-side scan.",
    score: 92,
    opening: "$42k",
    arv: "$95k",
    spread: "$53k",
    color: "#2563EB",
    lng: -81.7136629,
    lat: 41.469781,
  },
  {
    id: "detroit",
    address: "7604 Detroit Ave",
    area: "Detroit–Shoreway",
    source: "Tax delinquency",
    sourceKey: "tax",
    signal: "New delinquency signal",
    insight: "New public-record signal with a wide modeled renovation margin.",
    score: 86,
    opening: "$68k",
    arv: "$142k",
    spread: "$74k",
    color: "#7C3AED",
    lng: -81.7372636,
    lat: 41.4823093,
  },
  {
    id: "woodland",
    address: "8010 Woodland Ave",
    area: "Kinsman",
    source: "Sheriff sale",
    sourceKey: "sheriff",
    signal: "Bid date moved forward",
    insight: "Auction timing changed; diligence should be prioritized this week.",
    score: 83,
    opening: "$51k",
    arv: "$118k",
    spread: "$67k",
    color: "#EA580C",
    lng: -81.6329114,
    lat: 41.4880902,
  },
  {
    id: "superior",
    address: "11818 Superior Ave",
    area: "Glenville",
    source: "Code enforcement",
    sourceKey: "code",
    signal: "Violation filed 4 days ago",
    insight: "Fresh municipal distress signal near active east-side acquisition zones.",
    score: 78,
    opening: "$59k",
    arv: "$126k",
    spread: "$67k",
    color: "#0891B2",
    lng: -81.6027726,
    lat: 41.5229457,
  },
  {
    id: "broadview",
    address: "4532 Broadview Rd",
    area: "Old Brooklyn",
    source: "Estate filing",
    sourceKey: "estate",
    signal: "Probate record matched",
    insight: "Estate filing and parcel identity resolve to the same owner record.",
    score: 74,
    opening: "$81k",
    arv: "$157k",
    spread: "$76k",
    color: "#16A34A",
    lng: -81.6973692,
    lat: 41.4324144,
  },
];

const FALLBACK_MAP_TILES = [
  [557, 763], [558, 763], [559, 763], [560, 763], [561, 763],
  [557, 764], [558, 764], [559, 764], [560, 764], [561, 764],
  [557, 765], [558, 765], [559, 765], [560, 765], [561, 765],
] as const;

// Padded bounding box of the opportunity set — used to project fallback
// marker positions when the map engine itself fails to boot (offline chunk).
const OPPORTUNITY_BOUNDS = OPPORTUNITIES.reduce(
  (acc, deal) => ({
    minLng: Math.min(acc.minLng, deal.lng),
    maxLng: Math.max(acc.maxLng, deal.lng),
    minLat: Math.min(acc.minLat, deal.lat),
    maxLat: Math.max(acc.maxLat, deal.lat),
  }),
  { minLng: Infinity, maxLng: -Infinity, minLat: Infinity, maxLat: -Infinity },
);

const FALLBACK_PAD = 0.12;
function fallbackPosition(lng: number, lat: number) {
  const spanLng = OPPORTUNITY_BOUNDS.maxLng - OPPORTUNITY_BOUNDS.minLng;
  const spanLat = OPPORTUNITY_BOUNDS.maxLat - OPPORTUNITY_BOUNDS.minLat;
  const x = spanLng === 0 ? 0.5 : (lng - OPPORTUNITY_BOUNDS.minLng) / spanLng;
  const y = spanLat === 0 ? 0.5 : (OPPORTUNITY_BOUNDS.maxLat - lat) / spanLat;
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
  const [announcement, setAnnouncement] = React.useState("");
  const [mapReady, setMapReady] = React.useState(false);
  const [mapUnavailable, setMapUnavailable] = React.useState(false);
  const [engineFailed, setEngineFailed] = React.useState(false);
  const [isInView, setIsInView] = React.useState(false);
  const [scanState, setScanState] = React.useState<ScanState>("idle");
  const [scanRun, setScanRun] = React.useState(0);
  const shouldReduceMotion = usePrefersReducedMotion();
  const reduceMotionRef = React.useRef(shouldReduceMotion);
  const activeDeal = OPPORTUNITIES[activeIndex];

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
      const deal = OPPORTUNITIES[index];
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
    [],
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
      const count = OPPORTUNITIES.length;
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
    [activeIndex],
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

        markerEntriesRef.current = OPPORTUNITIES.map((deal, index) => {
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
            <span aria-hidden="true" class="opportunity-map-marker__pin">${deal.score}</span>
            <span aria-hidden="true" class="opportunity-map-marker__label">${deal.area}</span>
          `;
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
            features: OPPORTUNITIES.map((deal) => ({
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
  }, []);

  const rankedDeals = OPPORTUNITIES.filter((_, index) => index !== activeIndex)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  return (
    <div
      ref={atlasRef}
      onKeyDown={handleMarkerKeydown}
      data-testid="storyteller-deal-map"
      data-map-engine="maplibre"
      data-map-ready={mapReady ? "true" : "false"}
      data-map-unavailable={mapUnavailable ? "true" : "false"}
      data-active-deal={activeDeal.id}
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
            {OPPORTUNITIES.map((deal, index) => {
              const position = fallbackPosition(deal.lng, deal.lat);
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
                    {deal.score}
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
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-blue-50 text-blue-700">
              <MapPinned className="h-4 w-4" aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="truncate text-[10px] font-extrabold uppercase tracking-[0.12em] text-blue-700">
                Real map · demo opportunities
              </p>
              <p className="truncate text-[12px] font-semibold text-[#111827]">
                Cleveland, OH · {OPPORTUNITIES.length} signals
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
          <span className="h-2 w-2 rounded-full bg-[#2563EB]" /> County
          <span className="ml-1 h-2 w-2 rounded-full bg-[#7C3AED]" /> Tax
          <span className="ml-1 h-2 w-2 rounded-full bg-[#EA580C]" /> Auction
          <span className="ml-1 h-2 w-2 rounded-full bg-[#0891B2]" /> Code
          <span className="ml-1 h-2 w-2 rounded-full bg-[#16A34A]" /> Estate
        </div>
      </div>

      <article
        id="storyteller-map-preview"
        data-testid="storyteller-map-preview"
        data-opportunity-detail="true"
        aria-label={`Selected opportunity: ${activeDeal.address}`}
        className="opportunity-inspector relative z-40 border-t border-[#E2E8F0] bg-white p-4 sm:p-5 lg:absolute lg:bottom-4 lg:right-4 lg:top-4 lg:w-[352px] lg:overflow-y-auto lg:rounded-2xl lg:border lg:border-white/90 lg:bg-white/94 lg:shadow-[0_22px_70px_rgba(15,23,42,0.18)] lg:backdrop-blur-xl"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[10px] font-extrabold uppercase tracking-[0.13em] text-blue-700">
              {activeDeal.source}
            </p>
            <h3 className="mt-1 truncate text-[20px] font-bold tracking-[-0.02em] text-[#111827]">
              {activeDeal.address}
            </h3>
            <p className="mt-1 text-[12px] font-medium text-[#64748B]">
              {activeDeal.area} · Cleveland, OH
            </p>
          </div>
          <span className="inline-flex shrink-0 items-center gap-1 rounded-xl bg-emerald-50 px-3 py-2 text-[16px] font-extrabold tabular-nums text-emerald-700">
            <TrendingUp className="h-4 w-4" aria-hidden /> {activeDeal.score}
          </span>
        </div>

        <p className="mt-4 rounded-xl bg-[#F8FAFC] px-3.5 py-3 text-[12px] font-medium leading-[1.45] text-[#475569]">
          {activeDeal.signal}. {activeDeal.insight}
        </p>

        <div className="mt-4 grid grid-cols-3 gap-2 text-center">
          <OpportunityStat label="Opening" value={activeDeal.opening} />
          <OpportunityStat label="ARV" value={activeDeal.arv} />
          <OpportunityStat label="Spread" value={activeDeal.spread} green />
        </div>

        <a
          href="#live-feed"
          className="opportunity-primary-action mt-3 inline-flex h-11 w-full items-center justify-center gap-1.5 rounded-xl bg-[#0F172A] px-4 text-[12px] font-bold text-white"
        >
          Explore live deals <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </a>

        <div className="mt-5 border-t border-[#E8EDF3] pt-4">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-extrabold uppercase tracking-[0.12em] text-[#64748B]">
              Next opportunities
            </p>
            <span className="text-[10px] font-semibold text-[#94A3B8]">
              Ranked by score
            </span>
          </div>
          <div data-testid="opportunity-list" className="mt-2 space-y-1.5">
            {rankedDeals.map((deal) => {
              const index = OPPORTUNITIES.findIndex((item) => item.id === deal.id);
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
                    <span className="block truncate text-[10px] font-medium text-[#94A3B8]">
                      {deal.source}
                    </span>
                  </span>
                  <span className="text-[12px] font-extrabold tabular-nums text-[#334155]">
                    {deal.score}
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
      <p className="text-[9px] font-bold uppercase tracking-[0.08em] text-[#94A3B8]">
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
