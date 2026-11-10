#!/usr/bin/env node
'use strict';

/**
 * scripts/compact-snapshots.js
 *
 * Maintenance CLI for observation deduplication and snapshot compaction.
 *
 * Scans observation runs and history in .cache/ and PostgreSQL source_observations,
 * eliminates consecutive identical snapshots while strictly preserving:
 *   - First and last observation of every series
 *   - Every status-transition observation
 *   - Cryptographic payload identity (contentHash)
 *
 * Modes:
 *   --dry-run (default): reports compaction potential and byte reduction without writing.
 *   --apply: applies compaction with automatic backup preservation.
 *
 * Usage:
 *   node scripts/compact-snapshots.js [--apply] [--pg] [--ssl|--no-ssl] [--vacuum] [--source <sourceId>] [--target-dir <path>]
 */

const fs = require('node:fs');
const path = require('node:path');
const { compactObservations, computeContentHash } = require('../server/discovery/snapshot-compactor');

function parseArgs(argv) {
  const args = {
    apply: false,
    pg: false,
    ssl: undefined,
    vacuum: false,
    source: null,
    targetDir: path.resolve(process.cwd(), '.cache/discovery-evidence'),
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--apply') {
      args.apply = true;
    } else if (arg === '--dry-run') {
      args.apply = false;
    } else if (arg === '--pg') {
      args.pg = true;
    } else if (arg === '--ssl') {
      args.ssl = true;
    } else if (arg === '--no-ssl') {
      args.ssl = false;
    } else if (arg === '--vacuum') {
      args.vacuum = true;
    } else if (arg === '--source' && argv[i + 1]) {
      args.source = argv[++i];
    } else if (arg === '--target-dir' && argv[i + 1]) {
      args.targetDir = path.resolve(argv[++i]);
    } else if ((arg === '--database-url' || arg === '--db') && argv[i + 1]) {
      process.env.DATABASE_URL = argv[++i];
    }
  }

  return args;
}

function runCompaction(options = {}) {
  const { apply, source, targetDir } = options;
  console.log(`[Snapshot Compactor] Mode: ${apply ? 'APPLY (in-place write with backup)' : 'DRY-RUN (read-only)'}`);
  console.log(`[Snapshot Compactor] Target directory: ${targetDir}`);

  if (!fs.existsSync(targetDir)) {
    console.log(`[Snapshot Compactor] Directory ${targetDir} does not exist. Nothing to compact.`);
    return { filesProcessed: 0, totalOriginalCount: 0, totalRetainedCount: 0, bytesSaved: 0 };
  }

  const entries = fs.readdirSync(targetDir, { withFileTypes: true });
  let filesProcessed = 0;
  let totalOriginalCount = 0;
  let totalRetainedCount = 0;
  let totalOriginalBytes = 0;
  let totalRetainedBytes = 0;

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    if (entry.name.includes('.backup.')) continue;
    if (source && !entry.name.startsWith(source)) continue;

    const filePath = path.join(targetDir, entry.name);
    let content;
    try {
      content = fs.readFileSync(filePath, 'utf8');
    } catch {
      continue;
    }

    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch {
      continue;
    }

    // Identify array of observations
    const observations = Array.isArray(parsed)
      ? parsed
      : (Array.isArray(parsed.observations) ? parsed.observations : null);

    if (!observations || observations.length <= 1) continue;

    const originalBytes = Buffer.byteLength(content, 'utf8');
    const result = compactObservations(observations);

    totalOriginalCount += result.originalCount;
    totalRetainedCount += result.retainedCount;
    totalOriginalBytes += originalBytes;

    const compactedPayload = Array.isArray(parsed)
      ? result.compacted
      : { ...parsed, observations: result.compacted };

    const compactedJson = JSON.stringify(compactedPayload, null, 2);
    const retainedBytes = Buffer.byteLength(compactedJson, 'utf8');
    totalRetainedBytes += retainedBytes;

    filesProcessed++;

    console.log(
      `  - ${entry.name}: ${result.originalCount} -> ${result.retainedCount} records ` +
      `(-${result.compressionPct}%, ${Math.round((originalBytes - retainedBytes) / 1024)} KB saved)`
    );

    if (apply && result.removedCount > 0) {
      // Evidence preservation: keep the pre-compaction backup, and replace
      // the live file atomically (tmp + rename) so an interrupted compaction
      // can never leave a truncated observations file behind.
      const backupPath = `${filePath}.backup.${Date.now()}`;
      fs.writeFileSync(backupPath, content, 'utf8');
      const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
      fs.writeFileSync(tmpPath, compactedJson, 'utf8');
      fs.renameSync(tmpPath, filePath);
    }
  }

  const bytesSaved = totalOriginalBytes - totalRetainedBytes;
  console.log('\n--- Compaction Summary ---');
  console.log(`Files examined/compacted: ${filesProcessed}`);
  console.log(`Original observations:   ${totalOriginalCount}`);
  console.log(`Retained observations:   ${totalRetainedCount}`);
  console.log(`Observations pruned:     ${totalOriginalCount - totalRetainedCount}`);
  console.log(`Total storage reduction:  ${Math.round(bytesSaved / 1024)} KB (${totalOriginalBytes > 0 ? ((bytesSaved / totalOriginalBytes) * 100).toFixed(1) : 0}%)`);

  return {
    filesProcessed,
    totalOriginalCount,
    totalRetainedCount,
    bytesSaved,
  };
}

