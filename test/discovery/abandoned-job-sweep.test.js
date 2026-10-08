'use strict';

// test/discovery/abandoned-job-sweep.test.js
//
// Defect: an abandoned durable job was never swept, and the one signal that
// could detect it was computed and then deliberately excluded from health.
//
// Two halves.
//
// 1. Nothing moved an abandoned discovery_jobs row out of 'running'.
//    failAbandonedRuns repaired only discovery_source_runs. scheduler.js claims a
//    durable job, sets it running, and if runAll then throws, onCycleComplete and
//    finalize never run -- so the job sits at 'running' with a dead lease
//    forever. An expired lease is never renewable (renewJobClaim requires
//    lease_expires_at>NOW()), so no worker can take the row over that way, and
//    nothing else touches the status. The job list is then a wall of rows frozen
//    at 'running' with no terminal state and no error.
//
// 2. collectionHealth counted the evidence and then ignored it.
//    `count(*) FILTER(WHERE status='running' AND lease_expires_at<NOW())` was
//    returned as backlog.expiredRunning, but `degraded` was derived only from
//    last_seen_at / last_loop_status. A worker that checked in on time and
//    reported 'idle' while an abandoned job rotted produced
//    `degraded:false, ready:true` -- a healthy-looking pipeline collecting
//    nothing. For a scheduled collector that is the worst possible report: it is
//    indistinguishable from "nothing to collect".
//
// No database: a fake pool models the sweep statement and the health query,
// following test/db/ai-cache-consistency.test.js.

const assert = require('node:assert/strict');
const test = require('node:test');

const { DiscoveryStore } = require('../../server/discovery/store');
const { withExpiredJobSignal, collectionDegraded, expiredJobBacklogDegraded } = require('../../server/discovery/worker-health');
const { discoveryReadiness } = require('../../server/discovery-readiness');
const { run } = require('../../scripts/discovery-worker');

const JOB_ID = 'job_0123456789abcdef01234567';
const hoursAgo = (h) => new Date(Date.now() - h * 3600_000).toISOString();

function jobRow(overrides = {}) {
  return {
    id: JOB_ID, idempotency_key: 'recurring:wave1:treasury:2026-10', idempotency_scope_hash: 'x',
    kind: 'property', trigger: 'discovery_worker', source_keys: ['treasury'], status: 'running',
    revision: 3, created_at: hoursAgo(3), started_at: hoursAgo(2), completed_at: null,
    lease_owner: 'worker-that-died', lease_expires_at: hoursAgo(1.5), attempt_count: 1,
    stages: { collection: { status: 'running' } }, errors: [], result: null,
    ...overrides,
  };
}

/**
 * A fake pool for the sweeper. It models the one thing the statement depends
 * on -- an expired lease on a 'running' row, older than the floor -- and nothing
 * else. Which rows qualify is the store's decision; whether a row is expired is
 * the row's own state.
 */
function sweepPool(rows) {
  const jobs = new Map(rows.map(row => [row.id, { ...row }]));
  const calls = [];
  return {
    jobs, calls,
    async query(sql, params = []) {
      calls.push({ sql: String(sql), params });
      const floorSeconds = Number(params[0]);
      const swept = [];
      for (const row of jobs.values()) {
        const leaseExpired = row.status === 'running' && !!row.lease_expires_at
          && Date.parse(row.lease_expires_at) < Date.now();
        const startedLongAgo = !row.started_at || Date.now() - Date.parse(row.started_at) > floorSeconds * 1000;
        if (!leaseExpired || !startedLongAgo) continue;
        const updated = {
          ...row, status: 'failed', completed_at: new Date().toISOString(),
          lease_owner: null, lease_expires_at: null, revision: row.revision + 1,
          errors: [...(row.errors || []), ...JSON.parse(params[1])],
        };
        jobs.set(row.id, updated);
        swept.push({ id: row.id });
      }
      return { rows: swept, rowCount: swept.length };
    },
  };
}

