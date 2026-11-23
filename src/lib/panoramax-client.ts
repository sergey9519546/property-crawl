export type PanoramaxCandidate = {
  provider: 'panoramax';
  pictureId: string;
  collectionId: string;
  mediaType: 'panorama_360' | 'directional_sequence';
  capturedAt: string | null;
  distanceMeters: number;
  targetHeading?: number | null;
  viewerUrl: string;
  thumbUrl?: string | null;
  license: { id: string | null; url: string | null; displayApproved: boolean };
  attribution: { provider: string; producer: string | null };
};

export type MapillaryCandidate = {
  provider: 'mapillary';
  pictureId: string;
  collectionId: string;
  mediaType: 'panorama_360' | 'directional_sequence';
  capturedAt: string | null;
  distanceMeters: number;
  targetHeading?: number | null;
  viewerUrl: string;
  thumbUrl: string | null;
  license: { id: string | null; url: string | null; displayApproved: boolean };
  attribution: { provider: string; producer: string | null };
};

const UUID_PICTURE_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type AlternativeCandidate = PanoramaxCandidate | MapillaryCandidate;

export type AlternativeImageryPayload = {
  available: boolean;
  primary: AlternativeCandidate | null;
  panoramax: PanoramaxCandidate | null;
  mapillary: MapillaryCandidate | null;
  unavailableReason: string;
};

function safeHttpsUrl(raw: unknown, allowedHostCheck: (hostname: string, url: URL) => boolean): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    return allowedHostCheck(url.hostname.toLowerCase(), url) ? url.href : null;
  } catch {
    return null;
  }
}

export function parsePanoramaxCandidate(raw: unknown): PanoramaxCandidate | null {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as Record<string, unknown>;
  const license = item.license as Record<string, unknown> | undefined;
  if (
    item.provider !== 'panoramax'
    || license?.displayApproved !== true
    || !['panorama_360', 'directional_sequence'].includes(String(item.mediaType))
    || typeof item.pictureId !== 'string' || !item.pictureId.trim()
    || typeof item.collectionId !== 'string' || !item.collectionId.trim()
    || typeof item.distanceMeters !== 'number' || !Number.isFinite(item.distanceMeters)
    || item.distanceMeters < 0 || item.distanceMeters > 100
  ) return null;

  const viewerUrl = safeHttpsUrl(
    item.viewerUrl,
    (host, url) => host === 'api.panoramax.xyz' && url.pathname === '/' && url.searchParams.get('pic') === item.pictureId
  );
  if (!viewerUrl) return null;

  const thumbUrl = safeHttpsUrl(
    item.thumbUrl,
    (host, url) =>
      host === 'api.panoramax.xyz'
      && UUID_PICTURE_RE.test(String(item.pictureId))
      && url.pathname === `/api/pictures/${item.pictureId}/thumb.jpg`
  );
  const licenseUrl = safeHttpsUrl(license.url, () => true);
  const targetHeading = typeof item.targetHeading === 'number' && Number.isFinite(item.targetHeading)
    ? item.targetHeading
    : null;

  const attribution = item.attribution as Record<string, unknown> | undefined;
  return {
    provider: 'panoramax',
    pictureId: item.pictureId,
    collectionId: item.collectionId,
    mediaType: item.mediaType as PanoramaxCandidate['mediaType'],
    capturedAt: typeof item.capturedAt === 'string' && Number.isFinite(Date.parse(item.capturedAt)) ? item.capturedAt : null,
    distanceMeters: item.distanceMeters,
    ...(targetHeading !== null ? { targetHeading } : {}),
    viewerUrl,
    ...(thumbUrl ? { thumbUrl } : {}),
    license: {
      id: typeof license.id === 'string' ? license.id : null,
      url: licenseUrl,
      displayApproved: true,
    },
    attribution: {
      provider: 'Panoramax',
      producer: typeof attribution?.producer === 'string' ? attribution.producer : null,
    },
  };
}

