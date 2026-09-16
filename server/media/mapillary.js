'use strict';

// server/media/mapillary.js
//
// Mapillary lookup helper. Mirrors the Panoramax module's shape:
//   lookupMapillary(location, options) -> {
//     available, candidate, panoramas, panoramicMetadata,
//     directionalSequences, reason, queriedRadiusMeters
//   }
//
// Mapillary is a community street-level imagery provider (Meta). All
// Mapillary imagery is published under CC-BY-SA-4.0 per Mapillary's
// terms, so the license gate is satisfied for every returned image —
// no proprietary / opt-out filter needed.
//
// Configuration:
//   MAPILLARY_ACCESS_TOKEN   runtime-only access token (never committed,
//                            never logged); absence yields { available:false,
//                            reason:'not_configured' } without an upstream
//                            call.
//
// Caching: when an optional `cache` is provided, results are cached by
// (provider, lat, lng, radius) using the same provider-cache helper that
// Panoramax uses, so a property at the same coordinates does not hit
// Mapillary twice in the cache TTL window.

const ORIGIN = 'https://graph.mapillary.com';
const IMAGES_PATH = '/images';
const MAX_BYTES = 1_000_000;
const DISPLAY_LICENSE = Object.freeze({ id: 'CC-BY-SA-4.0', url: 'https://creativecommons.org/licenses/by-sa/4.0/', displayApproved: true });
const FIELD_LIST = Object.freeze(['id', 'captured_at', 'thumb_2048_url', 'thumb_1024_url', 'sequence', 'compass_angle', 'creator', 'geometry', 'image_type']);

function strictNumber(v, min, max, name) {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) throw new TypeError(`Mapillary ${name} must be a finite number`);
  return v;
}

function integer(v, d, max, name) {
  if (v == null) return d;
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 1 || v > max) throw new RangeError(`Mapillary ${name} must be between 1 and ${max}`);
  return v;
}

function id(v) {
  if (typeof v !== 'string') return null;
  v = v.trim();
  return v && v.length <= 200 ? v : null;
}

