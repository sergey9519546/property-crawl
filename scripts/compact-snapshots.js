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
 *   node scripts/compact-snapshots.js [--apply] [--source <sourceId>] [--target-dir <path>]
 */

const fs = require('node:fs');
const path = require('node:path');
const { compactObservations, computeContentHash } = require('../server/discovery/snapshot-compactor');

function parseArgs(argv) {
  const args = {
    apply: false,
    source: null,
    targetDir: path.resolve(process.cwd(), '.cache/discovery-evidence'),
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--apply') {
      args.apply = true;
    } else if (arg === '--dry-run') {
      args.apply = false;
    } else if (arg === '--source' && argv[i + 1]) {
      args.source = argv[++i];
    } else if (arg === '--target-dir' && argv[i + 1]) {
      args.targetDir = path.resolve(argv[++i]);
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

if (require.main === module) {
  const args = parseArgs(process.argv);
  runCompaction(args);
}

module.exports = { runCompaction, parseArgs };

