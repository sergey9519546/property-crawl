'use strict';

// test/routes/auction-calendar.test.js
//
// Integration tests for the auction-calendar HTTP route at
// server/routes/auction-calendar.js.

const assert = require('node:assert/strict');
const test = require('node:test');

const { createAuctionCalendarHandler, parseStates } = require('../../server/routes/auction-calendar');

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
  return { async getListings() { return { listings: pool }; } };
}

const NOW_MS = Date.parse('2026-09-16T12:00:00.000Z');
const FIXED_NOW = () => NOW_MS;

const POOL = [
  { id: 'A', source: 'treasury', state: 'TX', saleDate: '2026-09-22T10:00:00.000Z', openingBid: 50000, mid: 100000, dealScore: 70, propType: 'Single Family' },
  { id: 'B', source: 'hud', state: 'TX', saleDate: '2026-09-23T15:00:00.000Z', openingBid: 70000, mid: 110000, dealScore: 80, propType: 'Single Family' },
  { id: 'C', source: 'irs', state: 'CA', saleDate: '2026-09-29T10:00:00.000Z', openingBid: 90000, mid: 120000, dealScore: 75, propType: 'Land' },
  { id: 'D', source: 'treasury', state: 'TX', saleDate: '2026-12-25T10:00:00.000Z', openingBid: 80000, mid: 150000, dealScore: 65, propType: 'Single Family' }
];

// --- parseStates ---------------------------------------------------------

test('parseStates: parses comma-separated uppercase list', () => {
  assert.deepEqual(parseStates('TX,CA'), ['TX', 'CA']);
});

test('parseStates: trims whitespace and ignores empty entries', () => {
  assert.deepEqual(parseStates(' TX ,  CA '), ['TX', 'CA']);
});

test('parseStates: returns null for empty / missing input', () => {
  assert.equal(parseStates(null), null);
  assert.equal(parseStates(''), null);
  assert.equal(parseStates('   '), null);
});

// --- handler -------------------------------------------------------------

test('createAuctionCalendarHandler: returns 405 on non-GET', async () => {
  const handler = createAuctionCalendarHandler({ database: stubDb([]), now: FIXED_NOW });
  const res = makeRes();
  const url = new URL('http://localhost/api/auction-calendar');
  await handler(makeReq('POST'), res, url);
  assert.equal(res.statusCode, 405);
});

test('createAuctionCalendarHandler: returns weeks grouped by ISO-week', async () => {
  const handler = createAuctionCalendarHandler({ database: stubDb(POOL), now: FIXED_NOW });
  const res = makeRes();
  const url = new URL('http://localhost/api/auction-calendar?windowDays=60');
  await handler(makeReq('GET'), res, url);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.schema, 'property-crawl.auction-calendar/v1');
  assert.ok(res.body.weeks.length >= 2);
  const firstWeek = res.body.weeks[0];
  assert.equal(firstWeek.count, 2); // A + B same week
  assert.ok(firstWeek.sample.length > 0);
});

test('createAuctionCalendarHandler: state filter restricts the pool', async () => {
  const handler = createAuctionCalendarHandler({ database: stubDb(POOL), now: FIXED_NOW });
  const res = makeRes();
  const url = new URL('http://localhost/api/auction-calendar?states=TX&windowDays=60');
  await handler(makeReq('GET'), res, url);
  // POOL has A (TX), B (TX), D (TX but out of window) — so 2 TX listings in window
  const totalCount = res.body.weeks.reduce((sum, w) => sum + w.count, 0);
  assert.equal(totalCount, 2);
  assert.deepEqual(res.body.states, ['TX']);
});

test('createAuctionCalendarHandler: windowDays caps the planning horizon', async () => {
  // NOW_MS = Sep 16 12:00 UTC; window=7 days ends Sep 23 12:00 UTC.
  // Listing A (Sep 22) is in-window, Listing B (Sep 23 15:00) is just past
  // the cutoff, Listing C (Sep 29) is in-window but a different week.
  // Use a 14-day window so A + B both fall inside the same week.
  const handler = createAuctionCalendarHandler({ database: stubDb(POOL), now: FIXED_NOW });
  const res = makeRes();
  const url = new URL('http://localhost/api/auction-calendar?windowDays=14');
  await handler(makeReq('GET'), res, url);
  const totalCount = res.body.weeks.reduce((sum, w) => sum + w.count, 0);
  assert.equal(totalCount, 3, 'A + B in first 14 days; C (Sep 29) is also in-window');
  assert.ok(res.body.dropped.outsideWindow >= 1, 'D (Dec 25) is outside window');
});

