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

test('Decision Packet API: rejects unauthenticated requests with 401', async () => {
  const req = { method: 'GET', headers: {} };
  const res = mockResponse();
  const url = new URL('http://localhost/api/listings/SHERIFF-OH-CUY-4401/packet');

  await handleDecisionPacket(req, res, url, {
    database: mockDb,
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
