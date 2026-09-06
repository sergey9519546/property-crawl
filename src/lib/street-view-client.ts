export type StreetViewMetadata = {
  provider: string;
  attribution: string;
  captureDate: string | null;
  distanceMeters: number | null;
};

export type StreetViewMetadataResult =
  | { available: true; metadata: StreetViewMetadata }
  | { available: false; reason: string };

// Coalesce concurrent requests only. Do not persist Google metadata or imagery.
const requests = new Map<string, Promise<StreetViewMetadataResult>>();
function safeText(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 240) : fallback;
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
    },
  };
}

export function requestStreetViewMetadata(listingId: string) {
  const pending = requests.get(listingId);
  if (pending) return pending;
  const request = fetch(`/api/property-image?listingId=${encodeURIComponent(listingId)}&mode=metadata`, {
    cache: "no-store", credentials: "same-origin", headers: { Accept: "application/json" }, signal: AbortSignal.timeout(15_000),
  }).then(async (response) => {
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok && (!payload || typeof payload !== "object")) throw new Error("Street View metadata request failed");
    if (!response.ok && (payload as Record<string, unknown>)?.available === true) throw new Error("Street View metadata request failed");
    return parseStreetViewMetadata(payload);
  }).finally(() => requests.delete(listingId));
  requests.set(listingId, request);
  return request;
}

export function formatCaptureDate(value: string | null) {
  if (!value) return "Capture date unavailable";
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(value);
  if (!match) return `Captured ${value}`;
  return `Captured ${new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1)))}`;
}
