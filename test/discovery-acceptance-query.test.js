'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const discovery = require('../server/discovery/query');

function database(rows) { return { getListings: async () => ({ listings: rows, total: rows.length }) }; }
function row(id, state = 'CA') {
  return { id, state, source: 'servicelink', address: `${id} Main Street`, city: 'Test City', propType: 'Single Family', dealScore: 50, lat: 34, lng: -118, sourceObservedAt: '2026-09-05T00:00:00.000Z', status: 'active' };
}

test('query module returns the specified page and facet contract', async () => {
  const result = await discovery.search(database([row('a'), row('b', 'TX'), row('c')]), { q: '', state: '', county: '', source: '', type: '', program: '', lifecycle: '', occupancy: '', freshness: '', saleFrom: null, saleTo: null, maxBid: null, hasDocuments: null, hasPhoto: null, bbox: null, sort: 'score', cursor: null, limit: 2, facets: ['state'] });
  assert.equal(result.listings.length, 2);
  assert.equal(result.total, 3);
  assert.equal(result.page.hasMore, true);
  assert.equal(typeof result.page.nextCursor, 'string');
  assert.deepEqual(result.facets.state.map((item) => item.value).sort(), ['CA', 'TX']);
});

test('query cursor becomes 409 when the underlying revision changes', async () => {
  const rows = [row('a'), row('b')];
  const filters = { q: '', state: '', county: '', source: '', type: '', program: '', lifecycle: '', occupancy: '', freshness: '', saleFrom: null, saleTo: null, maxBid: null, hasDocuments: null, hasPhoto: null, bbox: null, sort: 'score', cursor: null, limit: 1, facets: [] };
  const first = await discovery.search(database(rows), filters);
  rows.push(row('new'));
  await assert.rejects(() => discovery.search(database(rows), { ...filters, cursor: first.page.nextCursor }), (error) => error.status === 409);
});

test('map query returns GeoJSON and bounds coordinates', async () => {
  const unknown = row('unknown'); delete unknown.lat; delete unknown.lng;
  const result = await discovery.map(database([row('a'), unknown]), { q: '', state: '', county: '', source: '', type: '', program: '', lifecycle: '', occupancy: '', freshness: '', saleFrom: null, saleTo: null, maxBid: null, hasDocuments: null, hasPhoto: null, bbox: [-125, 24, -66, 50], sort: 'score', cursor: null, limit: 2, facets: [] });
  assert.equal(result.type, 'FeatureCollection');
  assert.equal(result.features.length, 1);
  assert.deepEqual(result.features[0].geometry.coordinates, [-118, 34]);
});

test('query refuses an inventory larger than the bounded non-Postgres adapter scan', async () => {
  const rows = Array.from({ length: 10000 }, (_, index) => row(`row-${index}`));
  const bounded = { getListings: async () => ({ listings: rows, total: 10001 }) };
  await assert.rejects(() => discovery.search(bounded, { q: '', state: '', county: '', source: '', type: '', program: '', lifecycle: '', occupancy: '', freshness: '', saleFrom: null, saleTo: null, maxBid: null, hasDocuments: null, hasPhoto: null, bbox: null, sort: 'score', cursor: null, limit: 10, facets: [] }), (error) => error.status === 503);
});

