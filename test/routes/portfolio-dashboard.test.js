'use strict';

// test/routes/portfolio-dashboard.test.js
//
// Integration tests for the portfolio dashboard HTTP route. End-to-end
// with a stub DB that returns the user's saved listings. The
// workspace-identity helper is injected via the factory's dependency
// bag so the test surface stays narrow (we test the dashboard handler,
// not the auth gate).

const assert = require('node:assert/strict');
const test = require('node:test');

const { createPortfolioDashboardHandler, serializeDashboard } = require('../../server/routes/portfolio-dashboard');

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

function stubDb(listings = []) {
  return { async getSavedDeals() { return listings; } };
}

function makeIdentityStub(userId) {
  return function identityStub(req, res) {
    res.setHeader('X-Identity-Used', '1');
    return userId;
  };
}

const NOW_MS = Date.parse('2026-09-16T12:00:00.000Z');
const FIXED_NOW = () => NOW_MS;

const SAVED = [
  {
    id: 'A', source: 'treasury', state: 'TX', city: 'Bruni', address: '112 North Ave E',
    propType: 'Single Family', sqft: 1500, openingBid: 50000, mid: 100000, dealScore: 70,
    saleDate: '2026-09-22T15:00:00.000Z'
  },
  {
    id: 'B', source: 'hud', state: 'CA', city: 'Bakersfield', address: '500 Oak St',
    propType: 'Single Family', sqft: 1800, openingBid: 120000, mid: 180000, dealScore: 80,
    saleDate: '2026-09-30T15:00:00.000Z'
  },
  {
    id: 'C', source: 'irs', state: 'TX', city: 'Houston', address: '99 Land Rd',
    propType: 'Land', sqft: 0, openingBid: 25000, mid: 60000, dealScore: 50,
    saleDate: null
  }
];

test('createPortfolioDashboardHandler: returns the dashboard payload for an authenticated user', async () => {
  const handler = createPortfolioDashboardHandler({
    database: stubDb(SAVED),
    now: FIXED_NOW,
    requireWorkspaceIdentity: makeIdentityStub('workspace:operator')
  });
  const res = makeRes();
  const url = new URL('http://localhost/api/portfolio/dashboard');
  await handler(makeReq('GET'), res, url);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['Cache-Control'], 'no-store');
  assert.equal(res.body.schema, 'property-crawl.portfolio-dashboard/v1');
  assert.equal(res.body.userId, 'workspace:operator');
  assert.equal(res.body.count, 3);
  assert.equal(res.body.upcomingSales.length, 2);
});

test('createPortfolioDashboardHandler: applies upcomingWindowDays + upcomingLimit from query', async () => {
  const handler = createPortfolioDashboardHandler({
    database: stubDb(SAVED),
    now: FIXED_NOW,
    requireWorkspaceIdentity: makeIdentityStub('workspace:operator')
  });
  const res = makeRes();
  const url = new URL('http://localhost/api/portfolio/dashboard?upcomingWindowDays=14&upcomingLimit=1');
  await handler(makeReq('GET'), res, url);
  assert.equal(res.body.upcomingSales.length, 1);
  // The 14-day window excludes the 9/30 sale (14 days out from 9/16)
  // and only includes the 9/22 sale.
  assert.equal(res.body.upcomingSales[0].id, 'A');
});

test('createPortfolioDashboardHandler: bogus query params fall back to defaults', async () => {
  const handler = createPortfolioDashboardHandler({
    database: stubDb(SAVED),
    now: FIXED_NOW,
    requireWorkspaceIdentity: makeIdentityStub('workspace:operator')
  });
  const res = makeRes();
  const url = new URL('http://localhost/api/portfolio/dashboard?upcomingWindowDays=NaN&upcomingLimit=99999');
  await handler(makeReq('GET'), res, url);
  assert.equal(res.body.upcomingSales.length, 2, 'default limit=5 covers both');
});

test('createPortfolioDashboardHandler: returns 405 on non-GET', async () => {
  const handler = createPortfolioDashboardHandler({
    database: stubDb([]),
    now: FIXED_NOW,
    requireWorkspaceIdentity: makeIdentityStub('workspace:operator')
  });
  const res = makeRes();
  const url = new URL('http://localhost/api/portfolio/dashboard');
  await handler(makeReq('POST'), res, url);
  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.Allow, 'GET');
});

test('createPortfolioDashboardHandler: returns 404 for unknown portfolio subpaths', async () => {
  const handler = createPortfolioDashboardHandler({
    database: stubDb([]),
    now: FIXED_NOW,
    requireWorkspaceIdentity: makeIdentityStub('workspace:operator')
  });
  const res = makeRes();
  const url = new URL('http://localhost/api/portfolio/unknown');
  await handler(makeReq('GET'), res, url);
  assert.equal(res.statusCode, 404);
});

test('createPortfolioDashboardHandler: empty watchlist returns zero counts but a valid payload', async () => {
  const handler = createPortfolioDashboardHandler({
    database: stubDb([]),
    now: FIXED_NOW,
    requireWorkspaceIdentity: makeIdentityStub('workspace:operator')
  });
  const res = makeRes();
  const url = new URL('http://localhost/api/portfolio/dashboard');
  await handler(makeReq('GET'), res, url);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.count, 0);
  assert.equal(res.body.totalEstimatedValue, null);
  assert.deepEqual(res.body.upcomingSales, []);
  assert.deepEqual(res.body.perState, {});
});

test('createPortfolioDashboardHandler: returns 401 when the identity helper rejects', async () => {
  const handler = createPortfolioDashboardHandler({
    database: stubDb(SAVED),
    now: FIXED_NOW,
    requireWorkspaceIdentity: (req, res) => {
      res.status(401).json({ error: 'unauthenticated' });
      return null;
    }
  });
  const res = makeRes();
  const url = new URL('http://localhost/api/portfolio/dashboard');
  await handler(makeReq('GET'), res, url);
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.error, 'unauthenticated');
});

// --- serializeDashboard ----------------------------------------------------

test('serializeDashboard: rounds floats + preserves the input shape', () => {
  const out = serializeDashboard({
    userId: 'workspace:operator',
    count: 3,
    totalEstimatedValue: 340000,
    totalEstimatedEquity: 60000,
    medianOpeningBid: 65000.123,
    medianMid: 105000.789,
    medianDealScore: 70,
    medianDiscount: 0.3500,
    perState: { TX: 2 },
    perSource: { treasury: 1 },
    perPropType: { 'Single Family': 3 },
    upcomingSales: [{ id: 'A', openingBid: 50000, mid: 100000 }],
    missing: { missing_deal_score: 1 },
    generatedAt: '2026-09-16T12:00:00.000Z'
  });
  assert.equal(out.medianOpeningBid, 65000.12);
  assert.equal(out.medianMid, 105000.79);
  assert.equal(out.medianDiscount, 0.35);
  assert.ok(Array.isArray(out.upcomingSales));
  assert.equal(out.generatedAt, '2026-09-16T12:00:00.000Z');
});