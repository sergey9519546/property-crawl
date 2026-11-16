"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, ExternalLink, ImageOff, Loader2 } from "lucide-react";
import { safeImageUrl } from "@/lib/listing-display";
import {
  fetchAlternativeStreetView,
  parseAlternativeCandidate,
  type AlternativeCandidate,
  type AlternativeImageryPayload,
} from "@/lib/panoramax-client";
import { formatCaptureDate, requestStreetViewMetadata, type StreetViewMetadata } from "@/lib/street-view-client";

function buildAlternativeMetadata(chosen: AlternativeCandidate): StreetViewMetadata {
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
    targetLabel: chosen.mediaType === "panorama_360" ? "360 street panorama" : "Directional street photos",
    fallbackProvider: chosen.provider,
  };
}

type Props = { listingId: string; address: string; photo?: string | null; photoCount?: number; observed: boolean; photoProvider?: string | null; photoSourceUrl?: string | null; layout?: "fill" | "card" };

export function ListingThumbnail({ listingId, address, photo, photoCount, observed, photoProvider, photoSourceUrl, layout = "fill" }: Props) {
  const publisherPhoto = safeImageUrl(photo);
  const [photoFailed, setPhotoFailed] = useState(false);
  const [altImageFailed, setAltImageFailed] = useState(false);
  const [status, setStatus] = useState<"idle" | "loading" | "image" | "loaded" | "unavailable">("idle");
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
    setMetadata(buildAlternativeMetadata(chosen));
    setStatus(chosen.provider === "mapillary" && chosen.thumbUrl ? "image" : "loaded");
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
        setReason("Fallback street imagery could not be validated.");
        setStatus("unavailable");
        return;
      }
      setAlternative(parsedAlt);
      setMetadata(result.metadata);
      setStatus(parsedAlt && !(parsedAlt.provider === "mapillary" && parsedAlt.thumbUrl) ? "loaded" : "image");
    } catch {
      if (request !== generation.current) return;
      setReason("Coverage could not be checked. Try again later.");
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
      setReason("Open street imagery could not be checked right now.");
      setStatus("unavailable");
    } finally {
      if (request === generation.current) setAltLoading(false);
    }
  }

  if (publisherPhoto && !photoFailed) {
    const countLabel = typeof photoCount === "number" && photoCount > 1
      ? `${photoCount} photos · Review gallery in property details`
      : typeof photoCount === "number" && photoCount === 1
        ? "1 publisher photo · Open details for street view & map"
        : "Open property details for media & map";
    return (
      <div className="flex h-full w-full flex-col">
        <div className={frame}><img src={publisherPhoto} alt={`${photoProvider || "Publisher"} photo of ${address}`} loading="lazy" decoding="async" className="absolute inset-0 h-full w-full object-cover" onError={() => setPhotoFailed(true)} /></div>
        {layout === "card" || (photoProvider && photoSourceUrl) ? <div className={caption}>{photoProvider && photoSourceUrl ? <a href={photoSourceUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">{photoProvider} · Address-matched photo</a> : <span>Publisher photo</span>}<span className="text-ink-3">{countLabel}</span></div> : null}
      </div>
    );
  }

  if ((status === "image" || status === "loaded") && metadata && alternative) {
    const thumb = alternative.provider === "mapillary" && !altImageFailed ? alternative.thumbUrl : null;
    return (
      <div className="flex h-full flex-col bg-paper" data-testid="listing-thumbnail-streetview">
        <div className={`${frame} bg-paper`}>
          {thumb ? (
            <>
              <img
                src={thumb}
                alt={`${alternative.attribution.provider} street-level context near ${address}`}
                className={`absolute inset-0 h-full w-full object-contain ${status === "loaded" ? "" : "opacity-0"}`}
                onLoad={() => setStatus("loaded")}
                onError={() => setAltImageFailed(true)}
              />
              {status === "image" ? <p role="status" className="absolute inset-0 grid place-items-center text-xs text-ink-3">Loading street-level context…</p> : null}
            </>
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-5 text-center">
              <Camera size={22} className="text-ink-3" aria-hidden />
              <p className="text-xs font-semibold text-ink">
                {alternative.attribution.provider} · {alternative.mediaType === "panorama_360" ? "360 street panorama" : "Directional street photos"}
              </p>
              <a
                href={alternative.viewerUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-line-strong bg-card px-3 py-1.5 text-xs font-semibold text-ink underline-offset-2 hover:underline"
              >
                Open {alternative.attribution.provider} viewer <ExternalLink size={12} aria-hidden />
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
          <p>{metadata.attribution} · {alternative.license.id || "Recorded license"} · {formatCaptureDate(metadata.captureDate)}</p>
          <p>
            {metadata.distanceMeters === null ? "Distance unavailable" : `${Math.round(metadata.distanceMeters)} m from matched location`} · Street context only
            {thumb ? (
              <>
                {" · "}
                <a href={alternative.viewerUrl} target="_blank" rel="noopener noreferrer" className="underline">
                  Open viewer
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
        <img src={`/api/property-image?listingId=${encodeURIComponent(listingId)}&mode=image`} alt={`Street-level context near ${address}`} className={`absolute inset-0 h-full w-full object-contain ${status === "loaded" ? "" : "opacity-0"}`} onLoad={() => setStatus("loaded")} onError={() => { setReason("The image could not be loaded. Try again later."); setStatus("unavailable"); }} />
        {status === "image" && <p role="status" className="absolute inset-0 grid place-items-center text-xs text-ink-3">Loading street-level context…</p>}
      </div>
      <div className={caption}>
        <p>{metadata.attribution.includes(metadata.provider) ? metadata.attribution : `${metadata.provider} · ${metadata.attribution}`} · {formatCaptureDate(metadata.captureDate)}</p>
        <p>{metadata.distanceMeters === null ? "Distance unavailable" : `${Math.round(metadata.distanceMeters)} m from matched location`} · Street context only</p>
      </div>
    </div>
  );

  return (
    <div className="flex h-full w-full flex-col" data-testid="listing-thumbnail-unavailable">
      <div className={`${frame} bg-paper`}>
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2.5 px-6 py-8 text-center">
          <ImageOff size={25} strokeWidth={1.4} className="text-ink-3" aria-hidden />
          <p className="text-sm font-medium text-ink-3">Photo unavailable</p>
          {observed ? (() => {
            // One label for both the visible text and the accessible name.
            // They used to be written separately and drifted: the aria-label
            // said "Load Street View" while the button read "Check Street
            // View", so the label named a different action than the one shown.
            const label =
              status === "loading" ? "Checking coverage…"
              : status === "unavailable" ? "Retry Street View"
              : "Check Street View";
            return (
              <div className="flex flex-wrap items-center justify-center gap-2">
                <button type="button" disabled={status === "loading" || altLoading} aria-label={`${label} for ${address}`} onClick={loadStreetView} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-line-strong bg-card px-3 py-2 text-xs font-semibold text-ink-2 transition hover:border-ink-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-3 disabled:opacity-60">
                  {status === "loading" ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Camera size={14} aria-hidden />}
                  {label}
                </button>
                <button type="button" disabled={status === "loading" || altLoading} aria-label={`Check open street imagery for ${address}`} onClick={loadAlternatives} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-line-strong bg-card px-3 py-2 text-xs font-semibold text-ink-2 transition hover:border-ink-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-3 disabled:opacity-60">
                  {altLoading ? <Loader2 size={14} className="animate-spin" aria-hidden /> : null}
                  {altLoading ? "Checking open imagery…" : "Panoramax / Mapillary"}
                </button>
              </div>
            );
          })() : null}
        </div>
      </div>
      {layout === "card" || status === "unavailable" ? <div className={caption}>{status === "unavailable" ? <p role="status">{reason}</p> : <><span>{photoFailed ? "Publisher photo could not load" : "No publisher photo available"}</span><span className="text-ink-3">{observed ? "Street View depends on local coverage" : "See the source record for available media"}</span></>}</div> : null}
    </div>
  );
}
