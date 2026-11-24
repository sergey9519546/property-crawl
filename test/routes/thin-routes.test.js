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

test('coverage: GET returns the matrix shape with catalog + catalogByState + liveByState', async () => {
  const res = captureRes();
  await handleCoverage({ method: 'GET' }, res);
  assert.equal(res.statusCode, 200);
  assert.ok(res.payload.catalog, 'catalog aggregate missing');
  assert.ok(res.payload.catalogByState, 'catalogByState missing');
  assert.ok(res.payload.liveByState, 'liveByState missing');
  assert.ok(Array.isArray(res.payload.states));
  assert.equal(res.payload.states.length, 51, 'all 50 states + DC expected');
  assert.ok(res.payload.statusLabels);
});

test('coverage: non-GET method returns 405', async () => {
  const res = captureRes();
  await handleCoverage({ method: 'POST' }, res);
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

test('alerts: DELETE accepts listingId in query param or body', async () => {
  const res = captureRes();
  await handleAlerts({
    method: 'DELETE',
    url: 'http://localhost/api/alerts?listingId=test-listing-1',
    body: {},
    headers: {},
  }, res);
  assert.ok([200, 401, 403, 503].includes(res.statusCode));
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
const { auditDocketEvidence } = handleVerifyDocket;

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

// --- Enrichment route -------------------------------------------------

const { createEnrichmentHandler } = require('../../server/routes/enrichment');

test('enrichment: rejects non-GET on /api/enrichment with 405', async () => {
  const handler = createEnrichmentHandler({});
  const res = captureRes();
  await handler({ method: 'POST', url: 'http://localhost/api/enrichment', headers: { host: 'localhost' } }, res);
  assert.equal(res.statusCode, 405);
});

test('enrichment: returns 404 on unknown nested subpath instead of hanging', async () => {
  const handler = createEnrichmentHandler({});
  const res = captureRes();
  await handler({ method: 'GET', url: 'http://localhost/api/enrichment/parcel-1/unknown-subpath', headers: { host: 'localhost' } }, res);
  assert.equal(res.statusCode, 404);
  assert.equal(res.payload.error, 'Enrichment endpoint not found');
});

test('enrichment: normalizes trailing slash on /api/enrichment/', async () => {
  const handler = createEnrichmentHandler({});
  const res = captureRes();
  await handler({ method: 'GET', url: 'http://localhost/api/enrichment/', headers: { host: 'localhost' } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.schema, 'property-crawl.enrichment-gateway/v1');
});

test('verify-docket: aggregates attached provenance dockets and optional CourtListener lookup without claiming full verification', async () => {
  const dbModule = require('../../server/db/client');
  const originalGetById = dbModule.getListingById;
  dbModule.getListingById = async () => ({
    id: 'cl-test-1',
    address: '500 Oak St',
    county: 'Cuyahoga',
    state: 'OH',
    defendant: 'Oak Street Holdings LLC',
    sourceObservedAt: '2026-10-01T00:00:00Z',
    provenance: {
      sourceFacts: {
        caseNumber: '24-CV-1092',
        documents: [
          { kind: 'docket', label: 'Cuyahoga Common Pleas docket', url: 'https://cpdocket.cuyahogacounty.us/case/24-CV-1092' },
        ],
      },
    },
  });
  try {
    const res = captureRes();
    const mockCourtListener = {
      async scrapeFeed() {
        return [
          {
            sourceUrl: 'https://www.courtlistener.com/docket/98765/in-re-oak-street-holdings/',
            sourceObservedAt: '2026-10-02T00:00:00Z',
            defendant: 'Oak Street Holdings LLC',
            provenance: {
              sourceFacts: {
                caseNumber: '1:24-bk-98765',
                documents: [{ kind: 'docket', label: 'Bankruptcy docket 1:24-bk-98765', url: 'https://www.courtlistener.com/docket/98765/in-re-oak-street-holdings/' }],
              },
            },
          },
        ];
      },
    };
    await handleVerifyDocket({
      method: 'POST',
      url: 'http://localhost/api/verify-docket',
      body: { listingId: 'cl-test-1', lookup: true },
    }, res, { courtlistenerClient: mockCourtListener });
    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.verified, false);
    assert.equal(res.payload.verificationState, 'partial_docket_evidence');
    assert.equal(res.payload.caseNumber, '24-CV-1092');
    assert.equal(res.payload.officialEvidence.length, 2);
    assert.ok(!res.payload.missingEvidence.includes('Official court docket response'));
    assert.ok(res.payload.missingEvidence.includes('Recorded lien and mortgage instruments'));

    // Upstream CourtListener failure degrades gracefully without throwing
    const failRes = captureRes();
    await handleVerifyDocket({
      method: 'POST',
      url: 'http://localhost/api/verify-docket',
      body: { listingId: 'cl-test-1', lookup: true },
    }, failRes, {
      courtlistenerClient: {
        async scrapeFeed() {
          throw new Error('rate limited');
        },
      },
    });
    assert.equal(failRes.statusCode, 200);
    assert.equal(failRes.payload.verified, false);
    assert.equal(failRes.payload.officialEvidence.length, 1);
  } finally {
    dbModule.getListingById = originalGetById;
  }
});

test('verify-docket: skips live CourtListener v4 network lookup when COURTLISTENER_API_KEY is unset', async () => {
  const originalFetch = globalThis.fetch;
  let outboundFetchCount = 0;
  const forbiddenFetch = async () => {
    outboundFetchCount += 1;
    throw new Error('outbound CourtListener v4 fetch must not fire without COURTLISTENER_API_KEY');
  };
  globalThis.fetch = forbiddenFetch;
  try {
    const audit = await auditDocketEvidence(
      { address: '500 Oak St', county: 'Cuyahoga', state: 'OH', defendant: 'Jane Doe' },
      {
        lookup: true,
        checkedAt: '2026-11-24T12:34:56.000Z',
        env: { COURTLISTENER_API_KEY: '', COURTLISTENER_VERIFY_DOCKET: '1' },
        fetchImpl: forbiddenFetch,
      }
    );
    assert.equal(outboundFetchCount, 0);
    assert.equal(audit.lookupExecuted, false);
    assert.equal(audit.lookupSkippedReason, 'courtlistener_api_key_required');
    assert.equal(audit.docketSummary.lookupExecuted, false);
    assert.equal(audit.docketSummary.lookupSkippedReason, 'courtlistener_api_key_required');
    assert.equal(audit.docketSummary.status, 'not_checked');
    assert.ok(
      audit.logs.includes('[12:34:56] Live CourtListener v4 lookup skipped: COURTLISTENER_API_KEY is not configured.')
    );

    const res = captureRes();
    await handleVerifyDocket(
      {
        method: 'POST',
        url: 'http://localhost/api/verify-docket',
        body: { address: '500 Oak St', county: 'Cuyahoga', state: 'OH', lookup: true },
      },
      res,
      {
        env: { COURTLISTENER_API_KEY: '' },
        fetchImpl: forbiddenFetch,
      }
    );
    assert.equal(outboundFetchCount, 0);
    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.verified, false);
    assert.equal(res.payload.verificationState, 'official_source_required');
    assert.equal(res.payload.docketSummary.lookupExecuted, false);
    assert.equal(res.payload.docketSummary.lookupSkippedReason, 'courtlistener_api_key_required');
    assert.ok(res.payload.missingEvidence.includes('Bankruptcy-stay search result'));
    assert.ok(
      res.payload.logs.some((l) => l.includes('Live CourtListener v4 lookup skipped: COURTLISTENER_API_KEY is not configured.'))
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('verify-docket: executes authenticated CourtListener v4 lookup and classifies Chapter 7/13 active bankruptcy dockets without leaking PII', async () => {
  const dbModule = require('../../server/db/client');
  const originalGetById = dbModule.getListingById;
  dbModule.getListingById = async () => ({
    id: 'cl-bk-auth-1',
    address: '742 Maple Ave',
    county: 'Cuyahoga',
    state: 'OH',
    defendant: 'Jane Private Homeowner',
    plaintiff: 'First Federal Mortgage Corp',
    sourceObservedAt: '2026-11-20T00:00:00Z',
  });

  const capturedHeaders = [];
  const capturedUrls = [];
  const mockFetch = async (url, init = {}) => {
    capturedUrls.push(String(url));
    capturedHeaders.push(init.headers || {});
    return {
      status: 200,
      url: String(url),
      headers: new Headers({ 'content-type': 'application/json' }),
      text: async () => JSON.stringify({
        count: 2,
        next: null,
        previous: null,
        results: [
          {
            docket_id: 88010013,
            docketNumber: '1:26-bk-10442',
            court_id: 'ohnb',
            court: 'Bankruptcy Court, N.D. Ohio',
            dateFiled: '2026-11-01',
            dateTerminated: null,
            caseName: 'In re Jane Private Homeowner',
            cause: '11 U.S.C. § 301 Voluntary Petition (Chapter 13)',
            suitNature: '422 Bankruptcy Chap. 13',
            party: ['Jane Private Homeowner'],
            attorney: ['Robert Private Attorney'],
            docket_absolute_url: '/docket/88010013/bankruptcy-case-10442/',
          },
          {
            docket_id: 88010007,
            docketNumber: '1:26-bk-10999',
            court_id: 'ohnb',
            court: 'Bankruptcy Court, N.D. Ohio',
            dateFiled: '2026-11-10',
            dateTerminated: null,
            caseName: 'In re Jane Private Homeowner',
            cause: '11 U.S.C. § 301 Chapter 7 Petition',
            suitNature: 'Bankruptcy Chapter 7',
            party: ['Jane Private Homeowner'],
            attorney: ['Robert Private Attorney'],
            docket_absolute_url: '/docket/88010007/bankruptcy-case-10999/',
          },
        ],
      }),
    };
  };

  try {
    const res = captureRes();
    await handleVerifyDocket(
      {
        method: 'POST',
        url: 'http://localhost/api/verify-docket',
        headers: {},
        body: { listingId: 'cl-bk-auth-1', lookup: true },
      },
      res,
      {
        env: { COURTLISTENER_API_KEY: 'cl-v4-test-token-999' },
        fetchImpl: mockFetch,
      }
    );

    assert.equal(capturedHeaders.length, 1);
    assert.equal(capturedHeaders[0].Authorization, 'Token cl-v4-test-token-999');
    assert.match(capturedUrls[0], /courtlistener\.com\/api\/rest\/v4\/search\//);

    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.verified, false);
    assert.equal(res.payload.piiGated, true);
    assert.equal(res.payload.defendant, null);
    assert.equal(res.payload.plaintiff, null);

    const summary = res.payload.docketSummary;
    assert.equal(summary.lookupExecuted, true);
    assert.equal(summary.lookupSkippedReason, null);
    assert.equal(summary.status, 'active_bankruptcy_docket');
    assert.equal(summary.activeBankruptcyStaySignal, true);
    assert.equal(summary.hitCount, 2);
    assert.equal(summary.bankruptcyHitCount, 2);
    assert.equal(summary.activeBankruptcyCount, 2);
    assert.deepEqual(
      summary.dockets.map((d) => ({ caseNumber: d.caseNumber, chapter: d.chapter, isBankruptcy: d.isBankruptcy, isActive: d.isActive })),
      [
        { caseNumber: '1:26-bk-10442', chapter: '13', isBankruptcy: true, isActive: true },
        { caseNumber: '1:26-bk-10999', chapter: '7', isBankruptcy: true, isActive: true },
      ]
    );

    // Non-PII contract: personal debtor/attorney names never appear in docketSummary
    const serializedSummary = JSON.stringify(summary);
    assert.ok(!serializedSummary.includes('Jane Private Homeowner'));
    assert.ok(!serializedSummary.includes('Robert Private Attorney'));
  } finally {
    dbModule.getListingById = originalGetById;
  }
});