test('a state-table redemption stamp is not a published redemption term', () => {
  const immediate = discovery.queryFromUrl(new URL('http://localhost/api/listings?redemption=immediate'));
  const active = discovery.queryFromUrl(new URL('http://localhost/api/listings?redemption=redemption_active'));
  const stampedZero = { id: 'stamped-zero', redemptionDays: 0, provenance: { derivedFields: { redemption: { model: 'state-statutory-rule-lookup-v1', days: 0 } } } };
  const publishedZero = { id: 'published-zero', redemptionDays: 0, provenance: {} };
  const stampedWindow = { id: 'stamped-window', redemptionDays: 10, provenance: { derivedFields: { redemption: { days: 10 } } } };
  const publishedWindow = { id: 'published-window', redemptionDays: 10, provenance: {} };
  assert.equal(discovery.matches(stampedZero, immediate), false);
  assert.equal(discovery.matches(publishedZero, immediate), true);
  assert.equal(discovery.matches(stampedWindow, active), false);
  assert.equal(discovery.matches(publishedWindow, active), true);
  assert.match(discovery.pgWhere(immediate).sql, /redemption_days=0 AND provenance #> '\{derivedFields,redemption\}' IS NULL/);
  assert.match(discovery.pgWhere(active).sql, /redemption_days>0 AND provenance #> '\{derivedFields,redemption\}' IS NULL/);
});

test('search filters and facet counts use the same filtered inventory', async () => {
  const result = await discovery.search(database([row('ca-1', 'CA'), row('ca-2', 'CA'), row('tx-1', 'TX')]), { q: 'ca-1', state: 'ca', county: '', source: 'servicelink', type: '', program: '', lifecycle: '', occupancy: '', freshness: '', saleFrom: null, saleTo: null, maxBid: null, hasDocuments: null, hasPhoto: null, bbox: null, sort: 'score', cursor: null, limit: 10, facets: ['state'] });
  assert.equal(result.total, 1);
  assert.equal(result.listings[0].id, 'ca-1');
  assert.deepEqual(result.facets.state, [{ value: 'CA', count: 1 }]);
});

test('cursorDecode rejects non-object payloads with 400', async () => {
  const nullCursor = Buffer.from('null').toString('base64url');
  const arrCursor = Buffer.from('["abc"]').toString('base64url');
  const numCursor = Buffer.from('12345').toString('base64url');
  const rows = [row('a'), row('b')];
  const filters = { q: '', state: '', county: '', source: '', type: '', program: '', lifecycle: '', occupancy: '', freshness: '', saleFrom: null, saleTo: null, maxBid: null, hasDocuments: null, hasPhoto: null, bbox: null, sort: 'score', limit: 10, facets: [] };
  await assert.rejects(() => discovery.search(database(rows), { ...filters, cursor: nullCursor }), (err) => err.status === 400);
  await assert.rejects(() => discovery.search(database(rows), { ...filters, cursor: arrCursor }), (err) => err.status === 400);
  await assert.rejects(() => discovery.search(database(rows), { ...filters, cursor: numCursor }), (err) => err.status === 400);
});

test('queryFromUrl treats empty coordinate and numeric strings as null', () => {
  const q = discovery.queryFromUrl(new URL('http://localhost/api/listings?lat=&lng=&maxBid=&minScore=&minEquity=&radiusKm='));
  assert.equal(q.lat, null);
  assert.equal(q.lng, null);
  assert.equal(q.maxBid, null);
  assert.equal(q.minScore, null);
  assert.equal(q.minEquity, null);
  assert.equal(q.radiusKm, 100);
});

test('queryFromUrl accepts opportunity and triage sorts without 400', () => {
  const qOpp = discovery.queryFromUrl(new URL('http://localhost/api/listings?sort=opportunity'));
  assert.equal(qOpp.sort, 'opportunity');
  const qTriage = discovery.queryFromUrl(new URL('http://localhost/api/listings?sort=triage'));
  assert.equal(qTriage.sort, 'triage');
});


test('triage sort demotes terminal and past-sale rows below upcoming rows', async () => {
  const future = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  const past = '2020-01-01';
  const rows = [
    { ...row('past-high'), triagePriority: 55, saleDate: past, status: 'scheduled' },
    { ...row('term-high'), triagePriority: 90, saleDate: future, status: 'cancelled' },
    { ...row('live-low'), triagePriority: 10, saleDate: future, status: 'scheduled' },
  ];
  const res = await discovery.search(database(rows), discovery.queryFromUrl(new URL('http://localhost/api/listings?sort=triage&limit=10')));
  assert.deepEqual(res.listings.map((x) => x.id), ['live-low', 'past-high', 'term-high']);
});

test('excludeTerminal and server triage filters align matches() and pgWhere()', () => {
  const recent = new Date(Date.now() - 2 * 3600_000).toISOString();
  const oldTs = new Date(Date.now() - 96 * 3600_000).toISOString();
  const terminalRow = { ...row('term-1'), status: 'redeemed', sourceObservedAt: recent, occupancy: 'Vacant' };
  const activeFresh = {
    ...row('fresh-1'),
    status: 'active',
    sourceObservedAt: recent,
    occupancy: 'Tenant Occupied',
    openingBid: 90000,
    priorOpeningBid: 120000,
  };
  const staleUnknownOcc = { ...row('stale-1'), status: 'scheduled', sourceObservedAt: oldTs, occupancy: 'unknown' };

  const qExcl = discovery.queryFromUrl(new URL('http://localhost/api/listings?excludeTerminal=true'));
  assert.equal(discovery.matches(terminalRow, qExcl), false);
  assert.equal(discovery.matches(activeFresh, qExcl), true);
  assert.match(discovery.pgWhere(qExcl, 1, { accelerated: true }).sql, /NOT discovery_terminal/);
  assert.match(discovery.pgWhere(qExcl, 1, { accelerated: false }).sql, /writ\[\[:space:\]\]\+expired/);

  const qNew = discovery.queryFromUrl(new URL('http://localhost/api/listings?isNew=true&occupancyKnown=true&priceDropped=true'));
  assert.equal(discovery.matches(activeFresh, qNew), true);
  assert.equal(discovery.matches(staleUnknownOcc, qNew), false);
  const sqlNew = discovery.pgWhere(qNew, 1, { accelerated: true }).sql;
  assert.match(sqlNew, /INTERVAL '48 hours'/);
  assert.match(sqlNew, /lower\(btrim\(occupancy\)\) NOT IN/);
  assert.match(sqlNew, /priorOpeningBid/);

  const qStale = discovery.queryFromUrl(new URL('http://localhost/api/listings?stale=true'));
  assert.equal(discovery.matches(staleUnknownOcc, qStale), true);
  assert.equal(discovery.matches(activeFresh, qStale), false);
  assert.match(discovery.pgWhere(qStale, 1, { accelerated: true }).sql, /INTERVAL '72 hours'/);
});
