'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { attachDiscoveryCoverage } = require('../server/sources/discovery-coverage');

function source(id, status = 'collected', extra = {}) {
  return { id, adapterKey: id, automated: true, status, lastRun: { lastRunAt: 'file-backed', acceptedCount: 999 }, workflow: { cadenceHours: 24 }, observedRecords: 0, ...extra };
}

// Answers only the queries attachDiscoveryCoverage issues. `inventory` is the
// per-source listings aggregate the store actually holds, so a source with no
// collected records is representable without lying about the ledger.
function makePool({ runs = [], inventory = [], rollouts = [], checkpoints = [] } = {}) {
  return { query: async (sql) => {
    if (sql.includes('to_regclass')) return { rows: [{ runs: 'discovery_source_runs', atlas: 'discovery_atlas_sources' }] };
    if (sql.includes('discovery_worker_health')) return { rows: [] };
    if (sql.includes("status='queued'")) return { rows: [{ queued: 0, expired: 0 }] };
    if (sql.includes('DISTINCT ON(source_key,run_kind)')) return { rows: runs };
    if (sql.includes('FROM listings GROUP BY')) return { rows: inventory };
    if (sql.includes('FROM discovery_checkpoints')) return { rows: checkpoints };
    if (sql.includes('FROM discovery_atlas_sources')) return { rows: [] };
    if (sql.includes('FROM discovery_atlas_ledger')) return { rows: [{ total: 0, unmapped: 0 }] };
    if (sql.includes('FROM discovery_source_rollouts rollout')) return { rows: rollouts };
    throw new Error(`Unexpected query: ${sql}`);
  } };
}

// The headline record count on the operator page must be the count of records
// the store holds, for two reasons that both bit in production.
//
// One: two catalog entries can share a source_key. civilview and
// civilview-nationwide are two workflows over one adapter, and the inventory
// aggregate is grouped by that key - summing per catalog entry counted every
// civilview record twice, so the page read 9,965 against a store of 9,831.
//
// Two: the observation index retains entries for records the store no longer
// holds. It read 11,080 - the number behind the tile until this was fixed.
test('the record total counts each adapter once, not each catalog entry', async () => {
  const network = {
    sources: [
      { id: 'civilview', adapterKey: 'civilview', automated: true, workflow: { cadenceHours: 12 }, lastRun: { lastRunAt: new Date().toISOString(), acceptedCount: 5, error: null } },
      { id: 'civilview-nationwide', adapterKey: 'civilview', automated: true, workflow: { cadenceHours: 12 }, lastRun: { lastRunAt: new Date().toISOString(), acceptedCount: 5, error: null } },
      { id: 'hud-homestore', adapterKey: 'hud-homestore', automated: true, workflow: { cadenceHours: 24 }, lastRun: { lastRunAt: new Date().toISOString(), acceptedCount: 7, error: null } },
    ],
    summary: { catalogSources: 3, automatedCollectors: 3, collected: 0, needsAttention: 0, importSources: 0, observedRecords: 0, trackedRecords: 99 },
  };
  const result = await attachDiscoveryCoverage(network, { pool: makePool({ inventory: [
    { source_key: 'civilview', count: 134, archived: 0, observed_at: new Date().toISOString(), states: ['NJ'] },
    { source_key: 'hud-homestore', count: 1992, archived: 0, observed_at: new Date().toISOString(), states: ['OH'] },
  ] }) }, { DISCOVERY_MODE: 'advanced' });

  assert.equal(result.summary.storedRecords, 2126,
    'civilview is one adapter behind two catalog entries and must be counted once');
  assert.equal(result.summary.observedRecords, 2126);
  assert.equal(result.sources.filter((s) => s.adapterKey === 'civilview').length, 2,
    'per-source rows keep their own count; only the total dedupes');
});

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
  const rollouts = [
    { source_key: 'healthy', state: 'promoted', clean_canary_runs: 2, configured_scope: countyScope, canary_scope_hash: require('../server/discovery/store').hash(countyScope), promoted_at: now, evidence_qualified: true, approved: true },
    { source_key: 'candidate', state: 'canary', clean_canary_runs: 2, configured_scope: countyScope, canary_scope_hash: require('../server/discovery/store').hash(countyScope), promoted_at: null, evidence_qualified: true, approved: false },
  ];
  const network = { sources: [source('healthy'), source('candidate'), source('partial'), source('blocked'), source('never-run'), source('legacy')], summary: { collected: 99, needsAttention: 0 } };
  const result = await attachDiscoveryCoverage(network, { pool: makePool({ runs, rollouts, checkpoints: [{ source_key: 'healthy', cursor: {} }] }) }, { DISCOVERY_MODE: 'advanced' });

  assert.equal(result.summary.collected, 1);
  // candidate + partial + blocked + legacy + never-run. never-run joins the count
  // because it now reports a real (partial) collection instead of awaiting_run:
  // awaiting_run matched neither filter, so a source holding a run was counted as
  // needing nothing at all. collected stays 1 - deriving the status must never
  // promote a source, because nothing here attests a complete sweep or a gate.
  assert.equal(result.summary.needsAttention, 5);
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
  // A missing ledger run means no *coverage attestation* - no acquisition scope,
  // no sweep completeness, no release-gate promotion - and coverage stays null.
  // It does not mean collection never happened: this source carries an
  // observation-backed run, so reporting "not run" denied a collection the
  // store can evidence. The run is preserved and the status is derived from it.
  assert.equal(neverRun.coverage, null);
  assert.deepEqual(neverRun.lastRun, { lastRunAt: 'file-backed', acceptedCount: 999 });
  assert.equal(neverRun.status, 'collected');
  assert.equal(neverRun.discoveryStatus, 'partial');
});

