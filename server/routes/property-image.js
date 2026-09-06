'use strict';

const db = require('../db/client');
const { inspectSourceRecordUrl } = require('../scrapers/source-policy');
const { inspectPublisherPhoto } = require('../scrapers/media-policy');

const GOOGLE_MAPS_HOST = 'maps.googleapis.com';
const GOOGLE_GEOCODING_PATH = '/maps/api/geocode/json';
const STREET_VIEW_METADATA_PATH = '/maps/api/streetview/metadata';
const STREET_VIEW_IMAGE_PATH = '/maps/api/streetview';
const MAX_METADATA_BYTES = 64 * 1024;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const GENERIC_IMAGE_HOSTS = Object.freeze([
  'images.unsplash.com',
  'unsplash.com',
  'images.pexels.com',
  'pexels.com',
  'pixabay.com',
  'picsum.photos',
  'placehold.co',
  'placeholder.com',
]);
const GENERIC_IMAGE_MARKERS = Object.freeze([
  'placeholder',
  'no-image',
  'no_image',
  'noimage',
  'default-image',
  'default_image',
  'defaultphoto',
  'default-photo',
  'spacer.gif',
  'transparent.gif',
]);

class PropertyImageError extends Error {
  constructor(status, code, reason, options = {}) {
    super(reason);
    this.name = 'PropertyImageError';
    this.status = status;
    this.code = code;
    this.retryAfterSeconds = options.retryAfterSeconds ?? null;
  }
}

class ProviderCircuit {
  constructor({ failureThreshold = 3, cooldownMs = 60_000, now = Date.now } = {}) {
    this.failureThreshold = clampInteger(failureThreshold, 1, 10, 3);
    this.cooldownMs = clampInteger(cooldownMs, 1_000, 15 * 60_000, 60_000);
    this.now = now;
    this.failures = 0;
    this.openedUntil = 0;
  }

  assertAvailable() {
    const timestamp = this.now();
    if (this.openedUntil > timestamp) {
      throw new PropertyImageError(503, 'circuit_open', 'Street View is temporarily unavailable.', {
        retryAfterSeconds: Math.max(1, Math.ceil((this.openedUntil - timestamp) / 1000)),
      });
    }
    if (this.openedUntil > 0) {
      this.openedUntil = 0;
      this.failures = 0;
    }
  }

  success() {
    this.failures = 0;
    this.openedUntil = 0;
  }

  failure({ immediate = false } = {}) {
    this.failures += 1;
    if (immediate || this.failures >= this.failureThreshold) {
      this.openedUntil = this.now() + this.cooldownMs;
    }
  }
}

class FixedWindowRateLimiter {
  constructor({ maxRequests = 30, windowMs = 60_000, now = Date.now } = {}) {
    this.maxRequests = clampInteger(maxRequests, 1, 120, 30);
    this.windowMs = clampInteger(windowMs, 1_000, 10 * 60_000, 60_000);
    this.now = now;
    this.count = 0;
    this.resetAt = 0;
  }

  consume() {
    const timestamp = this.now();
    if (!this.resetAt || timestamp >= this.resetAt) {
      this.count = 0;
      this.resetAt = timestamp + this.windowMs;
    }
    this.count += 1;
    if (this.count > this.maxRequests) {
      throw new PropertyImageError(429, 'rate_limited', 'Property image lookup rate limit exceeded.', {
        retryAfterSeconds: Math.max(1, Math.ceil((this.resetAt - timestamp) / 1000)),
      });
    }
  }
}

class BoundedConcurrencyGate {
  constructor({ concurrency = 3, maxQueue = 20 } = {}) {
    this.concurrency = clampInteger(concurrency, 1, 4, 3);
    this.maxQueue = clampInteger(maxQueue, 0, 100, 20);
    this.active = 0;
    this.queue = [];
  }

  async run(operation) {
    if (this.active >= this.concurrency) {
      if (this.queue.length >= this.maxQueue) {
        throw new PropertyImageError(503, 'upstream_busy', 'Property image service is busy. Try again shortly.');
      }
      await new Promise((resolve) => this.queue.push(resolve));
    }

    this.active += 1;
    try {
      return await operation();
    } finally {
      this.active -= 1;
      const next = this.queue.shift();
      if (next) next();
    }
  }
}

function clampInteger(value, minimum, maximum, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.floor(parsed)));
}

