'use strict';

/**
 * Backup Snapshot Rotation & Raw Store Pruner
 *
 * Implements Task 20:
 * Safely rotates backups based on retention policy (7 daily, 4 weekly)
 * and purges stale temporary crawler dumps older than 30 days while
 * permanently preserving canonical audit ledgers and database records.
 */

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_CACHE_DIR = path.resolve(__dirname, '../.cache');
const DEFAULT_BACKUP_DIR = path.resolve(DEFAULT_CACHE_DIR, 'backups');

const PERMANENT_AUDIT_FILES = new Set([
  'pruned-listings.json',
  'observations.json',
  'live-listings.json',
  'document-reviews.json'
]);

/**
 * Rotates backup snapshots according to retention rules:
 * - Keep all backups from the last 7 days.
 * - Keep 1 backup per week for the preceding 3 weeks (up to 28 days total).
 * - Remove backups older than 28 days.
 */
function pruneBackups(options = {}) {
  const backupDir = path.resolve(options.backupDir || DEFAULT_BACKUP_DIR);
  const now = options.now || Date.now();
  const dryRun = options.dryRun !== false;

  if (!fs.existsSync(backupDir)) {
    return { kept: [], deleted: [] };
  }

  const entries = fs.readdirSync(backupDir)
    .filter(name => name.startsWith('snapshot-') && (name.endsWith('.tar.gz') || name.endsWith('.gz')))
    .map(name => {
      const fullPath = path.join(backupDir, name);
      const stat = fs.statSync(fullPath);
      return {
        name,
        fullPath,
        mtime: stat.mtimeMs,
        ageDays: (now - stat.mtimeMs) / (1000 * 60 * 60 * 24)
      };
    })
    .sort((a, b) => b.mtime - a.mtime);

  const kept = [];
  const deleted = [];
  const coveredWeeks = new Set();

  for (const item of entries) {
    if (item.ageDays <= 7) {
      // Retain daily for first 7 days
      kept.push(item);
    } else if (item.ageDays <= 28) {
      // Retain 1 per week between day 8 and 28
      const weekIndex = Math.floor(item.ageDays / 7);
      if (!coveredWeeks.has(weekIndex)) {
        coveredWeeks.add(weekIndex);
        kept.push(item);
      } else {
        deleted.push(item);
      }
    } else {
      // Older than 28 days -> purge
      deleted.push(item);
    }
  }

  if (!dryRun) {
    for (const item of deleted) {
      try {
        fs.unlinkSync(item.fullPath);
      } catch (err) {
        console.error(`Failed to delete expired snapshot ${item.name}:`, err.message);
      }
    }
  }

  return { kept, deleted };
}

/**
 * Safely prunes stale collector scratch HTML dumps older than maxAgeDays (default 30 days).
 * Safeguard: NEVER prunes canonical ledgers or files matching PERMANENT_AUDIT_FILES.
 */
function pruneRawCollectorDumps(options = {}) {
  const targetDir = path.resolve(options.targetDir || path.join(DEFAULT_CACHE_DIR, 'raw'));
  const maxAgeDays = options.maxAgeDays || 30;
  const now = options.now || Date.now();
  const dryRun = options.dryRun !== false;

  if (!fs.existsSync(targetDir)) {
    return { kept: [], deleted: [] };
  }

  const kept = [];
  const deleted = [];

  const walk = (dir) => {
    const files = fs.readdirSync(dir);
    for (const file of files) {
      const fullPath = path.join(dir, file);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        walk(fullPath);
      } else {
        // Enforce audit ledger preservation invariant
        if (PERMANENT_AUDIT_FILES.has(file)) {
          kept.push({ name: file, fullPath, reason: 'permanent_audit_ledger' });
          continue;
        }

        const ageDays = (now - stat.mtimeMs) / (1000 * 60 * 60 * 24);
        if (ageDays > maxAgeDays) {
          deleted.push({ name: file, fullPath, ageDays });
        } else {
          kept.push({ name: file, fullPath, ageDays });
        }
      }
    }
  };

  walk(targetDir);

  if (!dryRun) {
    for (const item of deleted) {
      try {
        fs.unlinkSync(item.fullPath);
      } catch (err) {
        console.error(`Failed to delete raw dump ${item.name}:`, err.message);
      }
    }
  }

  return { kept, deleted };
}

// CLI Execution
if (require.main === module) {
  const isApply = process.argv.includes('--apply') || process.argv.includes('--force');
  const backupResult = pruneBackups({ dryRun: !isApply });
  const rawResult = pruneRawCollectorDumps({ dryRun: !isApply });

  console.log(`[Backup Rotation] Kept: ${backupResult.kept.length}, Expired: ${backupResult.deleted.length} (Dry-run: ${!isApply})`);
  console.log(`[Raw Collector Pruning] Kept: ${rawResult.kept.length}, Stale Dumps: ${rawResult.deleted.length} (Dry-run: ${!isApply})`);
}

module.exports = {
  pruneBackups,
  pruneRawCollectorDumps,
  PERMANENT_AUDIT_FILES
};
