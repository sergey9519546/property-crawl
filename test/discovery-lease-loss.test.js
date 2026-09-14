'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { IngestionScheduler } = require('../server/scrapers/scheduler');
const { run } = require('../scripts/discovery-worker');
const { CollectionCoordinator } = require('../server/sources/collection-coordinator');

test('scheduler propagates lease loss after publisher work and does not finish or checkpoint', async () => {
  const calls = [];
  let guards = 0;
  const source = {
    name: 'LeaseLossFixture', sourceKey: 'servicelink',
    getCollectionScope: () => ({ endpoint: '/api/listingsvc/v1/Listings', filters: {} }),
    async scrapeFeed() { calls.push('scrape'); this.lastRunReport = { complete: true, fullSweepComplete: true, truncated: false, scope: this.getCollectionScope() }; return []; },
  };
  const discoveryStore = {
    async getCheckpoint() { return null; },
    async beginRun(_input, options) { calls.push(['begin', options]); return { id: 'run-lease' }; },
    async finishRun() { calls.push('finish'); },
    async saveCheckpoint() { calls.push('checkpoint'); },
  };
  const scheduler = new IngestionScheduler({
    realScrapers: [source], discoveryStore, networkEnabled: true, concurrency: 1,
    storageProbe: () => ({ ready: true }), telemetry: { recordRun() {} }, database: { isPg: true },
  });
  await assert.rejects(() => scheduler.runAll({
    sourceIds: ['servicelink'], jobId: 'job-lease', owner: 'owner-1',
    leaseGuard: async () => { guards += 1; return guards <= 2; },
  }), Object.assign(/lease was lost after source execution/, { code: undefined }));
  assert.deepEqual(calls[0], ['begin', { jobId: 'job-lease', owner: 'owner-1' }]);
  assert.equal(calls[1], 'scrape');
  assert.equal(calls.includes('finish'), false);
  assert.equal(calls.includes('checkpoint'), false);
});

test('worker refuses completed result and canary evidence after heartbeat renewal failure', async () => {
  const originalSetInterval = global.setInterval;
  const originalClearInterval = global.clearInterval;
  let heartbeat;
  global.setInterval = (callback) => { heartbeat = callback; return { unref() {} }; };
  global.clearInterval = () => {};
  let canaryCalls = 0;
  const store = {
    async recordWorkerHealth() {}, async failAbandonedRuns() {},
    async createOrReuseJob() { return { id: 'job-canary' }; },
    async claimJob() { return { id: 'job-canary', sourceIds: ['treasury'], trigger: 'discovery_canary' }; },
    async renewJobClaim() { return false; },
    async recordCanary() { canaryCalls += 1; },
  };
  const priorMode = process.env.DISCOVERY_MODE;
  process.env.DISCOVERY_MODE = 'advanced';
  try {
    await assert.rejects(() => run({
      canarySource: 'treasury', database: { isPg: true }, discoveryStore: store,
      storageProbe: () => ({ ready: true }),
      collector: { collectionCoordinator: { async execute() { await heartbeat(); return { id: 'job-canary', status: 'completed', result: { sourceResults: [] } }; } } },
    }), (error) => error.code === 'DISCOVERY_JOB_LEASE_LOST' && /lease lost during collection/.test(error.message));
    assert.equal(canaryCalls, 0);
  } finally {
    global.setInterval = originalSetInterval;
    global.clearInterval = originalClearInterval;
    if (priorMode === undefined) delete process.env.DISCOVERY_MODE; else process.env.DISCOVERY_MODE = priorMode;
  }
});

test('coordinator does not convert lease loss into an ordinary failed result', async () => {
  const updates = [];
  const lost = new Error('lost during scheduler');
  lost.code = 'DISCOVERY_JOB_LEASE_LOST';
  const coordinator = new CollectionCoordinator({
    scheduler: { async runAll() { throw lost; } },
    store: {
      bindClaim() {},
      async renewClaim() { return true; },
      async update(_id, update) { updates.push(update); return update; },
      async get() { return { id: 'job-lease' }; },
    },
    database: { isPg: false }, hunts: { listHunts() { return []; } }, caseSink: null,
  });
  await assert.rejects(() => coordinator.execute('job-lease', { sourceIds: ['treasury'] }, { owner: 'owner-1' }), (error) => error === lost);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].status, 'running');
});

