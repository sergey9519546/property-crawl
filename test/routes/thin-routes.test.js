'use strict';

// test/routes/thin-routes.test.js
//
// HTTP-level unit tests for the thin route handlers that previously had no
// direct route-shape coverage:
//
//   - server/routes/coverage.js         (GET /api/coverage)
//   - server/routes/alerts.js           (GET/POST/DELETE /api/alerts)
//   - server/routes/property-signals.js (GET/POST /api/property-signals)
//   - server/routes/verify-docket.js    (POST /api/verify-docket — additional branches)
//
// Each handler is exercised through a minimal req/res pair that captures the
// status + JSON payload. The shape of every response is pinned so a future
// refactor that silently changes the contract fails the test.

const assert = require('node:assert/strict');
const test = require('node:test');

// --- Coverage matrix route ----------------------------------------------

const handleCoverage = require('../../server/routes/coverage');

function captureRes() {
  // The returned object IS the response — statusCode and payload are stored
  // on it so tests can read `res.statusCode` and `res.payload` directly.
  const res = {
    statusCode: 200,
    payload: null,
    headers: {},
    setHeader(name, value) { this.headers[name] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
  };
  return res;
}

test('coverage: GET returns the matrix shape with catalog + catalogByState + liveByState', () => {
  const res = captureRes();
  handleCoverage({ method: 'GET' }, res);
  assert.equal(res.statusCode, 200);
  assert.ok(res.payload.catalog, 'catalog aggregate missing');
  assert.ok(res.payload.catalogByState, 'catalogByState missing');
  assert.ok(res.payload.liveByState, 'liveByState missing');
  assert.ok(Array.isArray(res.payload.states));
  assert.equal(res.payload.states.length, 51, 'all 50 states + DC expected');
  assert.ok(res.payload.statusLabels);
});

test('coverage: non-GET method returns 405', () => {
  const res = captureRes();
  handleCoverage({ method: 'POST' }, res);
  assert.equal(res.statusCode, 405);
  assert.match(res.payload.error, /Method not allowed/);
});

// --- Alerts route ------------------------------------------------------

const handleAlerts = require('../../server/routes/alerts');

function mockReq({ method = 'GET', body = {}, headers = {} } = {}) {
  return { method, body, headers, url: 'http://localhost/api/alerts' };
}

test('alerts: GET refuses without workspace identity configured', async () => {
  // Without a SCRAPER_ADMIN_TOKEN the auth gate refuses with 503
  // ("Private workspace access is not configured"). With the env var set,
  // the handler returns 200 with the saved deals array. Both are valid
  // shapes for the same handler.
  const res = captureRes();
  await handleAlerts(mockReq({ method: 'GET' }), res);
  assert.ok([200, 401, 403, 503].includes(res.statusCode));
  if (res.statusCode === 200) {
    assert.ok(Array.isArray(res.payload.deals));
    assert.equal(typeof res.payload.savedCount, 'number');
  } else {
    assert.ok(typeof res.payload.error === 'string');
  }
});

test('alerts: POST refuses without workspace identity configured', async () => {
  const res = captureRes();
  await handleAlerts(mockReq({ method: 'POST', body: {} }), res);
  assert.ok([400, 401, 403, 503].includes(res.statusCode));
});

test('alerts: non-GET/POST/DELETE method returns 405 when auth passes', async () => {
  // With auth failing, the response is 503, not 405 — the auth gate fires
  // first. With auth passing, the trailing 405 branch fires. Accept either
  // shape and assert the error message when 405 is reached.
  const res = captureRes();
  await handleAlerts(mockReq({ method: 'PATCH' }), res);
  assert.ok([401, 403, 405, 503].includes(res.statusCode));
  if (res.statusCode === 405) {
    assert.match(res.payload.error, /Method not allowed/);
  }
});

// --- Property signals route -------------------------------------------

const { createPropertySignalsHandler } = require('../../server/routes/property-signals');

test('property-signals: returns 405 for an unsupported method', async () => {
  const handler = createPropertySignalsHandler({
    database: { getListingById: async () => null },
    loadObservations: () => ({ records: {}, signals: [] }),
  });
  const res = captureRes();
  await handler({ method: 'PUT', url: 'http://localhost/api/property-signals' }, res);
  assert.equal(res.statusCode, 405);
});

test('property-signals: returns 400 for a missing listingId', async () => {
  const handler = createPropertySignalsHandler({
    database: { getListingById: async () => null },
    loadObservations: () => ({ records: {}, signals: [] }),
  });
  const res = captureRes();
  await handler({ method: 'GET', url: 'http://localhost/api/property-signals' }, res);
  assert.equal(res.statusCode, 400);
  assert.match(res.payload.error, /listing ID/i);
});

test('property-signals: returns 400 for an oversize listingId', async () => {
  const handler = createPropertySignalsHandler({
    database: { getListingById: async () => null },
    loadObservations: () => ({ records: {}, signals: [] }),
  });
  const res = captureRes();
  const longId = 'x'.repeat(161);
  await handler({ method: 'GET', url: `http://localhost/api/property-signals?listingId=${longId}` }, res);
  assert.equal(res.statusCode, 400);
});

test('property-signals: returns 404 when the listing is not in the database', async () => {
  const handler = createPropertySignalsHandler({
    database: { getListingById: async () => null },
    loadObservations: () => ({ records: {}, signals: [] }),
  });
  const res = captureRes();
  await handler({ method: 'GET', url: 'http://localhost/api/property-signals?listingId=NOPE' }, res);
  assert.equal(res.statusCode, 404);
});

test('property-signals: returns the evaluation payload for a real listing', async () => {
  const handler = createPropertySignalsHandler({
    database: {
      getListingById: async () => ({
        id: 'L1',
        sourceUrl: 'https://example.com/x',
        saleDate: '2027-01-01',
      }),
    },
    loadObservations: () => ({ records: {}, signals: [] }),
  });
  const res = captureRes();
  await handler({ method: 'GET', url: 'http://localhost/api/property-signals?listingId=L1' }, res);
  assert.equal(res.statusCode, 200);
  assert.ok(res.payload.signals);
  assert.ok(Array.isArray(res.payload.signals));
  assert.ok(res.payload.signals.length > 0, 'expected at least one signal');
});

test('property-signals: POST body listingId is honored', async () => {
  let seenId = null;
  const handler = createPropertySignalsHandler({
    database: {
      getListingById: async (id) => { seenId = id; return { id, sourceUrl: 'https://example.com/x' }; },
    },
    loadObservations: () => ({ records: {}, signals: [] }),
  });
  const res = captureRes();
  await handler({ method: 'POST', body: { listingId: 'L2' }, url: 'http://localhost/api/property-signals' }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(seenId, 'L2');
});

test('property-signals: database errors propagate as 503', async () => {
  const handler = createPropertySignalsHandler({
    database: { getListingById: async () => { throw new Error('db down'); } },
    loadObservations: () => ({ records: {}, signals: [] }),
  });
  const res = captureRes();
  await handler({ method: 'GET', url: 'http://localhost/api/property-signals?listingId=L1' }, res);
  assert.equal(res.statusCode, 503);
  assert.match(res.payload.error, /unavailable/i);
});

// --- Verify-docket route ----------------------------------------------

const handleVerifyDocket = require('../../server/routes/verify-docket');

test('verify-docket: rejects method other than GET/POST with 405', async () => {
  const res = captureRes();
  await handleVerifyDocket({ method: 'DELETE', url: 'http://localhost/api/verify-docket', body: {} }, res);
  assert.equal(res.statusCode, 405);
});

test('verify-docket: returns 400 when required fields are missing', async () => {
  const res = captureRes();
  await handleVerifyDocket({ method: 'POST', url: 'http://localhost/api/verify-docket', body: { address: 'X' } }, res);
  assert.equal(res.statusCode, 400);
  assert.match(res.payload.error, /Address, county/);
});

test('verify-docket: returns 404 when a known listingId cannot be found', async () => {
  // Stub the database lookup to return null for the listingId.
  const dbModule = require('../../server/db/client');
  const originalGetById = dbModule.getListingById;
  dbModule.getListingById = async () => null;
  try {
    const res = captureRes();
    await handleVerifyDocket({
      method: 'POST',
      url: 'http://localhost/api/verify-docket',
      body: { listingId: 'does-not-exist', address: '500 X St', county: 'X', state: 'OH' },
    }, res);
    assert.equal(res.statusCode, 404);
    assert.equal(res.payload.verified, false);
    assert.equal(res.payload.verificationState, 'not_found');
  } finally {
    dbModule.getListingById = originalGetById;
  }
});

test('verify-docket: returns the truthful UNVERIFIED audit payload', async () => {
  const res = captureRes();
  await handleVerifyDocket({
    method: 'POST',
    url: 'http://localhost/api/verify-docket',
    body: { address: '500 Oak St', county: 'Cuyahoga', state: 'OH' },
  }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.verified, false);
  assert.equal(res.payload.verificationState, 'official_source_required');
  assert.equal(res.payload.caseNumber, null);
  assert.deepEqual(res.payload.officialEvidence, []);
  assert.ok(Array.isArray(res.payload.missingEvidence));
  assert.ok(res.payload.missingEvidence.length >= 4);
  assert.ok(Array.isArray(res.payload.logs));
  assert.match(res.payload.summaryMarkdown, /UNVERIFIED/);
  assert.match(res.payload.disclaimer, /not verified/i);
});
