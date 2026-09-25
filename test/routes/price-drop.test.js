'use strict';

// test/routes/price-drop.test.js
//
// Integration tests for GET /api/price-drops.

const assert = require('node:assert/strict');
const test = require('node:test');

const { createPriceDropHandler } = require('../../server/routes/price-drop');

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

function stubDb({ savedListings = [], history = [] } = {}) {
  const historyMap = new Map(history.map((h) => [h.listingId, h]));
  return {
    async getSavedDeals() { return savedListings; },
    async getListingHistory() {
      return [...historyMap.values()];
    }
  };
}

function makeIdentityStub(userId) {
  return function identityStub(req, res) {
    res.setHeader('X-Identity-Used', '1');
    return userId;
  };
}

const NOW_MS = Date.parse('2026-09-16T12:00:00.000Z');
const FIXED_NOW = () => NOW_MS;

test('createPriceDropHandler: returns 405 on non-GET', async () => {
  const handler = createPriceDropHandler({ database: stubDb(), now: FIXED_NOW });
  const res = makeRes();
  const url = new URL('http://localhost/api/price-drops');
  await handler(makeReq('POST'), res, url);
  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.Allow, 'GET');
});

test('createPriceDropHandler: returns 404 for unknown subpaths', async () => {
  const handler = createPriceDropHandler({ database: stubDb(), now: FIXED_NOW });
  const res = makeRes();
  const url = new URL('http://localhost/api/price-dropsx');
  await handler(makeReq('GET'), res, url);
  assert.equal(res.statusCode, 404);
});

test('createPriceDropHandler: empty watchlist returns zero counts', async () => {
  const handler = createPriceDropHandler({
    database: stubDb({ savedListings: [] }),
    now: FIXED_NOW,
    requireWorkspaceIdentity: makeIdentityStub('workspace:operator')
  });
  const res = makeRes();
  const url = new URL('http://localhost/api/price-drops');
  await handler(makeReq('GET'), res, url);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.scanned, 0);
  assert.equal(res.body.dropped, 0);
  assert.equal(res.body.userId, 'workspace:operator');
});

test('createPriceDropHandler: detects a 25% drop on a saved listing', async () => {
  const handler = createPriceDropHandler({
    database: stubDb({
      savedListings: [
        { id: 'A', openingBid: 75000 }, // current
        { id: 'B', openingBid: 100000 }
      ],
      history: [
        { listingId: 'A', openingBid: 100000 }, // 25% drop
        { listingId: 'B', openingBid: 50000 }   // increase
      ]
    }),
    now: FIXED_NOW,
    requireWorkspaceIdentity: makeIdentityStub('workspace:operator')
  });
  const res = makeRes();
  const url = new URL('http://localhost/api/price-drops');
  await handler(makeReq('GET'), res, url);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.scanned, 2);
  assert.equal(res.body.dropped, 1);
  const a = res.body.drops.find((d) => d.listingId === 'A');
  assert.equal(a.dropped, true);
  assert.equal(a.deltaPct, -0.25);
  assert.equal(a.severity, 'major');
  const b = res.body.drops.find((d) => d.listingId === 'B');
  assert.equal(b.dropped, false, 'increase is not a drop');
});

test('createPriceDropHandler: a listing with no history returns reason=previous_missing', async () => {
  const handler = createPriceDropHandler({
    database: stubDb({
      savedListings: [{ id: 'A', openingBid: 50000 }],
      history: []
    }),
    now: FIXED_NOW,
    requireWorkspaceIdentity: makeIdentityStub('workspace:operator')
  });
  const res = makeRes();
  const url = new URL('http://localhost/api/price-drops');
  await handler(makeReq('GET'), res, url);
  const drop = res.body.drops.find((d) => d.listingId === 'A');
  assert.equal(drop.dropped, false);
  assert.equal(drop.reason, 'previous_missing');
});

test('createPriceDropHandler: summary aggregates bySeverity + totalSavings', async () => {
  const handler = createPriceDropHandler({
    database: stubDb({
      savedListings: [
        { id: 'A', openingBid: 95000 }, // 5% off → minor
        { id: 'B', openingBid: 80000 }, // 20% off → major
        { id: 'C', openingBid: 60000 }  // 40% off → extreme
      ],
      history: [
        { listingId: 'A', openingBid: 100000 },
        { listingId: 'B', openingBid: 100000 },
        { listingId: 'C', openingBid: 100000 }
      ]
    }),
    now: FIXED_NOW,
    requireWorkspaceIdentity: makeIdentityStub('workspace:operator')
  });
  const res = makeRes();
  const url = new URL('http://localhost/api/price-drops');
  await handler(makeReq('GET'), res, url);
  assert.equal(res.body.dropped, 3);
  assert.deepEqual(res.body.bySeverity, { minor: 1, moderate: 0, major: 1, extreme: 1, none: 0 });
  assert.equal(res.body.totalSavings, 5000 + 20000 + 40000);
});

test('createPriceDropHandler: a DB without getListingHistory still works (no history = no drops)', async () => {
  // The route must not assume every DB has a history table. The
  // drop engine returns dropped=false for previous_missing, so the
  // summary's dropped count is 0 instead of crashing.
  const dbNoHistory = {
    async getSavedDeals() { return [{ id: 'A', openingBid: 50000 }]; }
  };
  const handler = createPriceDropHandler({
    database: dbNoHistory,
    now: FIXED_NOW,
    requireWorkspaceIdentity: makeIdentityStub('workspace:operator')
  });
  const res = makeRes();
  const url = new URL('http://localhost/api/price-drops');
  await handler(makeReq('GET'), res, url);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.scanned, 1);
  assert.equal(res.body.dropped, 0);
  assert.equal(res.body.drops[0].reason, 'previous_missing');
});

test('createPriceDropHandler: returns 401 when the identity helper rejects', async () => {
  const handler = createPriceDropHandler({
    database: stubDb(),
    now: FIXED_NOW,
    requireWorkspaceIdentity: (req, res) => {
      res.status(401).json({ error: 'unauthenticated' });
      return null;
    }
  });
  const res = makeRes();
  const url = new URL('http://localhost/api/price-drops');
  await handler(makeReq('GET'), res, url);
  assert.equal(res.statusCode, 401);
});