// Collectors run from two places. The discovery ledger records scheduled runs;
// collect-source.js records a run in the observation store on every invocation.
// A source can therefore hold a real run, real stored records and no ledger row
// at all. Reporting that as "collector registered, not run" denies collection
// that demonstrably happened - and on the live network it reported ServiceLink,
// with 7,497 stored records, as never run.
test('a source with an observed run is never reported as never run', async () => {
  const now = Date.now();
  const ago = (hours) => new Date(now - hours * 3600_000).toISOString();
  const sources = [
    source('fresh-run', 'awaiting_run', { workflow: { cadenceHours: 6 }, lastRun: { lastRunAt: ago(0.02), acceptedCount: 250, rejectedCount: 0, error: null } }),
    source('overdue-run', 'awaiting_run', { workflow: { cadenceHours: 6 }, lastRun: { lastRunAt: ago(12), acceptedCount: 250, rejectedCount: 0, error: null } }),
    source('failed-run', 'awaiting_run', { workflow: { cadenceHours: 6 }, lastRun: { lastRunAt: ago(1), acceptedCount: 0, rejectedCount: 0, error: 'publisher challenge' } }),
    source('no-scope-run', 'awaiting_run', { workflow: { cadenceHours: 6 }, lastRun: { lastRunAt: ago(1), acceptedCount: 0, rejectedCount: 0, error: null } }),
    source('blocked-collector', 'awaiting_run', { workflow: { cadenceHours: 24 }, lastRun: { lastRunAt: ago(1), acceptedCount: 0, rejectedCount: 0, error: null } }),
    source('imported-only', 'awaiting_run', { workflow: { cadenceHours: 12 }, lastRun: null }),
    source('imported-stale', 'awaiting_run', { workflow: { cadenceHours: 12 }, lastRun: null }),
    source('never', 'awaiting_run', { workflow: { cadenceHours: 24 }, lastRun: null }),
  ];
  const inventory = [
    { source_key: 'blocked-collector', count: 3, archived: 0, observed_at: ago(1), states: ['active'] },
    { source_key: 'imported-only', count: 122, archived: 0, observed_at: ago(2), states: ['active'] },
    { source_key: 'imported-stale', count: 40, archived: 0, observed_at: ago(72), states: ['active'] },
  ];
  const result = await attachDiscoveryCoverage(
    { sources, summary: { collected: 0, needsAttention: 0 } },
    { pool: makePool({ inventory }) },
    { DISCOVERY_MODE: 'advanced' },
  );
  const by = (id) => result.sources.find((item) => item.id === id);

  // A run inside its cadence window is collected. It is still not "operational":
  // nothing attested sweep completeness or release-gate promotion.
  assert.equal(by('fresh-run').status, 'collected');
  assert.equal(by('fresh-run').discoveryStatus, 'partial');
  assert.equal(by('fresh-run').coverage, null, 'no ledger run means no coverage claim');
  assert.equal(by('fresh-run').lastRun.acceptedCount, 250, 'the run the store recorded must survive');

  // Staleness is judged against the source's own cadence, not one flat window.
  assert.equal(by('overdue-run').status, 'stale');
  assert.equal(by('overdue-run').discoveryStatus, 'stale');

  assert.equal(by('failed-run').status, 'attention');
  assert.equal(by('failed-run').discoveryStatus, 'blocked', 'a challenge is an access block, not a generic failure');

  // A run that returned nothing is "empty", never "collected".
  assert.equal(by('no-scope-run').status, 'empty');
  assert.equal(by('no-scope-run').discoveryStatus, 'empty');

  // Stored records must not launder a collector that is returning nothing. This
  // is the GSA shape: the run inside its cadence window accepted 0, while the 3
  // stored records arrived by import. Reporting "collected" there hides a
  // collector that is currently blocked by publisher policy.
  assert.equal(by('blocked-collector').status, 'empty');
  assert.equal(by('blocked-collector').discoveryStatus, 'empty');
  assert.equal(by('blocked-collector').observedRecords, 3, 'the records are still reported, just not as a healthy collection');

  // Records in the store are evidence on their own, even with no run recorded.
  assert.equal(by('imported-only').status, 'collected');
  assert.equal(by('imported-only').discoveryStatus, 'partial');
  assert.equal(by('imported-only').lastRun, null, 'no run was recorded, so none is invented');
  assert.equal(by('imported-stale').status, 'stale');

  // Only a source with neither a run nor a single stored record is awaiting_run.
  assert.equal(by('never').status, 'awaiting_run');
  assert.equal(by('never').discoveryStatus, 'awaiting_run');
  assert.equal(by('never').lastRun, null);
  assert.equal(by('never').coverage, null);

  assert.equal(
    result.sources.filter((item) => ['awaiting_run'].includes(item.status)).length,
    1,
    'awaiting_run must mean "no evidence of collection", not "no ledger row"',
  );
});
