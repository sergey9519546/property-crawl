"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, ExternalLink, Loader2 } from "lucide-react";
import { safeImageUrl } from "@/lib/listing-display";
import { getPropertyPlaceholder } from "@/lib/property-placeholders";
import {
  fetchAlternativeStreetView,
  parseAlternativeCandidate,
  type AlternativeCandidate,
  type AlternativeImageryPayload,
} from "@/lib/panoramax-client";
import { formatCaptureDate, requestStreetViewMetadata, type StreetViewMetadata } from "@/lib/street-view-client";
import { useLocale } from "@/components/i18n/locale-provider";
import type { Messages } from "@/lib/i18n/messages";

function buildAlternativeMetadata(chosen: AlternativeCandidate, t: Messages["mediaUi"]): StreetViewMetadata {
  return {
    provider: chosen.attribution.provider,
    attribution: chosen.attribution.producer
      ? `${chosen.attribution.provider} · ${chosen.attribution.producer}`
      : chosen.attribution.provider,
    captureDate: chosen.capturedAt ? chosen.capturedAt.slice(0, 7) : null,
    distanceMeters: chosen.distanceMeters,
    panoramaId: null,
    panoramaLocation: null,
    heading: null,
    mapsLaunchUrl: null,
    coverage: "community_alternative",
    targetLabel: chosen.mediaType === "panorama_360" ? t.panorama360 : t.directionalPhotos,
    fallbackProvider: chosen.provider,
  };
}

type Props = { listingId: string; address: string; propType?: string | null; source?: string | null; photo?: string | null; photoCount?: number; observed: boolean; photoProvider?: string | null; photoSourceUrl?: string | null; layout?: "fill" | "card" };

