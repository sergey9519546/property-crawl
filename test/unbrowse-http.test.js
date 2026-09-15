'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const tool = require('../scripts/crawler-tools-unbrowse.cjs');
const createSourceNetworkHandler = require('../server/routes/source-network').createSourceNetworkHandler;

function candidate() {
  return {
    schemaVersion: tool.CANDIDATE_SCHEMA, source: 'gsa',
    sourceUrl: 'https://realestatesales.gov/asset-details?property_id=123',
    method: 'GET', reviewStatus: 'pending', generatedAt: '2026-01-01T00:00:00.000Z',
    evidence: {
      provider: 'unbrowse', version: '11.4.1',
      endpointUrl: 'https://realestatesales.gov/asset-details?property_id=123',
      observedAt: '2026-01-01T00:00:00.000Z', notes: 'Reviewed public route.',
    },
  };
}

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

const ADMIN_TOKEN = 'unbrowse-test-token';

function authedHeaders() {
  return { authorization: `Bearer ${ADMIN_TOKEN}` };
}

function makeHandler({ intake = { submitEvidence: () => { throw new Error('intake should not be called'); } }, env = {} } = {}) {
  return createSourceNetworkHandler({ intake, env: { SCRAPER_ADMIN_TOKEN: ADMIN_TOKEN, ...env } });
}

test('POST /api/source-network/unbrowse/intake accepts a valid candidate and forwards it to intake', async () => {
  const intakeCalls = [];
  const handler = makeHandler({
    intake: {
      submitEvidence(input) {
        intakeCalls.push(input);
        return { record: { id: 'intake_test1234', status: 'needs_review' }, deduplicated: false };
      }
    }
  });
  const req = {
    method: 'POST',
    url: '/api/source-network/unbrowse/intake',
    headers: authedHeaders(),
    body: candidate()
  };
  const res = makeRes();
  await handler(req, res);
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.provenance, 'unbrowse-route-candidate');
  assert.equal(res.body.candidateSchema, tool.CANDIDATE_SCHEMA);
  assert.equal(res.body.schemaVersion, tool.CANDIDATE_SCHEMA);
  assert.equal(res.body.source, 'gsa');
  assert.equal(res.body.endpointUrl, 'https://realestatesales.gov/asset-details?property_id=123');
  assert.equal(intakeCalls.length, 1);
  assert.equal(intakeCalls[0].sourceId, 'gsa');
  assert.equal(intakeCalls[0].records[0].provider, 'unbrowse');
});

test('POST /api/source-network/unbrowse/intake rejects candidates that fail validation without calling intake', async () => {
  let intakeCalled = false;
  const handler = makeHandler({
    intake: { submitEvidence() { intakeCalled = true; throw new Error('must not be called'); } }
  });
  const bad = candidate(); bad.method = 'POST';
  const req = { method: 'POST', url: '/api/source-network/unbrowse/intake', headers: authedHeaders(), body: bad };
  const res = makeRes();
  await handler(req, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.provenance, 'unbrowse-route-candidate');
  assert.match(res.body.reason, /method must be GET/);
  assert.equal(intakeCalled, false);
});

test('POST /api/source-network/unbrowse/intake rejects candidates from non-configured hosts', async () => {
  let intakeCalled = false;
  const handler = makeHandler({
    intake: { submitEvidence() { intakeCalled = true; throw new Error('must not be called'); } }
  });
  const bad = candidate(); bad.sourceUrl = 'https://attacker.example.com/foo';
  const req = { method: 'POST', url: '/api/source-network/unbrowse/intake', headers: authedHeaders(), body: bad };
  const res = makeRes();
  await handler(req, res);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.reason, /not configured/);
  assert.equal(intakeCalled, false);
});

test('POST /api/source-network/unbrowse/intake rejects candidates with secret-bearing query parameters', async () => {
  let intakeCalled = false;
  const handler = makeHandler({
    intake: { submitEvidence() { intakeCalled = true; throw new Error('must not be called'); } }
  });
  const bad = candidate(); bad.evidence.endpointUrl += '&api_key=secret';
  const req = { method: 'POST', url: '/api/source-network/unbrowse/intake', headers: authedHeaders(), body: bad };
  const res = makeRes();
  await handler(req, res);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.reason, /Secret-like/);
  assert.equal(intakeCalled, false);
});

