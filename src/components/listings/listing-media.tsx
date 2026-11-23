"use client";

import * as React from "react";
import { Camera, ExternalLink, Image as ImageIcon, Map as MapIcon, MapPin } from "lucide-react";
import type { Map as MapLibreMap, Marker as MapLibreMarker, StyleSpecification } from "maplibre-gl";
import type { Feature as GeoJsonFeature } from "geojson";
import { safeImageUrl } from "@/lib/listing-display";
import { requestStreetViewMetadata, formatCaptureDate, streetViewLaunchUrl, type StreetViewMetadata } from "@/lib/street-view-client";
import { PropertyEvidenceVisual } from "@/components/listings/property-evidence-visual";
import { AlternativeStreetView } from "@/components/listings/alternative-street-view";
import { InteractiveStreetView } from "@/components/listings/interactive-street-view";
import { useLocale } from "@/components/i18n/locale-provider";
import { AERIAL_IMAGERY_STYLE, OPENFREEMAP_POSITRON_STYLE, RASTER_STREET_STYLE } from "@/lib/map-style";
import { attachBasemapFallback, switchBasemapStyle, toggleFemaFloodOverlay } from "@/lib/map-controller";
import { inspectParcelBoundaryInputs } from "@/lib/listing-map-policy";
import { fetchParcelBoundaryCached } from "@/lib/parcel-boundary-cache";
import "maplibre-gl/dist/maplibre-gl.css";

type ListingMediaProps = {
  listingId?: string | null;
  address: string;
  state?: string | null;
  county?: string | null;
  apn?: string | null;
  propType?: string | null;
  source?: string | null;
  photo?: string | null;
  gallery?: string[];
  lat?: number | null;
  lng?: number | null;
  locationDisclosure?: string;
  photoOrigin?: "publisher" | "secondary";
  photoProvider?: string | null;
  photoSourceUrl?: string | null;
  sourceLabel?: string | null;
};

type MediaMode = "photo" | "streetview" | "map";
type MapLayer = "vector" | "aerial";

type StreetViewState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "available"; metadata: StreetViewMetadata }
  | { status: "unavailable"; reason: string };

type ParcelBoundaryPayload = {
  type?: unknown;
  geometry?: {
    type?: unknown;
    coordinates?: unknown;
  } | null;
  properties?: Record<string, unknown> | null;
};

const AERIAL_STYLE: StyleSpecification = AERIAL_IMAGERY_STYLE;

function computeGeometryBounds(
  geometry: { type?: unknown; coordinates?: unknown } | null | undefined,
): [[number, number], [number, number]] | null {
  if (!geometry || (geometry.type !== "Polygon" && geometry.type !== "MultiPolygon")) return null;
  let west = Number.POSITIVE_INFINITY;
  let south = Number.POSITIVE_INFINITY;
  let east = Number.NEGATIVE_INFINITY;
  let north = Number.NEGATIVE_INFINITY;
  let count = 0;

  const visitPoint = (point: unknown) => {
    if (!Array.isArray(point) || point.length < 2) return;
    const pointLng = Number(point[0]);
    const pointLat = Number(point[1]);
    if (!Number.isFinite(pointLng) || !Number.isFinite(pointLat)) return;
    if (Math.abs(pointLat) > 90 || Math.abs(pointLng) > 180) return;
    west = Math.min(west, pointLng);
    south = Math.min(south, pointLat);
    east = Math.max(east, pointLng);
    north = Math.max(north, pointLat);
    count += 1;
  };

  const rings = geometry.type === "Polygon"
    ? (Array.isArray(geometry.coordinates) ? geometry.coordinates : [])
    : (Array.isArray(geometry.coordinates) ? geometry.coordinates.flat(1) : []);

  for (const ring of rings) {
    if (!Array.isArray(ring)) continue;
    for (const point of ring) visitPoint(point);
  }

  if (count < 3 || !Number.isFinite(west) || !Number.isFinite(south) || !Number.isFinite(east) || !Number.isFinite(north)) {
    return null;
  }
  if (east <= west && north <= south) return null;
  return [[west, south], [east, north]];
}

function hasCoordinates(lat: number | null | undefined, lng: number | null | undefined) {
  return typeof lat === "number" && typeof lng === "number"
    && Number.isFinite(lat) && Number.isFinite(lng)
    && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
    && !(lat === 0 && lng === 0);
}

function publisherPhotoUrl(photo: string | null | undefined) {
  return safeImageUrl(photo) || null;
}

