'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

function assertSearchContract(body) {
  assert.ok(body && Array.isArray(body.listings), 'listings must be an array');
  assert.equal(typeof body.total, 'number');
  assert.ok(body.page && typeof body.page === 'object');
  assert.ok(body.page.nextCursor === null || typeof body.page.nextCursor === 'string');
  assert.equal(typeof body.page.hasMore, 'boolean');
  assert.ok(body.facets && typeof body.facets === 'object');
  for (const values of Object.values(body.facets)) {
    assert.ok(Array.isArray(values));
    for (const item of values) {
      assert.equal(typeof item.value, 'string');
      assert.equal(typeof item.count, 'number');
    }
  }
}

function assertMapContract(body) {
  assert.equal(body?.type, 'FeatureCollection');
  assert.ok(Array.isArray(body.features));
  for (const feature of body.features) {
    assert.equal(feature.type, 'Feature');
    assert.ok(feature.geometry);
    assert.ok(feature.properties && typeof feature.properties === 'object');
  }
}

test('discovery search contract exposes stable pagination and facets', () => {
  assertSearchContract({
    listings: [], total: 0, page: { nextCursor: null, hasMore: false },
    facets: { state: [{ value: 'CA', count: 2 }] },
  });
});

test('discovery map contract is GeoJSON FeatureCollection', () => {
  assertMapContract({ type: 'FeatureCollection', features: [] });
});

test('optional live discovery endpoint satisfies the same contract', { skip: !process.env.DISCOVERY_ACCEPTANCE_URL }, async () => {
  const base = process.env.DISCOVERY_ACCEPTANCE_URL.replace(/\/$/, '');
  const response = await fetch(`${base}/api/listings?limit=2&facets=state,source`);
  assert.equal(response.status, 200);
  assertSearchContract(await response.json());
  const map = await fetch(`${base}/api/listings/map?limit=2&bbox=-125,24,-66,50`);
  assert.equal(map.status, 200);
  assertMapContract(await map.json());
});

module.exports = { assertSearchContract, assertMapContract };
