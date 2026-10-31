'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createSourceNetworkHandler } = require('../server/routes/source-network');

function response() {
  return {
    statusCode: 200,
    headers: {},
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

async function invoke(handler, { url, method = 'POST', token, body } = {}) {
  const req = {
    url,
    method,
    body,
    headers: token ? { 'x-scraper-token': token } : {},
  };
  const res = response();
  await handler(req, res);
  return res;
}

test('POST /api/sources/press-association-email/collect fails closed (503) when operator token is unset', async () => {
  const handler = createSourceNetworkHandler({
    env: {}, // No SCRAPER_ADMIN_TOKEN or PROPERTY_OPERATOR_SECRET
  });

  const res = await invoke(handler, {
    url: '/api/sources/press-association-email/collect',
    method: 'POST',
    token: 'any-token',
  });

  assert.equal(res.statusCode, 503);
  assert.match(res.body.error, /SCRAPER_ADMIN_TOKEN/i);
});

test('POST /api/sources/press-association-email/collect fails closed (401) when unauthenticated or token mismatches', async () => {
  const handler = createSourceNetworkHandler({
    env: { SCRAPER_ADMIN_TOKEN: 'correct-secret-token' },
  });

  // Missing token
  const noTokenRes = await invoke(handler, {
    url: '/api/sources/press-association-email/collect',
    method: 'POST',
  });
  assert.equal(noTokenRes.statusCode, 401);
  assert.match(noTokenRes.body.error, /credential required/i);

  // Wrong token
  const wrongTokenRes = await invoke(handler, {
    url: '/api/sources/press-association-email/collect',
    method: 'POST',
    token: 'wrong-token',
  });
  assert.equal(wrongTokenRes.statusCode, 401);
  assert.match(wrongTokenRes.body.error, /credential required/i);
});

test('POST /api/sources/press-association-email/collect triggers email notice intake with valid token', async () => {
  const runs = [];
  const mockPool = {
    query: async () => ({ rows: [] }),
  };
  const recordRun = async (pool, sourceId, run) => {
    runs.push({ pool, sourceId, run });
  };

  const handler = createSourceNetworkHandler({
    env: {
      SCRAPER_ADMIN_TOKEN: 'correct-secret-token',
      IMAP_CORPUS_DIR: path.join(__dirname, 'fixtures', 'email-notices'),
    },
    database: { pool: mockPool },
    recordSourceRun: recordRun,
  });

  const res = await invoke(handler, {
    url: '/api/sources/press-association-email/collect',
    method: 'POST',
    token: 'correct-secret-token',
  });

  assert.ok(res.statusCode === 200 || res.statusCode === 202, `Expected 200 or 202, got ${res.statusCode}`);
  assert.equal(res.body.status, 'collected');
  assert.equal(res.body.sourceId, 'press-association-email');
  assert.ok(res.body.accepted > 0, 'Should accept notice items');
  assert.ok(res.body.evidencePackets > 0, 'Should report evidence packets');
  assert.equal(res.body.publicationStatus, 'evidence_only');

  // Verify run was recorded in DB run log
  assert.equal(runs.length, 1);
  assert.equal(runs[0].sourceId, 'press-association-email');
  assert.deepEqual(runs[0].run.listings, []);
  assert.ok(runs[0].run.durationMs >= 0);
  assert.equal(runs[0].run.error, null);
});

test('POST /api/source-network/run triggers email notice intake for press-association-email', async () => {
  const handler = createSourceNetworkHandler({
    env: {
      PROPERTY_OPERATOR_SECRET: 'operator-token-alias',
      IMAP_CORPUS_DIR: path.join(__dirname, 'fixtures', 'email-notices'),
    },
  });

  const res = await invoke(handler, {
    url: '/api/source-network/run',
    method: 'POST',
    token: 'operator-token-alias',
    body: { sourceId: 'press-association-email' },
  });

  assert.ok(res.statusCode === 200 || res.statusCode === 202);
  assert.equal(res.body.status, 'collected');
  assert.equal(res.body.sourceId, 'press-association-email');
  assert.equal(res.body.publicationStatus, 'evidence_only');
  assert.ok(res.body.evidencePackets >= 1);
});

test('POST /api/sources/press-association-email/collect reports waiting_for_inbox when unconfigured and no corpus exists', async () => {
  const handler = createSourceNetworkHandler({
    env: {
      SCRAPER_ADMIN_TOKEN: 'correct-secret-token',
      IMAP_CORPUS_DIR: '/nonexistent/corpus/directory/that/does/not/exist',
      // IMAP host/user/pass unset
    },
  });

  const res = await invoke(handler, {
    url: '/api/sources/press-association-email/collect',
    method: 'POST',
    token: 'correct-secret-token',
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.status, 'waiting_for_inbox');
  assert.equal(res.body.sourceId, 'press-association-email');
  assert.match(res.body.message, /IMAP credentials unset and no corpus directory found/i);
});
