"use client";

import * as React from "react";
import Link from "next/link";
import "maplibre-gl/dist/maplibre-gl.css";
import { OPENFREEMAP_POSITRON_STYLE, RASTER_STREET_STYLE } from "@/lib/map-style";
import { attachBasemapFallback, isBasemapErrorEvent, switchBasemapStyle } from "@/lib/map-controller";
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
import { useLocale } from "@/components/i18n/locale-provider";
import { localizeDisplayDate, localizePropType } from "@/lib/i18n/domain";
import { formatUsd, interpolate } from "@/lib/i18n/translator";
import type { Locale } from "@/lib/i18n/config";
import type { Messages } from "@/lib/i18n/messages";

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
  state?: string | null;
  source?: string | null;
  propType?: string | null;
  saleDate?: string | null;
  lat?: number | string | null;
  lng?: number | string | null;
  openingBid?: number | string | null;
  estLow?: number | string | null;
  estHigh?: number | string | null;
  dealScore?: number | string | null;
};

type ScanState = "idle" | "playing" | "complete";
type WindowKind =
  | { kind: "cleveland" }
  | { kind: "national" }
  | { kind: "state"; state: string }
  | { kind: "market" };
type FeedStatus = "loading" | "ready" | "empty" | "error";

const CLEVELAND_CENTER: [number, number] = [-81.6944, 41.4993];
const PIN_COLORS = ["#181529", "#1D4ED8", "#0F766E", "#7C3AED", "#B45309"];

