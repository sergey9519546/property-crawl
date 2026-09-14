export type PanoramaxCandidate = {
  provider: 'panoramax'; pictureId: string; collectionId: string;
  mediaType: 'panorama_360' | 'directional_sequence';
  capturedAt: string | null; distanceMeters: number; viewerUrl: string;
  license: { id: string | null; url: string | null; displayApproved: boolean };
  attribution: { provider: string; producer: string | null };
};

export function parsePanoramaxCandidate(raw: unknown): PanoramaxCandidate | null {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as Record<string, unknown>;
  const license = item.license as Record<string, unknown> | undefined;
  if (item.provider !== 'panoramax' || license?.displayApproved !== true
    || !['panorama_360', 'directional_sequence'].includes(String(item.mediaType))
    || typeof item.pictureId !== 'string' || !item.pictureId.trim()
    || typeof item.collectionId !== 'string' || !item.collectionId.trim()
    || typeof item.distanceMeters !== 'number' || !Number.isFinite(item.distanceMeters)
    || item.distanceMeters < 0 || item.distanceMeters > 100) return null;
  try {
    const viewer = new URL(String(item.viewerUrl));
    if (viewer.origin !== 'https://api.panoramax.xyz' || viewer.pathname !== '/'
      || viewer.username || viewer.password || viewer.searchParams.get('pic') !== item.pictureId) return null;
    const attribution = item.attribution as Record<string, unknown> | undefined;
    return {
      provider: 'panoramax', pictureId: item.pictureId, collectionId: item.collectionId,
      mediaType: item.mediaType as PanoramaxCandidate['mediaType'],
      capturedAt: typeof item.capturedAt === 'string' && Number.isFinite(Date.parse(item.capturedAt)) ? item.capturedAt : null,
      distanceMeters: item.distanceMeters, viewerUrl: viewer.href,
      license: { id: typeof license.id === 'string' ? license.id : null, url: typeof license.url === 'string' ? license.url : null, displayApproved: true },
      attribution: { provider: 'Panoramax', producer: typeof attribution?.producer === 'string' ? attribution.producer : null },
    };
  } catch { return null; }
}
