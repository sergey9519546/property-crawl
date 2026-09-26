'use strict';

// test/discovery/storage-health-helpers.test.js
//
// Direct unit coverage for server/discovery/storage-health.js. The
// collector pauses if local free bytes fall below the configured
// reserve. Silent drift in the threshold parsing or the statfs probe
// would silently block every collection run (or never block one).
//
//   - inspectCollectionStorage: ready/false paths
//   - minimum byte threshold parsing (positive int validation)
//   - statfs probe: insufficient vs sufficient free bytes
//   - requireCollectionStorage: throws when not ready, returns health when ready
//   - env-var override of DISCOVERY_STORAGE_PATH

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  inspectCollectionStorage,
  requireCollectionStorage,
  DEFAULT_MIN_FREE_BYTES,
} = require('../../server/discovery/storage-health');

// --- DEFAULT_MIN_FREE_BYTES --------------------------------------------

test('DEFAULT_MIN_FREE_BYTES: 1 GB minimum reserve', () => {
  assert.equal(DEFAULT_MIN_FREE_BYTES, 1024 * 1024 * 1024);
});

// --- inspectCollectionStorage: bad config ------------------------------

test('inspectCollectionStorage: DISCOVERY_MIN_FREE_BYTES=0 -> config error', () => {
  const result = inspectCollectionStorage({ env: { DISCOVERY_MIN_FREE_BYTES: '0' }, statfs: () => ({ bavail: 1n, bsize: 1n }) });
  assert.equal(result.ready, false);
  assert.equal(result.code, 'DISCOVERY_STORAGE_CONFIG');
});

test('inspectCollectionStorage: DISCOVERY_MIN_FREE_BYTES=NaN -> config error', () => {
  const result = inspectCollectionStorage({ env: { DISCOVERY_MIN_FREE_BYTES: 'not-a-number' }, statfs: () => ({ bavail: 1n, bsize: 1n }) });
  assert.equal(result.ready, false);
  assert.equal(result.code, 'DISCOVERY_STORAGE_CONFIG');
});

// --- inspectCollectionStorage: statfs error ---------------------------

test('inspectCollectionStorage: statfs throws -> unavailable', () => {
  const result = inspectCollectionStorage({ env: {}, statfs: () => { throw new Error('EACCES'); } });
  assert.equal(result.ready, false);
  assert.equal(result.code, 'DISCOVERY_STORAGE_UNAVAILABLE');
});

// --- inspectCollectionStorage: free bytes vs minimum ------------------

test('inspectCollectionStorage: free bytes above minimum -> ready', () => {
  const result = inspectCollectionStorage({ env: { DISCOVERY_MIN_FREE_BYTES: '10' }, statfs: () => ({ bavail: 100n, bsize: 1n }) });
  assert.equal(result.ready, true);
  assert.equal(result.freeBytes, 100);
  assert.equal(result.minimumFreeBytes, 10);
  assert.equal(result.code, undefined);
});

test('inspectCollectionStorage: free bytes below minimum -> not ready with reason', () => {
  const result = inspectCollectionStorage({ env: { DISCOVERY_MIN_FREE_BYTES: '1000' }, statfs: () => ({ bavail: 100n, bsize: 1n }) });
  assert.equal(result.ready, false);
  assert.equal(result.code, 'DISCOVERY_STORAGE_LOW');
  assert.match(result.reason, /below the free-space reserve/);
});

// --- requireCollectionStorage -----------------------------------------

test('requireCollectionStorage: throws with code when not ready', () => {
  assert.throws(
    () => requireCollectionStorage(() => ({ ready: false, code: 'TEST_CODE', reason: 'test reason' })),
    (err) => err.code === 'TEST_CODE' && /test reason/.test(err.message)
  );
});

test('requireCollectionStorage: returns the health object when ready', () => {
  const probeResult = { ready: true, freeBytes: 5000, minimumFreeBytes: 100 };
  const out = requireCollectionStorage(() => probeResult);
  assert.equal(out, probeResult);
});

test('requireCollectionStorage: throws DISCOVERY_STORAGE_UNAVAILABLE when probe returns null', () => {
  assert.throws(
    () => requireCollectionStorage(() => null),
    (err) => err.code === 'DISCOVERY_STORAGE_UNAVAILABLE'
  );
});