// --- pool coverage -------------------------------------------------------
//
// The calendar used to read `getListings({ limit: 1000 })` once. Against the
// real store (9,831 rows) that silently described 10% of the inventory as
// though it were the whole auction calendar, and the `dropped` counters it
// published described that slice rather than the store -- so "noDate: 866"
// read as a claim about the inventory when it was a claim about page 1.
//
// The engine is handed a pool; it has no idea how big the store was. These
// tests pin the two properties that make the endpoint honest: it reads to the
// end of the store, and when it cannot, it says so.

// A paged stub that behaves like the real Postgres path: honours limit/offset
// and reports the full match count alongside each page.
function pagedDb(pool, pageSize = 1000) {
  return {
    calls: [],
    async getListings(filters = {}) {
      const off = Number(filters.offset) || 0;
      const lim = Number(filters.limit) || 0;
      this.calls.push({ limit: lim, offset: off });
      return { total: pool.length, listings: pool.slice(off, off + lim) };
    }
  };
}

function datedPool(n, weekOffsetDays = 0) {
  const base = NOW_MS + (7 + weekOffsetDays) * 86_400_000;
  return Array.from({ length: n }, (_, i) => ({
    id: `X${i}`,
    source: 'treasury',
    state: 'TX',
    // Spread across two ISO weeks so the buckets are not all one row.
    saleDate: new Date(base + (i % 10) * 86_400_000).toISOString(),
    propType: 'Single Family'
  }));
}

test('createAuctionCalendarHandler: reads past the first page to cover the whole store', async () => {
  const big = datedPool(2500);
  const database = pagedDb(big);
  const handler = createAuctionCalendarHandler({ database, now: FIXED_NOW });
  const res = makeRes();
  const url = new URL('http://localhost/api/auction-calendar?windowDays=60');
  await handler(makeReq('GET'), res, url);

  const totalCount = res.body.weeks.reduce((sum, w) => sum + w.count, 0);
  assert.equal(totalCount, 2500,
    'every in-window listing is counted -- not just the first 1,000 rows');
  assert.ok(database.calls.length > 1, 'the pool is read in more than one page');
});

test('createAuctionCalendarHandler: publishes how much of the store it actually read', async () => {
  const big = datedPool(2500);
  const handler = createAuctionCalendarHandler({ database: pagedDb(big), now: FIXED_NOW });
  const res = makeRes();
  const url = new URL('http://localhost/api/auction-calendar?windowDays=60');
  await handler(makeReq('GET'), res, url);

  assert.equal(res.body.scanned, 2500, 'scanned rows is the pool actually handed to the engine');
  assert.equal(res.body.availableTotal, 2500, 'availableTotal is the store size');
  assert.equal(res.body.truncated, false, 'nothing was left unread, so nothing is truncated');
});

test('createAuctionCalendarHandler: says so when the store is bigger than what it could read', async () => {
  // A backend that reports 9,831 available but has only 1,000 rows to hand
  // over: offset past 1,000 and it returns nothing. Truncation must be visible
  // in the payload, not just inferable by comparing counts.
  const capped = datedPool(1000);
  const truncatedDb = {
    async getListings(filters = {}) {
      const off = Number(filters.offset) || 0;
      return { total: 9831, listings: capped.slice(off, off + 1000) };
    }
  };
  const handler = createAuctionCalendarHandler({ database: truncatedDb, now: FIXED_NOW });
  const res = makeRes();
  const url = new URL('http://localhost/api/auction-calendar?windowDays=60');
  await handler(makeReq('GET'), res, url);

  assert.equal(res.body.scanned, 1000);
  assert.equal(res.body.availableTotal, 9831);
  assert.equal(res.body.truncated, true,
    'a pool smaller than the store is reported as truncated');
});

test('createAuctionCalendarHandler: reports the full store for a small pool too', async () => {
  const handler = createAuctionCalendarHandler({ database: stubDb(POOL), now: FIXED_NOW });
  const res = makeRes();
  const url = new URL('http://localhost/api/auction-calendar?windowDays=60');
  await handler(makeReq('GET'), res, url);
  assert.equal(res.body.scanned, POOL.length);
  assert.equal(res.body.truncated, false);
});

test('createAuctionCalendarHandler: bogus params fall back to defaults', async () => {
  const handler = createAuctionCalendarHandler({ database: stubDb(POOL), now: FIXED_NOW });
  const res = makeRes();
  const url = new URL('http://localhost/api/auction-calendar?windowDays=NaN&sampleSize=99999');
  await handler(makeReq('GET'), res, url);
  assert.equal(res.body.windowDays, 60);
  assert.ok(res.body.weeks.every((w) => w.sample.length <= 10));
});