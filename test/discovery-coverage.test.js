'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { attachDiscoveryCoverage } = require('../server/sources/discovery-coverage');

function source(id, status = 'collected') {
  return { id, adapterKey: id, automated: true, status, lastRun: { lastRunAt: 'file-backed', acceptedCount: 999 }, workflow: { cadenceHours: 24 }, observedRecords: 0 };
}

test('advanced coverage recomputes counters from durable runs and clears file-backed no-run history', async () => {
  const now = new Date().toISOString();
  const runs = [
    { source_key: 'healthy', run_kind: 'operational', status: 'complete', trigger: 'scheduled', started_at: now, completed_at: now, accepted_count: 2, rejected_count: 0, discovered_count: 2, scope: {}, scope_hash: 'a', error_message: null },
    { source_key: 'partial', run_kind: 'operational', status: 'partial', trigger: 'scheduled', started_at: now, completed_at: now, accepted_count: 1, rejected_count: 0, discovered_count: 1, scope: {}, scope_hash: 'b', error_message: null },
    { source_key: 'blocked', run_kind: 'operational', status: 'failed', trigger: 'scheduled', started_at: now, completed_at: now, accepted_count: 0, rejected_count: 0, discovered_count: 0, scope: {}, scope_hash: 'c', error_message: 'publisher challenge blocked' },
  ];
  const pool = { query: async (sql) => {
    if (sql.includes("to_regclass")) return { rows: [{ runs: 'discovery_source_runs', atlas: 'discovery_atlas_sources' }] };
    if (sql.includes('discovery_worker_health')) return { rows: [] };
    if (sql.includes("status='queued'")) return { rows: [{ queued: 0, expired: 0 }] };
    if (sql.includes('DISTINCT ON(source_key,run_kind)')) return { rows: runs };
    if (sql.includes('FROM listings GROUP BY')) return { rows: [] };
    if (sql.includes('FROM discovery_checkpoints')) return { rows: [] };
    if (sql.includes('FROM discovery_atlas_sources')) return { rows: [] };
    if (sql.includes('FROM discovery_atlas_ledger')) return { rows: [{ total: 0, unmapped: 0 }] };
    throw new Error(`Unexpected query: ${sql}`);
  } };
  const network = { sources: [source('healthy'), source('partial'), source('blocked'), source('never-run')], summary: { collected: 99, needsAttention: 0 } };
  const result = await attachDiscoveryCoverage(network, { pool }, { DISCOVERY_MODE: 'advanced' });

  assert.equal(result.summary.collected, 1);
  assert.equal(result.summary.needsAttention, 2);
  const neverRun = result.sources.find((item) => item.id === 'never-run');
  assert.equal(neverRun.status, 'awaiting_run');
  assert.equal(neverRun.discoveryStatus, 'awaiting_run');
  assert.equal(neverRun.lastRun, null);
  assert.equal(neverRun.coverage, null);
});
