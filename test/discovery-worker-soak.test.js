'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { designatedTestDatabaseUrl, parseArgs, recordWorkerSample, runHeartbeatSample, runProductionTimerSample, safeFailure, validateOptions } = require('../scripts/discovery-worker-soak');

test('soak arguments are bounded and recovery is explicit', () => {
  assert.deepEqual(parseArgs(['--samples', '4', '--duration-ms', '45000', '--lease-seconds', '12', '--no-recovery', '--no-heartbeat']), {
    samples: 4,
    durationMs: 45000,
    leaseSeconds: 12,
    recovery: false,
    heartbeat: false,
    productionTimer: false,
    testEnvFile: null,
  });
  assert.equal(parseArgs(['--test-env-file', '.cache/test.env']).testEnvFile, '.cache/test.env');
  assert.throws(() => parseArgs(['--samples', '51']), /1 to 50/);
  assert.equal(parseArgs(['--production-timer', '--duration-ms', '150000']).productionTimer, true);
  assert.throws(() => parseArgs(['--duration-ms', '300001']), /1000 to 300000/);
  assert.throws(() => parseArgs(['--lease-seconds', '9']), /10 to 30/);
  assert.throws(() => parseArgs(['--unknown']), /Unknown argument/);
});

test('designated env file must exist and configuration requires a usable path', () => {
  assert.throws(() => designatedTestDatabaseUrl('test/does-not-exist.env'), /ENOENT/);
  assert.throws(() => validateOptions({ testEnvFile: '' }), /non-empty path/);
});

test('reported failures do not expose connection metadata or stacks', () => {
  const error = new Error('lease expired');
  error.code = 'LEASE_LOST';
  error.connectionString = 'postgres://secret@example.invalid/db';
  const failure = safeFailure(error, 'lease-recovery');
  assert.deepEqual(failure, { phase: 'lease-recovery', code: 'LEASE_LOST', message: 'lease-recovery failed' });
  assert.equal(JSON.stringify(failure).includes('postgres://'), false);
  assert.equal(Object.hasOwn(failure, 'stack'), false);
});

test('production DATABASE_URL alone cannot select a soak database', async () => {
  const script = require('../scripts/discovery-worker-soak');
  const savedDiscovery = process.env.DISCOVERY_TEST_DATABASE_URL;
  const savedTest = process.env.TEST_DATABASE_URL;
  delete process.env.DISCOVERY_TEST_DATABASE_URL;
  delete process.env.TEST_DATABASE_URL;
  try {
    await assert.rejects(() => script.runSoak({ samples: 1, recovery: false }, { databaseUrl: '' }), /DATABASE_URL is intentionally ignored/);
  } finally {
    if (savedDiscovery === undefined) delete process.env.DISCOVERY_TEST_DATABASE_URL; else process.env.DISCOVERY_TEST_DATABASE_URL = savedDiscovery;
    if (savedTest === undefined) delete process.env.TEST_DATABASE_URL; else process.env.TEST_DATABASE_URL = savedTest;
  }
});

test('active lease sample renews and rejects takeover past the original expiry', async () => {
  let now = 1_000;
  const calls = [];
  let claims = 0;
  const store = {
    async createOrReuseJob() { return { id: 'job_aaaaaaaaaaaaaaaaaaaaaaaa' }; },
    async claimJob(_id, owner) { calls.push(['claim', owner]); claims += 1; return claims === 1 ? { id: 'job_aaaaaaaaaaaaaaaaaaaaaaaa' } : null; },
    async renewJobClaim(_id, owner, ttl) { calls.push(['renew', owner, ttl]); return true; },
    async updateJob(_id, update, options) { calls.push(['complete', update.status, options.ownerId]); return {}; },
  };
  const sample = await runHeartbeatSample(store, { leaseSeconds: 10 }, {
    now: () => now,
    sleep: async (ms) => { now += ms; },
  }, 20_000);
  assert.equal(sample.crossedOriginalExpiry, true);
  assert.equal(sample.competitorClaimsRejected, 2);
  assert.equal(sample.durationMs, 10_150);
  assert.deepEqual(calls.map((call) => call[0]), ['claim', 'renew', 'claim', 'claim', 'complete']);
});

