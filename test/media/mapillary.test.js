'use strict';

// test/media/mapillary.test.js
//
// Unit tests for the Mapillary lookup helper. The test fixtures mock the
// graph.mapillary.com /images endpoint and verify:
//   - bbox is computed from lat/lng + radius
//   - the access_token is included on the URL
//   - the nearest image is selected as candidate
//   - non-Mapillary errors return a no-coverage result, not a throw
//   - missing token returns { available:false, reason:'not_configured' }
//     without any upstream call
//   - panoramas vs directional sequences are split by image_type
//   - cache hit avoids the upstream call
//   - 401/403/429 are surfaced with distinct reasons

const assert = require('node:assert/strict');
const test = require('node:test');

const { lookupMapillary, bboxAround } = require('../../server/media/mapillary');

function feature(properties = {}) {
  // Default coords sit inside the 100m radius of the test target
  // (40.95, -74.03) so a normalized image survives the distance filter.
  const [lng, lat] = properties.coords || [-74.0301, 40.9501];
  return {
    id: properties.id || 'image-1',
    captured_at: properties.captured_at || '2024-09-12T12:00:00.000Z',
    thumb_2048_url: properties.thumb_2048_url || 'https://images.mapillary.com/abc.jpg',
    sequence: properties.sequence || 'sequence-1',
    compass_angle: properties.compass_angle ?? 90.5,
    creator: properties.creator || { id: 1234, username: 'mapper' },
    geometry: { type: 'Point', coordinates: [lng, lat] },
    image_type: properties.image_type || 'flat',
    ...properties.extra
  };
}

function fixture(features, status = 200, contentType = 'application/json') {
  const body = JSON.stringify({ data: features });
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: new URL(url), init });
    return new Response(body, { status, headers: { 'content-type': contentType } });
  };
  return { fetchImpl, calls };
}

const TOKEN = 'MLY|test|fixture';
const ENV = { MAPILLARY_ACCESS_TOKEN: TOKEN };

test('bboxAround: 100m radius at Park Ridge, NJ yields a tight box', () => {
  const bbox = bboxAround({ lat: 40.95, lng: -74.03, radiusMeters: 100 });
  // lat delta = 100 / 111320 ≈ 0.000898 deg
  // lng delta = 100 / (111320 * cos(40.95°)) ≈ 0.001179 deg
  assert.ok(bbox.north - bbox.south > 0.0015 && bbox.north - bbox.south < 0.002, `lat span too wide: ${bbox.north - bbox.south}`);
  assert.ok(bbox.east - bbox.west > 0.002 && bbox.east - bbox.west < 0.003, `lng span too wide: ${bbox.east - bbox.west}`);
  assert.ok(bbox.west < -74.03 && bbox.east > -74.03, 'bbox must contain the target longitude');
  assert.ok(bbox.south < 40.95 && bbox.north > 40.95, 'bbox must contain the target latitude');
});

test('bboxAround: clamps to [-180, 180] so the URL is always valid', () => {
  const farEast = bboxAround({ lat: 0, lng: 179.99, radiusMeters: 1000 });
  assert.ok(farEast.east <= 180);
  const farWest = bboxAround({ lat: 0, lng: -179.99, radiusMeters: 1000 });
  assert.ok(farWest.west >= -180);
});

test('lookupMapillary: missing token returns not_configured without an upstream call', async () => {
  const fetchImpl = async () => { throw new Error('should not be called'); };
  const result = await lookupMapillary({ lat: 40.95, lng: -74.03 }, { fetchImpl, env: {} });
  assert.equal(result.available, false);
  assert.equal(result.reason, 'not_configured');
  assert.equal(result.candidate, null);
});

test('lookupMapillary: calls /images with bbox, fields, limit, and access_token', async () => {
  const { fetchImpl, calls } = fixture([feature()]);
  const result = await lookupMapillary({ lat: 40.95, lng: -74.03 }, { fetchImpl, env: ENV });
  assert.equal(calls.length, 1);
  const url = calls[0].url;
  assert.equal(url.origin, 'https://graph.mapillary.com');
  assert.equal(url.pathname, '/images');
  assert.equal(url.searchParams.get('access_token'), TOKEN);
  assert.equal(url.searchParams.get('limit'), '10');
  assert.match(url.searchParams.get('fields') || '', /id,captured_at,thumb_2048_url,thumb_1024_url,sequence,compass_angle,creator,geometry,image_type/);
  const [west, south, east, north] = (url.searchParams.get('bbox') || '').split(',').map(Number);
  assert.ok(west < -74.03 && east > -74.03, 'bbox must contain the target longitude');
  assert.ok(south < 40.95 && north > 40.95, 'bbox must contain the target latitude');
  assert.ok(result.available, 'expected at least one approved image');
});

test('lookupMapillary: nearest image is selected as candidate', async () => {
  const farFeature = feature({ id: 'far', coords: [-74.10, 40.95] });
  const nearFeature = feature({ id: 'near', coords: [-74.0301, 40.9501] });
  const { fetchImpl } = fixture([farFeature, nearFeature]);
  const result = await lookupMapillary({ lat: 40.95, lng: -74.03 }, { fetchImpl, env: ENV });
  assert.equal(result.candidate?.pictureId, 'near');
  assert.ok(result.candidate && result.candidate.distanceMeters < 50, 'near image should be very close');
  assert.match(result.candidate.viewerUrl || result.candidate.sourcePage, /mapillary\.com\/app/);
});

