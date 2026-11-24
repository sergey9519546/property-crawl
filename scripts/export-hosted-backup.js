'use strict';

/**
 * Hosted Database Backup Utility
 *
 * Exports a verified, custom-format PostgreSQL dump from the hosted database
 * into the private, ignored `.secrets/hosted-backups/` directory, verifies
 * SHA-256 and archive contents via `pg_restore --list`, and optionally uploads
 * both the dump and manifest to Cloudflare R2 (`--upload-r2`).
 */

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createR2SignedHeaders } = require('../server/storage/document-vault');

const ROOT = path.resolve(__dirname, '..');
const BACKUP_DIR = path.join(ROOT, '.secrets', 'hosted-backups');
const DEFAULT_PREFIX = 'property-crawl-pg';
const isWin = process.platform === 'win32';
const exeSuffix = isWin ? '.exe' : '';

function findPgBinary(name) {
  const binaryName = `${name}${exeSuffix}`;
  const localCacheBin = path.join(ROOT, '.cache', 'postgresql-client', 'pgsql', 'bin', binaryName);
  if (fs.existsSync(localCacheBin)) return localCacheBin;

  const probe = spawnSync(isWin ? 'where.exe' : 'which', [binaryName]);
  if (probe.status === 0) {
    const found = probe.stdout.toString().split('\n')[0].trim();
    if (found && fs.existsSync(found)) return found;
  }
  return localCacheBin;
}

const PG_DUMP = findPgBinary('pg_dump');
const PG_RESTORE = findPgBinary('pg_restore');

function parseDbTarget(env = process.env) {
  const connStr = env.DATABASE_DIRECT_URL || env.DATABASE_URL || env.DISCOVERY_DATABASE_URL || '';
  if (connStr) {
    try {
      const parsed = new URL(connStr);
      return {
        host: parsed.hostname,
        port: parsed.port || '5432',
        user: decodeURIComponent(parsed.username || 'postgres'),
        database: parsed.pathname.replace(/^\//, '') || 'postgres',
        password: decodeURIComponent(parsed.password || ''),
      };
    } catch {
      // Fall through to discrete PG* env vars
    }
  }
  const host = env.PGHOST;
  const port = env.PGPORT || '5432';
  const user = env.PGUSER || 'postgres';
  const database = env.PGDATABASE || 'postgres';
  const password = env.PGPASSWORD;

  if (!host || !password) {
    throw new Error('Database export failed: DATABASE_DIRECT_URL / DATABASE_URL (or PGHOST + PGPASSWORD) is required.');
  }

  return { host, port, user, database, password };
}

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  const buffer = fs.readFileSync(filePath);
  hash.update(buffer);
  return hash.digest('hex');
}

function sha256Buffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function resolveBackupDateStr({ manifest, dumpFilePath } = {}) {
  if (manifest && typeof manifest.createdAt === 'string' && /^\d{4}-\d{2}-\d{2}/.test(manifest.createdAt)) {
    return manifest.createdAt.slice(0, 10);
  }
  if (typeof dumpFilePath === 'string') {
    const match = path.basename(dumpFilePath).match(/(\d{4}-\d{2}-\d{2})\.dump$/);
    if (match) return match[1];
  }
  return new Date().toISOString().slice(0, 10);
}

async function putR2Object({
  url,
  body,
  contentType,
  payloadSha256,
  accessKeyId,
  secretAccessKey,
  region,
  fetchImpl,
}) {
  const headers = createR2SignedHeaders({
    method: 'PUT',
    url,
    accessKeyId,
    secretAccessKey,
    region,
    payloadSha256,
    headers: {
      'content-type': contentType,
      'content-length': String(body.length),
    },
  });

  const res = await fetchImpl(url, {
    method: 'PUT',
    headers,
    body,
  });

  if (!res || !res.ok) {
    let detail = '';
    if (res && typeof res.text === 'function') {
      try {
        detail = (await res.text()).slice(0, 300);
      } catch {
        detail = '';
      }
    }
    const status = res ? `HTTP ${res.status}` : 'no response';
    throw new Error(`R2 PUT failed (${status}) for ${url}${detail ? `: ${detail}` : ''}`);
  }

  return res;
}