function headerValue(headers, name) {
  if (!headers) return '';
  if (typeof headers.get === 'function') return String(headers.get(name) || '');
  const expected = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === expected) return Array.isArray(value) ? String(value[0] || '') : String(value || '');
  }
  return '';
}

function requestUrl(req) {
  const rawUrl = String(req?.url || '/api/property-image');
  if (/^https?:\/\//i.test(rawUrl)) return new URL(rawUrl);
  const forwardedProto = headerValue(req?.headers, 'x-forwarded-proto').split(',')[0].trim().toLowerCase();
  const protocol = forwardedProto === 'https' ? 'https' : 'http';
  const host = headerValue(req?.headers, 'host') || 'localhost';
  return new URL(rawUrl, `${protocol}://${host}`);
}

function assertSameOrigin(req, url) {
  const fetchSite = headerValue(req?.headers, 'sec-fetch-site').trim().toLowerCase();
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') {
    throw new PropertyImageError(403, 'cross_origin_denied', 'Cross-origin property image requests are not allowed.');
  }

  const origin = headerValue(req?.headers, 'origin').trim();
  const referer = headerValue(req?.headers, 'referer').trim();
  const suppliedOrigin = origin || referer;
  if (!suppliedOrigin) return;
  let parsed;
  try {
    parsed = new URL(suppliedOrigin);
  } catch (_) {
    throw new PropertyImageError(403, 'cross_origin_denied', 'Cross-origin property image requests are not allowed.');
  }
  if (parsed.origin !== url.origin) {
    throw new PropertyImageError(403, 'cross_origin_denied', 'Cross-origin property image requests are not allowed.');
  }
}

function validCoordinate(value, minimum, maximum) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= minimum && parsed <= maximum ? parsed : null;
}

function safeText(value, maximumLength = 256) {
  if (value === null || value === undefined) return null;
  const text = String(value).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, maximumLength) : null;
}

function isGenericImageHost(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/^www\./, '');
  return GENERIC_IMAGE_HOSTS.some((root) => host === root || host.endsWith(`.${root}`));
}

function hasUsablePublisherPhoto(listing) {
  if (!inspectPublisherPhoto(listing).accepted) return false;
  const rawPhoto = safeText(listing?.photo, 2048);
  if (!rawPhoto) return false;

  let photoUrl;
  try {
    photoUrl = new URL(rawPhoto);
  } catch (_) {
    return false;
  }
  if (photoUrl.protocol !== 'https:' || photoUrl.username || photoUrl.password || photoUrl.port) return false;
  if (isGenericImageHost(photoUrl.hostname)) return false;
  const lowerUrl = photoUrl.toString().toLowerCase();
  if (GENERIC_IMAGE_MARKERS.some((marker) => lowerUrl.includes(marker))) return false;

  const photoProvenance = listing?.provenance?.media?.photo;
  if (!photoProvenance || typeof photoProvenance !== 'object') return false;
  const origin = safeText(photoProvenance.origin, 64)?.toLowerCase();
  const verification = safeText(photoProvenance.verification, 64)?.toLowerCase();
  if (origin !== 'publisher_record' || verification !== 'source_extracted') return false;

  let provenanceRecordUrl;
  let listingRecordUrl;
  try {
    provenanceRecordUrl = new URL(String(photoProvenance.sourceRecordUrl || ''));
    listingRecordUrl = new URL(String(listing?.sourceUrl || ''));
  } catch (_) {
    return false;
  }
  provenanceRecordUrl.hash = '';
  listingRecordUrl.hash = '';
  return provenanceRecordUrl.toString() === listingRecordUrl.toString();
}

function hasSourceObservedProvenance(listing) {
  const provenance = listing?.provenance;
  if (!provenance || typeof provenance !== 'object') return false;
  if (provenance.origin !== 'live' || provenance.observed !== true || provenance.recordKind !== 'source_record') {
    return false;
  }

  const observedAt = listing.sourceObservedAt ?? provenance.observedAt;
  const observedTimestamp = Date.parse(observedAt);
  if (!Number.isFinite(observedTimestamp) || observedTimestamp > Date.now() + 5 * 60_000) return false;
  if (!safeText(provenance.publisher, 256) || !safeText(provenance.recordId, 256)) return false;
  return true;
}

