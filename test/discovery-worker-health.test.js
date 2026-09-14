'use strict';
const { workerHealthStatus } = require('../server/discovery/worker-health');

const test = require('node:test');
const assert = require('node:assert/strict');
const { main, maxAgeSeconds, probe, workerKey } = require('../scripts/discovery-worker-health');

const now = Date.parse('2026-09-12T12:00:00.000Z');
test('shared API and CLI health policy permits the full poll interval but rejects future timestamps', () => {
  assert.equal(workerHealthStatus({ last_seen_at: new Date(now - 300_000), last_loop_status: 'idle' }, now), 'healthy');
  assert.equal(workerHealthStatus({ last_seen_at: new Date(now - 361_000), last_loop_status: 'idle' }, now), 'stale');
  assert.equal(workerHealthStatus({ last_seen_at: new Date(now + 61_000), last_loop_status: 'idle' }, now), 'stale');
  assert.equal(workerHealthStatus({ last_seen_at: new Date(now), last_loop_status: 'lease_lost' }, now), 'lease_lost');
});
function poolWith(row) {
  return {
    calls: [],
    async query(sql, params) { this.calls.push({ sql, params }); return { rows: row ? [row] : [] }; },
  };
}

test('probe reports a recent idle worker as healthy and scopes lookup to the wave key', async () => {
  const pool = poolWith({ last_seen_at: '2026-09-12T11:55:01Z', last_loop_status: 'no_promoted_sources', current_job_id: null });
  const result = await probe({ pool, wave: 'wave2', maxAge: 330, now });
  assert.equal(result.ok, true);
  assert.equal(result.status, 'healthy');
  assert.equal(result.lastLoopStatus, 'no_promoted_sources');
  assert.deepEqual(pool.calls[0].params, ['wave2']);
});

test('probe distinguishes not started, stale, lease lost, and database unavailable', async () => {
  assert.equal((await probe({ pool: poolWith(null), now })).status, 'not_started');
  assert.equal((await probe({ pool: poolWith({ last_seen_at: '2026-09-12T11:54:29Z', last_loop_status: 'idle' }), maxAge: 330, now })).status, 'stale');
  assert.equal((await probe({ pool: poolWith({ last_seen_at: '2026-09-12T11:59:59Z', last_loop_status: 'lease_lost' }), now })).status, 'lease_lost');
  assert.equal((await probe({ pool: { query: async () => { throw new Error('contains postgres://user:secret@host/db'); } }, now })).status, 'database_unavailable');
});

test('configuration keeps max age above the 300 second worker poll ceiling and bounds inputs', () => {
  assert.equal(maxAgeSeconds(), 360);
  assert.equal(maxAgeSeconds('330'), 330);
  assert.throws(() => maxAgeSeconds('300'), /330/);
  assert.throws(() => maxAgeSeconds('3601'), /3600/);
  assert.equal(workerKey(), 'wave1');
  assert.throws(() => workerKey('wave1; DROP TABLE'), /simple/);
});

test('main closes its pool and emits credential-free database-unavailable diagnostics', async () => {
  let ended = false;
  class FailingPool {
    constructor(options) { this.options = options; FailingPool.instance = this; }
    async query() { throw new Error('postgres://user:secret@host/db'); }
    async end() { ended = true; }
  }
  const lines = [];
  const result = await main({ env: { DATABASE_URL: 'postgres://user:secret@host/db', DISCOVERY_WAVE: 'wave1' }, Pool: FailingPool, logger: { log: line => lines.push(line) }, now });
  assert.equal(result.status, 'database_unavailable');
  assert.equal(ended, true);
  assert.equal(FailingPool.instance.options.query_timeout, 5000);
  assert.equal(FailingPool.instance.options.statement_timeout, 5000);
  assert.equal(lines.join('').includes('secret'), false);
});
