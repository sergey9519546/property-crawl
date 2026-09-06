'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const discovery = require('../server/discovery/query');

function database(rows) { return { getListings: async () => ({ listings: rows, total: rows.length }) }; }
function row(id, state = 'CA') {
  return { id, state, source: 'servicelink', address: `${id} Main Street`, city: 'Test City', propType: 'Single Family', dealScore: 50, lat: 34, lng: -118, sourceObservedAt: '2026-09-05T00:00:00.000Z', status: 'active' };
}

test('query module returns the specified page and facet contract', async () => {
  const result = await discovery.search(database([row('a'), row('b', 'TX'), row('c')]), { q: '', state: '', county: '', source: '', type: '', program: '', lifecycle: '', occupancy: '', freshness: '', saleFrom: null, saleTo: null, maxBid: null, hasDocuments: null, bbox: null, sort: 'score', cursor: null, limit: 2, facets: ['state'] });
  assert.equal(result.listings.length, 2);
  assert.equal(result.total, 3);
  assert.equal(result.page.hasMore, true);
  assert.equal(typeof result.page.nextCursor, 'string');
  assert.deepEqual(result.facets.state.map((item) => item.value).sort(), ['CA', 'TX']);
});

test('query cursor becomes 409 when the underlying revision changes', async () => {
  const rows = [row('a'), row('b')];
  const filters = { q: '', state: '', county: '', source: '', type: '', program: '', lifecycle: '', occupancy: '', freshness: '', saleFrom: null, saleTo: null, maxBid: null, hasDocuments: null, bbox: null, sort: 'score', cursor: null, limit: 1, facets: [] };
  const first = await discovery.search(database(rows), filters);
  rows.push(row('new'));
  await assert.rejects(() => discovery.search(database(rows), { ...filters, cursor: first.page.nextCursor }), (error) => error.status === 409);
});

test('map query returns GeoJSON and bounds coordinates', async () => {
  const unknown = row('unknown'); delete unknown.lat; delete unknown.lng;
  const result = await discovery.map(database([row('a'), unknown]), { q: '', state: '', county: '', source: '', type: '', program: '', lifecycle: '', occupancy: '', freshness: '', saleFrom: null, saleTo: null, maxBid: null, hasDocuments: null, bbox: [-125, 24, -66, 50], sort: 'score', cursor: null, limit: 2, facets: [] });
  assert.equal(result.type, 'FeatureCollection');
  assert.equal(result.features.length, 1);
  assert.deepEqual(result.features[0].geometry.coordinates, [-118, 34]);
});

test('query refuses an inventory larger than the bounded non-Postgres adapter scan', async () => {
  const rows = Array.from({ length: 10000 }, (_, index) => row(`row-${index}`));
  const bounded = { getListings: async () => ({ listings: rows, total: 10001 }) };
  await assert.rejects(() => discovery.search(bounded, { q: '', state: '', county: '', source: '', type: '', program: '', lifecycle: '', occupancy: '', freshness: '', saleFrom: null, saleTo: null, maxBid: null, hasDocuments: null, bbox: null, sort: 'score', cursor: null, limit: 10, facets: [] }), (error) => error.status === 503);
});

test('search filters and facet counts use the same filtered inventory', async () => {
  const result = await discovery.search(database([row('ca-1', 'CA'), row('ca-2', 'CA'), row('tx-1', 'TX')]), { q: 'ca-1', state: 'ca', county: '', source: 'servicelink', type: '', program: '', lifecycle: '', occupancy: '', freshness: '', saleFrom: null, saleTo: null, maxBid: null, hasDocuments: null, bbox: null, sort: 'score', cursor: null, limit: 10, facets: ['state'] });
  assert.equal(result.total, 1);
  assert.equal(result.listings[0].id, 'ca-1');
  assert.deepEqual(result.facets.state, [{ value: 'CA', count: 1 }]);
});