export function parseMapillaryCandidate(raw: unknown): MapillaryCandidate | null {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as Record<string, unknown>;
  const license = item.license as Record<string, unknown> | undefined;
  if (
    item.provider !== 'mapillary'
    || license?.displayApproved !== true
    || !['panorama_360', 'directional_sequence'].includes(String(item.mediaType))
    || typeof item.pictureId !== 'string' || !item.pictureId.trim()
    || typeof item.collectionId !== 'string' || !item.collectionId.trim()
    || typeof item.distanceMeters !== 'number' || !Number.isFinite(item.distanceMeters)
    || item.distanceMeters < 0 || item.distanceMeters > 100
  ) return null;

  const viewerUrl = safeHttpsUrl(
    item.viewerUrl ?? item.sourcePage,
    (host, url) =>
      (host === 'www.mapillary.com' || host === 'mapillary.com')
      && url.pathname.startsWith('/app')
      && url.searchParams.get('photoId') === item.pictureId
  );
  if (!viewerUrl) return null;

  const thumbUrl = safeHttpsUrl(
    item.thumbUrl,
    (host) => host === 'mapillary.com' || host.endsWith('.mapillary.com') || host.endsWith('.fbcdn.net')
  );
  const licenseUrl = safeHttpsUrl(license.url, () => true);
  const targetHeading = typeof item.targetHeading === 'number' && Number.isFinite(item.targetHeading)
    ? item.targetHeading
    : null;

  const attribution = item.attribution as Record<string, unknown> | undefined;
  return {
    provider: 'mapillary',
    pictureId: item.pictureId,
    collectionId: item.collectionId,
    mediaType: item.mediaType as MapillaryCandidate['mediaType'],
    capturedAt: typeof item.capturedAt === 'string' && Number.isFinite(Date.parse(item.capturedAt)) ? item.capturedAt : null,
    distanceMeters: item.distanceMeters,
    ...(targetHeading !== null ? { targetHeading } : {}),
    viewerUrl,
    thumbUrl,
    license: {
      id: typeof license.id === 'string' ? license.id : null,
      url: licenseUrl,
      displayApproved: true,
    },
    attribution: {
      provider: 'Mapillary',
      producer: typeof attribution?.producer === 'string' ? attribution.producer : null,
    },
  };
}

export function parseAlternativeCandidate(raw: unknown): AlternativeCandidate | null {
  return parsePanoramaxCandidate(raw) || parseMapillaryCandidate(raw);
}

export function parseAlternativeImagery(payload: unknown): AlternativeImageryPayload {
  const emptyReason = 'No eligible Panoramax or Mapillary street imagery was found within 100 m of the recorded location.';
  if (!payload || typeof payload !== 'object') {
    return { available: false, primary: null, panoramax: null, mapillary: null, unavailableReason: emptyReason };
  }
  const body = payload as Record<string, unknown>;
  const providers = (body.providers && typeof body.providers === 'object' ? body.providers : {}) as Record<string, unknown>;
  const panoramaxBlock = providers.panoramax as Record<string, unknown> | undefined;
  const mapillaryBlock = providers.mapillary as Record<string, unknown> | undefined;
  const directional = Array.isArray(body.directionalSequences) ? body.directionalSequences : [];

  const panoramax = parsePanoramaxCandidate(panoramaxBlock?.candidate)
    || parsePanoramaxCandidate(body.candidate)
    || directional.map(parsePanoramaxCandidate).find((item): item is PanoramaxCandidate => Boolean(item))
    || null;

  const mapillary = parseMapillaryCandidate(mapillaryBlock?.candidate)
    || parseMapillaryCandidate(body.candidate)
    || directional.map(parseMapillaryCandidate).find((item): item is MapillaryCandidate => Boolean(item))
    || null;

  const primary = parseAlternativeCandidate(body.candidate) || panoramax || mapillary;
  const rawReason = typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim() : emptyReason;
  return {
    available: Boolean(primary),
    primary,
    panoramax,
    mapillary,
    unavailableReason: rawReason,
  };
}

export async function fetchAlternativeStreetView(
  listingId: string,
  signal?: AbortSignal
): Promise<{ ok: true; data: AlternativeImageryPayload } | { ok: false; reason: string }> {
  const response = await fetch(`/api/property-image?mode=alternatives&listingId=${encodeURIComponent(listingId)}`, {
    cache: 'no-store',
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
    signal,
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const reason = body && typeof body === 'object' && typeof (body as Record<string, unknown>).reason === 'string'
      ? String((body as Record<string, unknown>).reason)
      : 'Other street imagery could not be checked.';
    return { ok: false, reason };
  }
  return { ok: true, data: parseAlternativeImagery(body) };
}
