'use strict';
const fs = require('node:fs');
const path = require('node:path');

async function attachDiscoveryCoverage(network, database, env = process.env) {
  let atlas = { sources: [], total: 0, ledgerRows: 0, unmappedLedgerRows: 0 };
  if (database.pool) {
    const tables = await database.pool.query("SELECT to_regclass('public.discovery_source_runs') AS runs,to_regclass('public.discovery_atlas_sources') AS atlas");
    if (!tables.rows[0].runs || !tables.rows[0].atlas) {
      if (env.DISCOVERY_MODE === 'advanced') throw new Error('Discovery migrations are required');
      return { ...network, atlas, storageMode: 'postgres_legacy' };
    }
    const [runs, counts, checkpoints, sources, ledger] = await Promise.all([
      database.pool.query("SELECT DISTINCT ON(source_key) * FROM discovery_source_runs ORDER BY source_key,started_at DESC"),
      database.pool.query(`SELECT source_key,count(*)::int AS count,
        count(*) FILTER(WHERE provenance->>'origin'='archive')::int AS archived,
        max(source_observed_at) AS observed_at,array_agg(DISTINCT state) AS states FROM listings GROUP BY source_key`),
      database.pool.query('SELECT * FROM discovery_checkpoints'),
      database.pool.query('SELECT record,automation_status FROM discovery_atlas_sources ORDER BY atlas_id'),
      database.pool.query("SELECT count(*)::int AS total,count(*) FILTER(WHERE jsonb_array_length(record->'sourceIds')=0)::int AS unmapped FROM discovery_atlas_ledger"),
    ]);
    for (const source of network.sources) {
      const key = source.adapterKey || source.id;
      const run = runs.rows.find(r => r.source_key === key);
      const inventory = counts.rows.find(r => r.source_key === key);
      const checkpoint = checkpoints.rows.find(r => r.source_key === key);
      source.storedRecords = inventory?.count || 0;
      source.archivedRecords = inventory?.archived || 0;
      source.observedRecords = (inventory?.count || 0) - (inventory?.archived || 0);
      source.observedStates = inventory?.states || [];
      source.latestObservation = inventory?.observed_at || null;
      // Do not expose opaque publisher continuation tokens on public coverage.
      source.checkpoint = checkpoint ? { resumable: Boolean(checkpoint.cursor), updatedAt: checkpoint.updated_at, scopeHash: checkpoint.scope_hash } : null;
      if (run) {
        source.coverage = { scope: run.scope, discovered: run.discovered_count, accepted: run.accepted_count,
          rejected: run.rejected_count, complete: run.status === 'complete', lastRunAt: run.completed_at || run.started_at,
          trigger: run.trigger, error: run.error_message, scopeHash: run.scope_hash };
        const stale = Date.now() - Date.parse(run.completed_at || run.started_at) > (source.workflow?.cadenceHours || 24) * 3600000;
        source.discoveryStatus = run.trigger === 'archive_import' ? 'archived'
          : run.status === 'failed' ? (/403|429|challenge|blocked/i.test(run.error_message || '') ? 'blocked' : 'attention')
            : run.status === 'partial' ? 'partial' : run.status === 'running' ? 'collecting' : stale ? 'stale' : 'operational';
      } else source.discoveryStatus = source.automated ? 'awaiting_run' : 'manual';
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
  return { ...network, atlas, storageMode: database.pool ? 'postgres' : 'demo',
    summary: { ...network.summary, observedRecords: network.sources.reduce((n,s)=>n+s.observedRecords,0),
      storedRecords: network.sources.reduce((n,s)=>n+(s.storedRecords||s.observedRecords),0), atlasBacklog: atlas.total } };
}
module.exports = { attachDiscoveryCoverage };