async function uploadBackupToR2({
  dumpFilePath,
  manifestPath,
  manifest,
  env = process.env,
  fetchImpl = globalThis.fetch,
  keyPrefix = 'backups/postgres',
} = {}) {
  const bucket = String(env?.R2_BUCKET || '').trim();
  const accessKeyId = String(env?.R2_ACCESS_KEY_ID || '').trim();
  const secretAccessKey = String(env?.R2_SECRET_ACCESS_KEY || '').trim();
  const endpoint = String(env?.R2_ENDPOINT || '').trim().replace(/\/+$/, '');

  if (!bucket || !accessKeyId || !secretAccessKey || !endpoint) {
    const missing = [
      !bucket && 'R2_BUCKET',
      !accessKeyId && 'R2_ACCESS_KEY_ID',
      !secretAccessKey && 'R2_SECRET_ACCESS_KEY',
      !endpoint && 'R2_ENDPOINT',
    ].filter(Boolean);
    const err = new Error(`R2 backup upload requires credentials: missing ${missing.join(', ')}`);
    err.code = 'R2_CREDENTIALS_UNSET';
    throw err;
  }

  if (typeof fetchImpl !== 'function') {
    throw new Error('R2 backup upload requires a valid fetchImpl function');
  }
  if (!dumpFilePath || !fs.existsSync(dumpFilePath)) {
    throw new Error(`Dump archive not found at ${dumpFilePath}`);
  }
  if (!manifestPath || !fs.existsSync(manifestPath)) {
    throw new Error(`Backup manifest not found at ${manifestPath}`);
  }

  const resolvedManifest = manifest || JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const dateStr = resolveBackupDateStr({ manifest: resolvedManifest, dumpFilePath });
  const cleanPrefix = String(keyPrefix || 'backups/postgres').replace(/^\/+|\/+$/g, '');
  const region = String(env?.R2_REGION || env?.AWS_REGION || 'auto').trim() || 'auto';

  const dumpFilename = path.basename(dumpFilePath);
  const manifestFilename = path.basename(manifestPath);
  const dumpKey = `${cleanPrefix}/${dateStr}/${dumpFilename}`;
  const manifestKey = `${cleanPrefix}/${dateStr}/${manifestFilename}`;

  const dumpBuffer = fs.readFileSync(dumpFilePath);
  const dumpSha256 = sha256Buffer(dumpBuffer);
  const manifestBuffer = fs.readFileSync(manifestPath);
  const manifestSha256 = sha256Buffer(manifestBuffer);

  const dumpUrl = `${endpoint}/${bucket}/${dumpKey}`;
  const manifestUrl = `${endpoint}/${bucket}/${manifestKey}`;

  await putR2Object({
    url: dumpUrl,
    body: dumpBuffer,
    contentType: 'application/octet-stream',
    payloadSha256: dumpSha256,
    accessKeyId,
    secretAccessKey,
    region,
    fetchImpl,
  });

  await putR2Object({
    url: manifestUrl,
    body: manifestBuffer,
    contentType: 'application/json',
    payloadSha256: manifestSha256,
    accessKeyId,
    secretAccessKey,
    region,
    fetchImpl,
  });

  return {
    uploaded: true,
    bucket,
    dumpKey,
    manifestKey,
    dumpBytes: dumpBuffer.length,
    sha256: dumpSha256,
  };
}

function parseCliArgs(argv = process.argv.slice(2)) {
  const options = {
    prefix: DEFAULT_PREFIX,
    uploadR2: false,
    keyPrefix: 'backups/postgres',
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--upload-r2') {
      options.uploadR2 = true;
    } else if (arg.startsWith('--prefix=')) {
      const val = arg.slice('--prefix='.length).trim();
      if (val) options.prefix = val;
    } else if (arg === '--prefix' && argv[i + 1]) {
      options.prefix = String(argv[i + 1]).trim();
      i += 1;
    } else if (arg.startsWith('--key-prefix=')) {
      const val = arg.slice('--key-prefix='.length).trim();
      if (val) options.keyPrefix = val;
    }
  }

  return options;
}