test('active lease sample fails before work when duration cannot cross original expiry', async () => {
  let now = 0;
  const store = {
    async createOrReuseJob() { return { id: 'job_bbbbbbbbbbbbbbbbbbbbbbbb' }; },
    async claimJob() { return {}; },
  };
  await assert.rejects(() => runHeartbeatSample(store, { leaseSeconds: 10 }, {
    now: () => now,
    sleep: async (ms) => { now += ms; },
  }, 10_000), /Duration budget/);
});

function productionTimerFixture({ extendLease = true } = {}) {
  const initialLeaseExpiresAt = new Date('2030-01-01T00:05:00.000Z');
  const renewedLeaseExpiresAt = extendLease ? new Date('2030-01-01T00:07:00.000Z') : initialLeaseExpiresAt;
  const store = {
    pool: { query() {} },
    async claimJob() { return { id: 'job_timer', status: 'running', leaseExpiresAt: initialLeaseExpiresAt }; },
    async renewJobClaim() { return true; },
    async getJob() { return { id: 'job_timer', leaseExpiresAt: renewedLeaseExpiresAt }; },
    async updateJob(_id, update) { return { id: 'job_timer', status: update.status }; },
    async recordWorkerHealth() {},
    async recordCanary() {},
  };
  let now = 1_000;
  const dependencies = {
    now: () => now,
    async runWorker({ discoveryStore, collector }) {
      const claimed = await discoveryStore.claimJob('job_timer', 'owner', 300);
      const execution = collector.collectionCoordinator.execute(claimed.id, { sourceIds: ['soak-offline-fixture'] }, { owner: 'owner' });
      now += 120_000;
      await discoveryStore.renewJobClaim(claimed.id, 'owner', 300);
      return execution;
    },
  };
  return { store, dependencies };
}

test('production timer sample records an observed renewal and requires lease extension', async () => {
  const { store, dependencies } = productionTimerFixture();
  const sample = await runProductionTimerSample(store, {}, dependencies, 140_000);
  assert.equal(sample.kind, 'production-worker-timer');
  assert.equal(sample.firstRenewalAfterMs, 120_000);
  assert.equal(sample.renewCallCount, 1);
  assert.equal(sample.renewalTtlSeconds, 300);
  assert.equal(sample.leaseExtendedMs, 120_000);
});

test('production timer sample rejects a renewal that does not extend the stored lease', async () => {
  const { store, dependencies } = productionTimerFixture({ extendLease: false });
  await assert.rejects(() => runProductionTimerSample(store, {}, dependencies, 140_000), /did not extend/);
});

test('production timer sample rejects a budget too short for the real interval', async () => {
  const { store, dependencies } = productionTimerFixture();
  await assert.rejects(() => runProductionTimerSample(store, {}, dependencies, 125_999), /at least 125000ms/);
});

test('programmatic soak configuration enforces the same bounds and boolean types', () => {
  assert.equal(validateOptions({ samples: 2, durationMs: 5000, leaseSeconds: 10, recovery: false, heartbeat: true }).samples, 2);
  assert.throws(() => validateOptions({ samples: 0 }), /samples must be an integer/);
  assert.throws(() => validateOptions({ durationMs: Infinity }), /durationMs must be an integer/);
  assert.throws(() => validateOptions({ leaseSeconds: 31 }), /leaseSeconds must be an integer/);
  assert.throws(() => validateOptions({ recovery: 'false' }), /recovery must be a boolean/);
  assert.throws(() => validateOptions({ heartbeat: 1 }), /heartbeat must be a boolean/);
  assert.throws(() => validateOptions({ productionTimer: 1 }), /productionTimer must be a boolean/);
});

test('non-completed canonical worker results are explicit failures', () => {
  for (const status of ['failed', 'blocked', 'running', undefined]) {
    const report = { samples: [], failures: [] };
    recordWorkerSample(report, { id: 'job_cccccccccccccccccccccccc', status }, 0, 12);
    assert.equal(report.samples.length, 1);
    assert.equal(report.failures.length, 1);
    assert.equal(report.failures[0].code, 'WORKER_ITERATION_NOT_COMPLETED');
  }
  const completed = { samples: [], failures: [] };
  recordWorkerSample(completed, { id: 'job_dddddddddddddddddddddddd', status: 'completed' }, 0, 8);
  assert.equal(completed.failures.length, 0);
});
