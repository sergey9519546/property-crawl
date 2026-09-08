export type StreetViewMetadata = {
  provider: string;
  attribution: string;
  captureDate: string | null;
  distanceMeters: number | null;
  panoramaId: string | null;
  panoramaLocation: { lat: number; lng: number } | null;
  heading: number | null;
  mapsLaunchUrl: string | null;
  coverage: string | null;
  targetLabel: string | null;
};

export type StreetViewMetadataResult =
  | { available: true; metadata: StreetViewMetadata }
  | { available: false; reason: string };

// Coalesce concurrent requests only. Do not persist Google metadata or imagery.
const requests = new Map<string, Promise<StreetViewMetadataResult>>();
function safeText(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 240) : fallback;
}
function safePanoramaId(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 512) : null;
}

export function parseStreetViewMetadata(payload: unknown): StreetViewMetadataResult {
  if (!payload || typeof payload !== "object") throw new Error("Invalid Street View metadata response");
  const record = payload as Record<string, unknown>;
  if (record.available !== true) return { available: false, reason: safeText(record.reason, "No verified Street View panorama is available for this listing.") };
  return {
    available: true,
    metadata: {
      provider: safeText(record.provider, "Google Maps"),
      attribution: safeText(record.attribution, "Google Maps"),
      captureDate: typeof record.captureDate === "string" ? record.captureDate.trim().slice(0, 40) || null : null,
      distanceMeters: typeof record.distanceMeters === "number" && Number.isFinite(record.distanceMeters) && record.distanceMeters >= 0 ? record.distanceMeters : null,
      panoramaId: safePanoramaId(record.panoramaId),
      panoramaLocation: record.panoramaLocation && typeof record.panoramaLocation === "object"
        && (record.panoramaLocation as Record<string, unknown>).lat !== null && (record.panoramaLocation as Record<string, unknown>).lat !== ''
        && (record.panoramaLocation as Record<string, unknown>).lng !== null && (record.panoramaLocation as Record<string, unknown>).lng !== ''
        && Number.isFinite(Number((record.panoramaLocation as Record<string, unknown>).lat)) && Math.abs(Number((record.panoramaLocation as Record<string, unknown>).lat))<=90
        && Number.isFinite(Number((record.panoramaLocation as Record<string, unknown>).lng)) && Math.abs(Number((record.panoramaLocation as Record<string, unknown>).lng))<=180
        ? { lat: Number((record.panoramaLocation as Record<string, unknown>).lat), lng: Number((record.panoramaLocation as Record<string, unknown>).lng) } : null,
      heading: typeof (record.targetHeading ?? record.heading) === "number" && Number.isFinite(record.targetHeading ?? record.heading) ? Number(record.targetHeading ?? record.heading) : null,
      mapsLaunchUrl: safeLaunchUrl(record.mapsLaunchUrl),
      coverage: safeText(record.coverage, '') || null,
      targetLabel: safeText(record.targetLabel, '') || null,
    },
  };
}

function safeLaunchUrl(value: unknown) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && ["www.google.com", "maps.google.com"].includes(url.hostname.toLowerCase())
      && url.pathname.startsWith("/maps")
      ? url.href
      : null;
  } catch {
    return null;
  }
}

type PanoramaInstance = { setVisible(value: boolean): void; unbindAll?(): void };
type GoogleMapsRuntime = { maps: { StreetViewPanorama: new (element: HTMLElement, options: Record<string, unknown>) => PanoramaInstance } };
declare global {
  interface Window {
    google?: GoogleMapsRuntime;
    __propertyStreetViewReady?: () => void;
    gm_authFailure?: () => void;
  }
}
let googleMapsPromise: Promise<GoogleMapsRuntime> | null = null;
export function browserMapsKey() {
  return process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY?.trim() || null;
}
export function browserMapsEmbedKey() {
  return process.env.NEXT_PUBLIC_GOOGLE_MAPS_EMBED_API_KEY?.trim() || null;
}
export function loadGoogleMapsStreetView(): Promise<GoogleMapsRuntime> {
  if (typeof window === "undefined") return Promise.reject(new Error("Street View is available in the browser only"));
  if (window.google?.maps?.StreetViewPanorama) return Promise.resolve(window.google);
  const key = browserMapsKey();
  if (!key) return Promise.reject(new Error("Interactive Street View is not configured"));
  if (googleMapsPromise) return googleMapsPromise;

  googleMapsPromise = new Promise((resolve, reject) => {
    document.getElementById("property-google-maps-js")?.remove();
    const script = document.createElement("script");
    script.id = "property-google-maps-js";
    script.async = true;
    script.defer = true;
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&callback=__propertyStreetViewReady&v=weekly&loading=async`;
    let settled = false;
    const cleanup = () => {
      window.clearTimeout(timer);
      delete window.__propertyStreetViewReady;
      delete window.gm_authFailure;
    };
    const fail = () => {
      if (settled) return;
      settled = true;
      cleanup();
      googleMapsPromise = null;
      script.remove();
      reject(new Error("Google Maps could not be loaded"));
    };
    const timer = window.setTimeout(fail, 12_000);
    window.gm_authFailure = fail;
    window.__propertyStreetViewReady = () => {
      if (settled) return;
      if (!window.google?.maps?.StreetViewPanorama) return fail();
      settled = true;
      cleanup();
      resolve(window.google);
    };
    script.onerror = fail;
    document.head.appendChild(script);
  });
  return googleMapsPromise;
}

export function streetViewLaunchUrl(address: string, metadata?: StreetViewMetadata | null) {
  if (metadata?.mapsLaunchUrl) return metadata.mapsLaunchUrl;
  if (metadata?.panoramaLocation) {
    const viewpoint = `${metadata.panoramaLocation.lat},${metadata.panoramaLocation.lng}`;
    return `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${encodeURIComponent(viewpoint)}`;
  }
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}
export function streetViewEmbedUrl(metadata: StreetViewMetadata) {
  const key = browserMapsEmbedKey();
  if (!key) return null;
  const target = metadata.panoramaId
    ? `pano=${encodeURIComponent(metadata.panoramaId)}`
    : metadata.panoramaLocation
      ? `location=${encodeURIComponent(`${metadata.panoramaLocation.lat},${metadata.panoramaLocation.lng}`)}`
      : null;
  if (!target) return null;
  return `https://www.google.com/maps/embed/v1/streetview?key=${encodeURIComponent(key)}&${target}&heading=${encodeURIComponent(String(metadata.heading ?? 0))}&pitch=0&fov=80`;
}

export function requestStreetViewMetadata(listingId: string, options: { walkthrough?: boolean } = {}) {
  const requestKey = `${listingId}:${options.walkthrough ? "walkthrough" : "metadata"}`;
  const pending = requests.get(requestKey);
  if (pending) return pending;
  const request = fetch(`/api/property-image?listingId=${encodeURIComponent(listingId)}&mode=${options.walkthrough?'walkthrough':'metadata'}`, {
    cache: "no-store", credentials: "same-origin", headers: { Accept: "application/json" }, signal: AbortSignal.timeout(15_000),
  }).then(async (response) => {
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok && (!payload || typeof payload !== "object")) throw new Error("Street View metadata request failed");
    if (!response.ok && (payload as Record<string, unknown>)?.available === true) throw new Error("Street View metadata request failed");
    return parseStreetViewMetadata(payload);
  }).finally(() => requests.delete(requestKey));
  requests.set(requestKey, request);
  return request;
}

export function formatCaptureDate(value: string | null) {
  if (!value) return "Capture date unavailable";
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(value);
  if (!match) return `Captured ${value}`;
  return `Captured ${new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1)))}`;
}