async function exportBackup(options = {}) {
  const env = options.env || process.env;
  const prefix = String(options.prefix || DEFAULT_PREFIX).trim() || DEFAULT_PREFIX;
  const backupDir = options.backupDir || BACKUP_DIR;
  const uploadR2 = Boolean(options.uploadR2);

  if (!fs.existsSync(PG_DUMP)) {
    throw new Error(`pg_dump not found at ${PG_DUMP}`);
  }
  if (!fs.existsSync(PG_RESTORE)) {
    throw new Error(`pg_restore not found at ${PG_RESTORE}`);
  }

  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  const db = parseDbTarget(env);
  const dateStr = new Date().toISOString().slice(0, 10);
  const dumpFilename = `${prefix}-${dateStr}.dump`;
  const dumpFilePath = path.join(backupDir, dumpFilename);

  console.log(`[Backup] Exporting hosted database from ${db.host} to ${dumpFilePath}...`);

  const binDir = path.dirname(PG_DUMP);
  const dumpEnv = {
    ...env,
    PGPASSWORD: db.password,
    PGSSLMODE: env.PGSSLMODE || 'require',
    PATH: [binDir, env.PATH || ''].filter(Boolean).join(path.delimiter),
  };

  const dumpArgs = [
    '-h', db.host,
    '-p', db.port,
    '-U', db.user,
    '-d', db.database,
    '-Fc',
    '--no-owner',
    '--no-privileges',
    '-f', dumpFilePath,
  ];

  const startTime = Date.now();
  const dumpResult = spawnSync(PG_DUMP, dumpArgs, { env: dumpEnv, maxBuffer: 128 * 1024 * 1024 });

  if (dumpResult.status !== 0) {
    throw new Error(`pg_dump failed: ${dumpResult.stderr.toString().trim()}`);
  }

  const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);
  const stat = fs.statSync(dumpFilePath);
  const sha256 = sha256File(dumpFilePath);

  console.log(`[Backup] Dump completed in ${elapsedSec}s: ${(stat.size / 1024 / 1024).toFixed(2)} MB`);
  console.log(`[Backup] SHA-256: ${sha256}`);

  console.log('[Backup] Verifying dump with pg_restore --list...');
  const restoreArgs = ['--list', dumpFilePath];
  const restoreResult = spawnSync(PG_RESTORE, restoreArgs, { env: dumpEnv, maxBuffer: 64 * 1024 * 1024 });

  if (restoreResult.status !== 0) {
    throw new Error(`pg_restore verification failed: ${restoreResult.stderr.toString().trim()}`);
  }

  const restoreOutput = restoreResult.stdout.toString();
  const tableEntries = restoreOutput.split('\n').filter(line => line.includes('TABLE DATA')).map(line => line.trim());

  console.log(`[Backup] Verified valid archive. Found ${tableEntries.length} table data entries.`);

  const manifest = {
    version: 1,
    createdAt: new Date().toISOString(),
    source: {
      host: db.host,
      database: db.database,
      user: db.user,
      port: db.port,
    },
    archive: {
      filename: dumpFilename,
      bytes: stat.size,
      sha256,
      format: 'custom',
    },
    tables: tableEntries,
  };

  const manifestPath = path.join(backupDir, `${prefix}-${dateStr}.manifest.json`);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

  console.log(`[Backup] Manifest written to ${manifestPath}`);

  let r2 = null;
  if (uploadR2) {
    console.log('[Backup] Uploading verified dump and manifest to Cloudflare R2...');
    r2 = await uploadBackupToR2({
      dumpFilePath,
      manifestPath,
      manifest,
      env,
      fetchImpl: options.fetchImpl,
      keyPrefix: options.keyPrefix,
    });
    console.log(`[Backup] Uploaded to R2 bucket "${r2.bucket}": ${r2.dumpKey} (${r2.dumpBytes} bytes)`);
  }

  console.log('[Backup] SUCCESS. Hosted PostgreSQL backup verified and archived.');
  return { dumpFilePath, manifestPath, manifest, r2 };
}

if (require.main === module) {
  const cliOptions = parseCliArgs(process.argv.slice(2));
  exportBackup(cliOptions).catch(err => {
    console.error('[Backup] Unhandled error:', err && err.message ? err.message : err);
    process.exit(1);
  });
}

module.exports = {
  parseDbTarget,
  sha256File,
  uploadBackupToR2,
  exportBackup,
};