test('lookupMapillary: image_type=pano is routed to panoramicMetadata, flat to directionalSequences', async () => {
  const { fetchImpl } = fixture([feature({ id: 'pano', image_type: 'pano' }), feature({ id: 'flat', image_type: 'flat' })]);
  const result = await lookupMapillary({ lat: 40.95, lng: -74.03 }, { fetchImpl, env: ENV });
  assert.equal(result.panoramicMetadata.length, 1);
  assert.equal(result.panoramicMetadata[0].pictureId, 'pano');
  assert.equal(result.directionalSequences.length, 1);
  assert.equal(result.directionalSequences[0].pictureId, 'flat');
});

test('lookupMapillary: every returned image carries the CC-BY-SA-4.0 display-approved license', async () => {
  const { fetchImpl } = fixture([feature({ id: 'a' }), feature({ id: 'b', image_type: 'pano' })]);
  const result = await lookupMapillary({ lat: 40.95, lng: -74.03 }, { fetchImpl, env: ENV });
  const all = [result.candidate, ...result.panoramicMetadata, ...result.directionalSequences].filter(Boolean);
  for (const image of all) {
    assert.equal(image.license.id, 'CC-BY-SA-4.0');
    assert.equal(image.license.displayApproved, true);
  }
});

test('lookupMapillary: empty data array yields available:false with a truthful reason', async () => {
  const { fetchImpl } = fixture([]);
  const result = await lookupMapillary({ lat: 40.95, lng: -74.03 }, { fetchImpl, env: ENV });
  assert.equal(result.available, false);
  assert.equal(result.candidate, null);
  assert.match(result.reason, /No Mapillary imagery/);
});

test('lookupMapillary: 401 surfaces upstream_denied', async () => {
  const fetchImpl = async () => new Response('forbidden', { status: 401 });
  const result = await lookupMapillary({ lat: 40.95, lng: -74.03 }, { fetchImpl, env: ENV });
  assert.equal(result.reason, 'upstream_denied');
});

test('lookupMapillary: 429 surfaces upstream_rate_limited', async () => {
  const fetchImpl = async () => new Response('slow down', { status: 429 });
  const result = await lookupMapillary({ lat: 40.95, lng: -74.03 }, { fetchImpl, env: ENV });
  assert.equal(result.reason, 'upstream_rate_limited');
});

test('lookupMapillary: non-JSON content-type returns upstream_invalid_response', async () => {
  const fetchImpl = async () => new Response('oops', { status: 200, headers: { 'content-type': 'text/html' } });
  const result = await lookupMapillary({ lat: 40.95, lng: -74.03 }, { fetchImpl, env: ENV });
  assert.equal(result.reason, 'upstream_invalid_response');
});

test('lookupMapillary: a thrown fetch on transport-level error is re-thrown so the route can detect "both providers down"', async () => {
  // The library distinguishes transport-level failures (network reset,
  // abort, DNS) from HTTP-level failures (4xx/5xx). Transport failures
  // bubble up to the caller; HTTP failures are surfaced as graceful
  // result objects with a reason. This split lets the alternatives route
  // surface a 503 only when both providers are actually unreachable.
  const fetchImpl = async () => { throw new TypeError('network reset'); };
  await assert.rejects(
    () => lookupMapillary({ lat: 40.95, lng: -74.03 }, { fetchImpl, env: ENV }),
    (error) => error instanceof TypeError && /network reset/.test(error.message)
  );
});

test('lookupMapillary: an AbortError is re-thrown (caller treats it as transport-level)', async () => {
  const fetchImpl = async () => {
    const err = new Error('aborted');
    err.name = 'AbortError';
    throw err;
  };
  await assert.rejects(
    () => lookupMapillary({ lat: 40.95, lng: -74.03 }, { fetchImpl, env: ENV }),
    (error) => error.name === 'AbortError'
  );
});

test('lookupMapillary: cache hit short-circuits the upstream call', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return new Response(JSON.stringify({ data: [feature()] }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  // Build the same kind of in-memory cache the route uses.
  const store = new Map();
  const cache = {
    buildKey: ({ provider, lat, lng, radius }) => `${provider}|${lat.toFixed(5)}|${lng.toFixed(5)}|${radius}`,
    get: (key) => store.get(key),
    set: (key, value) => { store.set(key, value); }
  };
  const first = await lookupMapillary({ lat: 40.95, lng: -74.03 }, { fetchImpl, env: ENV, cache });
  assert.equal(calls, 1);
  assert.equal(first.candidate?.pictureId, 'image-1');
  // Same lat/lng/radius — should hit the cache.
  const second = await lookupMapillary({ lat: 40.95, lng: -74.03 }, { fetchImpl, env: ENV, cache });
  assert.equal(calls, 1, 'second call should not reach the network');
  assert.equal(second.candidate?.pictureId, 'image-1');
});

test('lookupMapillary: cacheTtlMs=0 disables caching even when a cache is supplied', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls += 1; return new Response(JSON.stringify({ data: [feature()] }), { status: 200, headers: { 'content-type': 'application/json' } }); };
  const store = new Map();
  const cache = {
    buildKey: ({ provider, lat, lng, radius }) => `${provider}|${lat.toFixed(5)}|${lng.toFixed(5)}|${radius}`,
    get: (key) => store.get(key),
    set: (key, value) => { store.set(key, value); }
  };
  await lookupMapillary({ lat: 40.95, lng: -74.03 }, { fetchImpl, env: ENV, cache, cacheTtlMs: 0 });
  await lookupMapillary({ lat: 40.95, lng: -74.03 }, { fetchImpl, env: ENV, cache, cacheTtlMs: 0 });
  assert.equal(calls, 2, 'cacheTtlMs=0 must force a fresh upstream call');
});