'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { lookupPanoramax } = require('../server/media/panoramax');
const { createProviderCache } = require('../server/media/provider-cache');

function buildSampleFeature(id, { lat, lng }) {
  return {
    id,
    collection: `col-${id}`,
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [lng, lat] },
    properties: {
      'panoramax:id': id,
      'panoramax:perspective:heading': 90,
      'pers:interior:orientation': 'outdoor',
      'panoramax:rank': 100,
      // panoramax.js reads properties.license (string) — not the array
      // licenses[] — so we use a display-approved license id here.
      license: 'CC-BY-SA-4.0',
      // isPanorama() needs either an equirectangular projection or a 360° fov.
      'Xmp.GPano.ProjectionType': 'equirectangular',
      field_of_view: 360
    },
    assets: {
      'panoramax:image': { href: `https://api.panoramax.xyz/pictures/${id}/image.jpg` },
      'panoramax:thumb': { href: `https://api.panoramax.xyz/pictures/${id}/thumb.jpg` },
      'panoramax:viewer': { href: `https://api.panoramax.xyz/pictures/${id}/viewer.json` }
    },
    links: [{ rel: 'self', href: `https://api.panoramax.xyz/pictures/${id}` }]
  };
}

const OK_JSON = (feature) => JSON.stringify({ type: 'FeatureCollection', features: [feature] });

function panoramaxFetchMock({ fetchCount, location }) {
  return async () => {
    fetchCount.value += 1;
    const feature = buildSampleFeature(`pano-${fetchCount.value}`, location);
    return {
      status: 200,
      ok: true,
      headers: { get: () => 'application/geo+json' },
      text: async () => OK_JSON(feature)
    };
  };
}

test('lookupPanoramax calls the upstream on the first lookup and serves the cache on subsequent calls', async () => {
  const fetchCount = { value: 0 };
  const location = { lat: 34.0522341, lng: -118.2437121 };
  const fetchImpl = panoramaxFetchMock({ fetchCount, location });
  const cache = createProviderCache({ ttlMs: 60_000 });
  const first = await lookupPanoramax(location, { fetchImpl, cache, radiusMeters: 100 });
  assert.equal(fetchCount.value, 1);
  assert.equal(first.available, true);
  // The cache key has bucket precision; a near-identical location hits the same bucket
  const second = await lookupPanoramax({ lat: 34.0522349, lng: -118.2437129 }, { fetchImpl, cache, radiusMeters: 100 });
  assert.equal(fetchCount.value, 1, 'second call should hit the cache, not the upstream');
  assert.deepEqual(first, second);
});

test('lookupPanoramax bypasses the cache when cacheTtlMs is 0', async () => {
  const fetchCount = { value: 0 };
  const location = { lat: 1, lng: 1 };
  const fetchImpl = panoramaxFetchMock({ fetchCount, location });
  const cache = createProviderCache({ ttlMs: 60_000 });
  await lookupPanoramax(location, { fetchImpl, cache, radiusMeters: 100, cacheTtlMs: 0 });
  await lookupPanoramax(location, { fetchImpl, cache, radiusMeters: 100, cacheTtlMs: 0 });
  assert.equal(fetchCount.value, 2);
});

test('cache stats are populated by lookupPanoramax hits', async () => {
  const fetchCount = { value: 0 };
  const location = { lat: 40.7128, lng: -74.0060 };
  const fetchImpl = panoramaxFetchMock({ fetchCount, location });
  const cache = createProviderCache({ ttlMs: 60_000 });
  await lookupPanoramax(location, { fetchImpl, cache, radiusMeters: 50 });
  await lookupPanoramax(location, { fetchImpl, cache, radiusMeters: 50 });
  const stats = cache.stats();
  assert.ok(stats.total >= 1);
  assert.ok(stats.live >= 1);
  assert.equal(fetchCount.value, 1);
});

test('lookupPanoramax without a cache does not throw', async () => {
  const fetchCount = { value: 0 };
  const location = { lat: 0, lng: 0 };
  const fetchImpl = panoramaxFetchMock({ fetchCount, location });
  // No cache option
  const result = await lookupPanoramax(location, { fetchImpl, radiusMeters: 100 });
  assert.ok(result);
  assert.equal(fetchCount.value, 1);
});
