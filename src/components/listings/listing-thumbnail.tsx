"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, ImageOff, Loader2 } from "lucide-react";
import { safeImageUrl } from "@/lib/listing-display";
import { formatCaptureDate, requestStreetViewMetadata, type StreetViewMetadata } from "@/lib/street-view-client";

type Props = { listingId: string; address: string; photo?: string | null; observed: boolean; photoProvider?: string | null; photoSourceUrl?: string | null; layout?: "fill" | "card" };

export function ListingThumbnail({ listingId, address, photo, observed, photoProvider, photoSourceUrl, layout = "fill" }: Props) {
  const publisherPhoto = safeImageUrl(photo);
  const [photoFailed, setPhotoFailed] = useState(false);
  const [status, setStatus] = useState<"idle" | "loading" | "image" | "loaded" | "unavailable">("idle");
  const [metadata, setMetadata] = useState<StreetViewMetadata | null>(null);
  const [reason, setReason] = useState("");
  const generation = useRef(0);
  const frame = layout === "card" ? "relative aspect-[4/3] w-full shrink-0 overflow-hidden" : "relative min-h-0 flex-1 overflow-hidden";
  const caption = "flex min-h-14 shrink-0 flex-col justify-center border-b border-slate-200 bg-slate-50 px-4 py-2 text-[11px] leading-4 text-slate-600";
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
    <div className="flex h-full w-full flex-col">
      <div className={frame}><img src={publisherPhoto} alt={`${photoProvider || "Publisher"} photo of ${address}`} loading="lazy" decoding="async" className="absolute inset-0 h-full w-full object-cover" onError={() => setPhotoFailed(true)} /></div>
      {layout === "card" || (photoProvider && photoSourceUrl) ? <div className={caption}>{photoProvider && photoSourceUrl ? <a href={photoSourceUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">{photoProvider} · Address-matched photo</a> : <span>Publisher photo</span>}<span className="text-slate-500">Review all photos in property details</span></div> : null}
    </div>
  );

  if ((status === "image" || status === "loaded") && metadata) return (
    <div className="flex h-full flex-col bg-slate-100" data-testid="listing-thumbnail-streetview">
      <div className={frame}>
        <img src={`/api/property-image?listingId=${encodeURIComponent(listingId)}&mode=image`} alt={`Street-level context near ${address}`} className={`absolute inset-0 h-full w-full object-contain ${status === "loaded" ? "" : "opacity-0"}`} onLoad={() => setStatus("loaded")} onError={() => { setReason("The image could not be loaded. Try again later."); setStatus("unavailable"); }} />
        {status === "image" && <p role="status" className="absolute inset-0 grid place-items-center text-xs text-slate-600">Loading street-level context…</p>}
      </div>
      <div className={caption}>
        <p>{metadata.attribution.includes(metadata.provider) ? metadata.attribution : `${metadata.provider} · ${metadata.attribution}`} · {formatCaptureDate(metadata.captureDate)}</p>
        <p>{metadata.distanceMeters === null ? "Distance unavailable" : `${Math.round(metadata.distanceMeters)} m from matched location`} · Street context only</p>
      </div>
    </div>
  );

  return (
    <div className="flex h-full w-full flex-col" data-testid="listing-thumbnail-unavailable">
      <div className={`${frame} bg-slate-100`}>
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 py-12 text-center">
          <ImageOff size={25} strokeWidth={1.4} className="text-slate-400" aria-hidden />
          <p className="text-sm font-medium text-slate-600">Photo unavailable</p>
          {observed ? <button type="button" disabled={status === "loading"} aria-label={`Load Street View for ${address}`} onClick={loadStreetView} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-800 transition hover:border-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 disabled:opacity-60">{status === "loading" ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Camera size={14} aria-hidden />}{status === "loading" ? "Checking coverage…" : status === "unavailable" ? "Retry Street View" : "Check Street View"}</button> : null}
        </div>
      </div>
      {layout === "card" || status === "unavailable" ? <div className={caption}>{status === "unavailable" ? <p role="status">{reason}</p> : <><span>{photoFailed ? "Publisher photo could not load" : "No publisher photo available"}</span><span className="text-slate-500">{observed ? "Street View depends on local coverage" : "See the source record for available media"}</span></>}</div> : null}
    </div>
  );
}
