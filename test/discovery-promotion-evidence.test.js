'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { createIsolatedDatabase } = require('./discovery-acceptance-db');
const { createDiscoveryStore, hash } = require('../server/discovery/store');

const configured = Boolean(process.env.DISCOVERY_TEST_DATABASE_URL || process.env.TEST_DATABASE_URL);
test('promotion requires distinct durable scope evidence and scope changes invalidate approval', { skip: !configured }, async () => {
  const database = await createIsolatedDatabase({ prefix: 'promotion_evidence' });
  const store = createDiscoveryStore(database.pool);
  const scope = countyId => ({ endpoint: '/Sales/SalesSearch', filters: { state: 'NJ', countyId } });
  async function observedRun(countyId, overrides = {}) {
    const run = await store.beginRun({ sourceKey: 'civilview', scope: scope(countyId) });
    await store.finishRun(run.id, {
      status: 'complete', discovered: 24, accepted: 24, rejected: 0,
      coverage: { complete: true, fullSweepComplete: true, truncated: false, acquisitionScope: scope(countyId) },
      ...overrides,
    });
    return run.id;
  }
  try {
    const missing = await store.recordCanary('civilview', { clean: true, scope: scope('20') });
    assert.equal(missing.clean_canary_runs, 0);
    assert.deepEqual(missing.configured_scope, {});
    assert.equal(missing.canary_scope_hash, null);
    await assert.rejects(store.promoteSource('civilview'), /two clean durable/);

    const first = await observedRun('20');
    assert.equal((await store.recordCanary('civilview', { clean: true, scope: scope('20'), runId: first })).clean_canary_runs, 1);
    assert.equal((await store.recordCanary('civilview', { clean: true, scope: scope('20'), runId: first })).clean_canary_runs, 1);
    await assert.rejects(store.promoteSource('civilview'), /two clean durable/);
    const second = await observedRun('20');
    await store.recordCanary('civilview', { clean: true, scope: scope('20'), runId: second });
    assert.equal((await store.promoteSource('civilview')).state, 'promoted');
    assert.deepEqual((await store.promotedSourceScopes()).map(row => [row.sourceKey, row.scope]), [['civilview', scope('20')]]);

    const newScopeRun = await observedRun('21');
    const changed = await store.recordCanary('civilview', { clean: true, scope: scope('21'), runId: newScopeRun });
    assert.equal(changed.state, 'canary');
    assert.equal(changed.promoted_at, null);
    assert.equal(changed.clean_canary_runs, 1);
    assert.deepEqual(await store.promotedSources(), []);
    await assert.rejects(store.promoteSource('civilview'), /two clean durable/);
    const otherScopeRun = await observedRun('21');
    await store.recordCanary('civilview', { clean: true, scope: scope('21'), runId: otherScopeRun });
    assert.deepEqual((await store.sourceRolloutStatuses()).map(row => [row.sourceKey, row.evidenceQualified, row.approved]), [['civilview', true, false]]);
    const promoted = await store.promoteSource('civilview');
    assert.deepEqual((await store.sourceRolloutStatuses()).map(row => [row.sourceKey, row.evidenceQualified, row.approved]), [['civilview', true, true]]);
    const thirdSameScopeRun = await observedRun('21');
    const stillPromoted = await store.recordCanary('civilview', { clean: true, scope: scope('21'), runId: thirdSameScopeRun });
    assert.equal(stillPromoted.state, 'promoted');
    assert.equal(stillPromoted.promoted_at.toISOString(), promoted.promoted_at.toISOString());
    assert.equal(stillPromoted.clean_canary_runs, 3);

    // Failed, partial, or otherwise unverified collection is not rollout
    // evidence and cannot mutate a previously authoritative rollout.
    const failed = await observedRun('21', { status: 'failed', accepted: 0 });
    const syntheticScope = { source: 'civilview', incomplete: true };
    const ignoredFailure = await store.recordCanary('civilview', { clean: false, scope: syntheticScope, runId: failed });
    assert.equal(ignoredFailure.state, 'promoted');
    assert.equal(ignoredFailure.promoted_at.toISOString(), promoted.promoted_at.toISOString());
    assert.equal(ignoredFailure.clean_canary_runs, 3);
    assert.deepEqual(ignoredFailure.configured_scope, scope('21'));
    assert.equal(ignoredFailure.canary_scope_hash, hash(scope('21')));
    assert.equal(ignoredFailure.last_clean_run_id, thirdSameScopeRun);
    assert.deepEqual((await store.sourceRolloutStatuses()).map(row => [row.sourceKey, row.evidenceQualified, row.approved]), [['civilview', true, true]]);

    const partial = await observedRun('22', { status: 'partial', accepted: 1 });
    const ignoredPartial = await store.recordCanary('civilview', { clean: true, scope: scope('22'), runId: partial });
    assert.equal(ignoredPartial.state, 'promoted');
    assert.equal(ignoredPartial.promoted_at.toISOString(), promoted.promoted_at.toISOString());
    assert.equal(ignoredPartial.clean_canary_runs, 3);
    assert.deepEqual(ignoredPartial.configured_scope, scope('21'));
    assert.equal(ignoredPartial.canary_scope_hash, hash(scope('21')));
    assert.equal(ignoredPartial.last_clean_run_id, thirdSameScopeRun);

    const reportOnlyScope = await observedRun('20', {
      coverage: { complete: true, fullSweepComplete: true, truncated: false, acquisitionScope: scope('22') },
    });
    const ignoredReportOnlyScope = await store.recordCanary('civilview', { clean: true, scope: scope('22'), runId: reportOnlyScope });
    assert.equal(ignoredReportOnlyScope.state, 'promoted');
    assert.equal(ignoredReportOnlyScope.clean_canary_runs, 3);
    assert.deepEqual(ignoredReportOnlyScope.configured_scope, scope('21'));
    assert.equal(ignoredReportOnlyScope.canary_scope_hash, hash(scope('21')));
    assert.equal(ignoredReportOnlyScope.last_clean_run_id, thirdSameScopeRun);

    // A real run for another source or another scope is not evidence here.
    assert.equal((await store.recordCanary('hud', { clean: true, scope: scope('20'), runId: first })).clean_canary_runs, 0);
    const ignoredWrongScope = await store.recordCanary('civilview', { clean: true, scope: scope('22'), runId: first });
    assert.equal(ignoredWrongScope.clean_canary_runs, 3);
    assert.deepEqual(ignoredWrongScope.configured_scope, scope('21'));
    await database.pool.query("UPDATE discovery_source_rollouts SET clean_canary_runs=2,configured_scope=$1::jsonb,canary_scope_hash=$2 WHERE source_key='civilview'", [scope('22'), hash(scope('22'))]);
    await assert.rejects(store.promoteSource('civilview'), /two clean durable/);
    await database.pool.query("UPDATE discovery_source_rollouts SET state='promoted',promoted_at=NOW() WHERE source_key='civilview'");
    assert.deepEqual(await store.promotedSources(), []);
    assert.deepEqual(await store.promotedSourceScopes(), []);
    const reconcile = fs.readFileSync(path.join(__dirname, '../server/db/migrations/014_discovery_promotion_evidence.sql'), 'utf8');
    await database.pool.query(reconcile);
    await database.pool.query(reconcile);
    const reconciled = (await database.pool.query("SELECT state,promoted_at FROM discovery_source_rollouts WHERE source_key='civilview'")).rows[0];
    assert.equal(reconciled.state, 'canary');
    assert.equal(reconciled.promoted_at, null);
  } finally {
    await database.close();
  }
});
