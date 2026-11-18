"use client";

import * as React from "react";
import { ExternalLink, RotateCcw } from "lucide-react";
import { useLocale } from "@/components/i18n/locale-provider";
import {
  browserMapsKey,
  loadGoogleMapsStreetView,
  streetViewEmbedUrl,
  streetViewLaunchUrl,
  type StreetViewMetadata,
} from "@/lib/street-view-client";

type Props = {
  listingId?: string | null;
  address: string;
  sourceLabel?: string | null;
  metadata: StreetViewMetadata;
  onUnavailable?: () => void;
};

type PanoramaHandle = {
  setVisible(value: boolean): void;
  unbindAll?(): void;
};

export function InteractiveStreetView({ listingId, address, sourceLabel, metadata, onUnavailable }: Props) {
  const { messages, format } = useLocale();
  const t = messages.mediaUi;
  const [staticImageFailed, setStaticImageFailed] = React.useState(false);
  const container = React.useRef<HTMLDivElement>(null);
  const panorama = React.useRef<PanoramaHandle | null>(null);
  const iframeTimer = React.useRef<number | null>(null);
  const embedUrl = streetViewEmbedUrl(metadata);
  const configured = Boolean(embedUrl || browserMapsKey());
  // A known panorama can open in Google Maps without a browser key. With no
  // panorama target, this viewer has nothing to show, so the parent falls
  // back to other street imagery.
  const hasPanoramaTarget = Boolean(metadata.panoramaId || metadata.panoramaLocation);
  const [state, setState] = React.useState<"loading" | "ready" | "error" | "unconfigured">(
    () => (configured ? "loading" : hasPanoramaTarget ? "unconfigured" : "error"),
  );
  const [attempt, setAttempt] = React.useState(0);
  const canStaticPreview = Boolean(
    listingId
    && hasPanoramaTarget
    && metadata.coverage !== "nearby_street"
    && !staticImageFailed
  );

  React.useEffect(() => {
    setStaticImageFailed(false);
  }, [listingId, metadata.panoramaId]);

  React.useEffect(() => {
    if (!configured) {
      setState(hasPanoramaTarget ? "unconfigured" : "error");
      return;
    }
    if (embedUrl) {
      setState("loading");
      iframeTimer.current = window.setTimeout(() => {
        iframeTimer.current = null;
        setState("error");
      }, 12_000);
      return () => {
        if (iframeTimer.current !== null) window.clearTimeout(iframeTimer.current);
        iframeTimer.current = null;
      };
    }
    if (!browserMapsKey() || !container.current) {
      setState("error");
      return;
    }

    let disposed = false;
    setState("loading");
    void loadGoogleMapsStreetView()
      .then((google) => {
        if (disposed || !container.current) return;
        panorama.current = new google.maps.StreetViewPanorama(container.current, {
          ...(metadata.panoramaId
            ? { pano: metadata.panoramaId }
            : metadata.panoramaLocation
              ? { position: metadata.panoramaLocation }
              : {}),
          pov: { heading: metadata.heading ?? 0, pitch: 0 },
          zoom: 1,
          visible: true,
          addressControl: false,
          clickToGo: true,
          linksControl: true,
          panControl: true,
          zoomControl: true,
          fullscreenControl: true,
          motionTracking: false,
          motionTrackingControl: false,
          showRoadLabels: true,
        });
        setState("ready");
      })
      .catch(() => {
        if (!disposed) setState("error");
      });

    return () => {
      disposed = true;
      panorama.current?.setVisible(false);
      panorama.current?.unbindAll?.();
      panorama.current = null;
    };
  }, [attempt, configured, embedUrl, hasPanoramaTarget, metadata]);

  React.useEffect(() => { if (state === "error") onUnavailable?.(); }, [state, onUnavailable]);

  const launch = streetViewLaunchUrl(address, metadata);
  const label = metadata.targetLabel
    || (metadata.coverage === "nearby_street" ? t.nearbyWalkthrough : t.exteriorWalkthrough);

  return (
    <div className="relative h-full min-h-[220px] w-full bg-paper" data-testid="interactive-street-view">
      {embedUrl ? (
        <iframe
          key={`${embedUrl}-${attempt}`}
          src={embedUrl}
          title={format(t.walkableSvgTitle, { address })}
          referrerPolicy="no-referrer-when-downgrade"
          allowFullScreen
          className="h-full w-full border-0"
          onLoad={() => {
            if (iframeTimer.current !== null) window.clearTimeout(iframeTimer.current);
            iframeTimer.current = null;
            setState("ready");
          }}
          onError={() => {
            if (iframeTimer.current !== null) window.clearTimeout(iframeTimer.current);
            iframeTimer.current = null;
            setState("error");
          }}
        />
      ) : (
        <div
          key={attempt}
          ref={container}
          className="h-full w-full"
          aria-label={format(t.walkableSvgTitle, { address })}
        />
      )}

      {state === "loading" ? (
        <div role="status" className="pointer-events-none absolute inset-0 grid place-items-center bg-paper text-sm font-semibold text-ink-3">
          {t.loadingInteractiveSv}
        </div>
      ) : null}

      {state === "unconfigured" ? (
        canStaticPreview && listingId ? (
          <div className="relative h-full w-full bg-paper">
            <img
              src={`/api/property-image?listingId=${encodeURIComponent(listingId)}&mode=image`}
              alt={format(t.streetCaptureNear, { address })}
              className="h-full w-full object-contain"
              onError={() => setStaticImageFailed(true)}
            />
            <a href={launch} target="_blank" rel="noopener noreferrer" className="absolute right-3 top-3 inline-flex items-center gap-1.5 rounded-control bg-ink/90 px-3 py-2 text-xs font-bold text-white shadow hover:bg-ink">
              {t.openInteractiveWalkthrough} <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            </a>
          </div>
        ) : (
        <div className="absolute inset-0 grid place-items-center bg-paper px-5 text-center">
          <div>
            <p className="text-sm font-bold text-ink">{t.svStaysOnMaps}</p>
            <p className="mt-2 text-xs leading-relaxed text-ink-3">{t.noMapsKeyNote}</p>
            <a href={launch} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex items-center gap-2 rounded-control bg-ink px-3 py-2 text-xs font-bold text-white">
              {t.openGoogleMaps} <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            </a>
          </div>
        </div>
        )
      ) : null}

      {state === "error" ? (
        <div className="absolute inset-0 grid place-items-center bg-paper px-5 text-center">
          <div>
            <p className="text-sm font-bold text-ink">{t.svUnavailableHere}</p>
            <p className="mt-2 text-xs leading-relaxed text-ink-3">{t.useMapsCheckCoverage}</p>
            <div className="mt-3 flex flex-wrap justify-center gap-2">
              {embedUrl || browserMapsKey() ? (
                <button type="button" onClick={() => setAttempt((value) => value + 1)} className="inline-flex items-center gap-2 rounded-control border border-line-strong bg-card px-3 py-2 text-xs font-bold">
                  <RotateCcw className="h-3.5 w-3.5" aria-hidden /> {t.retryViewer}
                </button>
              ) : null}
              <a href={launch} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-control bg-ink px-3 py-2 text-xs font-bold text-white">
                {t.openGoogleMaps} <ExternalLink className="h-3.5 w-3.5" aria-hidden />
              </a>
            </div>
          </div>
        </div>
      ) : null}

      {state === "ready" ? (
        <button
          type="button"
          onClick={() => setAttempt((value) => value + 1)}
          className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-control bg-card px-3 py-2 text-label font-bold text-ink shadow"
        >
          <RotateCcw className="h-3 w-3" aria-hidden /> {t.returnToProperty}
        </button>
      ) : null}

      <div className="pointer-events-none absolute bottom-7 left-3 max-w-[70%] rounded-control bg-ink/85 px-3 py-2 text-meta text-white shadow">
        <strong>{label}</strong><br />{sourceLabel || t.propertySourceFallback} · {address}
      </div>
    </div>
  );
}
