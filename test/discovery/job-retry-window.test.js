'use strict';

// test/discovery/job-retry-window.test.js
//
// Defect: a terminal job poisoned the rest of its own idempotency window, and
// the pipeline reported the poisoned state as "already claimed".
//
// The worker's recurring key is `recurring:<wave>:<sources>:<UTC hour>`, so
// every loop iteration inside one hour reuses the same job row. Two pieces of
// store.js disagreed about what that row may look like:
//
//   createOrReuseJob  ON CONFLICT (idempotency_key) DO UPDATE ... RETURNING *
//                     -> returns the EXISTING row, whatever status it has
//   claimJob          WHERE id=$1 AND (status='queued'
//                                    OR (status='running' AND lease_expires_at<NOW()))
//                     -> a 'failed' or 'partial' job matches neither, so it
//                        returns null
//
// So: source X fails at 04:05, the job ends 'failed'. At 04:06 the source is
// still due (only a *complete* source run advances the cadence), the key is the
// same hour bucket, the source list is identical so the scope hash matches, and
// the worker is handed the dead job. claimJob fails and the worker returns
// { skipped: true, reason: 'collection_jobs_claimed' } -- a claim by nobody. The
// source stays uncollected until the UTC hour rolls over, with its error
// invisible. In a scheduled collector, "quietly skipped" and "nothing to
// collect" look identical to an operator, which is the worst failure mode this
// system has.
//
// The fix reopens a retryable terminal job IN PLACE rather than creating a
// second one. The second half of this file is the guard that matters most: a
// fix that let the hour produce two jobs, or that stole a live lease, would be
// worse than the defect. Both are asserted here.
//
// No database: the fake pool below models the three discovery_jobs statements
// this path depends on, following the pattern in test/db/ai-cache-consistency.test.js.

const assert = require('node:assert/strict');
const test = require('node:test');

const { DiscoveryStore, hash } = require('../../server/discovery/store');
const { collectionScope } = require('../../server/scrapers/collection-scope');
const { run } = require('../../scripts/discovery-worker');

const JOB_ID = 'job_0123456789abcdef01234567';
// The worker derives the recurring key from the current UTC hour, so the fake
// matches the seeded row on this prefix rather than a literal string. That
// keeps the test from racing the hour boundary instead of freezing the clock.
const RECURRING_KEY = /^recurring:wave1:treasury:/;

const TREASURY_SCOPE = collectionScope({ sourceKey: 'treasury' });
const STORAGE_PROBE = () => ({
  ready: true, freeBytes: 10 * 1024 * 1024 * 1024, minimumFreeBytes: 1024 * 1024 * 1024, scope: 'collector_local_volume',
});

function dbRow(overrides = {}) {
  return {
    id: JOB_ID,
    idempotency_key: 'recurring:wave1:treasury:2026-10',
    idempotency_scope_hash: null,
    kind: 'property',
    trigger: 'discovery_worker',
    source_keys: ['treasury'],
    status: 'queued',
    revision: 1,
    created_at: '2026-10-01T04:05:00.000Z',
    started_at: null,
    completed_at: null,
    lease_owner: null,
    lease_expires_at: null,
    attempt_count: 0,
    stages: { collection: { status: 'queued' } },
    errors: [],
    result: null,
    ...overrides,
  };
}

const hoursFromNow = (h) => new Date(Date.now() + h * 3600_000).toISOString();

/**
 * A fake pool that answers the statements the retry window depends on, and
 * nothing else. The interesting behaviour it models is row-level SQL
 * semantics, not the fix itself:
 *   - UNIQUE(idempotency_key) is a real constraint, so a second worker cannot
 *     insert a duplicate row for the same hour;
 *   - `ON CONFLICT ... DO UPDATE ... WHERE <scope hash matches>` returns no row
 *     when the existing row is bound to a different scope;
 *   - `WHERE id=$1 AND status=ANY($n)` updates a row only if it is still in one
 *     of the listed states;
 *   - claimJob's lease predicate is evaluated against the row's own state.
 */
