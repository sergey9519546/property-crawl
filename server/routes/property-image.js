'use strict';

const db = require('../db/client');
const { inspectSourceRecordUrl } = require('../scrapers/source-policy');
const { inspectPublisherPhoto } = require('../scrapers/media-policy');
const { lookupPanoramax } = require('../media/panoramax');
const { lookupMapillary } = require('../media/mapillary');
const { createProviderCache } = require('../media/provider-cache');
const { isUsStateOrTerritoryCode } = require('../state-codes');

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
  constructor({ failureThreshold = 3, cooldownMs = 60_000, now = Date.now, unavailableMessage = 'Street View is temporarily unavailable.' } = {}) {
    this.failureThreshold = clampInteger(failureThreshold, 1, 10, 3);
    this.cooldownMs = clampInteger(cooldownMs, 1_000, 15 * 60_000, 60_000);
    this.now = now;
    this.unavailableMessage = unavailableMessage;
    this.failures = 0;
    this.openedUntil = 0;
  }

  assertAvailable() {
    const timestamp = this.now();
    if (this.openedUntil > timestamp) {
      throw new PropertyImageError(503, 'circuit_open', this.unavailableMessage, {
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
  constructor({ maxRequests = 30, windowMs = 60_000, now = Date.now, trustedProxyCount = 0 } = {}) {
    this.maxRequests = clampInteger(maxRequests, 1, 120, 30);
    this.windowMs = clampInteger(windowMs, 1_000, 10 * 60_000, 60_000);
    this.now = now;
    // Forwarded headers are caller-controlled without a trusted edge. When
    // TRUSTED_PROXY_COUNT > 0 we parse X-Forwarded-For from the right (the
    // address seen by the innermost trusted proxy); otherwise we fall back to
    // the direct socket address so an attacker cannot mint per-IP buckets.
    this.trustedProxyCount = Math.max(0, Math.floor(Number(trustedProxyCount) || 0));
    this.buckets = new Map();

    // Periodic eviction so stale IP records are removed regardless of traffic
    // volume. .unref() ensures this timer doesn't keep the Node process alive
    // after all other async work has completed (e.g. in tests).
    this._evictTimer = setInterval(() => {
      const now = this.now();
      for (const [key, record] of this.buckets.entries()) {
        if (now > record.resetAt) this.buckets.delete(key);
      }
    }, this.windowMs).unref();
  }

  // Best-effort client IP. Without a trusted proxy count we never trust
  // caller-controlled X-Forwarded-For and use the direct socket address.
  static clientIp(req, trustedProxyCount = 0) {
    const count = Math.max(0, Math.floor(Number(trustedProxyCount) || 0));
    if (count > 0) {
      const forwarded = String(req?.headers?.['x-forwarded-for'] || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const idx = forwarded.length - count;
      const ip = (idx >= 0 && forwarded[idx]) || req?.socket?.remoteAddress || 'unknown';
      return ip;
    }
    return req?.socket?.remoteAddress || 'unknown';
  }

  consume(key = 'global') {
    const timestamp = this.now();
    let record = this.buckets.get(key);
    if (!record || timestamp >= record.resetAt) {
      record = { count: 0, resetAt: timestamp + this.windowMs };
    }
    record.count += 1;
    this.buckets.set(key, record);
    if (record.count > this.maxRequests) {
      throw new PropertyImageError(429, 'rate_limited', 'Property image lookup rate limit exceeded.', {
        retryAfterSeconds: Math.max(1, Math.ceil((record.resetAt - timestamp) / 1000)),
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

function hasSourceIdentifiedArchive(listing) {
  const provenance=listing?.provenance;
  return Boolean(provenance&&typeof provenance==='object'&&provenance.origin==='archive'&&provenance.observed===true
    &&safeText(provenance.publisher,256)&&safeText(provenance.recordId,256)&&sourceObservedAddress(listing));
}

function validateListingForStreetView(listing, mode = 'metadata') {
  // A requested interactive tour complements publisher photos. Automatic
  // image fallback still prefers those photos and avoids unnecessary calls.
  if (mode !== 'walkthrough' && mode !== 'alternatives' && hasUsablePublisherPhoto(listing)) {
    throw new PropertyImageError(409, 'publisher_photo_available', 'The publisher already supplies a usable property photo.');
  }
  const liveObserved=hasSourceObservedProvenance(listing),archiveIdentified=hasSourceIdentifiedArchive(listing);
  if (!liveObserved && !archiveIdentified) {
    throw new PropertyImageError(
      422,
      'listing_not_source_observed',
      'Street View requires a source-identified record with verified target geometry or an exact address.'
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

  return { sourceUrl: sourceInspection.url, identityBasis: liveObserved?'current_source_record':'archived_source_record' };
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
  const rawStreetPart = fullAddress?.split(',')[0].trim();
  // Recover numbered street addresses that carry a lot/parcel label prefix (e.g.
  // "LOT 2: 139-B Farless Road"), while still rejecting bare lot/parcel/vacant labels.
  const address = rawStreetPart
    ? rawStreetPart.replace(/^(?:lot|parcel)\s+[A-Za-z0-9-]+\s*[:,-]\s*(?=\d+[A-Za-z]?(?:-[A-Za-z0-9]+)?\s+[A-Za-z])/i, '').trim()
    : null;
  const city = safeText(listing?.city, 128);
  const state = safeText(listing?.state, 2)?.toUpperCase();
  const zip = safeText(listing?.zip, 10);
  if (!address || !city || !state || !zip || !isUsStateOrTerritoryCode(state) || !/^\d{5}(?:-\d{4})?$/.test(zip)) {
    return null;
  }
  if (/^(?:p\.?\s*o\.?\s*box|lot\b|parcel\b|vacant\b)/i.test(address)) return null;
  const streetMatch = address.match(/^\s*(\d+[A-Za-z]?(?:-[A-Za-z0-9]+)?)\s+(.{2,})$/);
  if (!streetMatch) return null;
  const streetNumber = normalizeAddressToken(streetMatch[1]);
  const route = normalizeRouteName(streetMatch[2]);
  if (!streetNumber || !route) return null;
  return {
    street: address,
    city,
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

function resolveGeocodingConfig(env) {
  const geocodingKey = safeText(env?.GOOGLE_GEOCODING_API_KEY, 1024) || safeText(env?.GOOGLE_MAPS_API_KEY, 1024);
  if (!geocodingKey) {
    throw new PropertyImageError(503, 'not_configured', 'Street View fallback is not configured.');
  }
  return {
    geocodingKey,
    timeoutMs: clampInteger(env.GOOGLE_STREETVIEW_TIMEOUT_MS, 500, 10_000, 5_000),
  };
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

function mapsLaunchUrl({panoId,targetLat,targetLng,heading,config}) {
  const url=new URL('https://www.google.com/maps/@');
  url.search=new URLSearchParams({api:'1',map_action:'pano',viewpoint:`${targetLat.toFixed(7)},${targetLng.toFixed(7)}`,pano:panoId,heading:String(heading),pitch:String(config.pitch),fov:String(config.fov)}).toString();
  return url.toString();
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

function exactCensusGeocode(match, expected) {
  if (!match || typeof match !== 'object') return null;
  const matchedAddress = safeText(match.matchedAddress, 256);
  const numberMatch = matchedAddress?.match(/^\s*(\d+[A-Za-z]?(?:-[A-Za-z0-9]+)?)\b/);
  if (!numberMatch) return null;
  const returnedStreetNumber = normalizeAddressToken(numberMatch[1]);
  const comps = match.addressComponents && typeof match.addressComponents === 'object' ? match.addressComponents : {};
  const componentStreet = [comps.preDirection, comps.streetName, comps.suffixType, comps.postDirection].filter(Boolean).join(' ');
  const matchedStreet = matchedAddress.split(',')[0].replace(/^\s*\d+[A-Za-z]?(?:-[A-Za-z0-9]+)?\s+/, '');
  const returnedRoutes = [componentStreet, matchedStreet].map(normalizeRouteName).filter(Boolean);
  const returnedState = String(comps.state || '').trim().toUpperCase();
  const returnedZip5 = String(comps.zip || '').trim().slice(0, 5);
  if (returnedStreetNumber !== expected.streetNumber
      || !returnedRoutes.includes(expected.route)
      || returnedState !== expected.state
      || returnedZip5 !== expected.zip5) {
    return null;
  }
  const lat = validCoordinate(match?.coordinates?.y, -90, 90);
  const lng = validCoordinate(match?.coordinates?.x, -180, 180);
  if (lat === null || lng === null || (lat === 0 && lng === 0)) return null;
  return { lat, lng };
}

async function resolveCensusCoordinates({ fetchImpl, observedAddress, timeoutMs = 5_000 }) {
  if (!observedAddress || typeof fetchImpl !== 'function') return null;
  const url = new URL('https://geocoding.geo.census.gov/geocoder/locations/address');
  url.search = new URLSearchParams({
    street: observedAddress.street,
    city: observedAddress.city,
    state: observedAddress.state,
    zip: observedAddress.zip5,
    benchmark: 'Public_AR_Current',
    format: 'json',
  }).toString();
  try {
    const response = await fetchWithTimeout(
      fetchImpl,
      url,
      { method: 'GET', redirect: 'error', headers: { Accept: 'application/json' } },
      timeoutMs
    );
    if (!response || !response.ok) return null;
    const payload = JSON.parse(await readBoundedText(response, MAX_METADATA_BYTES));
    const matches = Array.isArray(payload?.result?.addressMatches) ? payload.result.addressMatches : [];
    const verified = matches.map((m) => exactCensusGeocode(m, observedAddress)).filter(Boolean);
    if (verified.length !== 1) return null;
    return {
      ...verified[0],
      basis: 'source_observed_address_census_geocode',
      resolution: {
        origin: 'us_census_geocoder_ephemeral',
        locationType: 'RANGE_INTERPOLATED',
        partialMatch: false,
        persisted: false,
      },
    };
  } catch (_) {
    return null;
  }
}

async function resolveArcgisCoordinates({ fetchImpl, observedAddress, timeoutMs = 5_000 }) {
  if (!observedAddress?.query || typeof fetchImpl !== 'function') return null;
  const url = new URL('https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates');
  url.search = new URLSearchParams({
    SingleLine: observedAddress.query,
    countryCode: 'USA',
    maxLocations: '1',
    outFields: 'Match_addr,Addr_type,StAddr,Postal,RegionAbbr',
    f: 'pjson',
  }).toString();
  try {
    const response = await fetchWithTimeout(
      fetchImpl,
      url,
      { method: 'GET', redirect: 'error', headers: { Accept: 'application/json' } },
      timeoutMs
    );
    if (!response || !response.ok) return null;
    const payload = JSON.parse(await readBoundedText(response, MAX_METADATA_BYTES));
    const candidate = Array.isArray(payload?.candidates) ? payload.candidates[0] : null;
    if (!candidate || Number(candidate.score) < 88) return null;
    const addrType = String(candidate?.attributes?.Addr_type || '');
    if (!['PointAddress', 'StreetAddress', 'Subaddress', 'Parcel'].includes(addrType)) return null;
    const lat = validCoordinate(candidate?.location?.y, -90, 90);
    const lng = validCoordinate(candidate?.location?.x, -180, 180);
    if (lat === null || lng === null || (lat === 0 && lng === 0)) return null;
    const returnedState = String(candidate?.attributes?.RegionAbbr || '').trim().toUpperCase();
    if (observedAddress.state && returnedState && returnedState !== observedAddress.state) return null;
    return {
      lat,
      lng,
      basis: 'source_observed_address_arcgis_geocode',
      resolution: {
        origin: 'arcgis_world_geocoder_ephemeral',
        locationType: addrType,
        partialMatch: false,
        persisted: false,
      },
    };
  } catch (_) {
    return null;
  }
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
    panoramaId: panoId,
    panoramaLocation: { lat: panoramaLat, lng: panoramaLng },
    targetHeading: heading,
    mapsLaunchUrl: mapsLaunchUrl({panoId,targetLat:coordinates.lat,targetLng:coordinates.lng,heading,config}),
    provenance: {
      origin: 'google_street_view',
      observed: true,
      observedAt,
      recordKind: 'street_view_panorama',
      publisher: 'Google Maps',
      listingId: String(listing.id),
      matchBasis: `${coordinates.basis}_and_panorama_distance`,
      exactPropertyVerified: false,
      panoramaReference: 'provider_identifier',
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

function panoramaxViewerUrl(candidate) {
  if (!candidate?.pictureId || !/^[A-Za-z0-9_-]{1,200}$/.test(candidate.pictureId)) return null;
  const url = new URL('https://api.panoramax.xyz/');
  url.searchParams.set('focus', 'pic');
  url.searchParams.set('pic', candidate.pictureId);
  const lat = candidate?.location?.lat;
  const lng = candidate?.location?.lng;
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    url.searchParams.set('map', `${lat.toFixed(7)},${lng.toFixed(7)}`);
  }
  return url.toString();
}

function sanitizeAlternativeCandidates(entries, toPublicCandidate) {
  return (Array.isArray(entries) ? entries : [])
    .filter((entry) => entry?.license?.displayApproved === true)
    .map(toPublicCandidate);
}

function sanitizePrimaryCandidate(candidate, toPublicCandidate) {
  return candidate?.license?.displayApproved === true ? toPublicCandidate(candidate) : null;
}

function publicPanoramaxCandidate(candidate) {
  return {
    ...candidate,
    viewerUrl: panoramaxViewerUrl(candidate),
  };
}

function mapillaryViewerUrl(candidate) {
  if (!candidate?.pictureId || !/^[A-Za-z0-9_-]{1,200}$/.test(candidate.pictureId)) return null;
  const url = new URL('https://www.mapillary.com/app/');
  url.searchParams.set('focus', 'photo');
  url.searchParams.set('photoId', candidate.pictureId);
  return url.toString();
}

function publicMapillaryCandidate(candidate) {
  return {
    ...candidate,
    viewerUrl: mapillaryViewerUrl(candidate),
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
    unavailableMessage: 'Address verification is temporarily unavailable.',
  });
  const limiter = options.limiter || new FixedWindowRateLimiter({
    maxRequests: env.PROPERTY_IMAGE_RATE_LIMIT ?? 60,
    windowMs: env.PROPERTY_IMAGE_RATE_WINDOW_MS,
    now,
    trustedProxyCount: env.TRUSTED_PROXY_COUNT,
  });
  const censusFallbackEnabled = env.PROPERTY_IMAGE_CENSUS_GEOCODER_FALLBACK === '1';
  const trustedProxyCount = Math.max(0, Math.floor(Number(env.TRUSTED_PROXY_COUNT) || 0));
  const gate = options.gate || new BoundedConcurrencyGate({
    concurrency: env.PROPERTY_IMAGE_CONCURRENCY,
    maxQueue: env.PROPERTY_IMAGE_MAX_QUEUE,
  });
  const panoramaxCache = options.panoramaxCache || createProviderCache({
    ttlMs: env.PANORAMAX_CACHE_TTL_MS,
    maxEntries: env.PANORAMAX_CACHE_MAX_ENTRIES,
    now
  });
  const mapillaryCache = options.mapillaryCache || createProviderCache({
    ttlMs: env.MAPILLARY_CACHE_TTL_MS,
    maxEntries: env.MAPILLARY_CACHE_MAX_ENTRIES,
    now
  });
  const panoramaInFlight = new Map();

  async function coalescedPanorama(listing,coordinates,config){
    const key=`${listing.id}\n${listing.sourceObservedAt||listing.provenance?.observedAt||''}\n${coordinates.lat},${coordinates.lng}\n${config.radiusMeters}:${config.maximumDistanceMeters}`;
    // Only share concurrent work. Google permits caching panorama IDs, but
    // completed metadata and image content are not retained by this service.
    if(panoramaInFlight.has(key))return panoramaInFlight.get(key);
    const pending=resolvePanorama({fetchImpl,config,listing,coordinates,circuit,now}).finally(()=>panoramaInFlight.delete(key));
    panoramaInFlight.set(key,pending);return pending;
  }

  // Try Panoramax as a fallback when Google Street View returns no nearby
  // imagery. The metadata path returns the Panoramax candidate directly; the
  // caller labels the response with provider:'panoramax_fallback' so the UI
  // can distinguish the source. Errors are swallowed — Panoramax being
  // down should never turn into a 5xx when Google already returned its own
  // graceful "no imagery here" answer.
  async function tryPanoramaxFallback({ coordinates, env, fetchImpl, cache, primaryUnavailableReason = 'street_view_unavailable' }) {
    let lookup;
    try {
      lookup = await lookupPanoramax(coordinates, {
        fetchImpl,
        radiusMeters: clampInteger(env.PANORAMAX_RADIUS_METERS, 1, 100, 100),
        limit: clampInteger(env.PANORAMAX_RESULT_LIMIT, 1, 10, 10),
        timeoutMs: clampInteger(env.PANORAMAX_TIMEOUT_MS, 500, 15_000, 8_000),
        cache
      });
    } catch (_) {
      return null;
    }
    const candidate = sanitizePrimaryCandidate(lookup?.candidate, publicPanoramaxCandidate);
    if (!candidate) return null;
    return {
      available: true,
      provider: 'panoramax_fallback',
      primaryProvider: 'Google Street View',
      primaryUnavailableReason,
      candidate,
      panoramicMetadata: sanitizeAlternativeCandidates(lookup.panoramicMetadata, publicPanoramaxCandidate),
      directionalSequences: sanitizeAlternativeCandidates(lookup.directionalSequences, publicPanoramaxCandidate),
      reason: lookup.reason,
      queriedRadiusMeters: lookup.queriedRadiusMeters,
      exactPropertyVerified: false,
      coordinateBasis: coordinates.basis,
      coverage: 'community_alternative'
    };
  }

  // Mapillary fallback. Same opt-in contract as tryPanoramaxFallback:
  // only runs when PROPERTY_IMAGE_GOOGLE_MAPILLARY_FALLBACK=1. Returns the
  // first Mapillary candidate near the listing's coordinates, with the
  // directional/panoramic metadata list. Errors are swallowed so a
  // Mapillary outage can never turn a Google "no imagery here" answer into
  // a 5xx.
  async function tryMapillaryFallback({ coordinates, env, fetchImpl, cache, primaryUnavailableReason = 'street_view_unavailable' }) {
    let lookup;
    try {
      lookup = await lookupMapillary(coordinates, {
        fetchImpl,
        env,
        radiusMeters: clampInteger(env.MAPILLARY_RADIUS_METERS, 1, 100, 100),
        limit: clampInteger(env.MAPILLARY_RESULT_LIMIT, 1, 10, 10),
        timeoutMs: clampInteger(env.MAPILLARY_TIMEOUT_MS, 500, 15_000, 8_000),
        cache
      });
    } catch (_) {
      return null;
    }
    const candidate = sanitizePrimaryCandidate(lookup?.candidate, publicMapillaryCandidate);
    if (!candidate) return null;
    return {
      available: true,
      provider: 'mapillary_fallback',
      primaryProvider: 'Google Street View',
      primaryUnavailableReason,
      candidate,
      panoramicMetadata: sanitizeAlternativeCandidates(lookup.panoramicMetadata, publicMapillaryCandidate),
      directionalSequences: sanitizeAlternativeCandidates(lookup.directionalSequences, publicMapillaryCandidate),
      reason: lookup.reason,
      queriedRadiusMeters: lookup.queriedRadiusMeters,
      exactPropertyVerified: false,
      coordinateBasis: coordinates.basis,
      coverage: 'community_alternative'
    };
  }

  async function tryMetadataFallbacks({ coordinates, primaryUnavailableReason }) {
    if (env.PROPERTY_IMAGE_GOOGLE_PANORAMAX_FALLBACK === '1') {
      const fallback = await tryPanoramaxFallback({
        coordinates,
        env,
        fetchImpl,
        cache: panoramaxCache,
        primaryUnavailableReason,
      });
      if (fallback) return fallback;
    }
    if (env.PROPERTY_IMAGE_GOOGLE_MAPILLARY_FALLBACK === '1') {
      const fallback = await tryMapillaryFallback({
        coordinates,
        env,
        fetchImpl,
        cache: mapillaryCache,
        primaryUnavailableReason,
      });
      if (fallback) return fallback;
    }
    return null;
  }

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
      if (!['metadata', 'walkthrough', 'image', 'alternatives', 'aerial'].includes(mode)) {
        throw new PropertyImageError(400, 'invalid_mode', 'mode must be metadata, walkthrough, image, alternatives, or aerial.');
      }

      limiter.consume(FixedWindowRateLimiter.clientIp(req, trustedProxyCount));
      const listing = await database.getListingById(listingId);
      if (!listing) throw new PropertyImageError(404, 'listing_not_found', 'Listing not found.');

      if (mode === 'aerial') {
        const directLat = validCoordinate(listing?.lat, -90, 90);
        const directLng = validCoordinate(listing?.lng, -180, 180);
        let aerialCoords = sourceCoordinates(listing)
          || (directLat !== null && directLng !== null && !(directLat === 0 && directLng === 0)
            ? { lat: directLat, lng: directLng, basis: 'listing_coordinates' }
            : null);
        if (!aerialCoords) {
          const observedAddress = sourceObservedAddress(listing) || (safeText(listing?.address, 256)
            ? {
                query: [listing.address, listing.city, listing.state, listing.zip].filter(Boolean).join(', '),
                street: String(listing.address || '').split(',')[0].trim(),
                city: String(listing.city || '').trim(),
                state: String(listing.state || '').trim().toUpperCase(),
                zip5: String(listing.zip || '').trim().slice(0, 5),
              }
            : null);
          if (observedAddress) {
            const timeoutMs = clampInteger(env.GOOGLE_STREETVIEW_TIMEOUT_MS, 500, 10_000, 5_000);
            aerialCoords = await resolveCensusCoordinates({ fetchImpl, observedAddress, timeoutMs })
              || await resolveArcgisCoordinates({ fetchImpl, observedAddress, timeoutMs });
          }
        }
        if (!aerialCoords) {
          throw new PropertyImageError(422, 'exact_location_unavailable', 'Aerial parcel imagery requires verified coordinates or a complete street address.');
        }
        return await gate.run(async () => {
          const deltaLng = 0.0008;
          const deltaLat = 0.0006;
          const exportUrl = new URL('https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export');
          exportUrl.search = new URLSearchParams({
            bbox: `${(aerialCoords.lng - deltaLng).toFixed(6)},${(aerialCoords.lat - deltaLat).toFixed(6)},${(aerialCoords.lng + deltaLng).toFixed(6)},${(aerialCoords.lat + deltaLat).toFixed(6)}`,
            bboxSR: '4326',
            imageSR: '3857',
            size: '640,480',
            format: 'jpg',
            f: 'image',
          }).toString();
          const timeoutMs = clampInteger(env.GOOGLE_STREETVIEW_TIMEOUT_MS, 500, 10_000, 6_500);
          const aerialRes = await fetchWithTimeout(
            fetchImpl,
            exportUrl,
            { method: 'GET', redirect: 'error', headers: { Accept: 'image/jpeg,image/png' } },
            timeoutMs
          );
          if (!aerialRes || !aerialRes.ok) {
            throw new PropertyImageError(503, 'aerial_unavailable', 'Aerial satellite imagery is temporarily unavailable.');
          }
          const buffer = await readBoundedBytes(aerialRes, MAX_IMAGE_BYTES, timeoutMs);
          if (buffer.length < 100 || (!imageMagicMatches('image/jpeg', buffer) && !imageMagicMatches('image/png', buffer))) {
            throw new PropertyImageError(502, 'upstream_non_image', 'Aerial imagery service did not return a valid image.');
          }
          const contentType = imageMagicMatches('image/png', buffer) ? 'image/png' : 'image/jpeg';
          const ext = contentType === 'image/png' ? 'png' : 'jpg';
          return {
            status: 200,
            headers: {
              ...baseHeaders(),
              'Cache-Control': 'public, max-age=86400',
              'Content-Type': contentType,
              'Content-Length': String(buffer.length),
              'Content-Disposition': `inline; filename="aerial-${listingId}.${ext}"`,
              'X-Property-Image-Provider': 'Esri World Imagery',
              'X-Property-Image-Attribution': 'Esri, Maxar, Earthstar Geographics, USDA NAIP',
            },
            body: buffer,
          };
        });
      }
      const geocodingOutageCodes = new Set([
        'geocoding_denied',
        'geocoding_rate_limited',
        'circuit_open',
        'geocoding_unavailable',
        'upstream_unavailable',
      ]);
      const googleFallbackTriggerCodes = new Set([
        'street_view_unavailable',
        'panorama_mismatch',
        'upstream_denied',
        'circuit_open',
        'upstream_unavailable',
        'upstream_rate_limited',
      ]);

      async function resolveAlternativeCoordinates({ identityBasis, observedAddress, geocodeConfig }) {
        if (geocodeConfig) {
          try {
            return await resolveEphemeralCoordinates({ fetchImpl, config: geocodeConfig, listing, circuit: geocodingCircuit });
          } catch (error) {
            if (!geocodingOutageCodes.has(error?.code) || env.PROPERTY_IMAGE_CENSUS_GEOCODER_FALLBACK === '0') {
              throw error;
            }
            const census = await resolveCensusCoordinates({ fetchImpl, observedAddress, timeoutMs: geocodeConfig.timeoutMs });
            if (census) return census;
            throw error;
          }
        }
        if (identityBasis === 'current_source_record' && censusFallbackEnabled) {
          const timeoutMs = clampInteger(env.GOOGLE_STREETVIEW_TIMEOUT_MS, 500, 10_000, 5_000);
          const census = await resolveCensusCoordinates({ fetchImpl, observedAddress, timeoutMs });
          if (census) return census;
        }
        return resolveGeocodingConfig(env);
      }

      if (mode === 'alternatives') {
        const altIdentity = validateListingForStreetView(listing, 'alternatives');
        const localCoordinates = sourceCoordinates(listing);
        const observedAddress = localCoordinates ? null : sourceObservedAddress(listing);
        if (!localCoordinates && !observedAddress) {
          throw new PropertyImageError(
            422,
            'exact_location_unavailable',
            'Alternative imagery requires validated source coordinates or a complete source-observed street address with state and ZIP.'
          );
        }
        let geocodeConfig = null;
        if (!localCoordinates) {
          if (safeText(env?.GOOGLE_GEOCODING_API_KEY, 1024) || safeText(env?.GOOGLE_MAPS_API_KEY, 1024)) {
            geocodeConfig = resolveGeocodingConfig(env);
          } else if (!(altIdentity.identityBasis === 'current_source_record' && censusFallbackEnabled)) {
            throw new PropertyImageError(503, 'not_configured', 'Street View fallback is not configured.');
          }
        }
        return await gate.run(async () => {
          const coordinates = localCoordinates
            || await resolveAlternativeCoordinates({
              identityBasis: altIdentity.identityBasis,
              observedAddress,
              geocodeConfig,
            });
          // Panoramax and Mapillary run in parallel; each provider has its
          // own cache (provider-keyed) so the lookups do not duplicate work
          // across the two surfaces. A failure of one provider is isolated —
          // a Mapillary outage must not turn a successful Panoramax lookup
          // into a 5xx.
          const panoramaxOptions = {
            fetchImpl,
            radiusMeters: clampInteger(env.PANORAMAX_RADIUS_METERS, 1, 100, 100),
            limit: clampInteger(env.PANORAMAX_RESULT_LIMIT, 1, 10, 10),
            timeoutMs: clampInteger(env.PANORAMAX_TIMEOUT_MS, 500, 15_000, 8_000),
            cache: panoramaxCache
          };
          const mapillaryOptions = {
            fetchImpl,
            env,
            radiusMeters: clampInteger(env.MAPILLARY_RADIUS_METERS, 1, 100, 100),
            limit: clampInteger(env.MAPILLARY_RESULT_LIMIT, 1, 10, 10),
            timeoutMs: clampInteger(env.MAPILLARY_TIMEOUT_MS, 500, 15_000, 8_000),
            cache: mapillaryCache
          };
          const [panoramaxSettled, mapillarySettled] = await Promise.allSettled([
            lookupPanoramax(coordinates, panoramaxOptions),
            lookupMapillary(coordinates, mapillaryOptions),
          ]);
          const panoramaxLookup = panoramaxSettled.status === 'fulfilled' ? panoramaxSettled.value : null;
          const mapillaryLookup = mapillarySettled.status === 'fulfilled' ? mapillarySettled.value : null;
          // If BOTH providers' lookups rejected (e.g. invalid input), surface
          // a 503 — the alternatives surface cannot answer the question.
          if (!panoramaxLookup && !mapillaryLookup) {
            throw new PropertyImageError(503, 'alternative_provider_unavailable', 'Alternative imagery providers are temporarily unavailable.');
          }
          const panoramaxCandidate = sanitizePrimaryCandidate(panoramaxLookup?.candidate, publicPanoramaxCandidate);
          const mapillaryCandidate = sanitizePrimaryCandidate(mapillaryLookup?.candidate, publicMapillaryCandidate);
          // Primary candidate stays Panoramax-first for backward compatibility
          // with the existing UI surface; the merged response also exposes a
          // `providers` sub-block so callers can render both columns.
          const primaryCandidate = panoramaxCandidate || mapillaryCandidate;
          const directionalSequences = [
            ...sanitizeAlternativeCandidates(panoramaxLookup?.directionalSequences, publicPanoramaxCandidate),
            ...sanitizeAlternativeCandidates(mapillaryLookup?.directionalSequences, publicMapillaryCandidate),
          ];
          const panoramicMetadata = [
            ...sanitizeAlternativeCandidates(panoramaxLookup?.panoramicMetadata, publicPanoramaxCandidate),
            ...sanitizeAlternativeCandidates(mapillaryLookup?.panoramicMetadata, publicMapillaryCandidate),
          ];
          return {
            status: 200,
            headers: { ...baseHeaders(), 'Content-Type': 'application/json; charset=utf-8' },
            body: {
              provider: 'Panoramax + Mapillary',
              available: Boolean(primaryCandidate),
              candidate: primaryCandidate,
              directionalSequences,
              panoramicMetadata,
              reason: primaryCandidate ? null : (panoramaxLookup?.reason || mapillaryLookup?.reason || 'No alternative imagery providers returned a candidate.'),
              queriedRadiusMeters: panoramaxLookup?.queriedRadiusMeters || mapillaryLookup?.queriedRadiusMeters || 0,
              exactPropertyVerified: false,
              coordinateBasis: coordinates.basis,
              providers: {
                panoramax: {
                  available: Boolean(panoramaxCandidate),
                  candidate: panoramaxCandidate,
                  reason: panoramaxLookup?.reason || null,
                  queriedRadiusMeters: panoramaxLookup?.queriedRadiusMeters || 0,
                  error: panoramaxSettled.status === 'rejected' ? String(panoramaxSettled.reason?.message || panoramaxSettled.reason) : null,
                },
                mapillary: {
                  available: Boolean(mapillaryCandidate),
                  candidate: mapillaryCandidate,
                  reason: mapillaryLookup?.reason || null,
                  queriedRadiusMeters: mapillaryLookup?.queriedRadiusMeters || 0,
                  error: mapillarySettled.status === 'rejected' ? String(mapillarySettled.reason?.message || mapillarySettled.reason) : null,
                },
              },
            },
          };
        });
      }
      const identity=validateListingForStreetView(listing, mode);
      const fallbackEnabled = (mode === 'metadata' || mode === 'walkthrough') && (
        env.PROPERTY_IMAGE_GOOGLE_PANORAMAX_FALLBACK === '1'
        || env.PROPERTY_IMAGE_GOOGLE_MAPILLARY_FALLBACK === '1'
      );
      if (!safeText(env?.GOOGLE_MAPS_API_KEY, 1024) && fallbackEnabled) {
        const localCoordinates = ['current_source_record', 'archived_source_record'].includes(identity.identityBasis)
          ? sourceCoordinates(listing)
          : null;
        const observedAddress = !localCoordinates && identity.identityBasis === 'current_source_record' && censusFallbackEnabled
          ? sourceObservedAddress(listing)
          : null;
        if (localCoordinates || observedAddress) {
          return await gate.run(async () => {
            const timeoutMs = clampInteger(env.GOOGLE_STREETVIEW_TIMEOUT_MS, 500, 10_000, 5_000);
            const fallbackCoords = localCoordinates || await resolveCensusCoordinates({ fetchImpl, observedAddress, timeoutMs });
            const fallback = fallbackCoords
              ? await tryMetadataFallbacks({ coordinates: fallbackCoords, primaryUnavailableReason: 'not_configured' })
              : null;
            if (fallback) {
              return { status: 200, headers: { ...baseHeaders(), 'Content-Type': 'application/json; charset=utf-8' }, body: fallback };
            }
            runtimeConfig(env);
          });
        }
      }
      const config = runtimeConfig(env);

      return await gate.run(async () => {
        let coordinates = identity.identityBasis === 'current_source_record' ? sourceCoordinates(listing) : null;
        if (!coordinates) {
          try {
            coordinates = await resolveEphemeralCoordinates({ fetchImpl, config, listing, circuit: geocodingCircuit });
          } catch (error) {
            if (mode !== 'image' && fallbackEnabled && identity.identityBasis === 'current_source_record'
                && geocodingOutageCodes.has(error?.code) && env.PROPERTY_IMAGE_CENSUS_GEOCODER_FALLBACK !== '0') {
              const census = await resolveCensusCoordinates({
                fetchImpl,
                observedAddress: sourceObservedAddress(listing),
                timeoutMs: config.timeoutMs,
              });
              if (census) {
                const fallback = await tryMetadataFallbacks({ coordinates: census, primaryUnavailableReason: error.code });
                if (fallback) {
                  return {
                    status: 200,
                    headers: { ...baseHeaders(), 'Content-Type': 'application/json; charset=utf-8' },
                    body: fallback,
                  };
                }
              }
            }
            throw error;
          }
        }
        let panorama;
        try { panorama = await coalescedPanorama(listing, coordinates, config); }
        catch (error) {
          const retryable = ['street_view_unavailable', 'panorama_mismatch'].includes(error.code);
          if (mode === 'walkthrough' && retryable) {
            try {
              // A street tour may start farther away; static property imagery keeps
              // its stricter gate. The response discloses this distinction.
              const radius = clampInteger(env.GOOGLE_WALKTHROUGH_RADIUS_METERS, 100, 500, 500);
              panorama = await coalescedPanorama(listing, coordinates, { ...config, radiusMeters: radius, maximumDistanceMeters: radius });
            } catch (walkthroughError) {
              if (fallbackEnabled && googleFallbackTriggerCodes.has(walkthroughError?.code) && coordinates) {
                const fallback = await tryMetadataFallbacks({ coordinates, primaryUnavailableReason: walkthroughError.code });
                if (fallback) {
                  return {
                    status: 200,
                    headers: { ...baseHeaders(), 'Content-Type': 'application/json; charset=utf-8' },
                    body: fallback,
                  };
                }
              }
              throw walkthroughError;
            }
          } else {
            if (fallbackEnabled && googleFallbackTriggerCodes.has(error?.code) && coordinates) {
              const fallback = await tryMetadataFallbacks({ coordinates, primaryUnavailableReason: error.code });
              if (fallback) {
                return {
                  status: 200,
                  headers: { ...baseHeaders(), 'Content-Type': 'application/json; charset=utf-8' },
                  body: fallback,
                };
              }
            }
            throw error;
          }
        }
        if (mode === 'metadata' || mode === 'walkthrough') {
          const { _panoId, ...publicMetadata } = panorama;
          const interactiveReady = Boolean(safeText(env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY, 1024));
          const coverage = panorama.distanceMeters <= config.maximumDistanceMeters ? 'near_property' : 'nearby_street';
          return {
            status: 200,
            headers: { ...baseHeaders(), 'Content-Type': 'application/json; charset=utf-8' },
            body: {...publicMetadata, coverage, targetLabel: coverage === 'nearby_street' ? 'Nearby street walkthrough' : 'Exterior walkthrough',
              interactiveReady, interactive:{ready:interactiveReady,provider:'google_maps_javascript',reason:interactiveReady?null:'public_browser_key_not_configured'}},
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

  return { resolve, circuit, geocodingCircuit, limiter, gate, panoramaInFlight, panoramaxCache, mapillaryCache };
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
module.exports.defaultService = defaultService;
module.exports.createProviderCache = createProviderCache;
module.exports.BoundedConcurrencyGate = BoundedConcurrencyGate;
module.exports.FixedWindowRateLimiter = FixedWindowRateLimiter;
module.exports.GOOGLE_MAPS_HOST = GOOGLE_MAPS_HOST;
module.exports.PropertyImageError = PropertyImageError;
module.exports.ProviderCircuit = ProviderCircuit;
module.exports.bearingDegrees = bearingDegrees;
module.exports.createPropertyImageService = createPropertyImageService;
module.exports.distanceMeters = distanceMeters;
module.exports.exactCensusGeocode = exactCensusGeocode;
module.exports.exactRooftopGeocode = exactRooftopGeocode;
module.exports.hasSourceObservedProvenance = hasSourceObservedProvenance;
module.exports.hasSourceIdentifiedArchive = hasSourceIdentifiedArchive;
module.exports.hasUsablePublisherPhoto = hasUsablePublisherPhoto;
module.exports.resolveCensusCoordinates = resolveCensusCoordinates;
module.exports.resolveEphemeralCoordinates = resolveEphemeralCoordinates;
module.exports.resolveRequest = defaultService.resolve;
module.exports.sourceCoordinates = sourceCoordinates;
module.exports.sourceObservedAddress = sourceObservedAddress;
module.exports.validateListingForStreetView = validateListingForStreetView;
module.exports.writeResult = writeResult;
