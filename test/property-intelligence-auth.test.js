"use strict";

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPropertyIntelligenceHandler } = require('../server/routes/property-intelligence');

const listing = {
  id: 'INT-2',
  address: '2 Main',
  source: 'hud',
  sourceUrl: 'https://example.com/listing',
  sourceObservedAt: new Date().toISOString(),
  provenance: { origin: 'live' },
};

function makeReq(method, url, headers = {}, body = null) {
  return { method, url, headers, body };
}

function makeRes() {
  const res = {
    statusCode: 200,
    body: null,
    setHeader() { return res; },
    status(code) { res.statusCode = code; return res; },
    json(data) { res.body = data; return res; },
  };
  return res;
}

function handlerWith(opts = {}) {
  process.env.SCRAPER_ADMIN_TOKEN = opts.token || 'intel-secret';
  return createPropertyIntelligenceHandler({
    database: {
      isPg: true,
      getListingById: async () => listing,
      pool: {},
    },
    durableEvidence: {
      loadEvidence: async () => ({
        observations: { records: {}, signals: [] },
        extraField: 'operator-visible',
      }),
      readResearch: async () => ({ savedAt: Date.now(), result: { parcelLookup: 'ok' } }),
    },
    env: process.env,
  });
}

test('authorized property-intelligence GET omits researchRestricted', async () => {
  const handler = handlerWith();
  const res = makeRes();
  await handler(makeReq('GET', '/api/property-intelligence?listingId=INT-2', { authorization: 'Bearer intel-secret' }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.extraField, 'operator-visible');
  assert.equal(res.body.researchRestricted, undefined);
  delete process.env.SCRAPER_ADMIN_TOKEN;
});

test('wrong operator token does not receive research extensions', async () => {
  const handler = handlerWith();
  const res = makeRes();
  await handler(makeReq('GET', '/api/property-intelligence?listingId=INT-2', { authorization: 'Bearer wrong-token' }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.researchRestricted, true);
  assert.equal(res.body.extraField, undefined);
  delete process.env.SCRAPER_ADMIN_TOKEN;
});

test('POST property-intelligence without operator token is denied', async () => {
  const handler = handlerWith();
  const res = makeRes();
  await handler(makeReq('POST', '/api/property-intelligence', {}, { listingId: 'INT-2' }), res);
  assert.ok(res.statusCode === 401 || res.statusCode === 503);
  delete process.env.SCRAPER_ADMIN_TOKEN;
});

test('health-equivalent anonymous GET when operator token unset stays restricted', async () => {
  delete process.env.SCRAPER_ADMIN_TOKEN;
  delete process.env.PROPERTY_OPERATOR_SECRET;
  const handler = createPropertyIntelligenceHandler({
    database: { isPg: true, getListingById: async () => listing, pool: {} },
    durableEvidence: {
      loadEvidence: async () => ({ observations: { records: {}, signals: [] }, extraField: 'x' }),
      readResearch: async () => ({ savedAt: Date.now(), result: { secret: true } }),
    },
    env: process.env,
  });
  const res = makeRes();
  await handler(makeReq('GET', '/api/property-intelligence?listingId=INT-2'), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.researchRestricted, true);
  assert.equal(res.body.extraField, undefined);
});