export function ListingThumbnail({ listingId, address, propType, source, photo, photoCount, observed, photoProvider, photoSourceUrl, layout = "fill" }: Props) {
  const placeholder = getPropertyPlaceholder(propType, { address, source });
  const { messages, format } = useLocale();
  const t = messages.mediaUi;
  const publisherPhoto = safeImageUrl(photo);
  const [photoFailed, setPhotoFailed] = useState(false);
  const [altImageFailed, setAltImageFailed] = useState(false);
  const [status, setStatus] = useState<"idle" | "loading" | "image" | "loaded" | "aerial" | "aerial_loaded" | "unavailable">("idle");
  const [altLoading, setAltLoading] = useState(false);
  const [metadata, setMetadata] = useState<StreetViewMetadata | null>(null);
  const [alternative, setAlternative] = useState<AlternativeCandidate | null>(null);
  const [altPayload, setAltPayload] = useState<AlternativeImageryPayload | null>(null);
  const [reason, setReason] = useState("");
  const generation = useRef(0);
  const frame = layout === "card" ? "relative aspect-[4/3] w-full shrink-0 overflow-hidden" : "relative min-h-0 flex-1 overflow-hidden";
  const caption = "flex min-h-14 shrink-0 flex-col justify-center border-b border-line bg-paper px-4 py-2 text-label leading-4 text-ink-3";
  useEffect(() => {
    generation.current++;
    setPhotoFailed(false);
    setAltImageFailed(false);
    setStatus("idle");
    setAltLoading(false);
    setMetadata(null);
    setAlternative(null);
    setAltPayload(null);
    setReason("");
    return () => { generation.current++; };
  }, [listingId, publisherPhoto]);

  function applyAlternativeCandidate(chosen: AlternativeCandidate) {
    setAltImageFailed(false);
    setAlternative(chosen);
    setMetadata(buildAlternativeMetadata(chosen, t));
    setStatus((chosen.provider === "mapillary" || chosen.provider === "panoramax") && chosen.thumbUrl ? "image" : "loaded");
  }

  async function loadStreetView() {
    const request = ++generation.current;
    setStatus("loading");
    setAltImageFailed(false);
    setAltPayload(null);
    try {
      const result = await requestStreetViewMetadata(listingId);
      if (request !== generation.current) return;
      if (!result.available) { setReason(result.reason); setStatus("unavailable"); return; }
      const parsedAlt = result.metadata.fallbackProvider
        ? parseAlternativeCandidate(result.metadata.alternativeCandidate)
        : null;
      if (result.metadata.fallbackProvider && !parsedAlt) {
        setReason(t.fallbackAltValidation);
        setStatus("unavailable");
        return;
      }
      setAlternative(parsedAlt);
      setMetadata(result.metadata);
      setStatus(parsedAlt && !((parsedAlt.provider === "mapillary" || parsedAlt.provider === "panoramax") && parsedAlt.thumbUrl) ? "loaded" : "image");
    } catch {
      if (request !== generation.current) return;
      setReason(t.coverageCheckError);
      setStatus("unavailable");
    }
  }

  async function loadAlternatives() {
    const request = ++generation.current;
    setAltLoading(true);
    setAltImageFailed(false);
    try {
      const result = await fetchAlternativeStreetView(listingId);
      if (request !== generation.current) return;
      if (!result.ok) {
        setReason(result.reason);
        setStatus("unavailable");
        return;
      }
      const chosen = result.data.panoramax || result.data.primary || result.data.mapillary;
      if (!chosen) {
        setAltPayload(null);
        setReason(result.data.unavailableReason);
        setStatus("unavailable");
        return;
      }
      setAltPayload(result.data);
      applyAlternativeCandidate(chosen);
    } catch {
      if (request !== generation.current) return;
      setReason(t.openImageryError);
      setStatus("unavailable");
    } finally {
      if (request === generation.current) setAltLoading(false);
    }
  }

  if (publisherPhoto && !photoFailed) {
    const countLabel = typeof photoCount === "number" && photoCount > 1
      ? format(t.photosGalleryCount, { count: photoCount })
      : typeof photoCount === "number" && photoCount === 1
        ? t.singlePublisherPhoto
        : t.openDetailsMedia;
    return (
      <div className="flex h-full w-full flex-col">
        <div className={frame}><img src={publisherPhoto} alt={format(t.publisherPhotoAlt, { provider: photoProvider || t.publisherFallback, address })} referrerPolicy="no-referrer" loading="lazy" decoding="async" className="absolute inset-0 h-full w-full object-cover" onError={() => setPhotoFailed(true)} /></div>
        {layout === "card" || (photoProvider && photoSourceUrl) ? <div className={caption}>{photoProvider && photoSourceUrl ? <a href={photoSourceUrl} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="underline underline-offset-2">{format(t.addressMatchedPhoto, { provider: photoProvider })}</a> : <span>{t.publisherPhotoLabel}</span>}<span className="text-ink-3">{countLabel}</span></div> : null}
      </div>
    );
  }

  if ((status === "image" || status === "loaded") && metadata && alternative) {
    const thumb = !altImageFailed ? alternative.thumbUrl : null;
    return (
      <div className="flex h-full flex-col bg-paper" data-testid="listing-thumbnail-streetview">
        <div className={`${frame} bg-paper`}>
          {thumb ? (
            <>
              <img
                src={thumb}
                alt={format(t.streetContextAlt, { provider: alternative.attribution.provider, address })}
                referrerPolicy="no-referrer"
                className={`absolute inset-0 h-full w-full object-contain ${status === "loaded" ? "" : "opacity-0"}`}
                onLoad={() => setStatus("loaded")}
                onError={() => setAltImageFailed(true)}
              />
              {status === "image" ? <p role="status" className="absolute inset-0 grid place-items-center text-xs text-ink-3">{t.loadingStreetContext}</p> : null}
            </>
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-5 text-center">
              <Camera size={22} className="text-ink-3" aria-hidden />
              <p className="text-xs font-semibold text-ink">
                {alternative.attribution.provider} · {alternative.mediaType === "panorama_360" ? t.panorama360 : t.directionalPhotos}
              </p>
              <a
                href={alternative.viewerUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-line-strong bg-card px-3 py-1.5 text-xs font-semibold text-ink underline-offset-2 hover:underline"
              >
                {format(t.openProviderViewer, { provider: alternative.attribution.provider })} <ExternalLink size={12} aria-hidden />
              </a>
            </div>
          )}
        </div>
        <div className={caption}>
          {altPayload?.panoramax && altPayload?.mapillary ? (
            <div className="mb-1.5 flex flex-wrap gap-1.5">
              {(["panoramax", "mapillary"] as const).map((provider) => {
                const candidate = provider === "panoramax" ? altPayload.panoramax : altPayload.mapillary;
                if (!candidate) return null;
                const active = alternative.provider === provider;
                return (
                  <button
                    key={provider}
                    type="button"
                    aria-pressed={active}
                    onClick={() => applyAlternativeCandidate(candidate)}
                    className={`rounded-md border px-2.5 py-1 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-3 ${
                      active ? "border-ink bg-ink text-white" : "border-line-strong bg-card text-ink-2"
                    }`}
                  >
                    {provider === "panoramax" ? "Panoramax" : "Mapillary"}
                  </button>
                );
              })}
            </div>
          ) : null}
          <p>
            {metadata.attribution} ·{" "}
            {alternative.license.url ? (
              <a href={alternative.license.url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="underline">
                {alternative.license.id || t.recordedLicense}
              </a>
            ) : (
              alternative.license.id || t.recordedLicense
            )}{" "}
            · {formatCaptureDate(metadata.captureDate)}
          </p>
          <p>
            {metadata.distanceMeters === null ? t.distanceUnavailable : format(t.distanceMetersFrom, { meters: Math.round(metadata.distanceMeters) })} · {t.streetContextOnly}
            {thumb ? (
              <>
                {" · "}
                <a href={alternative.viewerUrl} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="underline">
                  {t.openViewer}
                </a>
              </>
            ) : null}
          </p>
        </div>
      </div>
    );
  }

  if ((status === "image" || status === "loaded") && metadata) return (
    <div className="flex h-full flex-col bg-paper" data-testid="listing-thumbnail-streetview">
      <div className={frame}>
        <img src={`/api/property-image?listingId=${encodeURIComponent(listingId)}&mode=image`} alt={format(t.streetContextFallbackAlt, { address })} className={`absolute inset-0 h-full w-full object-contain ${status === "loaded" ? "" : "opacity-0"}`} onLoad={() => setStatus("loaded")} onError={() => { setReason(t.imageLoadError); setStatus("unavailable"); }} />
        {status === "image" && <p role="status" className="absolute inset-0 grid place-items-center text-xs text-ink-3">{t.loadingStreetContext}</p>}
      </div>
      <div className={caption}>
        <p>{metadata.attribution.includes(metadata.provider) ? metadata.attribution : `${metadata.provider} · ${metadata.attribution}`} · {formatCaptureDate(metadata.captureDate)}</p>
        <p>{metadata.distanceMeters === null ? t.distanceUnavailable : format(t.distanceMetersFrom, { meters: Math.round(metadata.distanceMeters) })} · {t.streetContextOnly}</p>
      </div>
    </div>
  );

  if (status === "aerial" || status === "aerial_loaded") {
    return (
      <div className="flex h-full flex-col bg-paper" data-testid="listing-thumbnail-aerial">
        <div className={frame}>
          <img
            src={`/api/property-image?listingId=${encodeURIComponent(listingId)}&mode=aerial`}
            alt={`Aerial satellite view for ${address}`}
            className={`absolute inset-0 h-full w-full object-cover ${status === "aerial_loaded" ? "" : "opacity-0"}`}
            onLoad={() => setStatus("aerial_loaded")}
            onError={() => {
              setReason("Aerial satellite imagery is unavailable for this location.");
              setStatus("unavailable");
            }}
          />
          {status === "aerial" ? <p role="status" className="absolute inset-0 grid place-items-center text-xs text-ink-3">Loading aerial parcel view…</p> : null}
        </div>
        <div className={caption}>
          <span>USGS National Map / USDA NAIP (Public Domain)</span>
          <span className="text-ink-3">Overhead satellite context · Not a publisher photo</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col" data-testid="listing-thumbnail-unavailable" data-placeholder-category={placeholder.category}>
      <div className={`${frame} bg-paper`}>
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-cover bg-center opacity-90"
          style={{ backgroundImage: `url("${placeholder.imageSrc}")` }}
        />
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-gradient-to-b from-paper/20 via-paper/55 to-paper/85" />
        <div className={layout === "fill" ? "relative z-10 flex h-full flex-col items-center justify-end gap-1.5 px-3 pb-2.5 pt-11 text-center" : "relative z-10 flex h-full flex-col items-center justify-end gap-1.5 px-4 pb-3 pt-12 text-center"}>
          <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-label font-semibold shadow-sm backdrop-blur-sm ${placeholder.accentClass}`}>
            {placeholder.typeLabel} · Placeholder
          </span>
          <p className="rounded bg-paper/80 px-2 py-0.5 text-xs font-semibold text-ink-2 backdrop-blur-sm">{t.photoUnavailable}</p>
          {observed ? (() => {
            // One label for both the visible text and the accessible name.
            // They used to be written separately and drifted: the aria-label
            // said "Load Street View" while the button read "Check Street
            // View", so the label named a different action than the one shown.
            const label =
              status === "loading" ? t.checkingCoverage
              : status === "unavailable" ? t.retryStreetView
              : t.checkStreetView;
            return (
              <div className="flex flex-wrap items-center justify-center gap-2">
                <button type="button" disabled={status === "loading" || altLoading} aria-label={format(t.actionForAddress, { action: label, address })} onClick={(e) => { e.preventDefault(); e.stopPropagation(); void loadStreetView(); }} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-line-strong bg-card px-3 py-2 text-xs font-semibold text-ink-2 transition hover:border-ink-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-3 disabled:opacity-60">
                  {status === "loading" ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Camera size={14} aria-hidden />}
                  {label}
                </button>
                <button type="button" disabled={status === "loading" || altLoading} aria-label={format(t.checkOpenImageryFor, { address })} onClick={(e) => { e.preventDefault(); e.stopPropagation(); void loadAlternatives(); }} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-line-strong bg-card px-3 py-2 text-xs font-semibold text-ink-2 transition hover:border-ink-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-3 disabled:opacity-60">
                  {altLoading ? <Loader2 size={14} className="animate-spin" aria-hidden /> : null}
                  {altLoading ? t.checkingOpenImagery : t.openProvidersBtn}
                </button>
                <button type="button" disabled={status === "loading" || altLoading} aria-label={`Load aerial view for ${address}`} onClick={(e) => { e.preventDefault(); e.stopPropagation(); setStatus("aerial"); }} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-line-strong bg-card px-3 py-2 text-xs font-semibold text-ink-2 transition hover:border-ink-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-3 disabled:opacity-60">
                  Aerial view
                </button>
              </div>
            );
          })() : null}
        </div>
      </div>
      {layout === "card" || status === "unavailable" ? <div className={caption}>{status === "unavailable" ? <p role="status">{reason}</p> : <><span>{photoFailed ? t.publisherPhotoFailed : t.noPublisherPhoto}</span><span className="text-ink-3">{observed ? t.streetViewDepends : t.seeSourceMedia}</span></>}</div> : null}
    </div>
  );
}
