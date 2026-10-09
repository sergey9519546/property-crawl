'use strict';

/**
 * Disaster Recovery & Store Snapshot Backup Utility
 *
 * Implements Task 20:
 * Creates atomic, compressed snapshot archives of JSON stores and cache data
 * with SHA-256 integrity validation and automated verification drills.
 */

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');

const DEFAULT_CACHE_DIR = path.resolve(__dirname, '../.cache');
const DEFAULT_BACKUP_DIR = path.resolve(DEFAULT_CACHE_DIR, 'backups');

const DEFAULT_BACKUP_TARGETS = [
  'live-listings.json',
  'observations.json',
  'document-reviews.json',
  'geocoding-cache.json',
  'saved-searches.json',
  'hpi-cache.json',
  'search-index.json'
];

function calculateSha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * Creates an atomic compressed snapshot archive.
 */
function createSnapshot(options = {}) {
  const sourceDir = path.resolve(options.sourceDir || DEFAULT_CACHE_DIR);
  const backupDir = path.resolve(options.outputDir || DEFAULT_BACKUP_DIR);
  const targets = options.targets || DEFAULT_BACKUP_TARGETS;

  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  const manifest = {
    version: '1.0.0',
    createdAt: Date.now(),
    isoDate: new Date().toISOString(),
    files: {},
    totalBytes: 0,
    fileCount: 0
  };

  const filesPayload = {};

  for (const relPath of targets) {
    const fullPath = path.join(sourceDir, relPath);
    if (fs.existsSync(fullPath)) {
      const stat = fs.statSync(fullPath);
      if (stat.isFile()) {
        const content = fs.readFileSync(fullPath);
        const sha256 = calculateSha256(content);
        manifest.files[relPath] = {
          size: content.length,
          sha256,
          mtime: stat.mtimeMs
        };
        manifest.totalBytes += content.length;
        manifest.fileCount += 1;
        filesPayload[relPath] = content.toString('base64');
      }
    }
  }

  const archiveData = {
    manifest,
    files: filesPayload
  };

  const jsonString = JSON.stringify(archiveData);
  const compressed = zlib.gzipSync(Buffer.from(jsonString, 'utf-8'));

  const tsString = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = options.filename || `snapshot-${tsString}.tar.gz`;
  const tempPath = path.join(backupDir, `${filename}.tmp-${Date.now()}`);
  const finalPath = path.join(backupDir, filename);

  fs.writeFileSync(tempPath, compressed);
  fs.renameSync(tempPath, finalPath);

  return {
    snapshotPath: finalPath,
    filename,
    manifest
  };
}

/**
 * Verifies the integrity of a snapshot archive.
 */
function verifySnapshot(snapshotPath) {
  const fullPath = path.resolve(snapshotPath);
  if (!fs.existsSync(fullPath)) {
    return { valid: false, errors: [`Snapshot file does not exist: ${fullPath}`] };
  }

  try {
    const compressed = fs.readFileSync(fullPath);
    const decompressed = zlib.gunzipSync(compressed);
    const parsed = JSON.parse(decompressed.toString('utf-8'));

    const errors = [];
    if (!parsed.manifest || !parsed.files) {
      errors.push('Archive payload missing manifest or files object');
      return { valid: false, errors };
    }

    const manifestFiles = parsed.manifest.files || {};
    for (const [relPath, meta] of Object.entries(manifestFiles)) {
      const base64Content = parsed.files[relPath];
      if (!base64Content) {
        errors.push(`Manifest declared file missing from archive: ${relPath}`);
        continue;
      }
      const fileBuffer = Buffer.from(base64Content, 'base64');
      const actualSha256 = calculateSha256(fileBuffer);
      if (actualSha256 !== meta.sha256) {
        errors.push(`Checksum mismatch for ${relPath}: expected ${meta.sha256}, got ${actualSha256}`);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      manifest: parsed.manifest
    };
  } catch (err) {
    return { valid: false, errors: [`Failed to unpack or parse archive: ${err.message}`] };
  }
}

/**
 * Restores a snapshot archive into a target directory.
 */
function restoreSnapshot(snapshotPath, targetDir = DEFAULT_CACHE_DIR) {
  const verification = verifySnapshot(snapshotPath);
  if (!verification.valid) {
    throw new Error(`Cannot restore corrupted snapshot: ${verification.errors.join('; ')}`);
  }

  const destination = path.resolve(targetDir);
  if (!fs.existsSync(destination)) {
    fs.mkdirSync(destination, { recursive: true });
  }

  const compressed = fs.readFileSync(snapshotPath);
  const decompressed = zlib.gunzipSync(compressed);
  const parsed = JSON.parse(decompressed.toString('utf-8'));

  let restoredCount = 0;
  for (const [relPath, base64Content] of Object.entries(parsed.files)) {
    const outPath = path.join(destination, relPath);
    const parentDir = path.dirname(outPath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }

    const fileBuffer = Buffer.from(base64Content, 'base64');
    const tempOut = `${outPath}.restore-tmp-${Date.now()}`;
    fs.writeFileSync(tempOut, fileBuffer);
    fs.renameSync(tempOut, outPath);
    restoredCount += 1;
  }

  return {
    restoredCount,
    targetDir: destination,
    manifest: verification.manifest
  };
}

// CLI Execution
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.includes('--verify')) {
    const targetIdx = args.indexOf('--verify') + 1;
    const file = args[targetIdx];
    if (!file) {
      console.error('Usage: node scripts/db-backup.js --verify <snapshot-file>');
      process.exit(1);
    }
    const result = verifySnapshot(file);
    if (result.valid) {
      console.log(`[OK] Snapshot valid: ${file} (${result.manifest.fileCount} files)`);
      process.exit(0);
    } else {
      console.error(`[ERROR] Snapshot corrupted:\n${result.errors.join('\n')}`);
      process.exit(1);
    }
  } else if (args.includes('--restore')) {
    const targetIdx = args.indexOf('--restore') + 1;
    const file = args[targetIdx];
    if (!file) {
      console.error('Usage: node scripts/db-backup.js --restore <snapshot-file> [--target <dir>]');
      process.exit(1);
    }
    const targetDirIdx = args.indexOf('--target') + 1;
    const dest = targetDirIdx > 0 ? args[targetDirIdx] : DEFAULT_CACHE_DIR;
    const result = restoreSnapshot(file, dest);
    console.log(`[OK] Successfully restored ${result.restoredCount} files to ${result.targetDir}`);
  } else {
    const result = createSnapshot();
    console.log(`[OK] Snapshot created: ${result.snapshotPath} (${result.manifest.fileCount} files, ${result.manifest.totalBytes} bytes)`);
  }
}

module.exports = {
  createSnapshot,
  verifySnapshot,
  restoreSnapshot,
  calculateSha256,
  DEFAULT_BACKUP_TARGETS
};
