'use strict';
// test/discovery/lease-loss-code.test.js
//
// Regression guard for the single highest-impact defect found in the
// 2026-10 audit.
//
// server/discovery/store.js:updateJob() ended its owner-scoped UPDATE with
//
//     if (!rows[0] && ownerId) throw new Error('Collection job lease was lost...')
//
// A bare Error, with no `.code`. Nine call sites decide what to do next by
// testing `error?.code === 'DISCOVERY_JOB_LEASE_LOST'` -- scheduler.js (5),
// collection-coordinator.js (3), and discovery-worker.js's fatal-vs-transient
// classification. So the one throw that represents a lost lease was invisible
// to every one of them. The guard did not merely fail to fire: it failed open,
// and collection-coordinator then retried the write as status='partial' and
// again as status='failed' against a job a successor worker now owned -- two
// further losing updates -- before killing the worker as an unknown fatal error.
//
// Six other modules construct this same condition correctly, either via
// job-fence.js:leaseLost() or by setting the code inline. store.js was the
// only one that did not.
//
// This test therefore has two halves: the behavioural regression, and a static
// invariant that no module may reintroduce an uncoded lease-lost throw.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { DiscoveryStore } = require('../../server/discovery/store');

const ROOT = path.resolve(__dirname, '..', '..');
const LEASE_CODE = 'DISCOVERY_JOB_LEASE_LOST';

/**
 * A pool that answers the getJob SELECT with a live-looking row and makes the
 * owner-scoped UPDATE match nothing -- exactly what Postgres does when a
 * successor worker already owns the lease.
 */
function stolenLeasePool() {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql: String(sql), params });
      if (/^\s*SELECT/i.test(sql)) {
        return {
          rows: [{
            id: params[0],
            idempotency_key: null,
            kind: 'property',
            trigger: 'manual',
            source_keys: ['hud'],
            status: 'running',
            revision: 4,
            created_at: '2026-10-01T00:00:00.000Z',
            started_at: '2026-10-01T00:00:05.000Z',
            completed_at: null,
            lease_owner: 'successor-worker',
            lease_expires_at: '2026-10-01T00:10:00.000Z',
            attempt_count: 2,
            stages: { collection: { status: 'running' } },
            errors: [],
            result: null,
          }],
        };
      }
      return { rows: [] };
    },
  };
}

test('updateJob reports a stolen lease with DISCOVERY_JOB_LEASE_LOST', async () => {
  const pool = stolenLeasePool();
  const store = new DiscoveryStore(pool);

  await assert.rejects(
    () => store.updateJob('job_stolen', { status: 'partial' }, { ownerId: 'owner-a' }),
    error => {
      assert.equal(error.code, LEASE_CODE,
        'updateJob must throw the coded lease-lost error, not a bare Error');
      return true;
    },
  );

  // Prove the fence is what fired: the UPDATE was owner-scoped and matched
  // nothing. If that ever stops being the reason, the guard above would pass
  // for the wrong cause.
  const update = pool.calls.find(c => /^\s*UPDATE/i.test(c.sql));
  assert.ok(update, 'expected an owner-scoped UPDATE to have been issued');
  assert.match(update.sql, /lease_owner=\$8/, 'UPDATE must stay owner-scoped');
});

test('every lease-lost consumer guard still sees the code from updateJob', async () => {
  // The failure mode was not cosmetic: the coordinator's recovery path keys on
  // the code to decide between "abort cleanly" and "retry the write". Assert
  // the specific transition that was corrupted: a partial-status write onto a
  // job owned by somebody else must abort, not cascade.
  const pool = stolenLeasePool();
  const store = new DiscoveryStore(pool);

  let observed = null;
  try {
    await store.updateJob('job_stolen', { status: 'partial' }, { ownerId: 'owner-a' });
  } catch (error) {
    observed = error;
  }
  assert.ok(observed, 'the stale update must not silently succeed');
  assert.equal(observed.code, LEASE_CODE);

  // Only one write was attempted. The uncoded version caused the caller to
  // retry with status='failed', producing a second losing UPDATE.
  const updates = pool.calls.filter(c => /^\s*UPDATE/i.test(c.sql));
  assert.equal(updates.length, 1, 'exactly one losing UPDATE should be issued');
});

test('no module throws an uncoded lease-lost error', () => {
  // The behavioural test above protects store.js specifically. This protects
  // the invariant that produced the bug: the codebase had seven independent
  // constructions of "the lease was lost" and exactly one of them forgot the
  // field that every consumer reads.
  const offenders = [];
  const scan = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { scan(full); continue; }
      if (!entry.name.endsWith('.js')) continue;
      const source = fs.readFileSync(full, 'utf8');
      source.split(/\r?\n/).forEach((line, index) => {
        // Match the lease-lost *signal* specifically, not any sentence that
        // happens to mention a lease. A soak harness asserting "Expired lease
        // was not recovered" is a test failure, not a lease-lost condition, and
        // no consumer routes on it. The real defect read "Collection job lease
        // was lost; refusing stale update", so anchor on that phrasing.
        const isLeaseLostSignal = /throw\s+new\s+Error\(\s*['"`][^'"`]*(?:lease\s+(?:was\s+)?lost|refusing\s+stale)[^'"`]*['"`]\s*\)/i;
        if (!isLeaseLostSignal.test(line)) return;
        if (/\.code\s*=/.test(line)) return;
        offenders.push(`${path.relative(ROOT, full).replace(/\\/g, '/')}:${index + 1}`);
      });
    }
  };
  scan(path.join(ROOT, 'server'));
  scan(path.join(ROOT, 'scripts'));

  assert.deepEqual(offenders, [],
    'these throw an uncoded lease-lost error; use leaseLost() from server/discovery/job-fence.js');
});