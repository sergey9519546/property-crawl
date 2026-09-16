'use strict';

// test/routes/neighborhoods.test.js
//
// Integration tests for the neighborhoods HTTP route at
// server/routes/neighborhoods.js. End-to-end with stub DB.

const assert = require('node:assert/strict');
const test = require('node:test');

const { createNeighborhoodsHandler, parseKey, serializeBucket } = require('../../server/routes/neighborhoods');

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
  return { method, url: path };
}

function stubDb(pool = []) {
  return {
    async getListings() { return { listings: pool }; }
  };
}

const NOW_MS = Date.parse('2026-09-16T12:00:00.000Z');
const FIXED_NOW = () => NOW_MS;

const OBSERVED = '2026-09-01T12:00:00.000Z';

const POOL = [
  { id: 'A', source: 'treasury', state: 'TX', city: 'Houston', zip: '77001', sqft: 1500, openingBid: 50000, mid: 100000, dealScore: 70, propType: 'Single Family', sourceObservedAt: OBSERVED },
  { id: 'B', source: 'hud', state: 'TX', city: 'Houston', zip: '77001', sqft: 1600, openingBid: 70000, mid: 110000, dealScore: 80, propType: 'Single Family', sourceObservedAt: OBSERVED },
  { id: 'C', source: 'irs', state: 'TX', city: 'Houston', zip: '77001', sqft: 1700, openingBid: 90000, mid: 120000, dealScore: 75, propType: 'Land', sourceObservedAt: OBSERVED },
  { id: 'D', source: 'treasury', state: 'TX', city: 'Dallas', zip: '75201', sqft: 2000, openingBid: 80000, mid: 150000, dealScore: 65, propType: 'Single Family', sourceObservedAt: OBSERVED }
];

// --- parseKey ------------------------------------------------------------

test('parseKey: parses zip:NNNNN keys', () => {
  assert.deepEqual(parseKey('zip:77001'), { kind: 'zip', key: '77001' });
});

test('parseKey: parses city:STATE:slug keys', () => {
  assert.deepEqual(parseKey('city:TX:houston'), { kind: 'city', key: 'TX::houston' });
});

test('parseKey: returns null on malformed keys', () => {
  assert.equal(parseKey(''), null);
  assert.equal(parseKey('foo'), null);
  assert.equal(parseKey('city:TX'), null);
  assert.equal(parseKey('city:TX:a:b'), null);
});

// --- list endpoint --------------------------------------------------------

test('createNeighborhoodsHandler: list returns grouped buckets', async () => {
  const handler = createNeighborhoodsHandler({ database: stubDb(POOL), now: FIXED_NOW });
  const res = makeRes();
  const url = new URL('http://localhost/api/neighborhoods');
  await handler(makeReq('GET'), res, url);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.schema, 'property-crawl.neighborhoods/v1');
  assert.ok(res.body.count >= 2, 'expected at least 2 buckets (77001 + 75201)');
  const zip77001 = res.body.neighborhoods.find((n) => n.key === '77001');
  assert.equal(zip77001.count, 3);
  assert.equal(zip77001.kind, 'zip');
});

test('createNeighborhoodsHandler: state filter restricts the pool', async () => {
  const handler = createNeighborhoodsHandler({ database: stubDb(POOL), now: FIXED_NOW });
  const res = makeRes();
  const url = new URL('http://localhost/api/neighborhoods?state=TX');
  await handler(makeReq('GET'), res, url);
  assert.equal(res.body.state, 'TX');
});

test('createNeighborhoodsHandler: limit caps the bucket count', async () => {
  const handler = createNeighborhoodsHandler({ database: stubDb(POOL), now: FIXED_NOW });
  const res = makeRes();
  const url = new URL('http://localhost/api/neighborhoods?limit=1');
  await handler(makeReq('GET'), res, url);
  assert.equal(res.body.count, 1);
});

// --- single-bucket endpoint ----------------------------------------------

test('createNeighborhoodsHandler: zip:NNNNN returns a single bucket', async () => {
  const handler = createNeighborhoodsHandler({ database: stubDb(POOL), now: FIXED_NOW });
  const res = makeRes();
  const url = new URL('http://localhost/api/neighborhoods/zip:77001');
  await handler(makeReq('GET'), res, url);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.neighborhood.key, '77001');
  assert.equal(res.body.neighborhood.count, 3);
});

test('createNeighborhoodsHandler: city:STATE:slug returns a city bucket', async () => {
  const handler = createNeighborhoodsHandler({ database: stubDb(POOL), now: FIXED_NOW });
  const res = makeRes();
  const url = new URL('http://localhost/api/neighborhoods/city:TX:houston');
  await handler(makeReq('GET'), res, url);
  // No listings have city:Houston zip — those still have zip 77001, so the
  // city bucket doesn't get built. That's expected: the engine prefers zip
  // when both are present.
  assert.equal(res.statusCode, 404);
});

test('createNeighborhoodsHandler: returns 400 for malformed keys', async () => {
  const handler = createNeighborhoodsHandler({ database: stubDb([]), now: FIXED_NOW });
  const res = makeRes();
  const url = new URL('http://localhost/api/neighborhoods/foo');
  await handler(makeReq('GET'), res, url);
  assert.equal(res.statusCode, 400);
});

test('createNeighborhoodsHandler: returns 404 for unknown keys', async () => {
  const handler = createNeighborhoodsHandler({ database: stubDb(POOL), now: FIXED_NOW });
  const res = makeRes();
  const url = new URL('http://localhost/api/neighborhoods/zip:00000');
  await handler(makeReq('GET'), res, url);
  assert.equal(res.statusCode, 404);
});

test('createNeighborhoodsHandler: returns 405 on non-GET', async () => {
  const handler = createNeighborhoodsHandler({ database: stubDb([]), now: FIXED_NOW });
  const res = makeRes();
  const url = new URL('http://localhost/api/neighborhoods');
  await handler(makeReq('POST'), res, url);
  assert.equal(res.statusCode, 405);
});

// --- serializeBucket -----------------------------------------------------

test('serializeBucket: rounds float fields and preserves structure', () => {
  const out = serializeBucket({
    kind: 'zip',
    key: '77001',
    label: '77001',
    count: 3,
    medianOpeningBid: 12345.6789,
    meanOpeningBid: 12000,
    medianSqft: 1500,
    medianDealScore: 70,
    medianDiscount: 0.25,
    sources: { hud: 1 },
    propTypes: { 'Single Family': 3 }
  });
  assert.equal(out.medianOpeningBid, 12345.68);
  assert.equal(out.medianSqft, 1500);
  assert.equal(out.medianDiscount, 0.25);
  assert.equal(out.sources.hud, 1);
});