export function ListingMedia({ listingId, address, state, county, apn, propType, source, photo, gallery = [], lat, lng, locationDisclosure, photoOrigin = "publisher", photoProvider, photoSourceUrl, sourceLabel }: ListingMediaProps) {
  const { locale, messages: m } = useLocale();
  const canMap = hasCoordinates(lat, lng);
  const publisherPhoto = publisherPhotoUrl(photo);
  const photos = [...new Set([publisherPhoto, ...gallery.map(safeImageUrl)].filter((url): url is string => Boolean(url)))].slice(0, 12);
  const publisherMediaKey = photos.join("\u0000");
  const photoLabel = photoOrigin === "secondary" ? `${photoProvider || "Verified"} property photos` : "Publisher photo";
  const [photoIndex, setPhotoIndex] = React.useState(0);
  const [failedPhotoUrls, setFailedPhotoUrls] = React.useState<Set<string>>(() => new Set());
  const canShowPhoto = photos.length > 0;
  const publisherGalleryUnavailable = canShowPhoto && photos.every((url) => failedPhotoUrls.has(url));
  const normalizedListingId = typeof listingId === "string" ? listingId.trim() : "";
  const [mode, setMode] = React.useState<MediaMode>("photo");
  const [mapLayer, setMapLayer] = React.useState<MapLayer>("vector");
  const [floodOverlay, setFloodOverlay] = React.useState(false);
  const [streetView, setStreetView] = React.useState<StreetViewState>({ status: "idle" });
  const [aerialState, setAerialState] = React.useState<"idle" | "loading" | "ready" | "error">("idle");
  const [mapReady, setMapReady] = React.useState(false);
  const [mapUnavailable, setMapUnavailable] = React.useState(false);
  const mapContainerRef = React.useRef<HTMLDivElement>(null);
  const mapRef = React.useRef<MapLibreMap | null>(null);
  const markerRef = React.useRef<MapLibreMarker | null>(null);
  const mapLayerRef = React.useRef<MapLayer>("vector");
  const floodOverlayRef = React.useRef(false);
  const fallbackUsedRef = React.useRef(false);
  const initializedLayerRef = React.useRef<MapLayer | null>(null);
  const rehydrateOverlaysRef = React.useRef<(() => void) | null>(null);
  const streetViewRequestGeneration = React.useRef(0);
  const tabsId = React.useId().replace(/:/g, "");
  mapLayerRef.current = mapLayer;
  floodOverlayRef.current = floodOverlay;

  // The photo set and the Street View request are independent. Publisher media
  // often resolves AFTER the user clicks "Check Street View"; when one effect
  // owned both, that late arrival bumped the generation below, discarded the
  // in-flight response, and reset the card - so the click silently did nothing.
  // Photo changes now reset only the carousel.
  React.useEffect(() => {
    setPhotoIndex(0);
    setFailedPhotoUrls(new Set());
  }, [publisherMediaKey]);

  // The Street View request belongs to the listing, so only a change of listing
  // may cancel one.
  React.useEffect(() => {
    streetViewRequestGeneration.current++;
    setStreetView({ status: "idle" });
    setAerialState("idle");

    // Always begin in the photo slot. A map is useful context, but it must not
    // masquerade as a property image when the publisher supplied none.
    setMode("photo");
    setMapLayer("vector");

    return () => {
      streetViewRequestGeneration.current++;
    };
  }, [normalizedListingId]);

  React.useEffect(() => {
    if (mode !== "map" || !canMap || !mapContainerRef.current) return;

    let disposed = false;
    let timeoutId: number | null = null;
    let fallbackTimeoutId: number | null = null;
    let onCheckReady: (() => void) | null = null;
    const parcelAbortController = new AbortController();
    const isAerial = mapLayer === "aerial";
    setMapReady(false);
    setMapUnavailable(false);

    void import("maplibre-gl")
      .then((maplibre) => {
        if (disposed || !mapContainerRef.current) return;
        const center: [number, number] = [Number(lng), Number(lat)];
        const map = new maplibre.Map({
          container: mapContainerRef.current,
          style: isAerial ? AERIAL_STYLE : OPENFREEMAP_POSITRON_STYLE,
          center,
          zoom: isAerial ? 17 : 15,
          minZoom: 2,
          maxZoom: 19,
          attributionControl: false,
        });
        mapRef.current = map;
        map.addControl(new maplibre.NavigationControl({ showCompass: false }), "bottom-right");
        map.addControl(
          new maplibre.AttributionControl({
            compact: true,
            customAttribution: isAerial
              ? "Esri, USGS, USDA NAIP"
              : "OpenFreeMap · OpenStreetMap · CARTO",
          }),
          "bottom-left",
        );
        markerRef.current = new maplibre.Marker({ color: isAerial ? "#ff5533" : "#181529" })
          .setLngLat(center)
          .setPopup(new maplibre.Popup({ offset: 28 }).setText(address))
          .addTo(map);
        let fallbackApplied = false; let tileErrorAfterFallback = false;
        let parcelFetched = false;
        const switchToRasterFallback = () => {
          if (disposed || isAerial || fallbackApplied) return false;
          fallbackApplied = true;
          try {
            map.setStyle(RASTER_STREET_STYLE);
            return true;
          } catch {
            return false;
          }
        };
        const fetchParcelBoundary = () => {
          if (disposed || parcelFetched) return;
          parcelFetched = true;
          if (!normalizedListingId) return;
          const parcelPreflight = inspectParcelBoundaryInputs({
            id: normalizedListingId,
            state: state ?? undefined,
            county: county ?? undefined,
            apn: apn ?? undefined,
            lat: lat ?? undefined,
            lng: lng ?? undefined,
          });
          if (state && !parcelPreflight.eligible) return;

          void (async () => {
            try {
              const query = new URLSearchParams({ listingId: normalizedListingId });
              if (parcelPreflight.apn) query.set("apn", parcelPreflight.apn);
              if (parcelPreflight.state) query.set("state", parcelPreflight.state);
              if (parcelPreflight.county) query.set("county", parcelPreflight.county);
              if (parcelPreflight.lat !== null) query.set("lat", String(parcelPreflight.lat));
              if (parcelPreflight.lng !== null) query.set("lng", String(parcelPreflight.lng));
              const data = (await fetchParcelBoundaryCached(
                `/api/parcel-boundary?${query.toString()}`,
                normalizedListingId,
              )) as (ParcelBoundaryPayload & { __error?: string }) | null;
              if (!data || data.__error || disposed || parcelAbortController.signal.aborted) return;
              const geometryType = data?.geometry?.type;
              if (
                disposed
                || parcelAbortController.signal.aborted
                || mapRef.current !== map
                || (geometryType !== "Polygon" && geometryType !== "MultiPolygon")
              ) {
                return;
              }
              const feature: GeoJsonFeature = {
                type: "Feature",
                geometry: data!.geometry as GeoJsonFeature["geometry"],
                properties: data?.properties ?? {},
              };
              if (!map.getSource("parcel-boundary")) {
                map.addSource("parcel-boundary", { type: "geojson", data: feature });
              }
              if (!map.getLayer("parcel-boundary-fill")) {
                map.addLayer({
                  id: "parcel-boundary-fill",
                  type: "fill",
                  source: "parcel-boundary",
                  paint: {
                    "fill-color": "#ff5533",
                    "fill-opacity": 0.18,
                  },
                });
              }
              if (!map.getLayer("parcel-boundary-line")) {
                map.addLayer({
                  id: "parcel-boundary-line",
                  type: "line",
                  source: "parcel-boundary",
                  paint: {
                    "line-color": "#ff5533",
                    "line-width": 2.5,
                  },
                });
              }
              const bounds = computeGeometryBounds(data?.geometry);
              if (bounds) {
                const reduceMotion = typeof window !== "undefined"
                  && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
                map.fitBounds(bounds, {
                  padding: 48,
                  maxZoom: 18,
                  duration: reduceMotion ? 0 : 400,
                });
              }
            } catch {
              // Some states do not publish GIS parcel boundaries; fail silently.
            }
          })();
        };
        const markReady = () => {
          if (disposed || tileErrorAfterFallback) return;
          setMapReady(true);
          setMapUnavailable(false);
          fetchParcelBoundary();
        };
        const checkReady = () => {
          if (disposed) return;
          if (!tileErrorAfterFallback && (map.loaded() || (!fallbackApplied && map.isStyleLoaded()))) {
            markReady();
            map.off("styledata", checkReady);
            map.off("idle", checkReady);
          }
        };
        onCheckReady = checkReady;
        map.on("styledata", checkReady);
        map.on("idle", checkReady);
        map.once("load", markReady);
        map.on("error", () => {
          if (disposed || map.loaded()) return;
          if (fallbackApplied) {
            tileErrorAfterFallback = true; setMapUnavailable(true);
            return;
          }
          if (!switchToRasterFallback()) setMapUnavailable(true);
        });
        timeoutId = window.setTimeout(() => {
          if (disposed || map.loaded() || map.isStyleLoaded()) return;
          if (!switchToRasterFallback()) {
            tileErrorAfterFallback = true; setMapUnavailable(true);
          } else {
            fallbackTimeoutId = window.setTimeout(() => {
              if (!map.loaded() && !map.isStyleLoaded() && !disposed) setMapUnavailable(true);
            }, 5_000);
          }
        }, 3_500);
      })
      .catch(() => {
        if (!disposed) setMapUnavailable(true);
      });

    return () => {
      disposed = true;
      parcelAbortController.abort();
      if (timeoutId !== null) window.clearTimeout(timeoutId);
      if (fallbackTimeoutId !== null) window.clearTimeout(fallbackTimeoutId);
      if (onCheckReady && mapRef.current) {
        mapRef.current.off("styledata", onCheckReady);
        mapRef.current.off("idle", onCheckReady);
      }
      markerRef.current?.remove();
      markerRef.current = null;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [address, canMap, lat, lng, mapLayer, mode, normalizedListingId]);

  const availableModes: MediaMode[] = [
    "photo",
    "streetview",
    ...(canMap ? ["map" as const] : []),
  ];
  const hasAnyMedia = availableModes.length > 0;

  const selectMode = React.useCallback((nextMode: MediaMode) => {
    setMode(nextMode);
  }, []);

  const loadStreetView = React.useCallback(() => {
    if (!normalizedListingId || streetView.status === "loading") return;
    const requestGeneration = ++streetViewRequestGeneration.current;
    setMode("streetview");
    setStreetView({ status: "loading" });
    void requestStreetViewMetadata(normalizedListingId, { walkthrough: true })
      .then((result) => {
        if (requestGeneration !== streetViewRequestGeneration.current) return;
        if (!result.available) {
          setStreetView({ status: "unavailable", reason: result.reason });
          return;
        }
        setStreetView({ status: "available", metadata: result.metadata });
      })
      .catch(() => {
        if (requestGeneration !== streetViewRequestGeneration.current) return;
        setStreetView({
          status: "unavailable",
          reason: "Street View coverage could not be verified right now.",
        });
      });
  }, [normalizedListingId, streetView.status]);

  const handlePhotoError = React.useCallback(() => {
    const failedUrl = photos[photoIndex];
    if (!failedUrl) return;
    const nextFailedUrls = new Set(failedPhotoUrls);
    nextFailedUrls.add(failedUrl);
    setFailedPhotoUrls(nextFailedUrls);
    const nextIndex = photos.findIndex((url) => !nextFailedUrls.has(url));
    if (nextIndex >= 0) setPhotoIndex(nextIndex);
  }, [failedPhotoUrls, photoIndex, photos]);

  const movePhoto = React.useCallback((direction: 1 | -1) => {
    for (let offset = 1; offset <= photos.length; offset++) {
      const nextIndex = (photoIndex + direction * offset + photos.length) % photos.length;
      if (!failedPhotoUrls.has(photos[nextIndex])) {
        setPhotoIndex(nextIndex);
        return;
      }
    }
  }, [failedPhotoUrls, photoIndex, photos]);

  const handleTabKeyDown = React.useCallback((event: React.KeyboardEvent<HTMLButtonElement>, currentMode: MediaMode) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const currentIndex = availableModes.indexOf(currentMode);
    let nextIndex = currentIndex;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = availableModes.length - 1;
    if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % availableModes.length;
    if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + availableModes.length) % availableModes.length;
    const nextMode = availableModes[nextIndex];
    if (!nextMode) return;
    selectMode(nextMode);
    if (nextMode === "streetview" && streetView.status === "idle") loadStreetView();
    window.requestAnimationFrame(() => document.getElementById(`${tabsId}-${nextMode}-tab`)?.focus());
  }, [availableModes, loadStreetView, selectMode, streetView.status, tabsId]);

  const renderTab = (tabMode: MediaMode, label: string, icon: React.ReactNode) => (
    <button
      key={tabMode}
      id={`${tabsId}-${tabMode}-tab`}
      type="button"
      role="tab"
      aria-selected={mode === tabMode}
      aria-controls={`${tabsId}-${tabMode}-panel`}
      tabIndex={mode === tabMode ? 0 : -1}
      onClick={() => {
        selectMode(tabMode);
        if (tabMode === "streetview" && streetView.status === "idle") loadStreetView();
      }}
      onKeyDown={(event) => handleTabKeyDown(event, tabMode)}
      className={`inline-flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 ${
        mode === tabMode ? "border-ink text-ink" : "border-transparent text-ink-3 hover:text-ink"
      }`}
    >
      {icon} {label}
    </button>
  );

  return (
    <div
      data-testid="listing-media"
      className="relative h-[340px] overflow-hidden bg-paper sm:h-[460px]"
    >
      {hasAnyMedia ? (
        <div
          role="tablist"
          aria-label="Property media"
          className="absolute inset-x-0 bottom-0 z-20 flex border-t border-line bg-card px-4 py-2"
        >
          {renderTab("photo", canShowPhoto && locale === "en" ? photoLabel : m.detailUi.mediaPhotoTab, <ImageIcon className="h-3.5 w-3.5" aria-hidden />)}
          {renderTab("streetview", m.detailUi.mediaStreetTab, <Camera className="h-3.5 w-3.5" aria-hidden />)}
          {canMap ? renderTab("map", m.detailUi.mediaMapTab, <MapIcon className="h-3.5 w-3.5" aria-hidden />) : null}
        </div>
      ) : null}

      {mode === "photo" ? (
        <div
          id={`${tabsId}-photo-panel`}
          role="tabpanel"
          aria-labelledby={`${tabsId}-photo-tab`}
          className="relative h-[calc(100%-56px)] w-full"
        >
          {(!canShowPhoto || publisherGalleryUnavailable) ? (
            <div className="relative h-full w-full">
              {(aerialState === "loading" || aerialState === "ready") && normalizedListingId ? (
                <>
                  <img
                    src={`/api/property-image?listingId=${encodeURIComponent(normalizedListingId)}&mode=aerial`}
                    alt={`Aerial parcel imagery for ${address}`}
                    className={`h-full w-full object-cover transition-opacity ${aerialState === "loading" ? "opacity-60" : "opacity-100"}`}
                    onLoad={() => setAerialState("ready")}
                    onError={() => setAerialState("error")}
                  />
                  <span className="absolute left-3 top-3 rounded-control bg-ink/85 px-2.5 py-1 text-label font-semibold text-white backdrop-blur sm:left-4 sm:top-4 sm:px-3 sm:py-1.5">
                    {aerialState === "loading" ? "Loading Esri / USGS NAIP aerial view…" : "Esri / USGS NAIP aerial parcel view · Overhead satellite context"}
                  </span>
                </>
              ) : (
                <PropertyEvidenceVisual
                  listingId={normalizedListingId}
                  address={address}
                  propType={propType}
                  source={source}
                  statusLabel={canShowPhoto ? "publisher media unavailable" : "source media open"}
                />
              )}
              <div className="absolute bottom-3 right-3 z-10 flex max-w-[min(92%,28rem)] flex-col items-end gap-1.5 sm:bottom-5 sm:right-5 sm:gap-2">
                {(normalizedListingId || canMap) ? (
                  <div className="flex flex-wrap items-center justify-end gap-1.5 sm:gap-2">
                    {normalizedListingId ? (
                      <button
                        type="button"
                        disabled={aerialState === "loading"}
                        aria-pressed={aerialState === "ready"}
                        onClick={() => setAerialState((prev) => (prev === "ready" ? "idle" : "loading"))}
                        className="inline-flex min-h-11 items-center gap-1.5 rounded-control border border-white/70 bg-card/95 px-3 py-2 text-xs font-bold text-ink shadow-xl backdrop-blur hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-ink disabled:opacity-60 sm:gap-2 sm:px-4 sm:py-2.5 sm:text-sm"
                      >
                        <ImageIcon className="h-3.5 w-3.5" aria-hidden /> {aerialState === "loading" ? "Loading aerial…" : aerialState === "ready" ? "Hide aerial view" : "Aerial satellite view"}
                      </button>
                    ) : null}
                    {normalizedListingId ? (
                      <button
                        type="button"
                        disabled={streetView.status === "loading"}
                        onClick={loadStreetView}
                        className="inline-flex min-h-11 items-center gap-1.5 rounded-control border border-white/70 bg-card/95 px-3 py-2 text-xs font-bold text-ink shadow-xl backdrop-blur hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-ink disabled:opacity-60 sm:gap-2 sm:px-4 sm:py-2.5 sm:text-sm"
                      >
                        <Camera className="h-3.5 w-3.5" aria-hidden /> {streetView.status === "loading" ? m.detailUi.mediaCheckingStreetView : streetView.status === "unavailable" ? m.detailUi.mediaRetryStreetView : m.detailUi.mediaCheckStreetView}
                      </button>
                    ) : null}
                    {canMap ? (
                      <button
                        type="button"
                        onClick={() => selectMode("map")}
                        className="inline-flex min-h-11 items-center gap-1.5 rounded-control border border-white/70 bg-card/95 px-3 py-2 text-xs font-bold text-ink shadow-xl backdrop-blur hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-ink sm:gap-2 sm:px-4 sm:py-2.5 sm:text-sm"
                      >
                        <MapIcon className="h-3.5 w-3.5" aria-hidden /> {m.detailUi.mediaPropertyMap}
                      </button>
                    ) : null}
                  </div>
                ) : null}
                {aerialState === "error" ? <p role="status" className="rounded-control bg-ink/90 px-3 py-2 text-right text-xs leading-snug text-white shadow-lg backdrop-blur">Aerial satellite imagery could not be loaded for this location.</p> : null}
                {streetView.status === "unavailable" ? <p role="status" className="rounded-control bg-ink/90 px-3 py-2 text-right text-xs leading-snug text-white shadow-lg backdrop-blur">{streetView.reason}</p> : null}
              </div>
            </div>
          ) : <img src={photos[photoIndex] || publisherPhoto || undefined} alt={`${photoLabel} ${photoIndex + 1} of ${address}`} referrerPolicy="no-referrer" className="h-full w-full object-contain" onError={handlePhotoError} />}
          {canShowPhoto && !publisherGalleryUnavailable ? <div className="absolute bottom-4 left-4 right-4 flex flex-col gap-2">
            {photos.length > 1 ? (
              <div className="flex items-center gap-1.5 overflow-x-auto rounded-control bg-ink/75 p-1.5 backdrop-blur" aria-label="Property gallery thumbnails">
                {photos.map((thumbUrl, idx) => (
                  <button
                    key={thumbUrl}
                    type="button"
                    aria-label={`Show photo ${idx + 1} of ${photos.length}`}
                    aria-current={photoIndex === idx ? "true" : undefined}
                    onClick={() => setPhotoIndex(idx)}
                    className={`relative h-9 w-12 shrink-0 overflow-hidden rounded border transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white ${photoIndex === idx ? "border-white ring-1 ring-white" : "border-white/30 opacity-75 hover:opacity-100"}`}
                  >
                    {failedPhotoUrls.has(thumbUrl) ? (
                      <span className="grid h-full w-full place-items-center bg-paper text-meta font-bold text-ink-3">{idx + 1}</span>
                    ) : (
                      <img
                        src={thumbUrl}
                        alt=""
                        referrerPolicy="no-referrer"
                        className="h-full w-full object-cover"
                        loading="lazy"
                        onError={() => setFailedPhotoUrls((prev) => {
                          const next = new Set(prev);
                          next.add(thumbUrl);
                          return next;
                        })}
                      />
                    )}
                  </button>
                ))}
              </div>
            ) : null}
            <div className="flex items-center justify-between gap-3">
              <span className="rounded-control bg-ink/80 px-3 py-2 text-label font-bold text-white backdrop-blur">{photoLabel}{photos.length > 1 ? ` ${photoIndex + 1} / ${photos.length}` : ""}{photoOrigin === "secondary" ? " · Exact-address matched" : ""}</span>
              {photos.length > 1 ? <div className="flex gap-2">
                <button type="button" aria-label="Previous property photo" className="rounded-control bg-card px-3 py-2 text-xs font-bold shadow focus-visible:ring-2 focus-visible:ring-ink" onClick={() => movePhoto(-1)}>{m.detailUi.mediaPreviousPhoto}</button>
                <button type="button" aria-label="Next property photo" className="rounded-control bg-card px-3 py-2 text-xs font-bold shadow focus-visible:ring-2 focus-visible:ring-ink" onClick={() => movePhoto(1)}>{m.detailUi.mediaNextPhoto}</button>
              </div> : null}
            </div>
          </div> : null}
          {photoOrigin === "secondary" && photoSourceUrl ? <a href={photoSourceUrl} target="_blank" rel="noreferrer" className="absolute bottom-16 right-4 z-10 rounded-control bg-card/90 px-3 py-2 text-label font-semibold text-ink underline shadow-sm hover:text-ink-2">Source record</a> : null}
        </div>
      ) : mode === "streetview" ? (
        <div
          id={`${tabsId}-streetview-panel`}
          role="tabpanel"
          aria-labelledby={`${tabsId}-streetview-tab`}
          data-testid="street-view-panel"
          className="flex h-[calc(100%-56px)] w-full flex-col bg-line"
        >
          {streetView.status === "available" ? <>
            <div className="relative min-h-0 flex-1">
              <InteractiveStreetView listingId={normalizedListingId} address={address} sourceLabel={sourceLabel} metadata={streetView.metadata} onUnavailable={() => setStreetView({ status: "unavailable", reason: "Google Street View could not be opened." })} />
            </div>
            <div data-testid="street-view-disclosure" className="shrink-0 border-t border-white/10 bg-ink px-4 py-3 text-white">
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-label">
                <strong>{streetView.metadata.provider} · {streetView.metadata.attribution}</strong>
                <span>Starting panorama: {formatCaptureDate(streetView.metadata.captureDate)}</span>
                <span>{streetView.metadata.distanceMeters !== null
                  ? `Starting point: ${Math.round(streetView.metadata.distanceMeters)} m from matched property location`
                  : "Starting-point distance unavailable"}</span>
              </div>
              <p className="mt-1 text-label leading-relaxed text-white/75">
                {streetView.metadata.coverage === "nearby_street" ? "Nearby street coverage; this is not verified property frontage. " : "Street-level context only. "}Verify the facade and parcel against the publisher record before relying on this imagery.
              </p>
            </div>
          </> : streetView.status === "unavailable" && normalizedListingId ? <><div className="min-h-0 flex-1"><AlternativeStreetView key={normalizedListingId} listingId={normalizedListingId} address={address} onSelectMap={canMap ? () => selectMode("map") : undefined} /></div><div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-line bg-card px-4 py-2.5"><span className="text-xs text-ink-3">{streetView.reason || "Google Street View preview unavailable"}</span><div className="flex flex-wrap items-center gap-2"><a href={streetViewLaunchUrl(address, null, { lat, lng })} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-9 items-center gap-1.5 rounded-control bg-ink px-3 py-1.5 text-xs font-bold text-white transition-colors hover:bg-ink-2">{m.detailUi.mediaOpenGoogleMaps} <ExternalLink className="h-3.5 w-3.5" aria-hidden /></a><button type="button" onClick={loadStreetView} className="inline-flex min-h-9 items-center gap-1.5 rounded-control border border-line-strong bg-card px-3 py-1.5 text-xs font-semibold text-ink transition-colors hover:bg-paper">{m.detailUi.mediaRetryGoogleStreetView}</button>{canMap && <button type="button" onClick={() => selectMode("map")} className="inline-flex min-h-9 items-center gap-1.5 rounded-control border border-line-strong bg-card px-3 py-1.5 text-xs font-semibold text-ink-2 transition-colors hover:bg-paper"><MapIcon className="h-3.5 w-3.5" aria-hidden />{m.detailUi.mediaPropertyMap}</button>}</div></div></> : <div className="grid min-h-0 flex-1 place-items-center px-5 py-4 text-center"><div><Camera className="mx-auto h-7 w-7 text-ink-3" aria-hidden /><p className="mt-2 text-sm font-bold text-ink">Street View</p>{streetView.status === "unavailable" ? <p role="status" className="mt-2 max-w-md text-xs leading-relaxed text-ink-3">{streetView.reason}</p> : <p className="mt-2 max-w-md text-xs leading-relaxed text-ink-3">Check for available outdoor street imagery near this property.</p>}<div className="mt-3 flex flex-wrap justify-center gap-2">{normalizedListingId ? <button type="button" disabled={streetView.status === "loading"} onClick={loadStreetView} className="inline-flex min-h-10 items-center gap-2 rounded-control bg-ink px-3 py-2 text-xs font-bold text-white disabled:opacity-60"><Camera className="h-3.5 w-3.5" aria-hidden />{streetView.status === "loading" ? "Checking…" : streetView.status === "unavailable" ? "Check again" : "Check panorama"}</button> : null}{streetView.status === "unavailable" ? <a href={streetViewLaunchUrl(address, null, { lat, lng })} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-10 items-center gap-2 rounded-control border border-line-strong bg-card px-3 py-2 text-xs font-bold text-ink">{m.detailUi.mediaOpenGoogleMaps} <ExternalLink className="h-3.5 w-3.5" aria-hidden /></a> : null}{streetView.status === "unavailable" && canMap ? <button type="button" onClick={() => selectMode("map")} className="inline-flex min-h-10 items-center gap-2 rounded-control border border-line-strong bg-card px-3 py-2 text-xs font-bold text-ink"><MapIcon className="h-3.5 w-3.5" aria-hidden />{m.detailUi.mediaPropertyMap}</button> : null}</div></div></div>}
        </div>
      ) : mode === "map" && canMap ? (
        <div
          id={`${tabsId}-map-panel`}
          role="tabpanel"
          aria-labelledby={`${tabsId}-map-tab`}
          className="relative h-[calc(100%-56px)] w-full"
        >
          <div ref={mapContainerRef} aria-label={`Interactive map for ${address}`} className="h-full w-full" />
          {locationDisclosure && (
            <p className="pointer-events-none absolute bottom-12 left-4 right-14 z-10 rounded-control bg-ink/85 px-3 py-2 text-label leading-relaxed text-white" role="note">
              {locationDisclosure}
            </p>
          )}
          {!mapReady && !mapUnavailable ? (
            <div className="pointer-events-none absolute inset-0 grid place-items-center bg-paper/70 text-sm font-semibold text-ink-3">
              {m.detailUi.mediaLoadingMap}
            </div>
          ) : null}
          {mapUnavailable ? (
            <div className="absolute inset-0 grid place-items-center bg-paper px-6 text-center">
              <div><MapPin className="mx-auto h-7 w-7 text-ink-3" aria-hidden /><p className="mt-3 text-sm font-bold text-ink-2">{m.detailUi.mediaMapUnavailable}</p><p className="mt-1 text-xs text-ink-3">The stored coordinates remain attached to this record.</p></div>
            </div>
          ) : null}
          <div
            role="group"
            aria-label="Map layer"
            className="absolute left-4 top-4 z-10 inline-flex rounded-control border border-line bg-card/95 p-1 shadow-md backdrop-blur"
          >
            <button
              type="button"
              aria-pressed={mapLayer === "vector"}
              onClick={() => setMapLayer("vector")}
              className={`min-h-9 rounded-control px-2.5 py-1 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink ${
                mapLayer === "vector"
                  ? "bg-ink text-white"
                  : "text-ink-2 hover:bg-paper hover:text-ink"
              }`}
            >
              Vector
            </button>
            <button
              type="button"
              aria-pressed={mapLayer === "aerial"}
              onClick={() => setMapLayer("aerial")}
              className={`min-h-9 rounded-control px-2.5 py-1 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink ${
                mapLayer === "aerial"
                  ? "bg-ink text-white"
                  : "text-ink-2 hover:bg-paper hover:text-ink"
              }`}
            >
              Aerial
            </button>
          </div>
          {!canShowPhoto && normalizedListingId ? (
            <div className="absolute right-4 top-4 z-10 rounded-control border border-white/70 bg-card/90 p-2 shadow backdrop-blur">
              <button type="button" disabled={streetView.status === "loading"} onClick={loadStreetView} className="inline-flex items-center gap-2 rounded-control px-2 py-1 text-label font-semibold text-ink-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-3 disabled:opacity-60">
                <Camera className="h-3.5 w-3.5" aria-hidden /> {streetView.status === "loading" ? m.detailUi.mediaCheckingStreetView : streetView.status === "unavailable" ? m.detailUi.mediaRetryStreetView : m.detailUi.mediaCheckStreetView}
              </button>
              {streetView.status === "unavailable" ? <p role="status" className="mt-1 max-w-52 text-meta leading-snug text-ink-3">{streetView.reason}</p> : null}
            </div>
          ) : null}
        </div>
      ) : (
        <div className="grid h-[calc(100%-56px)] place-items-center px-6 text-center">
          <div>
            <MapPin className="mx-auto h-8 w-8 text-ink-3" aria-hidden />
            <p className="mt-3 text-sm font-bold text-ink-2">{m.detailUi.mediaNoPhotoOrCoords}</p>
            <p className="mt-1 text-xs text-ink-3">{streetView.status === "unavailable" ? streetView.reason : m.detailUi.mediaNoSubstitute}</p>
            {normalizedListingId ? <button type="button" disabled={streetView.status === "loading"} onClick={loadStreetView} className="mt-4 inline-flex items-center gap-2 rounded-control border border-line-strong bg-card px-3 py-2 text-xs font-bold text-ink-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-3 disabled:opacity-60"><Camera className="h-3.5 w-3.5" aria-hidden /> {streetView.status === "loading" ? m.detailUi.mediaCheckingStreetView : streetView.status === "unavailable" ? m.detailUi.mediaRetryStreetView : m.detailUi.mediaCheckStreetView}</button> : null}
          </div>
        </div>
      )}
    </div>
  );
}