test('an abandoned job is swept to failed with a recorded reason', async () => {
  const pool = sweepPool([jobRow()]);
  const store = new DiscoveryStore(pool);

  const swept = await store.failAbandonedJobs();
  assert.deepEqual(swept, [JOB_ID]);

  const row = pool.jobs.get(JOB_ID);
  assert.equal(row.status, 'failed', 'the job must reach a terminal state, not stay running');
  assert.ok(row.completed_at, 'a terminal job needs a completion time');
  assert.equal(row.lease_owner, null, 'the dead lease must be released, not left pointing at nobody');
  assert.equal(row.lease_expires_at, null);
  assert.match(row.errors.at(-1).message, /lease expired before completion/,
    'the sweep reason must be visible on the job, not silent');
});

test('a job whose worker is still alive is never swept', async () => {
  const pool = sweepPool([jobRow({ lease_owner: 'worker-live', lease_expires_at: new Date(Date.now() + 300_000).toISOString() })]);
  const store = new DiscoveryStore(pool);

  assert.deepEqual(await store.failAbandonedJobs(), []);
  assert.equal(pool.jobs.get(JOB_ID).status, 'running', 'a live lease is not abandonment');
});

test('a job claimed this instant is not swept out from under itself', async () => {
  const pool = sweepPool([jobRow({ started_at: new Date().toISOString(), lease_expires_at: hoursAgo(0.001) })]);
  const store = new DiscoveryStore(pool);
  assert.deepEqual(await store.failAbandonedJobs(3600), [],
    'the started_at floor must protect a job claimed moments ago');
});

test('the sweep and the reported count use the same predicate', async () => {
  // If these two ever diverge, the repaired number and the displayed number stop
  // describing the same set of rows, and the health signal becomes a lie in the
  // other direction.
  const pool = sweepPool([]);
  const store = new DiscoveryStore(pool);
  await store.failAbandonedJobs();
  const sweepSql = pool.calls[0].sql;
  assert.match(sweepSql, /status='running' AND lease_expires_at<NOW\(\)/);

  const healthSql = [];
  const healthPool = {
    async query(sql) {
      healthSql.push(String(sql));
      if (/discovery_worker_health/.test(sql)) return { rows: [{ last_seen_at: new Date().toISOString(), last_loop_status: 'idle' }] };
      if (/count\(\*\) FILTER/.test(sql)) return { rows: [{ queued: 0, expired: 0 }] };
      return { rows: [] };
    },
  };
  await new DiscoveryStore(healthPool).collectionHealth();
  const count = healthSql.find(text => /count\(\*\) FILTER/.test(text));
  assert.ok(count, 'expected collectionHealth to count the backlog');
  assert.match(count, /status='running' AND lease_expires_at<NOW\(\)/,
    'the displayed count and the swept set must be the same set of rows');
});

test('an expired lease makes the worker degraded, even when the worker itself is healthy', async () => {
  const healthPool = (expired) => ({
    async query(sql) {
      if (/discovery_worker_health/.test(sql)) {
        return { rows: [{ last_seen_at: new Date().toISOString(), last_loop_status: 'idle', current_job_id: null }] };
      }
      if (/count\(\*\) FILTER/.test(sql)) return { rows: [{ queued: 0, expired }] };
      return { rows: [] };
    },
  });

  const wedged = await new DiscoveryStore(healthPool(1)).collectionHealth();
  assert.equal(wedged.status, 'healthy', 'the worker really is checking in on time');
  assert.equal(wedged.backlog.expiredRunning, 1);
  assert.equal(wedged.degraded, true,
    'a job nobody holds is the wedge signal; it must not be excluded from degraded');

  const clean = await new DiscoveryStore(healthPool(0)).collectionHealth();
  assert.equal(clean.degraded, false, 'no expired leases and a fresh heartbeat is genuinely healthy');
});

