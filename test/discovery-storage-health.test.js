'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const { inspectCollectionStorage, requireCollectionStorage, DEFAULT_MIN_FREE_BYTES } = require('../server/discovery/storage-health');
const { discoveryReadiness } = require('../server/discovery-readiness');
const worker = require('../scripts/discovery-worker');

function statfsWithFree(bytes) {
  return () => ({ bavail: BigInt(bytes), bsize: 1n });
}

test('storage uses the 1 GiB default and treats the exact boundary as healthy', () => {
  const low = inspectCollectionStorage({ env: { DISCOVERY_STORAGE_PATH: 'collector' }, statfs: statfsWithFree(DEFAULT_MIN_FREE_BYTES - 1) });
  assert.equal(low.ready, false);
  assert.equal(low.code, 'DISCOVERY_STORAGE_LOW');
  assert.equal(low.minimumFreeBytes, DEFAULT_MIN_FREE_BYTES);
  const boundary = inspectCollectionStorage({ env: { DISCOVERY_STORAGE_PATH: 'collector' }, statfs: statfsWithFree(DEFAULT_MIN_FREE_BYTES) });
  assert.equal(boundary.ready, true);
  assert.equal(boundary.freeBytes, DEFAULT_MIN_FREE_BYTES);
});

test('storage validates configuration and fails closed when statfs fails', () => {
  for (const value of ['0', '-1', '1.5', 'not-a-number']) {
    const result = inspectCollectionStorage({ env: { DISCOVERY_MIN_FREE_BYTES: value }, statfs: () => { throw new Error('must not run'); } });
    assert.equal(result.ready, false);
    assert.equal(result.code, 'DISCOVERY_STORAGE_CONFIG');
  }
  const unavailable = inspectCollectionStorage({ env: { DISCOVERY_MIN_FREE_BYTES: '1' }, statfs: () => { throw new Error('disk unavailable'); } });
  assert.equal(unavailable.ready, false);
  assert.equal(unavailable.code, 'DISCOVERY_STORAGE_UNAVAILABLE');
  assert.throws(() => requireCollectionStorage(() => unavailable), error => error.code === 'DISCOVERY_STORAGE_UNAVAILABLE');
});

test('readiness remains false when PostgreSQL is healthy but collector storage is low', async () => {
  const result = await discoveryReadiness({
    env: { DATABASE_URL: 'postgres://injected' },
    databaseProbe: async () => ({ postgis: true, tables: ['listings', 'discovery_source_runs', 'discovery_snapshots', 'discovery_checkpoints', 'discovery_jobs', 'discovery_leases'] }),
    storageProbe: () => ({ ready: false, code: 'DISCOVERY_STORAGE_LOW', freeBytes: 10, minimumFreeBytes: 20 })
  });
  assert.equal(result.checks.database.ready, true);
  assert.equal(result.checks.storage.code, 'DISCOVERY_STORAGE_LOW');
  assert.equal(result.ready, false);
});

test('worker checks storage before any discovery store claim or write', async () => {
  const previous = process.env.DISCOVERY_MODE;
  process.env.DISCOVERY_MODE = 'advanced';
  const calls = [];
  const store = new Proxy({}, { get(_target, property) { return (...args) => { calls.push([property, ...args]); throw new Error(`unexpected store call ${String(property)}`); }; } });
  try {
    await assert.rejects(() => worker.run({
      database: { isPg: true },
      discoveryStore: store,
      collector: { collectionCoordinator: { execute: async () => { calls.push(['execute']); } } },
      storageProbe: () => ({ ready: false, code: 'DISCOVERY_STORAGE_LOW', reason: 'reserve reached' })
    }), error => error.code === 'DISCOVERY_STORAGE_LOW');
    assert.deepEqual(calls, []);
  } finally {
    if (previous === undefined) delete process.env.DISCOVERY_MODE; else process.env.DISCOVERY_MODE = previous;
  }
});

test('continuous worker retries a storage-low iteration and subsequently recovers', async () => {
  const attempts = [], waits = [], logs = [], errors = [];
  const signalTarget = new EventEmitter();
  let continuing = true;
  await worker.main([], {
    signalTarget,
    runIteration: async () => {
      attempts.push(attempts.length + 1);
      if (attempts.length === 1) { const error = new Error('low storage'); error.code = 'DISCOVERY_STORAGE_LOW'; throw error; }
      continuing = false;
      return { recovered: true };
    },
    wait: async ms => { waits.push(ms); },
    continueRunning: () => continuing,
    logger: { log: value => logs.push(value), error: (...values) => errors.push(values) }
  });
  assert.equal(attempts.length, 2);
  assert.equal(waits.length, 1);
  assert.match(errors[0].join(' '), /DISCOVERY_STORAGE_LOW/);
  assert.deepEqual(JSON.parse(logs[0]), { recovered: true });
});