function validateListingForStreetView(listing) {
  if (hasUsablePublisherPhoto(listing)) {
    throw new PropertyImageError(409, 'publisher_photo_available', 'The publisher already supplies a usable property photo.');
  }
  if (!hasSourceObservedProvenance(listing)) {
    throw new PropertyImageError(
      422,
      'listing_not_source_observed',
      'Street View fallback requires a current source-observed listing record and coordinates.'
    );
  }

  const sourceInspection = inspectSourceRecordUrl(listing.source, listing.sourceUrl);
  if (!sourceInspection.isValid) {
    throw new PropertyImageError(
      422,
      'invalid_source_record',
      'Street View fallback requires an exact publisher record URL for the listing.'
    );
  }

  return { sourceUrl: sourceInspection.url };
}

function hasDerivedCoordinates(listing) {
  const derived = listing?.provenance?.derivedFields;
  if (!derived || typeof derived !== 'object') return false;
  const coordinateKeys = ['lat', 'lng', 'latitude', 'longitude', 'coordinates', 'location', 'geocode'];
  return coordinateKeys.some((key) => Boolean(derived[key]));
}

function sourceCoordinates(listing) {
  if (hasDerivedCoordinates(listing)) return null;
  const lat = validCoordinate(listing?.lat, -90, 90);
  const lng = validCoordinate(listing?.lng, -180, 180);
  if (lat === null || lng === null || (lat === 0 && lng === 0)) return null;
  return {
    lat,
    lng,
    basis: 'source_coordinates',
    resolution: null,
  };
}

const ROUTE_TOKEN_ALIASES = Object.freeze({
  north: 'n', south: 's', east: 'e', west: 'w',
  northeast: 'ne', northwest: 'nw', southeast: 'se', southwest: 'sw',
  street: 'st', avenue: 'ave', boulevard: 'blvd', road: 'rd', drive: 'dr',
  lane: 'ln', court: 'ct', circle: 'cir', terrace: 'ter', place: 'pl',
  parkway: 'pkwy', highway: 'hwy', trail: 'trl',
});

function normalizeAddressToken(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function normalizeRouteName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\b(?:apartment|apt|unit|suite|ste)\b.*$/i, '')
    .replace(/\s+#\s*\S+.*$/i, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => ROUTE_TOKEN_ALIASES[token] || token)
    .join(' ');
}

function sourceObservedAddress(listing) {
  const derived = listing?.provenance?.derivedFields;
  if (derived && typeof derived === 'object' && (derived.address || derived.streetAddress)) return null;

  const fullAddress = safeText(listing?.address, 256);
  const address = fullAddress?.split(',')[0].trim();
  const city = safeText(listing?.city, 128);
  const state = safeText(listing?.state, 2)?.toUpperCase();
  const zip = safeText(listing?.zip, 10);
  if (!address || !city || !state || !zip || !/^[A-Z]{2}$/.test(state) || !/^\d{5}(?:-\d{4})?$/.test(zip)) {
    return null;
  }
  if (/^(?:p\.?\s*o\.?\s*box|lot\b|parcel\b|vacant\b)/i.test(address)) return null;
  const streetMatch = address.match(/^\s*(\d+[A-Za-z]?(?:-\d+[A-Za-z]?)?)\s+(.{2,})$/);
  if (!streetMatch) return null;
  const streetNumber = normalizeAddressToken(streetMatch[1]);
  const route = normalizeRouteName(streetMatch[2]);
  if (!streetNumber || !route) return null;
  return {
    query: `${address}, ${city}, ${state} ${zip}`,
    streetNumber,
    route,
    state,
    zip5: zip.slice(0, 5),
  };
}

function degreesToRadians(value) {
  return value * Math.PI / 180;
}

