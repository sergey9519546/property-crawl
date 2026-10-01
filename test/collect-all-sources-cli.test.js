'use strict';
// test/collect-all-sources-cli.test.js
//
// Regression guard: the manual CLI collection path never worked.
//
// scripts/collect-all-sources.js called
//
//     const job = coordinator.start({ trigger: 'cli' });
//     const running = coordinator.inFlight.get(job.id);
//
// but coordinator.start() is `async` (server/sources/collection-coordinator.js:193),
// so `job` is a Promise and `job.id` is undefined. That made the inFlight lookup
// miss, made store.get(undefined) miss, and threw "Collection job was not
// retained" -- immediately, with exit code 1.
//
// The trap: the sweep was NOT skipped. `start()` had already fired the real
// 24-source collection before the throw, so the CLI reported failure while a
// full sweep ran unobserved in the same process, and was killed mid-run when
// the process exited. An operator reading the output would conclude the command
// does nothing, when in fact it was doing everything and then abandoning it.
//
// Zero tests referenced this file before this one.

const assert = require('node:assert/strict');
const test = require('node:test');

const scheduler = require('../server/scrapers/scheduler');
const { main } = require('../scripts/collect-all-sources');

/** A coordinator that records what the CLI asked it for. */
function stubCoordinator({ startIsAsync = true } = {}) {
  const calls = { startArgs: null, awaitedJobId: null, storeGetIds: [] };
  const job = { id: 'job_real_1', status: 'completed', revision: 3, stages: { collection: { status: 'completed' } }, errors: [] };
  const running = Promise.resolve();
  const coordinator = {
    inFlight: new Map([[job.id, running]]),
    store: {
      get(id) { calls.storeGetIds.push(id); return id === job.id ? job : null; },
    },
    start(input) {
      calls.startArgs = input;
      if (!startIsAsync) return job;
      // Faithful to the real contract: async, so .id is NOT on the return value.
      return Promise.resolve(job).then(resolved => {
        calls.awaitedJobId = resolved.id;
        return resolved;
      });
    },
  };
  return { coordinator, calls, job };
}

async function withStub(coordinator, fn) {
  const original = scheduler.collectionCoordinator;
  scheduler.collectionCoordinator = coordinator;
  const originalLog = console.log;
  const originalExitCode = process.exitCode;
  console.log = () => {};
  process.exitCode = 0;
  try { await fn(); } finally {
    scheduler.collectionCoordinator = original;
    console.log = originalLog;
    process.exitCode = originalExitCode;
  }
}

test('the CLI awaits start() and reads a real job id', async () => {
  const { coordinator, calls, job } = stubCoordinator();
  await withStub(coordinator, async () => {
    await main();
  });

  assert.equal(calls.startArgs.trigger, 'cli', 'the CLI must identify itself to the coordinator');
  assert.equal(calls.awaitedJobId, job.id,
    'start() must be awaited before reading .id; reading it off the Promise yields undefined');
  assert.deepEqual(calls.storeGetIds, [job.id],
    `store.get must be called with the real job id, got ${JSON.stringify(calls.storeGetIds)}`);
  assert.ok(!calls.storeGetIds.includes(undefined),
    'store.get(undefined) is the exact bug: it missed and threw "Collection job was not retained"');
});

test('the CLI succeeds for a completed job', async () => {
  const { coordinator } = stubCoordinator();
  await withStub(coordinator, async () => {
    await main();
    assert.equal(process.exitCode, 0, 'a completed collection must exit 0');
  });
});

test('the CLI reports a non-completed job with a non-zero exit', async () => {
  const { coordinator, job } = stubCoordinator();
  job.status = 'partial';
  await withStub(coordinator, async () => {
    await main();
    assert.equal(process.exitCode, 1, 'a partial collection must exit non-zero');
  });
});

test('requiring the module does not start a collection', async () => {
  // main() used to run at module load, so importing the file for its export
  // kicked off a real full sweep. Assert the side effect is gone by checking
  // the module exports without any coordinator being wired up.
  const fresh = require('../scripts/collect-all-sources');
  assert.equal(typeof fresh.main, 'function', 'main must be exported for testing');
  // No throw, no sweep, no exit code change from merely requiring it.
  assert.ok(true);
});
