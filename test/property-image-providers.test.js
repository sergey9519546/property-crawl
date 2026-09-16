'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createProviderStatusHandler,
  DEFAULT_PROVIDERS,
  buildProviderSnapshot,
  snapshotCircuit
} = require('../server/routes/property-image-providers');

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

test('createProviderStatusHandler returns 405 on non-GET', async () => {
  const handler = createProviderStatusHandler();
  const res = makeRes();
  await handler({ method: 'POST' }, res);
  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.Allow, 'GET');
});

test('createProviderStatusHandler returns the documented schema + summary for an unset environment', async () => {
  const handler = createProviderStatusHandler({ env: {} });
  const res = makeRes();
  await handler({ method: 'GET' }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['Cache-Control'], 'no-store');
  assert.match(res.body.schema, /property-image-providers\/v1/);
  assert.equal(res.body.summary.total, DEFAULT_PROVIDERS.length);
  // No key configured for any provider
  assert.equal(res.body.summary.missingKey, res.body.providers.filter((p) => p.keyEnvVar).length);
  assert.ok(Array.isArray(res.body.providers));
});

test('snapshotCircuit returns an available:true for an untouched circuit', () => {
  const snap = snapshotCircuit({ openedUntil: 0, failures: 0 });
  assert.equal(snap.available, true);
  assert.equal(snap.openedUntil, null);
  assert.equal(snap.retryAfterSeconds, 0);
});

test('snapshotCircuit reports openedUntil + retryAfterSeconds when the circuit is open', () => {
  const now = 5_000_000;
  const snap = snapshotCircuit({ openedUntil: now + 30_000, failures: 3 }, () => now);
  assert.equal(snap.available, false);
  assert.ok(snap.openedUntil);
  assert.equal(snap.retryAfterSeconds, 30);
});

test('snapshotCircuit reports unknown when no circuit is provided', () => {
  const snap = snapshotCircuit(null);
  assert.equal(snap.available, null);
  assert.match(snap.note, /no circuit/);
});

test('buildProviderSnapshot marks a configured provider with keyLength > 0', () => {
  const provider = { id: 'mock', label: 'Mock', role: 'geocoding', keyEnvVar: 'MOCK_API_KEY' };
  const env = { MOCK_API_KEY: 'abc123' };
  const snap = buildProviderSnapshot({ provider, env });
  assert.equal(snap.keyConfigured, true);
  assert.equal(snap.keyLength, 6);
});

test('buildProviderSnapshot marks a configured provider without a keyEnvVar as keyConfigured:true with length 0', () => {
  const provider = { id: 'panoramax', label: 'Panoramax', role: 'streetview-alternative' };
  const snap = buildProviderSnapshot({ provider, env: {} });
  assert.equal(snap.keyConfigured, true);
  assert.equal(snap.keyLength, 0);
});

test('createProviderStatusHandler wires the cache stats for cacheable providers', () => {
  const cache = { stats: () => ({ total: 3, live: 3, expired: 0, maxEntries: 1000, ttlMs: 60_000 }) };
  const handler = createProviderStatusHandler({ env: { GOOGLE_MAPS_API_KEY: 'a'.repeat(32) }, cache });
  const res = makeRes();
  return handler({ method: 'GET' }, res).then(() => {
    const panoramax = res.body.providers.find((p) => p.id === 'panoramax');
    assert.ok(panoramax.cache);
    assert.equal(panoramax.cache.total, 3);
    const google = res.body.providers.find((p) => p.id === 'google-streetview');
    assert.equal(google.keyConfigured, true);
    assert.equal(google.cache, null, 'Google providers should not advertise a cache');
  });
});

test('createProviderStatusHandler reports circuitOpen in summary when a circuit is open', async () => {
  const now = 5_000_000;
  const circuits = {
    'google-geocoding': { openedUntil: now + 60_000, failures: 3 },
    'google-streetview': { openedUntil: 0, failures: 0 }
  };
  const handler = createProviderStatusHandler({ env: {}, circuits, now: () => now });
  const res = makeRes();
  await handler({ method: 'GET' }, res);
  assert.ok(res.body.summary.circuitOpen >= 1);
  const geocoding = res.body.providers.find((p) => p.id === 'google-geocoding');
  assert.equal(geocoding.circuit.available, false);
});