test('POST /api/source-network/unbrowse/intake rejects unknown top-level fields without calling intake', async () => {
  let intakeCalled = false;
  const handler = makeHandler({
    intake: { submitEvidence() { intakeCalled = true; throw new Error('must not be called'); } }
  });
  const bad = candidate(); bad.routeMetadata = { arbitrary: true };
  const req = { method: 'POST', url: '/api/source-network/unbrowse/intake', headers: authedHeaders(), body: bad };
  const res = makeRes();
  await handler(req, res);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.reason, /forbidden field/);
  assert.equal(intakeCalled, false);
});

test('POST /api/source-network/unbrowse/intake surfaces intake errors as 400 without leaking internals', async () => {
  const handler = makeHandler({
    intake: { submitEvidence() { throw new Error('store is locked for maintenance'); } }
  });
  const req = { method: 'POST', url: '/api/source-network/unbrowse/intake', headers: authedHeaders(), body: candidate() };
  const res = makeRes();
  await handler(req, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.provenance, 'unbrowse-route-candidate');
  assert.match(res.body.reason, /store is locked/);
});

test('POST /api/source-network/unbrowse/intake returns 200 with deduplicated:true when intake reports a duplicate', async () => {
  const handler = makeHandler({
    intake: { submitEvidence() { return { record: { id: 'intake_dup1234' }, deduplicated: true }; } }
  });
  const req = { method: 'POST', url: '/api/source-network/unbrowse/intake', headers: authedHeaders(), body: candidate() };
  const res = makeRes();
  await handler(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.deduplicated, true);
});

test('POST /api/source-network/unbrowse/intake tolerates a missing body', async () => {
  const handler = makeHandler();
  const req = { method: 'POST', url: '/api/source-network/unbrowse/intake', headers: authedHeaders(), body: undefined };
  const res = makeRes();
  await handler(req, res);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.reason, /must be an object|absolute|invalid/);
});

test('GET /api/source-network/unbrowse/status returns install diagnostics without contacting hosted services', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'unbrowse-status-'));
  const pkg = path.join(directory, 'pkg'); const cfg = path.join(directory, 'cfg');
  fs.mkdirSync(path.join(pkg, 'bin'), { recursive: true });
  fs.mkdirSync(cfg, { recursive: true });
  fs.writeFileSync(path.join(pkg, 'package.json'), '{"version":"11.4.1"}');
  fs.writeFileSync(path.join(pkg, 'bin', 'unbrowse-wrapper.mjs'), '');
  fs.writeFileSync(path.join(cfg, 'config.json'), '{"tos_accepted_version":"2026-01"}');
  // We point the handler at the synthetic install via UNBROWSE_PACKAGE_ROOT
  // and the synthetic consent file via UNBROWSE_CONFIG_DIR.
  const handler = makeHandler({ env: { UNBROWSE_PACKAGE_ROOT: pkg, UNBROWSE_CONFIG_DIR: cfg } });
  const req = { method: 'GET', url: '/api/source-network/unbrowse/status', headers: authedHeaders(), body: null };
  const res = makeRes();
  return handler(req, res).then(() => {
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.installed, true);
    assert.equal(res.body.version, '11.4.1');
    assert.equal(res.body.setupReady, true);
    assert.match(res.body.wrapper, /unbrowse-wrapper\.mjs$/);
    fs.rmSync(directory, { recursive: true, force: true });
  });
});

test('GET /api/source-network/unbrowse/status reports installed:false for a missing installation', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'unbrowse-missing-'));
  const handler = makeHandler({ env: { UNBROWSE_PACKAGE_ROOT: path.join(directory, 'nonexistent') } });
  const req = { method: 'GET', url: '/api/source-network/unbrowse/status', headers: authedHeaders(), body: null };
  const res = makeRes();
  return handler(req, res).then(() => {
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.installed, false);
    assert.equal(res.body.version, null);
    assert.equal(res.body.setupReady, false);
    fs.rmSync(directory, { recursive: true, force: true });
  });
});
