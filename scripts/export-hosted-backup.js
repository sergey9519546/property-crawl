'use strict';

/**
 * Hosted Database Backup Utility
 *
 * Exports a verified, custom-format PostgreSQL dump from the hosted database
 * into the private, ignored `.secrets/hosted-backups/` directory.
 * Verifies SHA-256 and archive contents via `pg_restore --list`.
 */

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');
const BACKUP_DIR = path.join(ROOT, '.secrets', 'hosted-backups');
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

function parseDbTarget() {
  const connStr = process.env.DATABASE_URL || process.env.DISCOVERY_DATABASE_URL || '';
  if (connStr) {
    try {
      const parsed = new URL(connStr);
      return {
        host: parsed.hostname,
        port: parsed.port || '5432',
        user: decodeURIComponent(parsed.username || 'postgres'),
        database: parsed.pathname.replace(/^\//, '') || 'postgres',
        password: decodeURIComponent(parsed.password || '')
      };
    } catch {
      // Fall through to env vars
    }
  }
  const host = process.env.PGHOST || 'dpg-dbbc8su7bikc73819uo0-a.oregon-postgres.render.com';
  const port = process.env.PGPORT || '5432';
  const user = process.env.PGUSER || 'property_crawl_db_user';
  const database = process.env.PGDATABASE || 'property_crawl_db';
  const password = process.env.PGPASSWORD;

  if (!password) {
    throw new Error('Database export failed: PGPASSWORD environment variable is required and must not be hardcoded.');
  }

  return { host, port, user, database, password };
}

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  const buffer = fs.readFileSync(filePath);
  hash.update(buffer);
  return hash.digest('hex');
}

async function exportBackup() {
  if (!fs.existsSync(PG_DUMP)) {
    throw new Error(`pg_dump not found at ${PG_DUMP}`);
  }
  if (!fs.existsSync(PG_RESTORE)) {
    throw new Error(`pg_restore not found at ${PG_RESTORE}`);
  }

  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }

  const db = parseDbTarget();
  const dateStr = new Date().toISOString().slice(0, 10);
  const dumpFilename = `property-crawl-render-${dateStr}.dump`;
  const dumpFilePath = path.join(BACKUP_DIR, dumpFilename);

  console.log(`[Backup] Exporting hosted database from ${db.host} to ${dumpFilePath}...`);

  const binDir = path.dirname(PG_DUMP);
  const dumpEnv = {
    ...process.env,
    PGPASSWORD: db.password,
    PGSSLMODE: 'require',
    PATH: `${binDir};${process.env.PATH || ''}`
  };

  const dumpArgs = [
    '-h', db.host,
    '-p', db.port,
    '-U', db.user,
    '-d', db.database,
    '-Fc',
    '--no-owner',
    '--no-privileges',
    '-f', dumpFilePath
  ];

  const startTime = Date.now();
  const dumpResult = spawnSync(PG_DUMP, dumpArgs, { env: dumpEnv, maxBuffer: 128 * 1024 * 1024 });

  if (dumpResult.status !== 0) {
    console.error('[Backup] pg_dump failed:', dumpResult.stderr.toString());
    process.exit(1);
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
    console.error('[Backup] pg_restore verification failed:', restoreResult.stderr.toString());
    process.exit(1);
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
      port: db.port
    },
    archive: {
      filename: dumpFilename,
      bytes: stat.size,
      sha256,
      format: 'custom'
    },
    tables: tableEntries
  };

  const manifestPath = path.join(BACKUP_DIR, `property-crawl-render-${dateStr}.manifest.json`);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

  console.log(`[Backup] Manifest written to ${manifestPath}`);
  console.log('[Backup] SUCCESS. Database backup is safely archived off-host before Nov 19 free Render expiry.');
}

exportBackup().catch(err => {
  console.error('[Backup] Unhandled error:', err);
  process.exit(1);
});