async function runPgCompaction(options = {}) {
  const { apply = false, source = null, pool = null, vacuum = false } = options;
  const { compactPgObservations } = require('../server/db/observations-persistence');
  let activePool = pool || require('../server/db/client').pool;
  let customPool = null;
  let embeddedHandle = null;

  if (!activePool && process.env.DATABASE_URL) {
    try {
      const connectionString = process.env.DATABASE_URL;
      const useSsl = options.ssl === true || (
        options.ssl !== false && (
          process.env.PGSSLMODE === 'require' ||
          /sslmode=require|\.render\.com/i.test(connectionString)
        )
      );
      const { Pool } = require('pg');
      customPool = new Pool({
        connectionString,
        ...(useSsl ? { ssl: { rejectUnauthorized: false } } : {}),
        max: 5,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000,
      });
      activePool = customPool;
    } catch (err) {
      console.warn('[Snapshot Compactor] Could not connect to DATABASE_URL:', err.message);
    }
  }

  if (!activePool) {
    try {
      const { resolveDatabaseTarget } = require('../server/db/database-target');
      const target = resolveDatabaseTarget(process.env);
      const embeddedDir = process.env.PROPERTY_PG_DATA_DIR || path.resolve(process.cwd(), '.cache/pgdata');
      if (target === 'embedded' || (!process.env.DATABASE_URL && fs.existsSync(embeddedDir))) {
        const { startEmbeddedPostgres } = require('../server/db/pglite-pool');
        embeddedHandle = await startEmbeddedPostgres({
          dataDir: embeddedDir,
          applySchema: false,
          migrateExisting: false,
        });
        activePool = embeddedHandle.pool;
      }
    } catch (err) {
      console.warn('[Snapshot Compactor] Could not open embedded PostgreSQL:', err.message);
    }
  }

  if (!activePool) {
    console.log('[Snapshot Compactor] PostgreSQL pool is not configured; skipping source_observations compaction.');
    return {
      scannedRecords: 0,
      originalRows: 0,
      retainedRows: 0,
      prunedRows: 0,
      deletedIds: [],
      groups: 0,
      totalBefore: 0,
      totalAfter: 0,
      pruned: 0,
      bytesBefore: null,
      bytesAfter: null,
    };
  }

  try {
    const result = await compactPgObservations(activePool, {
      apply,
      source,
      vacuum: Boolean(vacuum),
    });
    console.log('\n--- PostgreSQL source_observations Compaction Summary ---');
    console.log(`Records scanned:         ${result.scannedRecords}`);
    console.log(`Original rows:           ${result.originalRows}`);
    console.log(`Retained rows:           ${result.retainedRows}`);
    console.log(`Redundant rows ${apply ? 'deleted' : 'found'}:  ${result.prunedRows}`);
    console.log(`Bytes before / after:    ${result.bytesBefore ?? 'n/a'} -> ${result.bytesAfter ?? 'n/a'}`);
    console.log(JSON.stringify({
      groups: result.groups,
      totalBefore: result.totalBefore,
      totalAfter: result.totalAfter,
      pruned: result.pruned,
      bytesBefore: result.bytesBefore ?? null,
      bytesAfter: result.bytesAfter ?? null,
      compactedAt: result.compactedAt,
    }));
    return result;
  } finally {
    if (customPool && typeof customPool.end === 'function') {
      await customPool.end().catch(() => {});
    }
    if (embeddedHandle && embeddedHandle.pool && typeof embeddedHandle.pool.end === 'function') {
      await embeddedHandle.pool.end().catch(() => {});
    }
  }
}

if (require.main === module) {
  const args = parseArgs(process.argv);
  (async () => {
    runCompaction(args);
    if (args.pg) {
      await runPgCompaction(args);
    }
  })().catch((err) => {
    console.error('[Snapshot Compactor] Compaction error:', err.message);
    process.exitCode = 1;
  });
}

module.exports = { runCompaction, runPgCompaction, parseArgs };
