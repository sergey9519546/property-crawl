#!/usr/bin/env node
'use strict';

// scripts/import-observation-store.js
//
// One-time import of the retired bounded JSON observation store into
// PostgreSQL. The file store accumulated 32+ days of snapshot history before
// the migration 025 mirror existed, so the durable table does not hold it yet;
// without this import, retiring the file would erase every pre-mirror
// transition — the returned-to-market and bid-reduction events included.
//
// What is imported:
//   - every record's `latest` + `history[]` snapshots, via
//     persistSourceObservations (idempotent: ON CONFLICT (id) DO NOTHING, so
//     re-running the import is safe and the post-mirror mirror rows stay);
//   - per-source run metadata, via importObservationRun (never clobbers newer
//     Postgres values — counts and timestamps take the greater, an existing
//     error is kept).
//
// What is NOT imported: the old stored change-event log. Events are derived on
// read now by replaying compareSnapshots over snapshot pairs — the same
// classifier that produced the log — so a stored log would be redundant and
// could fall behind the classifier. A few transitions whose intermediate
// snapshots were pruned by the file store's compaction are unrecoverable;
// that loss is bounded by the compaction that already happened and is called
// out in the summary rather than hidden.
//
// Usage:
//   node scripts/import-observation-store.js [--dry-run] [--store <path>]

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_STORE_PATH = process.env.PROPERTY_OBSERVATIONS_PATH
  || path.resolve(__dirname, '../.cache/source-observations.json');

function parseArgs(argv) {
  const options = { dryRun: false, storePath: DEFAULT_STORE_PATH };
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    if (flag === '--dry-run') options.dryRun = true;
    else if (flag === '--store') options.storePath = argv[++index];
    else throw new Error(`Unknown option: ${flag}`);
  }
  return options;
}

function readLegacyStore(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (!data || data.version !== 1 || !data.records || typeof data.records !== 'object') {
    throw new Error('Unrecognized legacy observation store (expected version 1 with records)');
  }
  return data;
}

function snapshotsForRecord(record) {
  return [...(Array.isArray(record?.history) ? record.history : []), record?.latest]
    .filter((snapshot) => snapshot && snapshot.source && snapshot.recordId && snapshot.observedAt);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const legacy = readLegacyStore(options.storePath);
  if (!legacy) {
    console.log(JSON.stringify({ imported: false, reason: 'no legacy store present at ' + options.storePath }));
    return;
  }

  const db = require('../server/db/client');
  await db.verifyConnection();
  if (!db.pool) throw new Error('Import requires PostgreSQL (DATABASE_URL is not configured or unreachable)');
  const { persistSourceObservations, importObservationRun } = require('../server/db/observations-persistence');

  const perSource = {};
  const skippedSources = new Set();
  let totalSnapshots = 0;

  for (const record of Object.values(legacy.records || {})) {
    const snapshots = snapshotsForRecord(record);
    if (!snapshots.length) continue;
    const sourceId = snapshots[0].source;
    totalSnapshots += snapshots.length;
    if (options.dryRun) {
      perSource[sourceId] = (perSource[sourceId] || 0) + snapshots.length;
      continue;
    }
    const result = await persistSourceObservations(db.pool, sourceId, snapshots);
    if (result.skipped) skippedSources.add(sourceId);
    perSource[sourceId] = (perSource[sourceId] || 0) + (result.persisted || 0);
  }

  let runRows = 0;
  const skippedRunSources = [];
  if (!options.dryRun) {
    for (const [sourceId, runMeta] of Object.entries(legacy.runs || {})) {
      try {
        const result = await importObservationRun(db.pool, sourceId, runMeta);
        if (result.imported) runRows += 1;
        else if (result.skipped) skippedRunSources.push(sourceId);
      } catch (error) {
        // One malformed run row must not abort the snapshot import that
        // already succeeded; report it and continue.
        skippedRunSources.push(`${sourceId} (${error.message.slice(0, 80)})`);
      }
    }
  }

  const summary = {
    imported: !options.dryRun,
    dryRun: options.dryRun,
    storePath: options.storePath,
    legacyRecords: Object.keys(legacy.records || {}).length,
    legacySnapshots: totalSnapshots,
    persistedBySource: perSource,
    runRowsImported: runRows,
    skippedUnknownSources: [...skippedSources].sort(),
    skippedRunSources: skippedRunSources.sort(),
  };
  if (options.dryRun) summary.note = 'Dry run: nothing was written. Re-run without --dry-run to import.';
  console.log(JSON.stringify(summary, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error('[import-observation-store]', error.message);
    process.exitCode = 1;
  });
}
module.exports = { parseArgs, readLegacyStore, snapshotsForRecord };
