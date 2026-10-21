'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { handleDecisionPacket, resolveRequestAuth } = require('../../server/routes/decision-packet');

function mockResponse() {
  const headers = {};
  let statusCode = 200;
  let body = null;
  return {
    setHeader(name, val) {
      headers[name.toLowerCase()] = val;
    },
    getHeader(name) {
      return headers[name.toLowerCase()];
    },
    status(code) {
      statusCode = code;
      return this;
    },
    json(obj) {
      body = obj;
      return this;
    },
    send(str) {
      body = str;
      return this;
    },
    end(str) {
      body = str;
      return this;
    },
    get statusCode() {
      return statusCode;
    },
    get body() {
      return body;
    },
    get headers() {
      return headers;
    },
  };
}

const SAMPLE_LISTING = {
  id: 'SHERIFF-OH-CUY-4401',
  address: '1420 W 28th St',
  city: 'Cleveland',
  state: 'OH',
  county: 'Cuyahoga',
  zip: '44113',
  propType: 'Single Family',
  openingBid: 55000,
  caseNumber: 'CV-24-887123',
  saleDate: '2026-11-15',
  plaintiff: 'Wells Fargo Bank, N.A.',
  deposit: 5000,
  source: 'sheriff',
};

const mockDb = {
  async getListingById(id) {
    if (id === 'SHERIFF-OH-CUY-4401') return SAMPLE_LISTING;
    return null;
  },
};

// Explicit operator-token env for stub-based tests: the route now fails closed
// with 503 when no token is configured, so tests exercising post-auth behavior
// must run against a configured environment regardless of ambient process.env.
const CONFIGURED_ENV = { SCRAPER_ADMIN_TOKEN: 'test-operator-secret' };

test('Decision Packet API: rejects unauthenticated requests with 401', async () => {
  const req = { method: 'GET', headers: {} };
  const res = mockResponse();
  const url = new URL('http://localhost/api/listings/SHERIFF-OH-CUY-4401/packet');

  await handleDecisionPacket(req, res, url, {
    database: mockDb,
    env: CONFIGURED_ENV,
    resolveAuth: () => ({ authenticated: false, role: null }),
  });

  assert.equal(res.statusCode, 401);
  assert.equal(res.body.code, 'AUTH_REQUIRED');
});

test('Decision Packet API: rejects viewer role with 403 Forbidden', async () => {
  const req = { method: 'GET', headers: { authorization: 'Bearer viewer_token' } };
  const res = mockResponse();
  const url = new URL('http://localhost/api/listings/SHERIFF-OH-CUY-4401/packet');

  await handleDecisionPacket(req, res, url, {
    database: mockDb,
    env: CONFIGURED_ENV,
    resolveAuth: () => ({ authenticated: true, role: 'viewer' }),
  });

  assert.equal(res.statusCode, 403);
  assert.equal(res.body.code, 'PERMISSION_DENIED');
  assert.equal(res.body.role, 'viewer');
});

test('Decision Packet API: permits analyst role and returns decision-packet/v1 JSON', async () => {
  const req = { method: 'GET', headers: { authorization: 'Bearer analyst_token' } };
  const res = mockResponse();
  const url = new URL('http://localhost/api/listings/SHERIFF-OH-CUY-4401/packet');

  await handleDecisionPacket(req, res, url, {
    database: mockDb,
    env: CONFIGURED_ENV,
    resolveAuth: () => ({ authenticated: true, role: 'analyst' }),
  });

  assert.equal(res.statusCode, 200);
  assert.ok(res.body);
  assert.equal(res.body.schemaVersion, 'decision-packet/v1');
  assert.equal(res.body.property.id, 'SHERIFF-OH-CUY-4401');
  assert.equal(res.body.property.openingBid, 55000);
  assert.ok(res.body.integrityChecksum);
  assert.equal(res.body.underwriting.titleRisk.canProceedWithBid, true);
  assert.equal(res.headers['content-type'], 'application/json; charset=utf-8');
});