function distanceMeters(lat1, lng1, lat2, lng2) {
  const earthRadiusMeters = 6_371_008.8;
  const deltaLat = degreesToRadians(lat2 - lat1);
  const deltaLng = degreesToRadians(lng2 - lng1);
  const startLat = degreesToRadians(lat1);
  const endLat = degreesToRadians(lat2);
  const haversine = Math.sin(deltaLat / 2) ** 2
    + Math.cos(startLat) * Math.cos(endLat) * Math.sin(deltaLng / 2) ** 2;
  return earthRadiusMeters * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function bearingDegrees(fromLat, fromLng, toLat, toLng) {
  const startLat = degreesToRadians(fromLat);
  const endLat = degreesToRadians(toLat);
  const deltaLng = degreesToRadians(toLng - fromLng);
  const y = Math.sin(deltaLng) * Math.cos(endLat);
  const x = Math.cos(startLat) * Math.sin(endLat)
    - Math.sin(startLat) * Math.cos(endLat) * Math.cos(deltaLng);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function runtimeConfig(env) {
  const key = safeText(env?.GOOGLE_MAPS_API_KEY, 1024);
  if (!key) {
    throw new PropertyImageError(503, 'not_configured', 'Street View fallback is not configured.');
  }
  const radiusMeters = clampInteger(env.GOOGLE_STREETVIEW_RADIUS_METERS, 1, 100, 50);
  const maximumDistanceMeters = clampInteger(
    env.GOOGLE_STREETVIEW_MAX_DISTANCE_METERS,
    1,
    Math.min(100, radiusMeters),
    Math.min(35, radiusMeters)
  );
  return {
    key,
    geocodingKey: safeText(env?.GOOGLE_GEOCODING_API_KEY, 1024) || key,
    radiusMeters,
    maximumDistanceMeters,
    timeoutMs: clampInteger(env.GOOGLE_STREETVIEW_TIMEOUT_MS, 500, 10_000, 5_000),
    fov: clampInteger(env.GOOGLE_STREETVIEW_FOV, 45, 100, 80),
    pitch: clampInteger(env.GOOGLE_STREETVIEW_PITCH, -20, 20, 0),
  };
}

function googleUrl(pathname, params) {
  const url = new URL(`https://${GOOGLE_MAPS_HOST}${pathname}`);
  url.search = new URLSearchParams(params).toString();
  return url;
}

async function fetchWithTimeout(fetchImpl, url, options, timeoutMs) {
  if (typeof fetchImpl !== 'function') {
    throw new PropertyImageError(503, 'upstream_unavailable', 'Street View transport is unavailable.');
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...options, signal: controller.signal });
  } catch (_) {
    throw new PropertyImageError(503, 'upstream_unavailable', 'Street View could not be reached.');
  } finally {
    clearTimeout(timeout);
  }
}