test('the expired-lease signal only ever escalates degraded', () => {
  assert.equal(expiredJobBacklogDegraded({ expiredRunning: 0 }), false);
  assert.equal(expiredJobBacklogDegraded({ expiredRunning: 3 }), true);
  assert.equal(expiredJobBacklogDegraded(undefined), false);
  assert.equal(collectionDegraded('healthy', { expiredRunning: 1 }), true);
  assert.equal(collectionDegraded('healthy', { expiredRunning: 0 }), false);
  assert.equal(collectionDegraded('stale', { expiredRunning: 0 }), true);

  // 'disabled' means there is no worker to be degraded about, and a demo
  // deployment must keep reporting degraded:false.
  const disabled = { status: 'disabled', degraded: false, backlog: { queued: 0, expiredRunning: 0 } };
  assert.equal(withExpiredJobSignal(disabled), disabled);
  assert.equal(withExpiredJobSignal({ ...disabled, backlog: { queued: 0, expiredRunning: 2 } }).degraded, true);
});

test('the readiness report surfaces the wedge without taking the API out of service', async () => {
  // Worker degradation is additive: a wedged collector must not make the API
  // report not-ready and take a working process down. That part of the original
  // expectation was right and is kept. What was wrong was that the report
  // trusted a producer-computed `degraded` flag without ever looking at the
  // backlog it had been handed, so it reported `degraded:false` for exactly the
  // state that matters.
  const wedged = {
    status: 'healthy', degraded: false, lastSeenAt: new Date().toISOString(),
    lastLoopStatus: 'idle', currentJobId: null, backlog: { queued: 0, expiredRunning: 1 },
  };
  const value = await discoveryReadiness({
    env: { DATABASE_URL: 'configured' },
    // Same reason as the stub 40 lines below: readiness folds collector-local
    // free disk space into `ready`, so without this the assertion measures the
    // host's free bytes instead of the wedged-collector policy it exists to pin.
    storageProbe: () => ({ ready: true, freeBytes: 10 * 1024 * 1024 * 1024, minimumFreeBytes: 1024 * 1024 * 1024, scope: 'collector_local_volume' }),
    databaseProbe: async () => ({
      postgis: true,
      tables: ['listings', 'discovery_source_runs', 'discovery_snapshots', 'discovery_checkpoints', 'discovery_jobs', 'discovery_leases'],
      collectionHealth: wedged,
    }),
  });

  assert.equal(value.ready, true, 'a wedged collector must not take the API down');
  assert.equal(value.collectionHealth.status, 'healthy');
  assert.equal(value.collectionHealth.degraded, true, 'an abandoned job must be reported as degradation');
  assert.equal(value.collectionHealth.backlog.expiredRunning, 1);
});

test('the worker sweeps abandoned jobs on every loop', async () => {
  const calls = [];
  const job = { id: JOB_ID, sourceIds: ['treasury'], trigger: 'discovery_canary' };
  const store = {
    async failAbandonedRuns() { calls.push('runs'); },
    async failAbandonedJobs() { calls.push('jobs'); },
    async recordWorkerHealth() {},
    async createOrReuseJob() { return job; },
    async claimJob() { return job; },
    async renewJobClaim() { return true; },
    async recordCanary() {},
    pool: { async query() { return { rows: [] }; } },
  };
  const coordinator = {
    async execute() {
      return {
        result: {
          sourceResults: [{
            sourceId: 'treasury', accepted: 1, runId: '00000000-0000-0000-0000-000000000001',
            report: { scope: { endpoint: '/auctions/treasury/rp/realprop.shtml' }, complete: true, fullSweepComplete: true, truncated: false },
          }],
        },
      };
    },
  };
  const priorMode = process.env.DISCOVERY_MODE;
  process.env.DISCOVERY_MODE = 'advanced';
  try {
    await run({
      canarySource: 'treasury',
      database: { isPg: true },
      collector: { collectionCoordinator: coordinator },
      discoveryStore: store,
      storageProbe: () => ({ ready: true, freeBytes: 10 * 1024 * 1024 * 1024, minimumFreeBytes: 1024 * 1024 * 1024, scope: 'collector_local_volume' }),
    });
  } finally {
    if (priorMode === undefined) delete process.env.DISCOVERY_MODE; else process.env.DISCOVERY_MODE = priorMode;
  }

  assert.deepEqual(calls, ['runs', 'jobs'],
    'durable jobs need the same repair as source runs, on the same loop');
});