function finite(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function moneyOrDash(value: unknown, locale: Locale): string {
  const n = finite(value);
  if (n === null || n <= 0) return "—";
  return formatUsd(locale, n);
}

function isClevelandCoord(lat: number, lng: number): boolean {
  return lat >= 41.3 && lat <= 41.6 && lng >= -81.9 && lng <= -81.5;
}

function isUsCoord(lat: number, lng: number): boolean {
  return lat >= 15 && lat <= 72 && lng >= -180 && lng <= -64;
}

function listingToOpportunity(
  row: ListingRow,
  index: number,
  t: Messages["mapsUi"],
  messages: Messages,
  locale: Locale,
): Opportunity | null {
  const lat = finite(row.lat);
  const lng = finite(row.lng);
  if (lat === null || lng === null || !row.id) return null;
  if (!isUsCoord(lat, lng)) return null;
  const low = finite(row.estLow);
  const high = finite(row.estHigh);
  const hasBand = low !== null && low > 0 && high !== null && high >= low;
  const mid = hasBand && low !== null && high !== null ? (low + high) / 2 : null;
  const opening = finite(row.openingBid);
  const spread = mid !== null && opening !== null && opening > 0 ? mid - opening : null;
  const score = finite(row.dealScore);
  const area = [row.city?.trim() || row.county?.trim(), row.state?.trim()]
    .filter((part): part is string => Boolean(part))
    .join(", ");
  const datePart = row.saleDate ? String(row.saleDate).slice(0, 10) : "";
  const formattedDate = datePart
    ? (locale === "en" ? datePart : localizeDisplayDate(datePart, locale, datePart))
    : "";
  const signal = formattedDate
    ? interpolate(t.ddmScheduledSignal, { date: formattedDate })
    : (row.propType?.trim() ? localizePropType(row.propType, messages, locale) : null) ||
      t.ddmPublishedRecord;
  return {
    id: String(row.id),
    address: row.address?.trim() || t.ddmAddressNotPublished,
    area: area || t.ddmUsArea,
    source: row.source?.trim() || t.ddmListingFallback,
    sourceKey: "listing",
    signal,
    insight: t.ddmInsight,
    score: score !== null && score > 0 ? score : 0,
    opening: moneyOrDash(opening, locale),
    arv: mid !== null ? moneyOrDash(mid, locale) : "—",
    spread: spread !== null ? moneyOrDash(spread, locale) : "—",
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
  const { locale, messages } = useLocale();
  const t = messages.mapsUi;

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
  const [rawRows, setRawRows] = React.useState<ListingRow[]>([]);
  const [windowKind, setWindowKind] = React.useState<WindowKind>({ kind: "cleveland" });
  const [feedStatus, setFeedStatus] = React.useState<FeedStatus>("loading");
  const [announcement, setAnnouncement] = React.useState("");
  const [mapReady, setMapReady] = React.useState(false);
  const [mapUnavailable, setMapUnavailable] = React.useState(false);
  const [engineFailed, setEngineFailed] = React.useState(false);
  const [isInView, setIsInView] = React.useState(false);
  const [scanState, setScanState] = React.useState<ScanState>("idle");
  const [scanRun, setScanRun] = React.useState(0);
  const shouldReduceMotion = usePrefersReducedMotion();
  const reduceMotionRef = React.useRef(shouldReduceMotion);

  const deals = React.useMemo(
    () =>
      rawRows
        .map((row, index) => listingToOpportunity(row, index, t, messages, locale))
        .filter((row): row is Opportunity => row !== null)
        .slice(0, 8),
    [rawRows, t, messages, locale],
  );
  const windowLabel = React.useMemo(() => {
    if (windowKind.kind === "cleveland") return t.ddmClevelandWin;
    if (windowKind.kind === "national") return t.ddmNationalWin;
    if (windowKind.kind === "state") return interpolate(t.ddmStateWin, { state: windowKind.state });
    return t.ddmMarketWin;
  }, [windowKind, t]);
  const inventoryNote = React.useMemo(() => {
    if (feedStatus === "loading") return t.ddmReadingNote;
    if (feedStatus === "empty") return t.ddmEmptyCoordsNote;
    if (feedStatus === "error") return t.ddmFeedFailedNote;
    return "";
  }, [feedStatus, t]);

  const activeDeal = deals[activeIndex] ?? null;
  const isClevelandWindow = deals.length === 0 || deals.every((deal) => isClevelandCoord(deal.lat, deal.lng));

  React.useEffect(() => {
    let cancelled = false;
    const clevelandParams = new URLSearchParams({
      state: "OH",
      lat: "41.4993",
      lng: "-81.6944",
      radiusKm: "12",
      limit: "40",
      sort: "date",
    });

    const loadOpportunities = async () => {
      try {
        const response = await fetch(`/api/listings?${clevelandParams.toString()}`, { cache: "no-store" });
        if (!response.ok) throw new Error(String(response.status));
        const data = (await response.json()) as { listings?: ListingRow[] };
        if (cancelled) return;
        const clevelandRows = (data.listings ?? [])
          .filter((row) => {
            const lat = finite(row.lat);
            const lng = finite(row.lng);
            return lat !== null && lng !== null && isClevelandCoord(lat, lng) && Boolean(row.id);
          })
          .slice(0, 8);

        if (clevelandRows.length > 0) {
          setRawRows(clevelandRows);
          setWindowKind({ kind: "cleveland" });
          setActiveIndex(0);
          setFeedStatus("ready");
          return;
        }

        const fallbackRes = await fetch("/api/listings?limit=40&sort=score", { cache: "no-store" });
        if (!fallbackRes.ok) throw new Error(String(fallbackRes.status));
        const fallbackData = (await fallbackRes.json()) as { listings?: ListingRow[] };
        if (cancelled) return;
        const rawFallback = fallbackData.listings ?? [];
        const nationalRows = rawFallback
          .filter((row) => {
            const lat = finite(row.lat);
            const lng = finite(row.lng);
            return lat !== null && lng !== null && isUsCoord(lat, lng) && Boolean(row.id);
          })
          .slice(0, 8);
        const states = new Set(
          rawFallback
            .map((row) => (typeof row.state === "string" ? row.state.trim().toUpperCase() : ""))
            .filter(Boolean),
        );
        setRawRows(nationalRows);
        setWindowKind(
          nationalRows.length > 0
            ? states.size === 1
              ? { kind: "state", state: [...states][0] }
              : { kind: "national" }
            : { kind: "market" },
        );
        setActiveIndex(0);
        setFeedStatus(nationalRows.length ? "ready" : "empty");
      } catch {
        if (cancelled) return;
        setRawRows([]);
        setFeedStatus("error");
      }
    };

    void loadOpportunities();
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
        setAnnouncement(`${deal.address} · ${deal.signal}`);
      }

      const map = mapRef.current;
      if (!map) return;
      map.stop();
      const camera = {
        center: [deal.lng, deal.lat] as [number, number],
        zoom: Math.max(map.getZoom(), 11.8),
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

  React.useEffect(() => {
    selectDealRef.current = selectDeal;
  }, [selectDeal]);

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
    const localWindow = deals.length === 0 || deals.every((deal) => isClevelandCoord(deal.lat, deal.lng));
    const initialCenter: [number, number] = deals.length > 0
      ? [
          deals.reduce((sum, d) => sum + d.lng, 0) / deals.length,
          deals.reduce((sum, d) => sum + d.lat, 0) / deals.length,
        ]
      : CLEVELAND_CENTER;

    void import("maplibre-gl")
      .then((maplibre) => {
        if (disposed || !mapContainerRef.current) return;
        const compactMap = window.innerWidth < 768;
        const map = new maplibre.Map({
          container: mapContainerRef.current,
          style: OPENFREEMAP_POSITRON_STYLE,
          center: initialCenter,
          zoom: localWindow ? (compactMap ? 10.2 : 10.8) : 4,
          pitch: localWindow && !compactMap ? 18 : 0,
          bearing: localWindow && !compactMap ? -7 : 0,
          minZoom: 2,
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
            interpolate(t.ddmShowOppAria, { address: deal.address }),
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

        let styleFailed = false;
        let detachFallback: (() => void) | null = null;
        let fallbackApplied = false;
        const markReadyIfStyleLoaded = () => {
          if (disposed || styleFailed) return;
          if (map.isStyleLoaded()) {
            setMapReady(true);
            setMapUnavailable(false);
          }
        };
        const applyHeatLayer = () => {
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
            if (!map.getSource("opportunity-signals")) {
              map.addSource("opportunity-signals", {
                type: "geojson",
                data: geojson,
              });
            }
            if (!map.getLayer("opportunity-heat")) {
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
            }
          } catch {
            // The geographic map and accessible HTML markers remain usable.
          }
        };
        detachFallback = attachBasemapFallback(map, RASTER_STREET_STYLE, {
          onFallback: () => {
            fallbackApplied = true;
          },
          onRehydrate: () => {
            if (disposed) return;
            applyHeatLayer();
            setMapReady(true);
            setMapUnavailable(false);
          },
        });
        const handleMapError = (event: unknown) => {
          if (disposed) return;
          if (!isBasemapErrorEvent(event, map)) return;
          if (!fallbackApplied) return;
          styleFailed = true;
          if (loadTimeout !== null) {
            window.clearTimeout(loadTimeout);
            loadTimeout = null;
          }
          setMapUnavailable(true);
        };
        map.on("error", handleMapError);
        map.once("styledata", markReadyIfStyleLoaded);
        map.once("render", markReadyIfStyleLoaded);

        map.once("load", () => {
          if (disposed) return;
          if (loadTimeout !== null) {
            window.clearTimeout(loadTimeout);
            loadTimeout = null;
          }
          if (!localWindow && deals.length >= 2) {
            const lngs = deals.map((d) => d.lng);
            const lats = deals.map((d) => d.lat);
            try {
              map.fitBounds(
                [
                  [Math.min(...lngs), Math.min(...lats)],
                  [Math.max(...lngs), Math.max(...lats)],
                ],
                { padding: 60, maxZoom: 12.2, duration: 0 },
              );
            } catch {
              // Keep initial center if bounds fit fails on single point.
            }
          }
          applyHeatLayer();
          setMapReady(true);
        });

        map.on("dragstart", () => setScanState("complete"));
        map.on("zoomstart", () => setScanState("complete"));

        loadTimeout = window.setTimeout(() => {
          if (!map.loaded()) {
            if (!fallbackApplied) {
              fallbackApplied = true;
              try {
                switchBasemapStyle(map, RASTER_STREET_STYLE, () => {
                  if (disposed) return;
                  applyHeatLayer();
                  setMapReady(true);
                });
              } catch {
                setMapUnavailable(true);
              }
            } else {
              setMapUnavailable(true);
            }
          }
        }, 8_000);
        const origRemove = map.remove.bind(map);
        map.remove = () => {
          detachFallback?.();
          return origRemove();
        };
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
  }, [deals, t]);

  const shown = activeDeal ?? {
    id: "",
    address: inventoryNote,
    area: windowLabel,
    source: t.ddmListingFallback,
    sourceKey: "listing" as const,
    signal: t.ddmNoPin,
    insight: inventoryNote,
    score: 0,
    opening: "—",
    arv: "—",
    spread: "—",
    color: "#181529",
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
      aria-label={interpolate(t.ddmRegionAria, { window: windowLabel.toLowerCase() })}
      className="opportunity-atlas relative w-full overflow-hidden rounded-card border border-line bg-paper"
    >
      <div className="opportunity-atlas__map relative h-[390px] overflow-hidden sm:h-[480px] lg:h-[620px]">
        <div aria-hidden="true" className="opportunity-atlas__fallback-map absolute inset-0 z-0 overflow-hidden bg-paper">
          {isClevelandWindow ? (
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
          ) : (
            <div
              data-fallback-mode="national-grid"
              className="h-full w-full bg-[linear-gradient(to_right,rgba(148,163,184,0.18)_1px,transparent_1px),linear-gradient(to_bottom,rgba(148,163,184,0.18)_1px,transparent_1px)] bg-[size:32px_32px]"
            />
          )}
          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(120deg,rgba(255,255,255,0.38),rgba(226,232,240,0.16))]" />
        </div>
        <div
          ref={mapContainerRef}
          data-testid="maplibre-map"
          aria-label={t.ddmStreetMapAria}
          className="opportunity-atlas__canvas absolute inset-0 z-[1]"
        />

        {mapUnavailable ? (
          <div
            role="status"
            className="absolute left-3 top-[72px] z-20 rounded-control border border-white/80 bg-white/90 px-3 py-2 text-xs font-semibold text-ink-3 shadow-sm backdrop-blur sm:left-5"
          >
            {t.ddmTilesDownBanner}
          </div>
        ) : null}

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
                  aria-label={interpolate(t.ddmShowOppAria, { address: deal.address })}
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
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-paper text-ink">
              <MapPinned className="h-4 w-4" aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="truncate text-xs font-extrabold uppercase tracking-[0.12em] text-ink">
                {t.ddmMapPreviewTag}
              </p>
              <p className="truncate text-xs font-semibold text-ink">
                {deals.length ? interpolate(t.ddmPublishedInWin, { count: deals.length, window: windowLabel.toLowerCase() }) : windowLabel}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={runDiscovery}
            disabled={shouldReduceMotion}
            aria-label={
              shouldReduceMotion
                ? t.ddmMotionDisabledAria
                : t.ddmReplayAria
            }
            className="opportunity-replay inline-flex h-11 shrink-0 items-center gap-2 rounded-control border border-white/85 bg-white/92 px-3 text-xs font-bold text-ink shadow-card backdrop-blur-md disabled:cursor-default disabled:opacity-70"
          >
            {shouldReduceMotion ? (
              <Crosshair className="h-3.5 w-3.5" aria-hidden />
            ) : (
              <Radar className="h-3.5 w-3.5" aria-hidden />
            )}
            <span className="hidden sm:inline">
              {shouldReduceMotion ? t.ddmMotionReduced : t.ddmReplayBtn}
            </span>
          </button>
        </div>

        <div className="absolute bottom-3 left-3 z-20 hidden items-center gap-2 rounded-lg border border-white/80 bg-white/86 px-2.5 py-2 text-xs font-semibold text-ink-3 shadow-sm backdrop-blur md:flex lg:bottom-5 lg:left-5">
          {t.ddmLegendPin}
        </div>
      </div>

      <article
        id="storyteller-map-preview"
        data-testid="storyteller-map-preview"
        data-opportunity-detail="true"
        aria-label={interpolate(t.ddmSelectedOppAria, { address: shown.address })}
        className="opportunity-inspector relative z-40 border-t border-line bg-card p-4 sm:p-5 lg:absolute lg:bottom-4 lg:right-4 lg:top-4 lg:w-[352px] lg:overflow-y-auto lg:rounded-2xl lg:border lg:border-white/90 lg:bg-card/95 lg:shadow-raised lg:backdrop-blur-xl"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-extrabold uppercase tracking-[0.13em] text-ink">
              {sourceDisplayText(shown.source)}
            </p>
            <h3 className="mt-1 truncate text-xl font-bold tracking-[-0.02em] text-ink">
              {shown.id ? (
                <Link href={`/listings/${encodeURIComponent(shown.id)}`} className="hover:underline underline-offset-4">
                  {shown.address}
                </Link>
              ) : (
                shown.address
              )}
            </h3>
            <p className="mt-1 text-xs font-medium text-ink-3">
              {shown.area}
            </p>
          </div>
          <span className="inline-flex shrink-0 items-center gap-1 rounded-xl bg-go-wash px-3 py-2 text-base font-extrabold tabular-nums text-go">
            <TrendingUp className="h-4 w-4" aria-hidden /> {pinText(shown.score)}
          </span>
        </div>

        <p className="mt-4 rounded-control bg-paper px-3.5 py-3 text-xs font-medium leading-[1.45] text-ink-2">
          {shown.signal}. {shown.insight}
        </p>

        <div className="mt-4 grid grid-cols-3 gap-2 text-center">
          <OpportunityStat label={t.ddmStatOpening} value={shown.opening} />
          <OpportunityStat label={t.ddmStatValueBand} value={shown.arv} />
          <OpportunityStat label={t.ddmStatSpread} value={shown.spread} green />
        </div>

        <a
          href={shown.id ? `/listings/${encodeURIComponent(shown.id)}` : "/listings"}
          className="opportunity-primary-action mt-3 inline-flex h-11 w-full items-center justify-center gap-1.5 rounded-xl bg-ink hover:bg-ink-2 px-4 text-xs font-bold text-white"
        >
          {shown.id ? t.ddmOpenListing : t.ddmOpenFeed} <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </a>

        <div className="mt-5 border-t border-line pt-4">
          <div className="flex items-center justify-between">
            <p className="text-xs font-extrabold uppercase tracking-[0.12em] text-ink-3">
              {t.ddmNextOpps}
            </p>
            <span className="text-xs font-semibold text-ink-3">
              {t.ddmFeedOrder}
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
                  aria-label={interpolate(t.ddmInspectRankedAria, { address: deal.address })}
                  className="opportunity-list-row flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left"
                >
                  <span
                    aria-hidden="true"
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: deal.color }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-bold text-ink">
                      {deal.address}
                    </span>
                    <span className="block truncate text-xs font-medium text-ink-3">
                      {sourceDisplayText(deal.source)}
                    </span>
                  </span>
                  <span className="text-xs font-extrabold tabular-nums text-ink-2">
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
    <div className="rounded-control bg-paper px-2 py-2.5">
      <p className="text-xs font-bold uppercase tracking-[0.08em] text-ink-3">
        {label}
      </p>
      <p
        className={`mt-0.5 text-sm font-extrabold tabular-nums ${
          green ? "text-go" : "text-ink"
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