async function readBoundedBytes(response, maximumBytes, timeoutMs = 5000) {
  const declaredLength = Number(headerValue(response?.headers, 'content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    void response.body?.cancel().catch(() => {});
    throw new PropertyImageError(502, 'upstream_invalid_response', 'Street View returned an invalid metadata response.');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new PropertyImageError(502, 'upstream_invalid_response', 'The image provider returned an empty response.');
  const chunks = [];
  let size = 0;
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new PropertyImageError(504, 'upstream_timeout', 'The image provider response timed out.')), timeoutMs);
  });
  try {
    while (true) {
      const result = await Promise.race([reader.read(), deadline]);
      if (result.done) break;
      size += result.value.byteLength;
      if (size > maximumBytes) throw new PropertyImageError(502, 'upstream_invalid_response', 'The image provider response was too large.');
      chunks.push(Buffer.from(result.value));
    }
    return Buffer.concat(chunks, size);
  } catch (error) {
    void reader.cancel().catch(() => {});
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function readBoundedText(response, maximumBytes) {
  return (await readBoundedBytes(response, maximumBytes)).toString('utf8');
}

function addressComponent(result, type) {
  const components = Array.isArray(result?.address_components) ? result.address_components : [];
  const component = components.find((candidate) => Array.isArray(candidate?.types) && candidate.types.includes(type));
  if (!component) return null;
  return {
    long: safeText(component.long_name, 160),
    short: safeText(component.short_name, 160),
  };
}

function exactRooftopGeocode(result, expected) {
  if (!result || typeof result !== 'object' || result.partial_match === true) return null;
  if (result?.geometry?.location_type !== 'ROOFTOP') return null;
  if (!Array.isArray(result.types) || !result.types.includes('street_address')) return null;

  const streetNumber = addressComponent(result, 'street_number');
  const route = addressComponent(result, 'route');
  const state = addressComponent(result, 'administrative_area_level_1');
  const postalCode = addressComponent(result, 'postal_code');
  const country = addressComponent(result, 'country');
  if (!streetNumber || !route || !state || !postalCode || !country) return null;

  const returnedStreetNumber = normalizeAddressToken(streetNumber.short || streetNumber.long);
  const returnedRoutes = [route.short, route.long].map(normalizeRouteName).filter(Boolean);
  const returnedState = String(state.short || '').toUpperCase();
  const returnedZip5 = String(postalCode.short || postalCode.long || '').slice(0, 5);
  const returnedCountry = String(country.short || '').toUpperCase();
  if (returnedStreetNumber !== expected.streetNumber
      || !returnedRoutes.includes(expected.route)
      || returnedState !== expected.state
      || returnedZip5 !== expected.zip5
      || returnedCountry !== 'US') {
    return null;
  }

  const lat = validCoordinate(result?.geometry?.location?.lat, -90, 90);
  const lng = validCoordinate(result?.geometry?.location?.lng, -180, 180);
  if (lat === null || lng === null || (lat === 0 && lng === 0)) return null;
  return { lat, lng };
}

function classifyGeocodingStatus(status, circuit) {
  if (status === 'ZERO_RESULTS') {
    circuit.success();
    throw new PropertyImageError(422, 'geocode_unavailable', 'The source-observed address could not be resolved to a rooftop coordinate.');
  }
  if (status === 'OVER_QUERY_LIMIT') {
    circuit.failure({ immediate: true });
    throw new PropertyImageError(503, 'geocoding_rate_limited', 'Address verification is temporarily rate limited.');
  }
  if (status === 'REQUEST_DENIED') {
    circuit.failure({ immediate: true });
    throw new PropertyImageError(503, 'geocoding_denied', 'Address verification is unavailable for the configured server key.');
  }
  circuit.failure();
  throw new PropertyImageError(502, 'geocoding_invalid_response', 'Address verification returned an invalid response.');
}

async function resolveEphemeralCoordinates({ fetchImpl, config, listing, circuit }) {
  const observedAddress = sourceObservedAddress(listing);
  if (!observedAddress) {
    throw new PropertyImageError(
      422,
      'exact_location_unavailable',
      'Source coordinates or a complete source-observed street address with state and ZIP are required.'
    );
  }

  circuit.assertAvailable();
  const geocodeUrl = googleUrl(GOOGLE_GEOCODING_PATH, {
    address: observedAddress.query,
    components: 'country:US',
    region: 'us',
    language: 'en',
    key: config.geocodingKey,
  });

  let response;
  try {
    response = await fetchWithTimeout(
      fetchImpl,
      geocodeUrl,
      { method: 'GET', redirect: 'error', headers: { Accept: 'application/json' } },
      config.timeoutMs
    );
  } catch (error) {
    circuit.failure();
    throw error;
  }
  if (!response || !response.ok) {
    circuit.failure({ immediate: response?.status === 403 || response?.status === 429 });
    throw new PropertyImageError(503, 'geocoding_unavailable', 'Address verification is temporarily unavailable.');
  }

  let payload;
  try {
    const contentType = headerValue(response.headers, 'content-type').toLowerCase();
    if (contentType && !contentType.includes('json')) throw new Error('not json');
    payload = JSON.parse(await readBoundedText(response, MAX_METADATA_BYTES));
  } catch (_) {
    circuit.failure();
    throw new PropertyImageError(502, 'geocoding_invalid_response', 'Address verification returned an invalid response.');
  }

  const status = safeText(payload?.status, 64);
  if (status !== 'OK') classifyGeocodingStatus(status, circuit);
  const candidates = Array.isArray(payload.results) ? payload.results : [];
  const resolved = candidates.length === 1 ? exactRooftopGeocode(candidates[0], observedAddress) : null;
  if (!resolved) {
    circuit.success();
    throw new PropertyImageError(
      422,
      'geocode_mismatch',
      'Address verification did not return one exact rooftop match for the source-observed address.'
    );
  }
  circuit.success();
  return {
    ...resolved,
    basis: 'source_observed_address_rooftop_geocode',
    resolution: {
      origin: 'google_geocoding_ephemeral',
      locationType: 'ROOFTOP',
      partialMatch: false,
      persisted: false,
    },
  };
}

function classifyMetadataStatus(status, circuit) {
  if (status === 'ZERO_RESULTS' || status === 'NOT_FOUND') {
    circuit.success();
    throw new PropertyImageError(404, 'street_view_unavailable', 'No outdoor Street View panorama was found near the property.');
  }
  if (status === 'OVER_QUERY_LIMIT') {
    circuit.failure({ immediate: true });
    throw new PropertyImageError(503, 'upstream_rate_limited', 'Street View is temporarily rate limited.');
  }
  if (status === 'REQUEST_DENIED') {
    circuit.failure({ immediate: true });
    throw new PropertyImageError(503, 'upstream_denied', 'Street View rejected the server request.');
  }
  circuit.failure();
  throw new PropertyImageError(502, 'upstream_invalid_response', 'Street View returned an invalid metadata response.');
}

async function resolvePanorama({ fetchImpl, config, listing, coordinates, circuit, now }) {
  circuit.assertAvailable();
  const metadataUrl = googleUrl(STREET_VIEW_METADATA_PATH, {
    location: `${coordinates.lat.toFixed(7)},${coordinates.lng.toFixed(7)}`,
    radius: String(config.radiusMeters),
    source: 'outdoor',
    key: config.key,
  });

  let response;
  try {
    response = await fetchWithTimeout(
      fetchImpl,
      metadataUrl,
      { method: 'GET', redirect: 'error', headers: { Accept: 'application/json' } },
      config.timeoutMs
    );
  } catch (error) {
    circuit.failure();
    throw error;
  }

  if (!response || !response.ok) {
    circuit.failure({ immediate: response?.status === 403 || response?.status === 429 });
    throw new PropertyImageError(503, 'upstream_unavailable', 'Street View metadata is temporarily unavailable.');
  }

  let metadata;
  try {
    const contentType = headerValue(response.headers, 'content-type').toLowerCase();
    if (contentType && !contentType.includes('json')) throw new Error('not json');
    metadata = JSON.parse(await readBoundedText(response, MAX_METADATA_BYTES));
  } catch (_) {
    circuit.failure();
    throw new PropertyImageError(502, 'upstream_invalid_response', 'Street View returned an invalid metadata response.');
  }

  const status = safeText(metadata?.status, 64);
  if (status !== 'OK') classifyMetadataStatus(status, circuit);
  const panoId = safeText(metadata?.pano_id, 512);
  const panoramaLat = validCoordinate(metadata?.location?.lat, -90, 90);
  const panoramaLng = validCoordinate(metadata?.location?.lng, -180, 180);
  if (!panoId || !/^[A-Za-z0-9_-]{5,512}$/.test(panoId) || panoramaLat === null || panoramaLng === null) {
    circuit.failure();
    throw new PropertyImageError(502, 'upstream_invalid_response', 'Street View metadata did not identify a valid panorama.');
  }

  const measuredDistance = distanceMeters(panoramaLat, panoramaLng, coordinates.lat, coordinates.lng);
  if (!Number.isFinite(measuredDistance) || measuredDistance > config.maximumDistanceMeters) {
    circuit.success();
    throw new PropertyImageError(
      422,
      'panorama_mismatch',
      'The nearest Street View panorama is too far from the exact property coordinates.'
    );
  }

  const upstreamCopyright = safeText(metadata?.copyright, 160);
  const attribution = upstreamCopyright
    ? (/google maps/i.test(upstreamCopyright) ? upstreamCopyright : `${upstreamCopyright} · Google Maps`)
    : 'Google Maps';
  const captureDate = /^\d{4}(?:-(?:0[1-9]|1[0-2]))?$/.test(String(metadata?.date || ''))
    ? String(metadata.date)
    : null;
  const distance = Number(measuredDistance.toFixed(1));
  const heading = Number(bearingDegrees(panoramaLat, panoramaLng, coordinates.lat, coordinates.lng).toFixed(1));
  const observedAt = new Date(now()).toISOString();
  circuit.success();

  return {
    available: true,
    kind: 'street_view',
    provider: 'Google Maps',
    attribution,
    captureDate,
    distanceMeters: distance,
    heading,
    provenance: {
      origin: 'google_street_view',
      observed: true,
      observedAt,
      recordKind: 'street_view_panorama',
      publisher: 'Google Maps',
      listingId: String(listing.id),
      matchBasis: `${coordinates.basis}_and_panorama_distance`,
      exactPropertyVerified: false,
      panoramaReference: 'ephemeral_not_disclosed',
      ...(coordinates.resolution ? { coordinateResolution: coordinates.resolution } : {}),
    },
    // Kept server-side for the immediately following image request. This is
    // removed from the public metadata response and every response header.
    _panoId: panoId,
  };
}

function imageMagicMatches(contentType, buffer) {
  if (contentType === 'image/jpeg') return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (contentType === 'image/png') {
    return buffer.length >= 8
      && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47
      && buffer[4] === 0x0d && buffer[5] === 0x0a && buffer[6] === 0x1a && buffer[7] === 0x0a;
  }
  return false;
}

async function resolveImageBytes({ fetchImpl, config, panorama, circuit }) {
  circuit.assertAvailable();
  const imageUrl = googleUrl(STREET_VIEW_IMAGE_PATH, {
    size: '640x480',
    pano: panorama._panoId,
    heading: String(panorama.heading),
    fov: String(config.fov),
    pitch: String(config.pitch),
    return_error_code: 'true',
    key: config.key,
  });

  let response;
  try {
    response = await fetchWithTimeout(
      fetchImpl,
      imageUrl,
      { method: 'GET', redirect: 'error', headers: { Accept: 'image/jpeg,image/png' } },
      config.timeoutMs
    );
  } catch (error) {
    circuit.failure();
    throw error;
  }

  if (!response || !response.ok) {
    circuit.failure({ immediate: response?.status === 403 || response?.status === 429 });
    throw new PropertyImageError(503, 'upstream_unavailable', 'Street View image is temporarily unavailable.');
  }

  const contentTypeHeader = headerValue(response.headers, 'content-type').toLowerCase();
  const contentType = contentTypeHeader.split(';')[0].trim();
  const declaredLength = Number(headerValue(response.headers, 'content-length'));
  if (!['image/jpeg', 'image/png'].includes(contentType)
      || (Number.isFinite(declaredLength) && declaredLength > MAX_IMAGE_BYTES)) {
    circuit.failure();
    throw new PropertyImageError(502, 'upstream_non_image', 'Street View did not return a valid image.');
  }

  let buffer;
  try { buffer = await readBoundedBytes(response, MAX_IMAGE_BYTES, config.timeoutMs); }
  catch (error) { circuit.failure(); throw error; }
  if (buffer.length < 100 || buffer.length > MAX_IMAGE_BYTES || !imageMagicMatches(contentType, buffer)) {
    circuit.failure();
    throw new PropertyImageError(502, 'upstream_non_image', 'Street View did not return a valid image.');
  }
  circuit.success();
  return { buffer, contentType };
}

function baseHeaders() {
  return {
    'Cache-Control': 'no-store, max-age=0',
    Pragma: 'no-cache',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Resource-Policy': 'same-origin',
    Vary: 'Origin',
  };
}

function errorResult(error) {
  const expected = error instanceof PropertyImageError;
  const headers = { ...baseHeaders(), 'Content-Type': 'application/json; charset=utf-8' };
  if (expected && error.retryAfterSeconds) headers['Retry-After'] = String(error.retryAfterSeconds);
  return {
    status: expected ? error.status : 500,
    headers,
    body: {
      available: false,
      error: expected ? error.code : 'property_image_error',
      reason: expected ? error.message : 'Property image lookup failed.',
    },
  };
}

function createPropertyImageService(options = {}) {
  const database = options.db || db;
  const fetchImpl = options.fetchImpl || ((...args) => globalThis.fetch(...args));
  const env = options.env || process.env;
  const now = options.now || Date.now;
  const circuit = options.circuit || new ProviderCircuit({
    failureThreshold: env.GOOGLE_STREETVIEW_CIRCUIT_THRESHOLD,
    cooldownMs: env.GOOGLE_STREETVIEW_CIRCUIT_COOLDOWN_MS,
    now,
  });
  const geocodingCircuit = options.geocodingCircuit || new ProviderCircuit({
    failureThreshold: env.GOOGLE_GEOCODING_CIRCUIT_THRESHOLD || env.GOOGLE_STREETVIEW_CIRCUIT_THRESHOLD,
    cooldownMs: env.GOOGLE_GEOCODING_CIRCUIT_COOLDOWN_MS || env.GOOGLE_STREETVIEW_CIRCUIT_COOLDOWN_MS,
    now,
  });
  const limiter = options.limiter || new FixedWindowRateLimiter({
    maxRequests: env.PROPERTY_IMAGE_RATE_LIMIT,
    windowMs: env.PROPERTY_IMAGE_RATE_WINDOW_MS,
    now,
  });
  const gate = options.gate || new BoundedConcurrencyGate({
    concurrency: env.PROPERTY_IMAGE_CONCURRENCY,
    maxQueue: env.PROPERTY_IMAGE_MAX_QUEUE,
  });

  async function resolve(req) {
    try {
      if (String(req?.method || '').toUpperCase() !== 'GET') {
        throw new PropertyImageError(405, 'method_not_allowed', 'Only GET is allowed for property images.');
      }
      const url = requestUrl(req);
      assertSameOrigin(req, url);
      const listingId = safeText(url.searchParams.get('listingId'), 160);
      if (!listingId) throw new PropertyImageError(400, 'missing_listing_id', 'listingId is required.');
      if (!/^[A-Za-z0-9._:-]{1,160}$/.test(listingId)) {
        throw new PropertyImageError(400, 'invalid_listing_id', 'listingId is invalid.');
      }
      const mode = safeText(url.searchParams.get('mode') || 'metadata', 16)?.toLowerCase();
      if (mode !== 'metadata' && mode !== 'image') {
        throw new PropertyImageError(400, 'invalid_mode', 'mode must be metadata or image.');
      }

      limiter.consume();
      const listing = await database.getListingById(listingId);
      if (!listing) throw new PropertyImageError(404, 'listing_not_found', 'Listing not found.');
      validateListingForStreetView(listing);
      const config = runtimeConfig(env);

      return await gate.run(async () => {
        const coordinates = sourceCoordinates(listing)
          || await resolveEphemeralCoordinates({ fetchImpl, config, listing, circuit: geocodingCircuit });
        const panorama = await resolvePanorama({ fetchImpl, config, listing, coordinates, circuit, now });
        if (mode === 'metadata') {
          const { _panoId, ...publicMetadata } = panorama;
          return {
            status: 200,
            headers: { ...baseHeaders(), 'Content-Type': 'application/json; charset=utf-8' },
            body: publicMetadata,
          };
        }

        const image = await resolveImageBytes({ fetchImpl, config, panorama, circuit });
        const extension = image.contentType === 'image/png' ? 'png' : 'jpg';
        return {
          status: 200,
          headers: {
            ...baseHeaders(),
            'Content-Type': image.contentType,
            'Content-Length': String(image.buffer.length),
            'Content-Disposition': `inline; filename="street-view-${listingId}.${extension}"`,
            'X-Property-Image-Provider': 'Google Maps',
            'X-Property-Image-Attribution': 'Google Maps',
            'X-Property-Image-Distance-Meters': String(panorama.distanceMeters),
            'X-Property-Image-Heading': String(panorama.heading),
            ...(panorama.captureDate ? { 'X-Property-Image-Capture-Date': panorama.captureDate } : {}),
          },
          body: image.buffer,
        };
      });
    } catch (error) {
      return errorResult(error);
    }
  }

  return { resolve, circuit, geocodingCircuit, limiter, gate };
}

function writeResult(res, result) {
  for (const [name, value] of Object.entries(result.headers || {})) res.setHeader(name, value);
  res.statusCode = result.status;
  if (Buffer.isBuffer(result.body)) return res.end(result.body);
  return res.end(JSON.stringify(result.body));
}

const defaultService = createPropertyImageService();

async function handlePropertyImage(req, res) {
  const result = await defaultService.resolve(req);
  return writeResult(res, result);
}

module.exports = handlePropertyImage;
module.exports.BoundedConcurrencyGate = BoundedConcurrencyGate;
module.exports.FixedWindowRateLimiter = FixedWindowRateLimiter;
module.exports.GOOGLE_MAPS_HOST = GOOGLE_MAPS_HOST;
module.exports.PropertyImageError = PropertyImageError;
module.exports.ProviderCircuit = ProviderCircuit;
module.exports.bearingDegrees = bearingDegrees;
module.exports.createPropertyImageService = createPropertyImageService;
module.exports.distanceMeters = distanceMeters;
module.exports.exactRooftopGeocode = exactRooftopGeocode;
module.exports.hasSourceObservedProvenance = hasSourceObservedProvenance;
module.exports.hasUsablePublisherPhoto = hasUsablePublisherPhoto;
module.exports.resolveEphemeralCoordinates = resolveEphemeralCoordinates;
module.exports.resolveRequest = defaultService.resolve;
module.exports.sourceCoordinates = sourceCoordinates;
module.exports.sourceObservedAddress = sourceObservedAddress;
module.exports.validateListingForStreetView = validateListingForStreetView;
module.exports.writeResult = writeResult;