test('Decision Packet API: returns GitHub-Flavored Markdown when format=markdown', async () => {
  const req = { method: 'GET', headers: { authorization: 'Bearer operator_token' } };
  const res = mockResponse();
  const url = new URL('http://localhost/api/listings/SHERIFF-OH-CUY-4401/packet?format=markdown');

  await handleDecisionPacket(req, res, url, {
    database: mockDb,
    env: CONFIGURED_ENV,
    resolveAuth: () => ({ authenticated: true, role: 'operator' }),
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['content-type'], 'text/markdown; charset=utf-8');
  assert.ok(typeof res.body === 'string');
  assert.ok(res.body.includes('# FORECLOSURE DUE DILIGENCE DECISION PACKET'));
  assert.ok(res.body.includes('1420 W 28th St'));
  assert.ok(res.body.includes('Statutory Title Risk & Lien Survival Matrix'));
});

test('Decision Packet API: accepts operator overrides via query or body', async () => {
  const req = {
    method: 'POST',
    headers: { authorization: 'Bearer operator_token' },
    body: {
      disposition: 'BID',
      maxAllowableOffer: 85000,
      operatorNotes: 'Underwriter sign-off verified via automated pipeline.',
      operatorId: 'analyst-42',
      registrationFunds: 1000,
      creditedDeposit: 5000,
      buyersPremium: 2500,
      sheriffPoundage: 750,
      transferTax: 500,
    },
  };
  const res = mockResponse();
  const url = new URL('http://localhost/api/listings/SHERIFF-OH-CUY-4401/decision-packet');

  await handleDecisionPacket(req, res, url, {
    database: mockDb,
    env: CONFIGURED_ENV,
    resolveAuth: () => ({ authenticated: true, role: 'operator' }),
  });

  assert.equal(res.statusCode, 200);
  const d = res.body.dispositionSignOff;
  assert.equal(d.decision, 'BID');
  assert.equal(d.maxAllowableOffer, 85000);
  assert.equal(d.operatorNotes, 'Underwriter sign-off verified via automated pipeline.');
  assert.equal(d.operatorId, 'analyst-42');

  const c = res.body.underwriting.cashToClose;
  assert.equal(c.registrationFunds, 1000);
  assert.equal(c.creditedDeposit, 5000);
  assert.equal(c.buyersPremium, 2500);
});

test('Decision Packet API: returns 404 for unknown listing', async () => {
  const req = { method: 'GET', headers: { authorization: 'Bearer operator_token' } };
  const res = mockResponse();
  const url = new URL('http://localhost/api/listings/NON-EXISTENT-ID/packet');

  await handleDecisionPacket(req, res, url, {
    database: mockDb,
    env: CONFIGURED_ENV,
    resolveAuth: () => ({ authenticated: true, role: 'operator' }),
  });

  assert.equal(res.statusCode, 404);
  assert.equal(res.body.error, 'Listing not found');
});

test('Decision Packet API: rejects invalid HTTP methods with 405', async () => {
  const req = { method: 'DELETE', headers: {} };
  const res = mockResponse();
  const url = new URL('http://localhost/api/listings/SHERIFF-OH-CUY-4401/packet');

  await handleDecisionPacket(req, res, url, {
    database: mockDb,
  });

  assert.equal(res.statusCode, 405);
});

// ---------------------------------------------------------------------------
// Real-auth coverage (no resolveAuth stubs): exercises resolveRequestAuth with
// explicit env objects. The unconfigured-env branch previously had zero
// coverage and failed OPEN — any junk credential authenticated as 'operator'.
// ---------------------------------------------------------------------------

// --- Fail-closed: no operator token configured (SCRAPER_ADMIN_TOKEN unset) ---

test('Decision Packet API: 503 with junk cookie credential when operator token is unset', async () => {
  const req = { method: 'GET', headers: { cookie: 'workspace_session=garbage' } };
  const res = mockResponse();
  const url = new URL('http://localhost/api/listings/SHERIFF-OH-CUY-4401/packet');

  await handleDecisionPacket(req, res, url, { database: mockDb, env: {} });

  assert.equal(res.statusCode, 503);
  assert.equal(res.body.requiredConfiguration, 'SCRAPER_ADMIN_TOKEN');
  assert.ok(String(res.body.error).includes('SCRAPER_ADMIN_TOKEN'));
  assert.equal(res.body.authenticated, undefined);
});

test('Decision Packet API: 503 with junk Authorization header when operator token is unset', async () => {
  const req = { method: 'GET', headers: { authorization: 'Bearer definitely-not-the-secret' } };
  const res = mockResponse();
  const url = new URL('http://localhost/api/listings/SHERIFF-OH-CUY-4401/packet');

  await handleDecisionPacket(req, res, url, { database: mockDb, env: {} });

  assert.equal(res.statusCode, 503);
  assert.equal(res.body.requiredConfiguration, 'SCRAPER_ADMIN_TOKEN');
  assert.ok(String(res.body.error).includes('SCRAPER_ADMIN_TOKEN'));
});

test('Decision Packet API: 503 with no credentials when operator token is unset', async () => {
  const req = { method: 'GET', headers: {} };
  const res = mockResponse();
  const url = new URL('http://localhost/api/listings/SHERIFF-OH-CUY-4401/packet');

  await handleDecisionPacket(req, res, url, { database: mockDb, env: {} });

  assert.equal(res.statusCode, 503);
  assert.equal(res.body.requiredConfiguration, 'SCRAPER_ADMIN_TOKEN');
});

test('Decision Packet API: 503 on POST overrides when operator token is unset', async () => {
  const req = { method: 'POST', headers: { cookie: 'workspace_session=garbage' }, body: { disposition: 'BID' } };
  const res = mockResponse();
  const url = new URL('http://localhost/api/listings/SHERIFF-OH-CUY-4401/decision-packet');

  await handleDecisionPacket(req, res, url, { database: mockDb, env: {} });

  assert.equal(res.statusCode, 503);
  assert.equal(res.body.requiredConfiguration, 'SCRAPER_ADMIN_TOKEN');
});

test('Decision Packet API: unconfigured resolveRequestAuth never authenticates junk credentials (fail-open regression)', () => {
  // Auditor reproduction: resolveRequestAuth({headers:{cookie:'workspace_session=garbage'}}, {})
  // used to return { authenticated: true, role: 'operator' } for ANY non-empty
  // credential when no operator token was configured.
  const junkCookie = resolveRequestAuth({ headers: { cookie: 'workspace_session=garbage' } }, {});
  assert.equal(junkCookie.authenticated, false);
  assert.equal(junkCookie.role, null);

  const junkBearer = resolveRequestAuth({ headers: { authorization: 'Bearer junk-credentials' } }, {});
  assert.equal(junkBearer.authenticated, false);
  assert.equal(junkBearer.role, null);

  const junkScraperToken = resolveRequestAuth({ headers: { 'x-scraper-token': 'junk' } }, {});
  assert.equal(junkScraperToken.authenticated, false);
  assert.equal(junkScraperToken.role, null);

  const rolePrefixedJunk = resolveRequestAuth({ headers: { authorization: 'Bearer analyst:unverified' } }, {});
  assert.equal(rolePrefixedJunk.authenticated, false);
  assert.equal(rolePrefixedJunk.role, null);

  const noCredentials = resolveRequestAuth({ headers: {} }, {});
  assert.equal(noCredentials.authenticated, false);
  assert.equal(noCredentials.role, null);
});

// --- Characterization: operator token configured (real auth, no stubs) ---

test('Decision Packet API: with token configured, anonymous GET gets 401 AUTH_REQUIRED', async () => {
  const req = { method: 'GET', headers: {} };
  const res = mockResponse();
  const url = new URL('http://localhost/api/listings/SHERIFF-OH-CUY-4401/packet');

  await handleDecisionPacket(req, res, url, { database: mockDb, env: CONFIGURED_ENV });

  assert.equal(res.statusCode, 401);
  assert.equal(res.body.code, 'AUTH_REQUIRED');
});

test('Decision Packet API: with token configured, anonymous POST gets 401 AUTH_REQUIRED', async () => {
  const req = { method: 'POST', headers: {}, body: {} };
  const res = mockResponse();
  const url = new URL('http://localhost/api/listings/SHERIFF-OH-CUY-4401/packet');

  await handleDecisionPacket(req, res, url, { database: mockDb, env: CONFIGURED_ENV });

  assert.equal(res.statusCode, 401);
  assert.equal(res.body.code, 'AUTH_REQUIRED');
});

test('Decision Packet API: with token configured, junk credentials are rejected and never authenticated as operator', async () => {
  const junkBearer = resolveRequestAuth({ headers: { authorization: 'Bearer junk-credentials' } }, CONFIGURED_ENV);
  assert.equal(junkBearer.authenticated, false);
  assert.equal(junkBearer.role, null);
  assert.equal(junkBearer.reason, 'invalid_credentials');

  const junkCookie = resolveRequestAuth({ headers: { cookie: 'workspace_session=garbage' } }, CONFIGURED_ENV);
  assert.equal(junkCookie.authenticated, false);
  assert.equal(junkCookie.role, null);
  assert.equal(junkCookie.reason, 'invalid_credentials');

  const req = { method: 'GET', headers: { authorization: 'Bearer junk-credentials' } };
  const res = mockResponse();
  const url = new URL('http://localhost/api/listings/SHERIFF-OH-CUY-4401/packet');
  await handleDecisionPacket(req, res, url, { database: mockDb, env: CONFIGURED_ENV });
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.code, 'AUTH_REQUIRED');
});