function optionalNumber(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function distance(a, b) {
  const r = (x) => (x * Math.PI) / 180;
  const dlat = r(b.lat - a.lat);
  const dlng = r(b.lng - a.lng);
  const h = Math.sin(dlat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dlng / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function bboxAround({ lat, lng, radiusMeters }) {
  // 1 deg lat ≈ 111.32 km. 1 deg lng varies with latitude; cos(lat).
  // US data stays well within [-180, 180] so no antimeridian split needed.
  const latDelta = radiusMeters / 111_320;
  const cosLat = Math.cos((lat * Math.PI) / 180);
  const lngDelta = Math.abs(cosLat) < 1e-6 ? 180 : radiusMeters / (111_320 * Math.abs(cosLat));
  return {
    west: Math.max(-180, lng - lngDelta),
    south: Math.max(-90, lat - latDelta),
    east: Math.min(180, lng + lngDelta),
    north: Math.min(90, lat + latDelta),
  };
}

function imageUrl(location, radius, limit, token) {
  const bbox = bboxAround({ lat: location.lat, lng: location.lng, radiusMeters: radius });
  const url = new URL(IMAGES_PATH, ORIGIN);
  url.searchParams.set('access_token', token);
  url.searchParams.set('bbox', [bbox.west, bbox.south, bbox.east, bbox.north].map((n) => n.toFixed(7)).join(','));
  url.searchParams.set('fields', FIELD_LIST.join(','));
  url.searchParams.set('limit', String(limit));
  return url;
}

function viewerUrlFor(imageId) {
  if (!imageId) return null;
  const url = new URL('https://www.mapillary.com/app/');
  url.searchParams.set('focus', 'photo');
  url.searchParams.set('photoId', imageId);
  return url.toString();
}

function normalize(image, target, radius) {
  if (!image || typeof image !== 'object') return null;
  const pictureId = id(image.id);
  const sequenceId = id(image.sequence);
  const coords = image.geometry?.type === 'Point' && Array.isArray(image.geometry.coordinates)
    ? image.geometry.coordinates : null;
  if (!pictureId || !sequenceId || !coords || coords.length < 2) return null;
  const [lng, lat] = coords;
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  const meters = distance(target, { lat, lng });
  if (meters > radius) return null;
  const captured = typeof image.captured_at === 'string' && Number.isFinite(Date.parse(image.captured_at))
    ? new Date(image.captured_at).toISOString()
    : null;
  const creator = image.creator && typeof image.creator === 'object' ? image.creator : null;
  const producer = creator && typeof creator.username === 'string' ? creator.username.trim().slice(0, 200) : null;
  const isPano = String(image.image_type || '').toLowerCase() === 'pano';
  return {
    provider: 'mapillary',
    pictureId,
    collectionId: sequenceId,
    location: { lat, lng },
    distanceMeters: Number(meters.toFixed(1)),
    capturedAt: captured,
    azimuth: optionalNumber(image.compass_angle),
    mediaType: isPano ? 'panorama_360' : 'directional_sequence',
    license: DISPLAY_LICENSE,
    attribution: { provider: 'Mapillary', producer: producer || null },
    sourcePage: viewerUrlFor(pictureId),
    thumbUrl: typeof image.thumb_2048_url === 'string' ? image.thumb_2048_url : null,
  };
}

async function readJson(response, max) {
  const type = response.headers?.get?.('content-type') || '';
  // Many CDNs omit Content-Type on successful 200 JSON responses. Treat
  // a missing header the same as a JSON header — the upstream contract is
  // /images returning a JSON body, not the header. Only reject if a
  // header is present and explicitly non-JSON (e.g. text/html).
  if (type && !/^application\/(?:[^;]+\+)?json\b/i.test(type)) throw new Error('Mapillary returned a non-JSON response');
  const length = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(length) && length > max) throw new Error('Mapillary response exceeded the byte limit');
  const reader = response.body?.getReader?.();
  if (!reader) {
    const text = await response.text();
    if (Buffer.byteLength(text) > max) throw new Error('Mapillary response exceeded the byte limit');
    return JSON.parse(text);
  }
  const chunks = [];
  let size = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.byteLength;
    if (size > max) {
      void reader.cancel();
      throw new Error('Mapillary response exceeded the byte limit');
    }
    chunks.push(Buffer.from(part.value));
  }
  return JSON.parse(Buffer.concat(chunks, size).toString('utf8'));
}

function safeText(v, max = 1024) {
  if (typeof v !== 'string') return null;
  const t = v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  return t && t.length <= max ? t : null;
}

function readToken(env) {
  if (!env || typeof env !== 'object') return null;
  return safeText(env.MAPILLARY_ACCESS_TOKEN, 1024);
}

async function lookupMapillary(location, options = {}) {
  const target = {
    lat: strictNumber(location?.lat, -90, 90, 'latitude'),
    lng: strictNumber(location?.lng, -180, 180, 'longitude'),
  };
  const radius = integer(options.radiusMeters, 100, 100, 'radius');
  const limit = integer(options.limit, 10, 10, 'result limit');
  const timeout = integer(options.timeoutMs, 8000, 15000, 'timeout');
  const max = integer(options.maximumBytes, MAX_BYTES, MAX_BYTES, 'response byte limit');
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new TypeError('A fetch implementation is required');

  const env = options.env || process.env;
  const token = readToken(env);
  if (!token) {
    return {
      available: false,
      candidate: null,
      panoramas: [],
      panoramicMetadata: [],
      directionalSequences: [],
      reason: 'not_configured',
      queriedRadiusMeters: radius,
    };
  }

  const cache = options.cache;
  const cacheable = Boolean(cache) && options.cacheTtlMs !== 0;
  if (cacheable) {
    const key = cache.buildKey({ provider: 'mapillary', lat: target.lat, lng: target.lng, radius });
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const url = imageUrl(target, radius, limit, token);
    const response = await fetchImpl(url, {
      method: 'GET',
      redirect: 'error',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response || response.status !== 200) {
      return {
        available: false,
        candidate: null,
        panoramas: [],
        panoramicMetadata: [],
        directionalSequences: [],
        reason: response?.status === 401 || response?.status === 403
          ? 'upstream_denied'
          : response?.status === 429
            ? 'upstream_rate_limited'
            : 'upstream_invalid_response',
        queriedRadiusMeters: radius,
      };
    }
    const contentType = response.headers?.get?.('content-type') || '';
    // Mirror readJson's lenient handling: a missing content-type is not
    // a hard failure (CDNs sometimes omit it on 200 JSON responses), only
    // a present-but-non-JSON header is rejected up-front.
    if (contentType && !/^application\/(?:[^;]+\+)?json\b/i.test(contentType)) {
      return {
        available: false,
        candidate: null,
        panoramas: [],
        panoramicMetadata: [],
        directionalSequences: [],
        reason: 'upstream_invalid_response',
        queriedRadiusMeters: radius,
      };
    }
    const payload = await readJson(response, max);
    const raw = Array.isArray(payload?.data) ? payload.data.slice(0, limit) : [];
    const seen = new Set();
    const candidates = raw
      .map((entry) => normalize(entry, target, radius))
      .filter((entry) => entry && !seen.has(entry.pictureId) && seen.add(entry.pictureId))
      .sort((a, b) => a.distanceMeters - b.distanceMeters);
    const panoramicMetadata = candidates.filter((entry) => entry.mediaType === 'panorama_360');
    // Mapillary images are CC-BY-SA-4.0 by default per Mapillary's terms;
    // every returned image already has license.displayApproved = true.
    const panoramas = candidates.filter((entry) => entry.mediaType === 'panorama_360');
    const directionalSequences = candidates.filter((entry) => entry.mediaType === 'directional_sequence');
    const result = {
      available: candidates.length > 0,
      candidate: candidates[0] || null,
      panoramas,
      panoramicMetadata,
      directionalSequences,
      reason: candidates.length > 0
        ? null
        : 'No Mapillary imagery was returned within the configured radius.',
      queriedRadiusMeters: radius,
    };
    if (cacheable) {
      const key = cache.buildKey({ provider: 'mapillary', lat: target.lat, lng: target.lng, radius });
      cache.set(key, result);
    }
    return result;
  } catch (error) {
    // Re-throw transport-level failures (network reset, abort, DNS) so the
    // route can detect "both providers down" and surface a 503. HTTP-level
    // failures (4xx/5xx) are handled inline above with their own reasons,
    // and JSON-parse / content-type failures are also handled inline.
    if (error instanceof TypeError || error?.name === 'AbortError') throw error;
    return {
      available: false,
      candidate: null,
      panoramas: [],
      panoramicMetadata: [],
      directionalSequences: [],
      reason: 'upstream_unavailable',
      queriedRadiusMeters: radius,
    };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { lookupMapillary, bboxAround };