test('coordinator-managed scheduler cycles are finalized exactly once by the coordinator', async () => {
  let schedulerFinalizations = 0;
  const source = {
    name: 'CoordinatorFixture', sourceKey: 'treasury',
    getCollectionScope: () => ({ endpoint: '/auctions/treasury/rp/realprop.shtml', filters: { assetClass: 'real_property' } }),
    async scrapeFeed() { this.lastRunReport = { complete: true, fullSweepComplete: true, truncated: false, scope: this.getCollectionScope() }; return []; },
  };
  const scheduler = new IngestionScheduler({ realScrapers: [source], database: { isPg: false }, networkEnabled: true, telemetry: { recordRun() {} } });
  scheduler.onCycleComplete = async () => { schedulerFinalizations += 1; };
  const updates = [];
  const store = {
    bindClaim() {}, async renewClaim() { return true; },
    async update(_id, update) { updates.push(update); return { id: 'job-once', status: update.status || 'running' }; },
    async get() { return { id: 'job-once', status: 'running' }; },
  };
  const coordinator = new CollectionCoordinator({ scheduler, store, database: { isPg: false }, hunts: { listHunts() { return []; } }, caseSink: null });
  const result = await coordinator.execute('job-once', { sourceIds: ['treasury'] }, { owner: 'owner-once' });
  assert.equal(schedulerFinalizations, 0);
  assert.equal(result.status, 'completed');
  assert.equal(updates.filter(update => update.completed).length, 1);
});

test('direct scheduler cycles adopt owner and guard returned by durable job creation', async () => {
  const optionsSeen = [];
  const source = {
    name: 'DirectCycleFixture', sourceKey: 'servicelink',
    getCollectionScope: () => ({ endpoint: '/api/listingsvc/v1/Listings', filters: {} }),
    async scrapeFeed() { this.lastRunReport = { complete: true, fullSweepComplete: true, truncated: false, scope: this.getCollectionScope() }; return []; },
  };
  const discoveryStore = {
    async getCheckpoint() { return null; },
    async beginRun(_input, options) { optionsSeen.push(options); return { id: 'run-direct' }; },
    async finishRun(_id, _result, options) { optionsSeen.push(options); },
    async saveCheckpoint(_source, _cursor, _scope, options) { optionsSeen.push(options); },
  };
  const scheduler = new IngestionScheduler({ realScrapers: [source], discoveryStore, database: { isPg: true }, networkEnabled: true, storageProbe: () => ({ ready: true }), telemetry: { recordRun() {} } });
  scheduler.onCycleStart = async () => ({ jobId: 'job-direct', owner: 'owner-direct', leaseGuard: async () => true });
  scheduler.onCycleComplete = async () => {};
  await scheduler.runAll({ sourceIds: ['servicelink'] });
  assert.deepEqual(optionsSeen, Array(3).fill({ jobId: 'job-direct', owner: 'owner-direct' }));
});

test('scheduler reserves a cycle before asynchronous job initialization', async () => {
  let initializeCalls = 0;
  let releaseInitialization;
  const initialization = new Promise((resolve) => { releaseInitialization = resolve; });
  const source = {
    name: 'ConcurrentCycleFixture', sourceKey: 'servicelink',
    async scrapeFeed() { return []; },
  };
  const scheduler = new IngestionScheduler({
    realScrapers: [source], networkEnabled: true,
    telemetry: { recordRun() {} }, database: { isPg: false, async createListing() {} },
  });
  scheduler.onCycleStart = async () => { initializeCalls += 1; await initialization; return null; };
  scheduler.onCycleComplete = async () => {};

  const first = scheduler.runAll({ sourceIds: ['servicelink'] });
  const second = await scheduler.runAll({ sourceIds: ['servicelink'] });
  assert.equal(second.skipped, true);
  assert.equal(initializeCalls, 1);

  releaseInitialization();
  await first;
  assert.equal(scheduler.isRunning, false);
});

test('scheduler releases its cycle reservation when job initialization fails', async () => {
  const source = { name: 'InitializationFailureFixture', sourceKey: 'servicelink', async scrapeFeed() { return []; } };
  const scheduler = new IngestionScheduler({
    realScrapers: [source], networkEnabled: true,
    telemetry: { recordRun() {} }, database: { isPg: false, async createListing() {} },
  });
  scheduler.onCycleStart = async () => {
    const error = new Error('claim failed');
    error.code = 'DISCOVERY_JOB_LEASE_LOST';
    throw error;
  };

  await assert.rejects(() => scheduler.runAll({ sourceIds: ['servicelink'] }), (error) => error.code === 'DISCOVERY_JOB_LEASE_LOST');
  assert.equal(scheduler.isRunning, false);
});
