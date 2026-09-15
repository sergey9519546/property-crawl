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
  const countyScope = { endpoint: '/Sales/SalesSearch', filters: { state: 'NJ', countyId: '20' } };
  runs[0].scope = { collector: 'CivilViewScraper' };
  runs[0].coverage = { acquisitionScope: countyScope, complete: true, fullSweepComplete: true, truncated: false };
  runs.push({ ...runs[0], source_key: 'legacy', coverage: {} });
  runs.push({ ...runs[0], source_key: 'candidate' });
  const pool = { query: async (sql) => {
    if (sql.includes("to_regclass")) return { rows: [{ runs: 'discovery_source_runs', atlas: 'discovery_atlas_sources' }] };
    if (sql.includes('discovery_worker_health')) return { rows: [] };
    if (sql.includes("status='queued'")) return { rows: [{ queued: 0, expired: 0 }] };
    if (sql.includes('DISTINCT ON(source_key,run_kind)')) return { rows: runs };
    if (sql.includes('FROM listings GROUP BY')) return { rows: [] };
    if (sql.includes('FROM discovery_checkpoints')) return { rows: [{ source_key: 'healthy', cursor: {} }] };
    if (sql.includes('FROM discovery_atlas_sources')) return { rows: [] };
    if (sql.includes('FROM discovery_atlas_ledger')) return { rows: [{ total: 0, unmapped: 0 }] };
    if (sql.includes('FROM discovery_source_rollouts rollout')) return { rows: [
      { source_key: 'healthy', state: 'promoted', clean_canary_runs: 2, configured_scope: countyScope, canary_scope_hash: require('../server/discovery/store').hash(countyScope), promoted_at: now, evidence_qualified: true, approved: true },
      { source_key: 'candidate', state: 'canary', clean_canary_runs: 2, configured_scope: countyScope, canary_scope_hash: require('../server/discovery/store').hash(countyScope), promoted_at: null, evidence_qualified: true, approved: false },
    ] };
    throw new Error(`Unexpected query: ${sql}`);
  } };
  const network = { sources: [source('healthy'), source('candidate'), source('partial'), source('blocked'), source('never-run'), source('legacy')], summary: { collected: 99, needsAttention: 0 } };
  const result = await attachDiscoveryCoverage(network, { pool }, { DISCOVERY_MODE: 'advanced' });

  assert.equal(result.summary.collected, 1);
  assert.equal(result.summary.needsAttention, 4);
  assert.deepEqual(result.sources.find(item => item.id === 'healthy').coverage.acquisitionScope, countyScope);
  assert.equal(result.sources.find(item => item.id === 'healthy').checkpoint.resumable, false);
  const candidate = result.sources.find(item => item.id === 'candidate');
  assert.equal(candidate.releaseGate.approved, false);
  assert.equal(candidate.releaseGate.evidenceQualified, true);
  assert.equal(candidate.releaseGate.cleanRuns, 2);
  assert.equal(candidate.releaseGate.scopeMatchesLatest, true);
  assert.equal(candidate.discoveryStatus, 'partial');
  assert.ok(candidate.lastRun.lastSuccessAt);
  const legacy = result.sources.find(item => item.id === 'legacy');
  assert.equal(legacy.coverage.complete, false);
  assert.equal(legacy.discoveryStatus, 'partial');
  assert.equal(legacy.lastRun.lastSuccessAt, null);
  const neverRun = result.sources.find((item) => item.id === 'never-run');
  assert.equal(neverRun.status, 'awaiting_run');
  assert.equal(neverRun.discoveryStatus, 'awaiting_run');
  assert.equal(neverRun.lastRun, null);
  assert.equal(neverRun.coverage, null);
});