function jobPool({ seed = [], rollouts = [] } = {}) {
  const jobs = new Map();
  const byKey = new Map();
  const calls = [];
  const state = { inserts: 0, updates: [] };

  const put = (row) => { jobs.set(row.id, row); if (row.idempotency_key) byKey.set(row.idempotency_key, row.id); };
  for (const row of seed) put({ ...row });

  const claimable = (row, now) => row.status === 'queued'
    || (row.status === 'running' && !!row.lease_expires_at && Date.parse(row.lease_expires_at) < now);

  const pool = {
    jobs, state, calls,
    async query(sql, params = []) {
      const text = String(sql);
      calls.push({ sql: text, params });

      if (/discovery_source_rollouts/.test(text)) return { rows: rollouts, rowCount: rollouts.length };
      if (/discovery_checkpoints/.test(text)) return { rows: [] };
      if (/MAX\(completed_at\)/.test(text)) return { rows: [], rowCount: 0 };   // treasury never completed => still due
      if (/discovery_source_runs/.test(text)) return { rows: [], rowCount: 0 };
      if (/discovery_worker_health/.test(text)) return { rows: [], rowCount: 0 };
      if (/source_keys<\@/.test(text)) {
        const wanted = params[0] || [];
        const now = Date.now();
        const found = [...jobs.values()].filter(row => row.trigger !== 'discovery_canary'
          && wanted.every(key => row.source_keys.includes(key)) && claimable(row, now));
        return { rows: found.map(row => ({ id: row.id })), rowCount: found.length };
      }
      if (/^\s*SELECT \* FROM discovery_jobs/.test(text)) {
        const row = jobs.get(params[0]);
        return { rows: row ? [{ ...row }] : [], rowCount: row ? 1 : 0 };
      }
      if (/^\s*INSERT INTO discovery_jobs/.test(text)) {
        const [id, key, scopeHash, kind, trigger, sources, payload, stages] = params;
        let existing = byKey.has(key) ? jobs.get(byKey.get(key)) : null;
        if (!existing && key && RECURRING_KEY.test(key)) {
          existing = [...jobs.values()].find(row => RECURRING_KEY.test(row.idempotency_key || '')) || null;
        }
        if (existing) {
          // DO UPDATE ... WHERE the existing row is bound to the same scope.
          if (existing.idempotency_scope_hash !== scopeHash) return { rows: [], rowCount: 0 };
          return { rows: [{ ...existing }], rowCount: 1 };
        }
        state.inserts += 1;
        const row = dbRow({
          id, idempotency_key: key, idempotency_scope_hash: scopeHash, kind, trigger,
          source_keys: sources, payload: JSON.parse(payload), stages: JSON.parse(stages),
        });
        put(row);
        return { rows: [{ ...row }], rowCount: 1 };
      }
      if (/^\s*UPDATE discovery_jobs SET status='queued'/.test(text)) {
        // Reopen: WHERE id=$1 AND status=ANY($4::text[])
        const row = jobs.get(params[0]);
        const allowed = params[3] || [];
        state.updates.push(text);
        if (!row || !allowed.includes(row.status)) return { rows: [], rowCount: 0 };
        const reopened = {
          ...row, status: 'queued', completed_at: null, started_at: null,
          lease_owner: null, lease_expires_at: null, stages: JSON.parse(params[1]),
          result: null, revision: row.revision + 1,
          errors: [...(row.errors || []), ...JSON.parse(params[2])],
        };
        put(reopened);
        return { rows: [{ ...reopened }], rowCount: 1 };
      }
      if (/^\s*UPDATE discovery_jobs SET status='running'/.test(text)) {
        // claimJob: WHERE id=$1 AND (status='queued' OR (running AND lease expired))
        const row = jobs.get(params[0]);
        if (!row || !claimable(row, Date.now())) return { rows: [], rowCount: 0 };
        const claimed = {
          ...row, status: 'running', lease_owner: params[1],
          lease_expires_at: hoursFromNow(params[2] / 3600),
          started_at: row.started_at || new Date().toISOString(),
          attempt_count: row.attempt_count + 1, revision: row.revision + 1,
        };
        put(claimed);
        return { rows: [{ ...claimed }], rowCount: 1 };
      }
      if (/^\s*UPDATE discovery_jobs SET lease_expires_at=/.test(text)) {
        const row = jobs.get(params[0]);
        if (!row || row.lease_owner !== params[1] || !(row.status === 'running' && Date.parse(row.lease_expires_at) > Date.now())) {
          return { rows: [], rowCount: 0 };
        }
        const renewed = { ...row, lease_expires_at: hoursFromNow(params[2] / 3600), revision: row.revision + 1 };
        put(renewed);
        return { rows: [{ id: renewed.id }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
  };
  return pool;
}

const scopeHashFor = (input) => hash({
  kind: input.kind || 'property', trigger: input.trigger || 'manual',
  sourceIds: [...new Set((input.sourceIds || []).map(String))].sort(), payload: input.payload || {},
});

function terminalStore(status) {
  // attempt_count 1: the 04:05 attempt was really claimed before it failed.
  const pool = jobPool({ seed: [dbRow({ status, attempt_count: 1, idempotency_scope_hash: 'seeded', completed_at: '2026-10-01T04:05:30.000Z' })] });
  const store = new DiscoveryStore(pool);
  // Bind the seeded row to the scope the caller will ask for, exactly as the
  // real upsert would have written it on the attempt that failed.
  const input = { sourceIds: ['treasury'], trigger: 'discovery_worker', idempotencyKey: 'recurring:wave1:treasury:2026-10' };
  pool.jobs.get(JOB_ID).idempotency_scope_hash = scopeHashFor(input);
  return { pool, store, input };
}

test('a failed job from earlier in the same hour is reopened, not reported as already claimed', async () => {
  const { store, input } = terminalStore('failed');

  const job = await store.createOrReuseJob(input);
  assert.equal(job.id, JOB_ID, 'the retry must reuse the existing job row');
  assert.equal(job.status, 'queued', 'a terminal failure must come back claimable');
  assert.match(job.errors.at(-1).message, /previous failed attempt reopened/,
    'the reopen reason must be recorded on the job, not swallowed');

  const claim = await store.claimJob(job.id, 'worker-b', 300);
  assert.ok(claim, 'the reopened job must be claimable in the same hour');
  assert.equal(claim.status, 'running');
  assert.equal(claim.attemptCount, 2, 'the retry is attempt two of one job');
});

test('a partial job is reopened too -- it matches neither claim predicate either', async () => {
  const { store, input } = terminalStore('partial');
  const job = await store.createOrReuseJob(input);
  assert.equal(job.status, 'queued');
  assert.ok(await store.claimJob(job.id, 'worker-b', 300));
});

test('two workers in the same hour converge on ONE job', async () => {
  const { pool, store, input } = terminalStore('failed');

  const first = await store.createOrReuseJob(input);
  const second = await store.createOrReuseJob(input);

  assert.equal(second.id, first.id, 'both workers must get the same job');
  assert.equal(pool.state.inserts, 0, 'the retry must not INSERT a second row');
  assert.equal(pool.jobs.size, 1);

  // And only one of them can actually run it.
  assert.ok(await store.claimJob(first.id, 'worker-a', 300), 'the first worker claims it');
  assert.equal(await store.claimJob(first.id, 'worker-b', 300), null,
    'the second worker must lose the claim, exactly as before the fix');
});

test('a job with a live lease is never reopened -- a second worker cannot steal it', async () => {
  const pool = jobPool({ seed: [dbRow({ status: 'running', lease_owner: 'worker-a', lease_expires_at: hoursFromNow(0.2) })] });
  const store = new DiscoveryStore(pool);
  const input = { sourceIds: ['treasury'], trigger: 'discovery_worker', idempotencyKey: 'recurring:wave1:treasury:2026-10' };
  pool.jobs.get(JOB_ID).idempotency_scope_hash = scopeHashFor(input);

  const job = await store.createOrReuseJob(input);
  assert.equal(job.status, 'running', 'a job somebody holds is not a retry candidate');
  assert.equal(pool.state.updates.length, 0, 'no reopen statement may be issued at all');
  assert.equal(await store.claimJob(job.id, 'worker-b', 300), null);
});

test('a complete job is not reopened -- a successful hour is not recollected', async () => {
  const pool = jobPool({ seed: [dbRow({ status: 'complete', completed_at: '2026-10-01T04:06:00.000Z' })] });
  const store = new DiscoveryStore(pool);
  const input = { sourceIds: ['treasury'], trigger: 'discovery_worker', idempotencyKey: 'recurring:wave1:treasury:2026-10' };
  pool.jobs.get(JOB_ID).idempotency_scope_hash = scopeHashFor(input);

  const job = await store.createOrReuseJob(input);
  assert.equal(job.status, 'complete', 'a fully collected hour must stay complete');
  assert.equal(pool.state.updates.length, 0);
  assert.equal(await store.claimJob(job.id, 'worker-b', 300), null);
});

test('a different scope on the same key is still rejected, and no retry happens', async () => {
  const { pool, store, input } = terminalStore('failed');
  await assert.rejects(
    () => store.createOrReuseJob({ ...input, sourceIds: ['treasury', 'gsa'] }),
    /different collection scope/,
  );
  assert.equal(pool.jobs.get(JOB_ID).status, 'failed', 'the rejected attempt must leave the row alone');
});

test('the worker loop collects instead of returning collection_jobs_claimed', async () => {
  // The operator-visible symptom, end to end through the real worker, the real
  // DiscoveryStore and the real coordinator call site.
  const executed = [];
  const coordinator = {
    async execute(jobId, payload, options) {
      executed.push({ jobId, sourceIds: payload.sourceIds, owner: options.owner });
      return { result: { totalIngested: 0, sourceResults: [] } };
    },
  };
  const input = { sourceIds: ['treasury'], trigger: 'discovery_worker' };
  const pool = jobPool({
    seed: [dbRow({ status: 'failed', attempt_count: 1, idempotency_scope_hash: scopeHashFor({ ...input, idempotencyKey: null }) })],
    rollouts: [{ source_key: 'treasury', configured_scope: TREASURY_SCOPE, canary_scope_hash: hash(TREASURY_SCOPE) }],
  });

  const priorMode = process.env.DISCOVERY_MODE;
  process.env.DISCOVERY_MODE = 'advanced';
  let result;
  try {
    result = await run({
      wave: 'wave1',
      database: { isPg: true },
      collector: { realScrapers: [{ sourceKey: 'treasury' }], collectionCoordinator: coordinator },
      discoveryStore: new DiscoveryStore(pool),
      storageProbe: STORAGE_PROBE,
    });
  } finally {
    if (priorMode === undefined) delete process.env.DISCOVERY_MODE; else process.env.DISCOVERY_MODE = priorMode;
  }

  assert.equal(result.skipped, undefined,
    `the worker must not skip; it returned ${JSON.stringify(result)}`);
  assert.notEqual(result.reason, 'collection_jobs_claimed');
  assert.equal(executed.length, 1, 'the dead job must be re-attempted, not skipped');
  assert.equal(executed[0].jobId, JOB_ID);
  assert.deepEqual(executed[0].sourceIds, ['treasury']);
  assert.equal(pool.jobs.get(JOB_ID).status, 'running', 'the reclaimed job is running again');
  assert.equal(pool.jobs.get(JOB_ID).attempt_count, 2);
});
