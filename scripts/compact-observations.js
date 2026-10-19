'use strict';

/**
 * Compact Observation Store
 *
 * Safely prunes superseded raw notice excerpts from historical snapshots in
 * .cache/source-observations.json, keeping latest notice excerpts, all signals,
 * and historical term-change fields completely intact.
 *
 * Usage:
 *   node scripts/compact-observations.js           # dry run: preview savings
 *   node scripts/compact-observations.js --apply   # apply compaction atomically
 */

const fs = require('node:fs');
const path = require('node:path');
const {
  DEFAULT_PATH,
  compactObservations,
  loadObservations,
  recordSourceRun,
} = require('../server/sources/observations');

function main() {
  const apply = process.argv.includes('--apply');
  const filePath = process.env.PROPERTY_OBSERVATIONS_PATH || DEFAULT_PATH;

  if (!fs.existsSync(filePath)) {
    console.log(`[compact-observations] File not found: ${filePath}`);
    return;
  }

  const beforeBytes = fs.statSync(filePath).size;
  const data = loadObservations({ filePath });
  const prunedCount = compactObservations(data);
  const compactedJson = JSON.stringify(data);
  const afterBytes = Buffer.byteLength(compactedJson);
  const savedBytes = beforeBytes - afterBytes;
  const savedMb = (savedBytes / (1024 * 1024)).toFixed(2);

  console.log(`[compact-observations] Examined: ${filePath}`);
  console.log(`[compact-observations] Original size: ${(beforeBytes / (1024 * 1024)).toFixed(2)} MB (${beforeBytes} bytes)`);
  console.log(`[compact-observations] Pruned ${prunedCount} superseded history excerpts`);
  console.log(`[compact-observations] Compacted size: ${(afterBytes / (1024 * 1024)).toFixed(2)} MB (${afterBytes} bytes)`);
  console.log(`[compact-observations] Space savings: ${savedMb} MB (${((savedBytes / beforeBytes) * 100).toFixed(1)}%)`);

  if (!apply) {
    console.log('[compact-observations] Dry run complete. Re-run with --apply to write changes.');
    return;
  }

  // Atomically write through file lock with stale lock recovery
  const lockPath = filePath + '.lock';
  let lock;
  while (true) {
    try {
      lock = fs.openSync(lockPath, 'wx', 0o600);
      break;
    } catch (err) {
      if (err.code === 'EEXIST') {
        try {
          const stat = fs.statSync(lockPath);
          if (Date.now() - stat.mtimeMs > 30_000) {
            try { fs.unlinkSync(lockPath); } catch {}
            continue;
          }
        } catch {
          continue;
        }
        throw new Error('Observation store is locked by another active process. Retry after it finishes.');
      }
      throw err;
    }
  }
  const tempPath = filePath + '.' + Date.now() + '.tmp';
  try {
    fs.writeFileSync(tempPath, compactedJson, { flag: 'wx', mode: 0o600 });
    fs.renameSync(tempPath, filePath);
    console.log(`[compact-observations] Successfully applied compaction to ${filePath}`);
  } finally {
    if (fs.existsSync(tempPath)) {
      try { fs.unlinkSync(tempPath); } catch {}
    }
    fs.closeSync(lock);
    try { fs.unlinkSync(lockPath); } catch {}
  }
}

if (require.main === module) {
  main();
}

module.exports = { main };
