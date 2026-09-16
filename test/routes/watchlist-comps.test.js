'use strict';

// test/routes/watchlist-comps.test.js
//
// Integration tests for the watchlist comps HTTP route at
// server/routes/watchlist-comps.js. The handler is exercised end-to-end
// with stub request/response objects and a stub DB; no Postgres, no
// network.

const assert = require('node:assert/strict');
const test = require('node:test');

const { createWatchlistCompsHandler, loadTargetAndPool } = require('../../server/routes/watchlist-comps');

function makeRes() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; }
  };
}

function makeReq(method = 'GET', path = '/') {
  return { method, url: path, headers: {} };
}

function stubDb(target = null, pool = []) {
  return {
    async getListingById(id) {
      if (!target || target.id !== id) return null;
      return target;
    },
    async getListings() {
      return { listings: pool };
    }
  };
}

const TARGET = {
  id: 'TARGET-1',
  source: 'treasury',
  state: 'TX',
  city: 'Bruni',
  zip: '78344',
  sqft: 1500,
  openingBid: 50000,
  mid: 100000,
  dealScore: 70,
  propType: 'Single Family',
  lat: 27.45,
  lng: -98.88,
  sourceObservedAt: '2026-09-01T12:00:00.000Z'
};

const NOW_MS = Date.parse('2026-09-16T12:00:00.000Z');
const FIXED_NOW = () => NOW_MS;

test('createWatchlistCompsHandler returns 405 on non-GET', async () => {
  const handler = createWatchlistCompsHandler({ database: stubDb(), now: FIXED_NOW });
  const res = makeRes();
  await handler(makeReq('POST', '/api/watchlist/TARGET-1/comps'), res, new URL('http://localhost/api/watchlist/TARGET-1/comps', 'http://localhost'));
  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.Allow, 'GET');
});

test('createWatchlistCompsHandler returns 404 when listing does not exist', async () => {
  const handler = createWatchlistCompsHandler({ database: stubDb(null, []), now: FIXED_NOW });
  const res = makeRes();
  const url = new URL('http://localhost/api/watchlist/MISSING/comps');
  await handler(makeReq('GET'), res, url);
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.error, 'listing_not_found');
});

test('createWatchlistCompsHandler returns the comps + stats payload', async () => {
  const pool = [
    { ...TARGET },
    { id: 'C1', source: 'hud', state: 'TX', city: 'Bruni', zip: '78344', sqft: 1500, openingBid: 52000, mid: 100000, dealScore: 75, propType: 'Single Family', lat: 27.455, lng: -98.881, sourceObservedAt: '2026-09-01T12:00:00.000Z' },
    { id: 'C2', source: 'irs', state: 'TX', city: 'Houston', zip: '77001', sqft: 1620, openingBid: 48000, mid: 100000, dealScore: 80, propType: 'Single Family', lat: 29.76, lng: -95.37, sourceObservedAt: '2026-09-02T12:00:00.000Z' }
  ];
  const handler = createWatchlistCompsHandler({ database: stubDb(TARGET, pool), now: FIXED_NOW });
  const res = makeRes();
  const url = new URL('http://localhost/api/watchlist/TARGET-1/comps');
  await handler(makeReq('GET'), res, url);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['Cache-Control'], 'no-store');
  assert.equal(res.body.schema, 'property-crawl.watchlist-comps/v1');
  assert.ok(Array.isArray(res.body.comps));
  assert.ok(res.body.stats.count > 0);
  assert.ok(res.body.targetId, 'TARGET-1');
});

test('createWatchlistCompsHandler applies query-string overrides', async () => {
  const pool = [
    { ...TARGET },
    { id: 'C1', source: 'hud', state: 'TX', city: 'Bruni', zip: '78344', sqft: 1500, openingBid: 52000, mid: 100000, dealScore: 75, propType: 'Single Family', lat: 27.455, lng: -98.881, sourceObservedAt: '2026-09-01T12:00:00.000Z' }
  ];
  const handler = createWatchlistCompsHandler({ database: stubDb(TARGET, pool), now: FIXED_NOW });
  const res = makeRes();
  const url = new URL('http://localhost/api/watchlist/TARGET-1/comps?radiusKm=4&sqftBand=0.5&maxAgeDays=180&limit=2');
  await handler(makeReq('GET'), res, url);
  assert.equal(res.body.radiusKm, 4);
  assert.equal(res.body.sqftBand, 0.5);
  assert.equal(res.body.maxAgeDays, 180);
  assert.equal(res.body.limit, 2);
});

test('createWatchlistCompsHandler falls back to defaults on bogus query params', async () => {
  const handler = createWatchlistCompsHandler({ database: stubDb(TARGET, [TARGET]), now: FIXED_NOW });
  const res = makeRes();
  const url = new URL('http://localhost/api/watchlist/TARGET-1/comps?radiusKm=NaN&limit=99999&sqftBand=-5');
  await handler(makeReq('GET'), res, url);
  assert.equal(res.body.radiusKm, 8);
  assert.equal(res.body.limit, 8);
  assert.equal(res.body.sqftBand, 0.30);
});

test('createWatchlistCompsHandler returns reason when target has no usable geo', async () => {
  const target = { ...TARGET, id: 'NO-GEO', lat: null, lng: null, zip: null, city: 'Bruni' };
  const pool = [{ id: 'FAR', source: 'hud', state: 'TX', city: 'Houston', sqft: 1500, openingBid: 50000, mid: 100000, dealScore: 70, propType: 'Single Family', lat: 29.76, lng: -95.37, sourceObservedAt: '2026-09-01T12:00:00.000Z' }];
  const handler = createWatchlistCompsHandler({ database: stubDb(target, pool), now: FIXED_NOW });
  const res = makeRes();
  const url = new URL('http://localhost/api/watchlist/NO-GEO/comps');
  await handler(makeReq('GET'), res, url);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.comps.length, 0);
  assert.equal(res.body.reason, 'target_geocode_missing');
});

test('loadTargetAndPool returns 404-shaped error when listing is missing', async () => {
  const loaded = await loadTargetAndPool('NOPE', stubDb(null, []));
  assert.equal(loaded.error.status, 404);
});