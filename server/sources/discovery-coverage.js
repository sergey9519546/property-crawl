'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { acquisitionScope } = require('../discovery/run-report');
const { hash } = require('../discovery/store');

async function attachDiscoveryCoverage(network, database, env = process.env) {
  let atlas = { sources: [], total: 0, ledgerRows: 0, unmappedLedgerRows: 0 }, collectionHealth={status:'disabled',degraded:false,lastSeenAt:null,lastLoopStatus:null,currentJobId:null,backlog:{queued:0,expiredRunning:0}};
  if (database.pool) {
    const tables = await database.pool.query("SELECT to_regclass('public.discovery_source_runs') AS runs,to_regclass('public.discovery_atlas_sources') AS atlas");
    if (!tables.rows[0].runs || !tables.rows[0].atlas) {
      if (env.DISCOVERY_MODE === 'advanced') throw new Error('Discovery migrations are required');
      return { ...network, atlas, collectionHealth, storageMode: 'postgres_legacy' };
    }
    const discoveryStore=require('../discovery/store').createDiscoveryStore(database);
    collectionHealth=await discoveryStore.collectionHealth();
    const [runs, counts, checkpoints, sources, ledger, rollouts] = await Promise.all([
      database.pool.query("SELECT DISTINCT ON(source_key,run_kind) *,run_kind FROM (SELECT r.*,CASE WHEN trigger IN ('legacy_import','legacy_history','archive_import') THEN 'import' ELSE 'operational' END run_kind FROM discovery_source_runs r) classified ORDER BY source_key,run_kind,started_at DESC"),
      database.pool.query(`SELECT source_key,count(*)::int AS count,
        count(*) FILTER(WHERE provenance->>'origin'='archive')::int AS archived,
        max(source_observed_at) AS observed_at,array_agg(DISTINCT state) AS states FROM listings GROUP BY source_key`),
      database.pool.query('SELECT * FROM discovery_checkpoints'),
      database.pool.query('SELECT record,automation_status FROM discovery_atlas_sources ORDER BY atlas_id'),
      database.pool.query("SELECT count(*)::int AS total,count(*) FILTER(WHERE jsonb_array_length(record->'sourceIds')=0)::int AS unmapped FROM discovery_atlas_ledger"),
      discoveryStore.sourceRolloutStatuses(),
    ]);
    for (const source of network.sources) {
      const key = source.adapterKey || source.id;
      const run = runs.rows.find(r => r.source_key === key && r.run_kind === 'operational');
      const imported = runs.rows.find(r => r.source_key === key && r.run_kind === 'import');
      const inventory = counts.rows.find(r => r.source_key === key);
      const checkpoint = checkpoints.rows.find(r => r.source_key === key);
      const rollout = rollouts.find(r => r.sourceKey === key);
      source.storedRecords = inventory?.count || 0;
      source.archivedRecords = inventory?.archived || 0;
      source.observedRecords = (inventory?.count || 0) - (inventory?.archived || 0);
      source.observedStates = inventory?.states || [];
      source.latestObservation = inventory?.observed_at || null;
      // Do not expose opaque publisher continuation tokens on public coverage.
      source.checkpoint = checkpoint ? { resumable: Boolean(checkpoint.cursor && typeof checkpoint.cursor === 'object' && Object.keys(checkpoint.cursor).length), updatedAt: checkpoint.updated_at, scopeHash: checkpoint.scope_hash } : null;
      source.importHistory = imported ? { trigger: imported.trigger, lastRunAt: imported.completed_at || imported.started_at, accepted: imported.accepted_count, rejected: imported.rejected_count, error: imported.error_message } : null;
      source.releaseGate = source.automated ? {
        state: rollout?.state || 'unqualified', cleanRuns: rollout?.cleanRuns || 0,
        requiredRuns: 2, approved: rollout?.approved === true,
        evidenceQualified: rollout?.evidenceQualified === true,
        configuredScope: rollout?.configuredScope || null,
        scopeHash: rollout?.scopeHash || null, promotedAt: rollout?.promotedAt || null,
      } : null;
      if (run) {
        const scope = acquisitionScope(run.coverage?.acquisitionScope || run.scope) || null;
        const complete = Boolean(scope && run.status === 'complete' && run.coverage?.complete === true
          && run.coverage?.fullSweepComplete === true && run.coverage?.truncated === false && run.rejected_count === 0);
        source.lastRun = { lastRunAt: run.completed_at || run.started_at, lastSuccessAt: complete ? run.completed_at : null, acceptedCount: run.accepted_count, rejectedCount: run.rejected_count, error: run.error_message, durationMs: null, runs: null, trigger: run.trigger };
        source.status = complete ? (run.accepted_count > 0 ? 'collected' : 'empty') : run.status === 'running' ? 'awaiting_run' : 'attention';
        source.coverage = { scope, acquisitionScope: scope, discovered: run.discovered_count, accepted: run.accepted_count,
          rejected: run.rejected_count, complete, lastRunAt: run.completed_at || run.started_at,
          trigger: run.trigger, error: run.error_message, scopeHash: scope ? hash(scope) : null };
        if (source.releaseGate) source.releaseGate.scopeMatchesLatest = Boolean(scope && rollout?.scopeHash && hash(scope) === rollout.scopeHash);
        const stale = Date.now() - Date.parse(run.completed_at || run.started_at) > (source.workflow?.cadenceHours || 24) * 3600000;
        source.discoveryStatus = run.trigger === 'archive_import' ? 'archived'
          : run.status === 'failed' ? (/403|429|challenge|blocked/i.test(run.error_message || '') ? 'blocked' : 'attention')
            : run.status === 'running' ? 'collecting' : !complete ? 'partial' : run.accepted_count === 0 ? 'empty' : stale ? 'stale' : rollout?.approved !== true ? 'partial' : 'operational';
      } else {
        source.lastRun = null;
        source.coverage = null;
        source.discoveryStatus = source.automated ? 'awaiting_run' : 'manual';
        source.status = source.automated ? 'awaiting_run' : source.status;
      }
    }
    atlas = { sources: sources.rows.map(s => ({ ...s.record, automationStatus: s.automation_status })),
      total: sources.rows.length, ledgerRows: ledger.rows[0].total, unmappedLedgerRows: ledger.rows[0].unmapped };
  } else {
    const file = env.PROPERTY_ATLAS_STAGE_PATH || path.resolve(__dirname, '../../.cache/discovery-import/atlas.json');
    if (fs.existsSync(file)) {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      atlas = { sources: data.sources, total: data.sources.length, ledgerRows: data.ledger.length, unmappedLedgerRows: data.unmappedLedgerRows };
    }
  }
  const collected = network.sources.filter((source) => source.status === 'collected' && source.discoveryStatus === 'operational').length;
  const needsAttention = network.sources.filter((source) =>
    ['attention', 'stale', 'empty'].includes(source.status)
    || ['attention', 'stale', 'partial', 'blocked'].includes(source.discoveryStatus)).length;
  return { ...network, atlas, collectionHealth, storageMode: database.pool ? 'postgres' : 'demo',
    summary: { ...network.summary, collected, needsAttention,
      observedRecords: network.sources.reduce((n,s)=>n+Number(s.observedRecords||0),0),
      storedRecords: network.sources.reduce((n,s)=>n+Number(s.storedRecords||s.observedRecords||0),0), atlasBacklog: atlas.total } };
}
module.exports = { attachDiscoveryCoverage };
