'use strict';

/**
 * server/discovery/cache-compaction.js
 *
 * Safe, Atomic Maintenance & Compaction Engine for .cache/ JSON storage.
 *
 * Features:
 * - TTL-based eviction for dated cache entries (observedAt, cachedAt, timestamp, etc.).
 * - Pruning of orphaned, null, undefined, or empty cache keys.
 * - Integrity validation (round-trip JSON parse verification prior to serialization).
 * - Atomic write operations using process-isolated temporary files with synchronous rename.
 * - Full multi-cache compaction across federal hazard GIS, terrain, snapshots, and custom caches.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const DEFAULT_CACHE_DIR = path.resolve(process.cwd(), '.cache');

const DEFAULT_KNOWN_CACHE_FILES = [
  'fema-flood-cache.json',
  'epa-hazard-cache.json',
  'usgs-terrain-cache.json',
  'discovery-snapshots.json'
];

/**
 * Extracts a numeric timestamp from an entry object or primitive if available.
 *
 * @param {*} entry
 * @returns {number|null} Timestamp in milliseconds or null
 */
function extractEntryTimestamp(entry) {
  if (!entry) return null;

  if (typeof entry === 'number' && Number.isFinite(entry) && entry > 0) {
    return entry;
  }

  if (typeof entry === 'string') {
    const parsed = Date.parse(entry);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  if (typeof entry === 'object' && !Array.isArray(entry)) {
    const candidateKeys = [
      'observedAt',
      'cachedAt',
      'timestamp',
      'createdAt',
      'updatedAt',
      'date',
      'time',
      'lastChecked'
    ];
    for (const key of candidateKeys) {
      const val = entry[key];
      if (!val) continue;
      if (typeof val === 'number' && Number.isFinite(val) && val > 0) {
        return val;
      }
      if (typeof val === 'string') {
        const parsed = Date.parse(val);
        if (Number.isFinite(parsed) && parsed > 0) {
          return parsed;
        }
      }
    }
  }

  return null;
}

/**
 * Safely compacts a single JSON cache file with TTL eviction, null pruning,
 * and atomic disk write.
 *
 * @param {string} filePath - Absolute or relative path to the cache JSON file
 * @param {object} [options={}]
 * @param {number} [options.maxAgeMs=null] - Maximum age in ms before an entry is evicted
 * @param {number|Date} [options.referenceTime=Date.now()] - Reference timestamp for age calculations
 * @param {boolean} [options.pruneNulls=true] - Remove null or undefined entries
 * @param {boolean} [options.pruneEmptyObjects=true] - Remove empty object ({}) values
 * @param {boolean} [options.dryRun=false] - Return calculated stats without modifying disk
 * @returns {{
 *   path: string,
 *   originalBytes: number,
 *   compactedBytes: number,
 *   entriesRemoved: number,
 *   entriesRetained: number,
 *   status: 'compacted'|'missing_file'|'parse_error'|'dry_run'|'unchanged',
 *   error?: string
 * }}
 */
function compactCacheFile(filePath, options = {}) {
  const resolvedPath = path.resolve(filePath);
  const maxAgeMs = typeof options.maxAgeMs === 'number' && options.maxAgeMs > 0 ? options.maxAgeMs : null;
  const refTime = options.referenceTime ? new Date(options.referenceTime).getTime() : Date.now();
  const pruneNulls = options.pruneNulls !== false;
  const pruneEmptyObjects = options.pruneEmptyObjects !== false;
  const dryRun = Boolean(options.dryRun);

  if (!fs.existsSync(resolvedPath)) {
    return {
      path: resolvedPath,
      originalBytes: 0,
      compactedBytes: 0,
      entriesRemoved: 0,
      entriesRetained: 0,
      status: 'missing_file'
    };
  }

  let raw;
  try {
    raw = fs.readFileSync(resolvedPath, 'utf8');
  } catch (err) {
    return {
      path: resolvedPath,
      originalBytes: 0,
      compactedBytes: 0,
      entriesRemoved: 0,
      entriesRetained: 0,
      status: 'parse_error',
      error: `Failed to read file: ${err.message}`
    };
  }

  const originalBytes = Buffer.byteLength(raw, 'utf8');
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return {
      path: resolvedPath,
      originalBytes,
      compactedBytes: originalBytes,
      entriesRemoved: 0,
      entriesRetained: 0,
      status: 'parse_error',
      error: `JSON parse error: ${err.message}`
    };
  }

  let entriesRemoved = 0;
  let entriesRetained = 0;
  let compactedData;

  const cutoff = maxAgeMs !== null ? refTime - maxAgeMs : null;

  if (Array.isArray(parsed)) {
    compactedData = [];
    for (const item of parsed) {
      if (item === null || item === undefined) {
        if (pruneNulls) {
          entriesRemoved++;
          continue;
        }
      }
      if (pruneEmptyObjects && typeof item === 'object' && item !== null && !Array.isArray(item) && Object.keys(item).length === 0) {
        entriesRemoved++;
        continue;
      }
      if (cutoff !== null) {
        const itemTs = extractEntryTimestamp(item);
        if (itemTs !== null && itemTs < cutoff) {
          entriesRemoved++;
          continue;
        }
      }
      compactedData.push(item);
      entriesRetained++;
    }
  } else if (typeof parsed === 'object' && parsed !== null) {
    compactedData = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (value === null || value === undefined) {
        if (pruneNulls) {
          entriesRemoved++;
          continue;
        }
      }
      if (pruneEmptyObjects && typeof value === 'object' && value !== null && !Array.isArray(value) && Object.keys(value).length === 0) {
        entriesRemoved++;
        continue;
      }
      if (cutoff !== null) {
        const entryTs = extractEntryTimestamp(value);
        if (entryTs !== null && entryTs < cutoff) {
          entriesRemoved++;
          continue;
        }
      }
      compactedData[key] = value;
      entriesRetained++;
    }
  } else {
    // Non-collection primitive JSON (number, string, boolean)
    return {
      path: resolvedPath,
      originalBytes,
      compactedBytes: originalBytes,
      entriesRemoved: 0,
      entriesRetained: 1,
      status: 'unchanged'
    };
  }

  const outputString = JSON.stringify(compactedData, null, 2) + '\n';
  const compactedBytes = Buffer.byteLength(outputString, 'utf8');

  // Validate integrity by parsing output before any write
  try {
    JSON.parse(outputString);
  } catch (err) {
    return {
      path: resolvedPath,
      originalBytes,
      compactedBytes: originalBytes,
      entriesRemoved: 0,
      entriesRetained: entriesRemoved + entriesRetained,
      status: 'parse_error',
      error: `Compaction serialization verification failed: ${err.message}`
    };
  }

  if (dryRun) {
    return {
      path: resolvedPath,
      originalBytes,
      compactedBytes,
      entriesRemoved,
      entriesRetained,
      status: 'dry_run'
    };
  }

  // Atomic write to tmp file and rename
  const dir = path.dirname(resolvedPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const randomSuffix = crypto.randomBytes(4).toString('hex');
  const tmpPath = path.join(dir, `.${path.basename(resolvedPath)}.${process.pid}.${Date.now()}.${randomSuffix}.tmp`);

  try {
    fs.writeFileSync(tmpPath, outputString, 'utf8');

    // Verify temp file parse integrity
    const verifyContent = fs.readFileSync(tmpPath, 'utf8');
    JSON.parse(verifyContent);

    // Atomically replace destination
    fs.renameSync(tmpPath, resolvedPath);
  } catch (err) {
    try {
      if (fs.existsSync(tmpPath)) {
        fs.unlinkSync(tmpPath);
      }
    } catch {
      // Ignore cleanup error
    }
    return {
      path: resolvedPath,
      originalBytes,
      compactedBytes: originalBytes,
      entriesRemoved: 0,
      entriesRetained: entriesRetained + entriesRemoved,
      status: 'parse_error',
      error: `Atomic write failed: ${err.message}`
    };
  }

  return {
    path: resolvedPath,
    originalBytes,
    compactedBytes,
    entriesRemoved,
    entriesRetained,
    status: 'compacted'
  };
}