test('Decision Packet API: with token configured, exact operator token authenticates as operator (200)', async () => {
  const req = { method: 'GET', headers: { authorization: 'Bearer test-operator-secret' } };
  const res = mockResponse();
  const url = new URL('http://localhost/api/listings/SHERIFF-OH-CUY-4401/packet');

  await handleDecisionPacket(req, res, url, { database: mockDb, env: CONFIGURED_ENV });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.schemaVersion, 'decision-packet/v1');
  assert.equal(res.body.property.id, 'SHERIFF-OH-CUY-4401');
});

test('Decision Packet API: with token configured, analyst-prefixed token authenticates as analyst (200)', async () => {
  const req = { method: 'GET', headers: { authorization: 'Bearer analyst:test-operator-secret' } };
  const res = mockResponse();
  const url = new URL('http://localhost/api/listings/SHERIFF-OH-CUY-4401/packet');

  await handleDecisionPacket(req, res, url, { database: mockDb, env: CONFIGURED_ENV });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.schemaVersion, 'decision-packet/v1');
});

test('Decision Packet API: with token configured, JSON session token authenticates the embedded role', async () => {
  const req = {
    method: 'GET',
    headers: { authorization: 'Bearer ' + JSON.stringify({ role: 'analyst', secret: 'test-operator-secret' }) },
  };
  const res = mockResponse();
  const url = new URL('http://localhost/api/listings/SHERIFF-OH-CUY-4401/packet');

  await handleDecisionPacket(req, res, url, { database: mockDb, env: CONFIGURED_ENV });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.schemaVersion, 'decision-packet/v1');
});

test('Decision Packet API: with token configured, viewer-prefixed token is authenticated but forbidden (403)', async () => {
  const req = { method: 'GET', headers: { authorization: 'Bearer viewer:test-operator-secret' } };
  const res = mockResponse();
  const url = new URL('http://localhost/api/listings/SHERIFF-OH-CUY-4401/packet');

  await handleDecisionPacket(req, res, url, { database: mockDb, env: CONFIGURED_ENV });

  assert.equal(res.statusCode, 403);
  assert.equal(res.body.code, 'PERMISSION_DENIED');
  assert.equal(res.body.role, 'viewer');
});

test('Decision Packet API: PROPERTY_OPERATOR_SECRET alias configures the route (200)', async () => {
  const req = { method: 'GET', headers: { authorization: 'Bearer alias-secret' } };
  const res = mockResponse();
  const url = new URL('http://localhost/api/listings/SHERIFF-OH-CUY-4401/packet');

  await handleDecisionPacket(req, res, url, { database: mockDb, env: { PROPERTY_OPERATOR_SECRET: 'alias-secret' } });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.schemaVersion, 'decision-packet/v1');
});
