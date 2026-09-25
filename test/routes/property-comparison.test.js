'use strict';

// test/routes/property-comparison.test.js
//
// Integration tests for GET /api/listings/compare. End-to-end with
// a stub DB that resolves each requested id to a listing record.

const assert = require('node:assert/strict');
const test = require('node:test');

const { createPropertyComparisonHandler, parseIds } = require('../../server/routes/property-comparison');

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

function stubDb(byId = {}) {
  return {
    async getListingById(id) {
      return byId[id] || null;
    }
  };
}

function listing(overrides = {}) {
  return {
    id: 'L1',
    source: 'treasury',
    state: 'TX',
    city: 'Bruni',
    zip: '78344',
    sqft: 1500,
    openingBid: 50000,
    mid: 100000,
    dealScore: 70,
    propType: 'Single Family',
    ...overrides
  };
}

// --- parseIds -------------------------------------------------------------

test('parseIds: parses comma-separated single id param', () => {
  const url = new URL('http://localhost/api/listings/compare?ids=A,B,C');
  const ids = parseIds(url.searchParams);
  assert.deepEqual(ids, ['A', 'B', 'C']);
});

test('parseIds: parses repeated ids=… params', () => {
  const url = new URL('http://localhost/api/listings/compare?ids=A&ids=B&ids=C');
  const ids = parseIds(url.searchParams);
  assert.deepEqual(ids, ['A', 'B', 'C']);
});

test('parseIds: ignores empty entries', () => {
  const url = new URL('http://localhost/api/listings/compare?ids=A,,B,');
  const ids = parseIds(url.searchParams);
  assert.deepEqual(ids, ['A', 'B']);
});

// --- handler --------------------------------------------------------------

test('createPropertyComparisonHandler: returns 405 on non-GET', async () => {
  const handler = createPropertyComparisonHandler({ database: stubDb() });
  const res = makeRes();
  const url = new URL('http://localhost/api/listings/compare?ids=A,B');
  await handler(makeReq('POST'), res, url);
  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.Allow, 'GET');
});

test('createPropertyComparisonHandler: returns 404 for unknown subpaths', async () => {
  const handler = createPropertyComparisonHandler({ database: stubDb() });
  const res = makeRes();
  const url = new URL('http://localhost/api/listings/comparex?ids=A,B');
  await handler(makeReq('GET'), res, url);
  assert.equal(res.statusCode, 404);
});

test('createPropertyComparisonHandler: returns 400 when fewer than 2 ids are given', async () => {
  const handler = createPropertyComparisonHandler({ database: stubDb() });
  const res = makeRes();
  const url = new URL('http://localhost/api/listings/compare?ids=A');
  await handler(makeReq('GET'), res, url);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'ids_required');
});

test('createPropertyComparisonHandler: returns 400 when more than 4 ids are given', async () => {
  const handler = createPropertyComparisonHandler({ database: stubDb() });
  const res = makeRes();
  const url = new URL('http://localhost/api/listings/compare?ids=A,B,C,D,E');
  await handler(makeReq('GET'), res, url);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'too_many_ids');
});

test('createPropertyComparisonHandler: returns 404 when no listings are found', async () => {
  const handler = createPropertyComparisonHandler({ database: stubDb() });
  const res = makeRes();
  const url = new URL('http://localhost/api/listings/compare?ids=A,B');
  await handler(makeReq('GET'), res, url);
  assert.equal(res.statusCode, 404);
  assert.deepEqual(res.body.requested, ['A', 'B']);
});

test('createPropertyComparisonHandler: returns 404 with missing[] when only some ids resolve', async () => {
  const handler = createPropertyComparisonHandler({ database: stubDb({ A: listing({ id: 'A' }) }) });
  const res = makeRes();
  const url = new URL('http://localhost/api/listings/compare?ids=A,B');
  await handler(makeReq('GET'), res, url);
  assert.equal(res.statusCode, 404);
  assert.deepEqual(res.body.missing, ['B']);
});

test('createPropertyComparisonHandler: returns the comparison payload for 2 valid listings', async () => {
  const byId = {
    A: listing({ id: 'A', sqft: 1500, openingBid: 50000 }),
    B: listing({ id: 'B', sqft: 1700, openingBid: 60000 })
  };
  const handler = createPropertyComparisonHandler({ database: stubDb(byId) });
  const res = makeRes();
  const url = new URL('http://localhost/api/listings/compare?ids=A,B');
  await handler(makeReq('GET'), res, url);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.schema, 'property-crawl.compare/v1');
  assert.equal(res.body.targetId, 'A');
  assert.equal(res.body.count, 2);
  assert.equal(res.headers['Cache-Control'], 'no-store');
  assert.equal(res.body.winnerByField.openingBid, 'A', 'A has the cheaper opening bid');
});

test('createPropertyComparisonHandler: returns the comparison payload for 4 valid listings', async () => {
  const byId = {
    A: listing({ id: 'A', sqft: 1500 }),
    B: listing({ id: 'B', sqft: 1700 }),
    C: listing({ id: 'C', sqft: 1900 }),
    D: listing({ id: 'D', sqft: 2100 })
  };
  const handler = createPropertyComparisonHandler({ database: stubDb(byId) });
  const res = makeRes();
  const url = new URL('http://localhost/api/listings/compare?ids=A,B,C,D');
  await handler(makeReq('GET'), res, url);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.count, 4);
  assert.equal(res.body.winnerByField.sqft, 'D');
});