/**
 * Runs compaction across all specified or known JSON cache files in a directory.
 *
 * @param {string} [cacheDir] - Directory containing caches (defaults to .cache/)
 * @param {object} [options={}] - Options passed to compactCacheFile
 * @param {string[]} [options.targetFiles] - Custom list of filenames or paths to compact
 * @param {boolean} [options.scanAllJson=false] - Whether to scan and compact all .json in cacheDir
 * @returns {{
 *   cacheDir: string,
 *   filesProcessed: number,
 *   totalOriginalBytes: number,
 *   totalCompactedBytes: number,
 *   bytesSaved: number,
 *   totalEntriesRemoved: number,
 *   totalEntriesRetained: number,
 *   fileSummaries: Array<object>
 * }}
 */
function runFullCacheCompaction(cacheDir = DEFAULT_CACHE_DIR, options = {}) {
  const resolvedCacheDir = path.resolve(cacheDir);

  let targetFiles;
  if (Array.isArray(options.targetFiles) && options.targetFiles.length > 0) {
    targetFiles = options.targetFiles;
  } else if (options.scanAllJson) {
    if (fs.existsSync(resolvedCacheDir)) {
      targetFiles = fs.readdirSync(resolvedCacheDir).filter((f) => f.endsWith('.json') && !f.startsWith('.'));
    } else {
      targetFiles = [];
    }
  } else {
    targetFiles = DEFAULT_KNOWN_CACHE_FILES;
  }

  let totalOriginalBytes = 0;
  let totalCompactedBytes = 0;
  let totalEntriesRemoved = 0;
  let totalEntriesRetained = 0;
  let filesProcessed = 0;
  const fileSummaries = [];

  for (const fileName of targetFiles) {
    const fullPath = path.isAbsolute(fileName) ? fileName : path.resolve(resolvedCacheDir, fileName);
    const summary = compactCacheFile(fullPath, options);

    fileSummaries.push(summary);
    filesProcessed++;
    totalOriginalBytes += summary.originalBytes;
    totalCompactedBytes += summary.compactedBytes;
    totalEntriesRemoved += summary.entriesRemoved;
    totalEntriesRetained += summary.entriesRetained;
  }

  const bytesSaved = Math.max(0, totalOriginalBytes - totalCompactedBytes);

  return {
    cacheDir: resolvedCacheDir,
    filesProcessed,
    totalOriginalBytes,
    totalCompactedBytes,
    bytesSaved,
    totalEntriesRemoved,
    totalEntriesRetained,
    fileSummaries
  };
}

module.exports = {
  DEFAULT_KNOWN_CACHE_FILES,
  extractEntryTimestamp,
  compactCacheFile,
  runFullCacheCompaction
};
