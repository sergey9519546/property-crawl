"use client";

import { useEffect, useRef, useState } from "react";
import { Camera } from "lucide-react";
import { safeImageUrl } from "@/lib/listing-display";
import { formatCaptureDate, requestStreetViewMetadata, type StreetViewMetadata } from "@/lib/street-view-client";
import { PropertyEvidenceVisual } from "@/components/listings/property-evidence-visual";

type Props = { listingId: string; address: string; photo?: string | null; observed: boolean; photoProvider?: string | null; photoSourceUrl?: string | null };

export function ListingThumbnail({ listingId, address, photo, observed, photoProvider, photoSourceUrl }: Props) {
  const publisherPhoto = safeImageUrl(photo);
  const [photoFailed, setPhotoFailed] = useState(false);
  const [status, setStatus] = useState<"idle" | "loading" | "image" | "loaded" | "unavailable">("idle");
  const [metadata, setMetadata] = useState<StreetViewMetadata | null>(null);
  const [reason, setReason] = useState("");
  const generation = useRef(0);
  useEffect(() => {
    generation.current++;
    setPhotoFailed(false);
    setStatus("idle");
    setMetadata(null);
    return () => { generation.current++; };
  }, [listingId, publisherPhoto]);

  async function loadStreetView() {
    const request = ++generation.current;
    setStatus("loading");
    try {
      const result = await requestStreetViewMetadata(listingId);
      if (request !== generation.current) return;
      if (!result.available) { setReason(result.reason); setStatus("unavailable"); return; }
      setMetadata(result.metadata);
      setStatus("image");
    } catch {
      if (request !== generation.current) return;
      setReason("Coverage could not be checked. Try again later.");
      setStatus("unavailable");
    }
  }

  if (publisherPhoto && !photoFailed) return (
    <div className="relative h-full w-full">
      <img src={publisherPhoto} alt={`${photoProvider || "Publisher"} photo of ${address}`} loading="lazy" decoding="async" className="h-full w-full object-cover" onError={() => setPhotoFailed(true)} />
      {photoProvider && photoSourceUrl && <a href={photoSourceUrl} target="_blank" rel="noopener noreferrer" className="absolute inset-x-0 bottom-0 bg-slate-950/85 px-3 py-1.5 text-[10px] text-white underline underline-offset-2 focus-visible:ring-2 focus-visible:ring-slate-400">{photoProvider} · Exact-address matched photo</a>}
    </div>
  );

  if ((status === "image" || status === "loaded") && metadata) return (
    <div className="flex h-full flex-col bg-slate-200" data-testid="listing-thumbnail-streetview">
      <div className="relative min-h-0 flex-1">
        <img src={`/api/property-image?listingId=${encodeURIComponent(listingId)}&mode=image`} alt={`Street-level context near ${address}`} className={`h-full w-full object-contain ${status === "loaded" ? "" : "opacity-0"}`} onLoad={() => setStatus("loaded")} onError={() => { setReason("The image could not be loaded. Try again later."); setStatus("unavailable"); }} />
        {status === "image" && <p role="status" className="absolute inset-0 grid place-items-center text-xs text-slate-600">Loading street-level context…</p>}
      </div>
      <div className="shrink-0 bg-slate-950 px-3 py-2 text-[10px] leading-snug text-white">
        <p>{metadata.provider}{metadata.attribution !== metadata.provider ? ` · ${metadata.attribution}` : ""} · {formatCaptureDate(metadata.captureDate)}</p>
        <p>{metadata.distanceMeters === null ? "Distance unavailable" : `${Math.round(metadata.distanceMeters)} m from matched location`} · Context, not condition evidence</p>
      </div>
    </div>
  );

  return (
    <div className="relative h-full w-full" data-testid="listing-thumbnail-evidence-visual">
      <PropertyEvidenceVisual
        listingId={listingId}
        address={address}
        compact
        statusLabel={photoFailed ? "publisher media unavailable" : "source media open"}
      />
      {observed ? <div className="absolute bottom-3 right-3 flex max-w-[72%] flex-col items-end gap-1.5">
        {status === "unavailable" ? <p role="status" className="rounded-md bg-slate-950/90 px-2 py-1 text-right text-[9px] leading-snug text-white shadow-lg backdrop-blur">{reason}</p> : null}
        <button type="button" disabled={status === "loading"} aria-label={`Load Street View for ${address}`} onClick={loadStreetView} className="inline-flex items-center gap-1.5 rounded-lg border border-white/70 bg-white/95 px-2.5 py-2 text-[10px] font-bold text-slate-800 shadow-lg backdrop-blur transition hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 disabled:opacity-60"><Camera className="h-3 w-3" aria-hidden />{status === "loading" ? "Checking…" : status === "unavailable" ? "Retry Street View" : "Check Street View"}</button>
      </div> : null}
    </div>
  );
}
