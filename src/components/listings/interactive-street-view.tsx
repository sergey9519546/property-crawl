"use client";

import * as React from "react";
import { ExternalLink, RotateCcw } from "lucide-react";
import {
  browserMapsKey,
  loadGoogleMapsStreetView,
  streetViewEmbedUrl,
  streetViewLaunchUrl,
  type StreetViewMetadata,
} from "@/lib/street-view-client";

type Props = {
  address: string;
  sourceLabel?: string | null;
  metadata: StreetViewMetadata;
};

type PanoramaHandle = {
  setVisible(value: boolean): void;
  unbindAll?(): void;
};

export function InteractiveStreetView({ address, sourceLabel, metadata }: Props) {
  const container = React.useRef<HTMLDivElement>(null);
  const panorama = React.useRef<PanoramaHandle | null>(null);
  const iframeTimer = React.useRef<number | null>(null);
  const embedUrl = streetViewEmbedUrl(metadata);
  const [state, setState] = React.useState<"loading" | "ready" | "error">(
    () => (embedUrl || browserMapsKey() ? "loading" : "error"),
  );
  const [attempt, setAttempt] = React.useState(0);

  React.useEffect(() => {
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
  }, [attempt, embedUrl, metadata]);

  const launch = streetViewLaunchUrl(address, metadata);
  const label = metadata.targetLabel
    || (metadata.coverage === "nearby_street" ? "Nearby street walkthrough" : "Exterior walkthrough");

  return (
    <div className="relative h-full min-h-[220px] w-full bg-slate-100" data-testid="interactive-street-view">
      {embedUrl ? (
        <iframe
          key={`${embedUrl}-${attempt}`}
          src={embedUrl}
          title={`Walkable Google Street View near ${address}`}
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
          aria-label={`Walkable Google Street View near ${address}`}
        />
      )}

      {state === "loading" ? (
        <div role="status" className="pointer-events-none absolute inset-0 grid place-items-center bg-slate-100 text-sm font-semibold text-slate-600">
          Loading interactive Street View…
        </div>
      ) : null}

      {state === "error" ? (
        <div className="absolute inset-0 grid place-items-center bg-slate-100 px-5 text-center">
          <div>
            <p className="text-sm font-bold text-slate-900">Interactive Street View is unavailable here</p>
            <p className="mt-2 text-xs leading-relaxed text-slate-600">Use Google Maps to check available street-level coverage.</p>
            <div className="mt-3 flex flex-wrap justify-center gap-2">
              {embedUrl || browserMapsKey() ? (
                <button type="button" onClick={() => setAttempt((value) => value + 1)} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold">
                  <RotateCcw className="h-3.5 w-3.5" aria-hidden /> Retry viewer
                </button>
              ) : null}
              <a href={launch} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-lg bg-slate-950 px-3 py-2 text-xs font-bold text-white">
                Open in Google Maps <ExternalLink className="h-3.5 w-3.5" aria-hidden />
              </a>
            </div>
          </div>
        </div>
      ) : null}

      {state === "ready" ? (
        <button
          type="button"
          onClick={() => setAttempt((value) => value + 1)}
          className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-lg bg-white px-3 py-2 text-[10px] font-bold text-slate-900 shadow"
        >
          <RotateCcw className="h-3 w-3" aria-hidden /> Return to property
        </button>
      ) : null}

      <div className="pointer-events-none absolute bottom-7 left-3 max-w-[70%] rounded-lg bg-slate-950/85 px-3 py-2 text-[10px] text-white shadow">
        <strong>{label}</strong><br />{sourceLabel || "Property source"} · {address}
      </div>
    </div>
  );
}
