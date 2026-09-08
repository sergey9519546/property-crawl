"use client";

import * as React from "react";
import { Camera, ExternalLink, Image as ImageIcon, Map as MapIcon, MapPin } from "lucide-react";
import type { Map as MapLibreMap, Marker as MapLibreMarker } from "maplibre-gl";
import { safeImageUrl } from "@/lib/listing-display";
import { requestStreetViewMetadata, formatCaptureDate, streetViewLaunchUrl, type StreetViewMetadata } from "@/lib/street-view-client";
import { PropertyEvidenceVisual } from "@/components/listings/property-evidence-visual";
import { InteractiveStreetView } from "@/components/listings/interactive-street-view";

type ListingMediaProps = {
  listingId?: string | null;
  address: string;
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

type StreetViewState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "available"; metadata: StreetViewMetadata }
  | { status: "unavailable"; reason: string };

function hasCoordinates(lat: number | null | undefined, lng: number | null | undefined) {
  return typeof lat === "number" && typeof lng === "number"
    && Number.isFinite(lat) && Number.isFinite(lng)
    && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
    && !(lat === 0 && lng === 0);
}

function publisherPhotoUrl(photo: string | null | undefined) {
  return safeImageUrl(photo) || null;
}

export function ListingMedia({ listingId, address, photo, gallery = [], lat, lng, locationDisclosure, photoOrigin = "publisher", photoProvider, photoSourceUrl, sourceLabel }: ListingMediaProps) {
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
  const [mode, setMode] = React.useState<MediaMode>(canShowPhoto ? "photo" : "map");
  const [streetView, setStreetView] = React.useState<StreetViewState>({ status: "idle" });
  const [mapReady, setMapReady] = React.useState(false);
  const [mapUnavailable, setMapUnavailable] = React.useState(false);
  const mapContainerRef = React.useRef<HTMLDivElement>(null);
  const mapRef = React.useRef<MapLibreMap | null>(null);
  const markerRef = React.useRef<MapLibreMarker | null>(null);
  const streetViewRequestGeneration = React.useRef(0);
  const tabsId = React.useId().replace(/:/g, "");

  React.useEffect(() => {
    streetViewRequestGeneration.current++;
    setPhotoIndex(0);
    setFailedPhotoUrls(new Set());
    setStreetView({ status: "idle" });

    // Always begin in the photo slot. A map is useful context, but it must not
    // masquerade as a property image when the publisher supplied none.
    setMode("photo");

    return () => {
      streetViewRequestGeneration.current++;
    };
  }, [canMap, canShowPhoto, normalizedListingId, publisherMediaKey]);

  React.useEffect(() => {
    if (mode !== "map" || !canMap || !mapContainerRef.current) return;

    let disposed = false;
    let timeoutId: number | null = null;
    setMapReady(false);
    setMapUnavailable(false);

    void import("maplibre-gl")
      .then((maplibre) => {
        if (disposed || !mapContainerRef.current) return;
        const center: [number, number] = [Number(lng), Number(lat)];
        const map = new maplibre.Map({
          container: mapContainerRef.current,
          style: "https://tiles.openfreemap.org/styles/positron",
          center,
          zoom: 15,
          minZoom: 2,
          maxZoom: 19,
          attributionControl: false,
        });
        mapRef.current = map;
        map.addControl(new maplibre.NavigationControl({ showCompass: false }), "bottom-right");
        map.addControl(
          new maplibre.AttributionControl({
            compact: true,
            customAttribution: "OpenFreeMap · OpenStreetMap contributors",
          }),
          "bottom-left",
        );
        markerRef.current = new maplibre.Marker({ color: "#0f172a" })
          .setLngLat(center)
          .setPopup(new maplibre.Popup({ offset: 28 }).setText(address))
          .addTo(map);
        map.once("load", () => {
          if (!disposed) setMapReady(true);
        });
        map.on("error", () => {
          if (!map.loaded() && !disposed) setMapUnavailable(true);
        });
        timeoutId = window.setTimeout(() => {
          if (!map.loaded() && !disposed) setMapUnavailable(true);
        }, 7_000);
      })
      .catch(() => {
        if (!disposed) setMapUnavailable(true);
      });

    return () => {
      disposed = true;
      if (timeoutId !== null) window.clearTimeout(timeoutId);
      markerRef.current?.remove();
      markerRef.current = null;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [address, canMap, lat, lng, mode]);

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
    setStreetView({ status: "loading" });
    void requestStreetViewMetadata(normalizedListingId,{walkthrough:true})
      .then((result) => {
        if (requestGeneration !== streetViewRequestGeneration.current) return;
        if (!result.available) {
          setStreetView({ status: "unavailable", reason: result.reason });
          return;
        }
        setStreetView({ status: "available", metadata: result.metadata });
        setMode("streetview");
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
      className={`inline-flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 ${
        mode === tabMode ? "border-slate-900 text-slate-950" : "border-transparent text-slate-600 hover:text-slate-950"
      }`}
    >
      {icon} {label}
    </button>
  );

  return (
    <div
      data-testid="listing-media"
      className={`relative overflow-hidden bg-slate-50 sm:h-[460px] ${mode === "streetview" ? "h-[440px]" : "h-[320px]"}`}
    >
      {hasAnyMedia ? (
        <div
          role="tablist"
          aria-label="Property media"
          className="absolute inset-x-0 bottom-0 z-20 flex border-t border-slate-200 bg-white px-4 py-2"
        >
          {renderTab("photo", canShowPhoto ? photoLabel : "Photos", <ImageIcon className="h-3.5 w-3.5" aria-hidden />)}
          {renderTab("streetview", "Exterior Walkthrough", <Camera className="h-3.5 w-3.5" aria-hidden />)}
          {canMap ? renderTab("map", "Map", <MapIcon className="h-3.5 w-3.5" aria-hidden />) : null}
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
              <PropertyEvidenceVisual
                listingId={normalizedListingId}
                address={address}
                statusLabel={canShowPhoto ? "publisher media unavailable" : "source media open"}
              />
              <div className="absolute bottom-5 right-5 flex max-w-[min(88%,28rem)] flex-col items-end gap-2">
                {normalizedListingId ? (
                  <button
                    type="button"
                    disabled={streetView.status === "loading"}
                    onClick={loadStreetView}
                    className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-white/70 bg-white/95 px-4 py-2.5 text-sm font-bold text-slate-900 shadow-xl backdrop-blur hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900 disabled:opacity-60"
                  >
                    <Camera className="h-3.5 w-3.5" aria-hidden /> {streetView.status === "loading" ? "Checking Street View…" : streetView.status === "unavailable" ? "Retry Street View" : "Check Street View"}
                  </button>
                ) : null}
                {streetView.status === "unavailable" ? <p role="status" className="rounded-xl bg-slate-950/90 px-3 py-2 text-right text-xs leading-snug text-white shadow-lg backdrop-blur">{streetView.reason}</p> : null}
              </div>
            </div>
          ) : <img src={photos[photoIndex] || publisherPhoto || undefined} alt={`${photoLabel} ${photoIndex + 1} of ${address}`} className="h-full w-full object-contain" onError={handlePhotoError} />}
          {canShowPhoto && !publisherGalleryUnavailable ? <div className="absolute bottom-4 left-4 right-4 flex items-center justify-between gap-3">
            <span className="rounded-xl bg-slate-950/80 px-3 py-2 text-[11px] font-bold text-white backdrop-blur">{photoLabel}{photos.length > 1 ? ` ${photoIndex + 1} / ${photos.length}` : ""}{photoOrigin === "secondary" ? " · Exact-address matched" : ""}</span>
            {photos.length > 1 ? <div className="flex gap-2">
              <button type="button" aria-label="Previous property photo" className="rounded-xl bg-white px-3 py-2 text-xs font-bold shadow focus-visible:ring-2 focus-visible:ring-slate-900" onClick={() => movePhoto(-1)}>Previous</button>
              <button type="button" aria-label="Next property photo" className="rounded-xl bg-white px-3 py-2 text-xs font-bold shadow focus-visible:ring-2 focus-visible:ring-slate-900" onClick={() => movePhoto(1)}>Next</button>
            </div> : null}
          </div> : null}
          {photoOrigin === "secondary" && photoSourceUrl ? <a href={photoSourceUrl} target="_blank" rel="noreferrer" className="absolute bottom-16 right-4 z-10 rounded-xl bg-white/90 px-3 py-2 text-[11px] font-semibold text-slate-900 underline shadow-sm hover:text-slate-700">Source record</a> : null}
        </div>
      ) : mode === "streetview" ? (
        <div
          id={`${tabsId}-streetview-panel`}
          role="tabpanel"
          aria-labelledby={`${tabsId}-streetview-tab`}
          data-testid="street-view-panel"
          className="flex h-[calc(100%-56px)] w-full flex-col bg-slate-200"
        >
          {streetView.status === "available" ? <>
            <div className="relative min-h-0 flex-1">
              <InteractiveStreetView address={address} sourceLabel={sourceLabel} metadata={streetView.metadata} />
            </div>
            <div data-testid="street-view-disclosure" className="shrink-0 border-t border-slate-800 bg-slate-950 px-4 py-3 text-white">
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-[11px]">
                <strong>{streetView.metadata.provider} · {streetView.metadata.attribution}</strong>
                <span>Starting panorama: {formatCaptureDate(streetView.metadata.captureDate)}</span>
                <span>{streetView.metadata.distanceMeters !== null
                  ? `Starting point: ${Math.round(streetView.metadata.distanceMeters)} m from matched property location`
                  : "Starting-point distance unavailable"}</span>
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-slate-200">
                {streetView.metadata.coverage === "nearby_street" ? "Nearby street coverage; this is not verified property frontage. " : "Street-level context only. "}Verify the facade and parcel against the publisher record before relying on this imagery.
              </p>
            </div>
          </> : <div className="grid min-h-0 flex-1 place-items-center px-5 py-4 text-center"><div><Camera className="mx-auto h-7 w-7 text-slate-400" aria-hidden/><p className="mt-2 text-sm font-bold text-slate-900">Exterior walkthrough</p>{streetView.status === "unavailable" ? <p role="status" className="mt-2 max-w-md text-xs leading-relaxed text-slate-600">{streetView.reason}</p> : <p className="mt-2 max-w-md text-xs leading-relaxed text-slate-600">Check for available outdoor street imagery near this property.</p>}<div className="mt-3 flex flex-wrap justify-center gap-2">{normalizedListingId?<button type="button" disabled={streetView.status === "loading"} onClick={loadStreetView} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-slate-950 px-3 py-2 text-xs font-bold text-white disabled:opacity-60"><Camera className="h-3.5 w-3.5" aria-hidden/>{streetView.status === "loading" ? "Checking…" : streetView.status === "unavailable" ? "Check again" : "Check panorama"}</button>:null}{streetView.status === "unavailable" ? <a href={streetViewLaunchUrl(address)} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-900">Open in Google Maps <ExternalLink className="h-3.5 w-3.5" aria-hidden/></a> : null}{streetView.status === "unavailable" && canMap ? <button type="button" onClick={()=>selectMode("map")} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-900"><MapIcon className="h-3.5 w-3.5" aria-hidden/>Property map</button> : null}</div></div></div>}
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
            <p className="pointer-events-none absolute bottom-12 left-4 right-14 z-10 rounded-xl bg-slate-950/85 px-3 py-2 text-[11px] leading-relaxed text-white" role="note">
              {locationDisclosure}
            </p>
          )}
          {!mapReady && !mapUnavailable ? (
            <div className="pointer-events-none absolute inset-0 grid place-items-center bg-slate-100/70 text-sm font-semibold text-slate-500">
              Loading map…
            </div>
          ) : null}
          {mapUnavailable ? (
            <div className="absolute inset-0 grid place-items-center bg-slate-100 px-6 text-center">
              <div><MapPin className="mx-auto h-7 w-7 text-slate-400" aria-hidden /><p className="mt-3 text-sm font-bold text-slate-700">Map tiles are unavailable</p><p className="mt-1 text-xs text-slate-500">The stored coordinates remain attached to this record.</p></div>
            </div>
          ) : null}
          {!canShowPhoto && normalizedListingId ? (
            <div className="absolute right-4 top-4 z-10 rounded-lg border border-white/70 bg-white/90 p-2 shadow backdrop-blur">
              <button type="button" disabled={streetView.status === "loading"} onClick={loadStreetView} className="inline-flex items-center gap-2 rounded-xl px-2 py-1 text-[11px] font-semibold text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 disabled:opacity-60">
                <Camera className="h-3.5 w-3.5" aria-hidden /> {streetView.status === "loading" ? "Checking Street View…" : streetView.status === "unavailable" ? "Retry Street View" : "Check Street View"}
              </button>
              {streetView.status === "unavailable" ? <p role="status" className="mt-1 max-w-52 text-[10px] leading-snug text-slate-500">{streetView.reason}</p> : null}
            </div>
          ) : null}
        </div>
      ) : (
        <div className="grid h-[calc(100%-56px)] place-items-center px-6 text-center">
          <div>
            <MapPin className="mx-auto h-8 w-8 text-slate-400" aria-hidden />
            <p className="mt-3 text-sm font-bold text-slate-700">No source photo or coordinates</p>
            <p className="mt-1 text-xs text-slate-500">{streetView.status === "unavailable" ? streetView.reason : "No substitute property image is shown."}</p>
            {normalizedListingId ? <button type="button" disabled={streetView.status === "loading"} onClick={loadStreetView} className="mt-4 inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 disabled:opacity-60"><Camera className="h-3.5 w-3.5" aria-hidden /> {streetView.status === "loading" ? "Checking Street View…" : streetView.status === "unavailable" ? "Retry Street View" : "Check Street View"}</button> : null}
          </div>
        </div>
      )}
    </div>
  );
}
