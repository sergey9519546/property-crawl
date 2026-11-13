'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const TRANSIENT_LOCK_CODES = new Set(['55P03', '40P01']);

function isTransientLockError(error) {
  if (!error) return false;
  if (TRANSIENT_LOCK_CODES.has(error.code)) return true;
  const msg = String(error.message || '');
  return /lock timeout|lock_not_available|deadlock detected/i.test(msg);
}

function normalizeLockTimeout(value) {
  const raw = String(value || '').trim();
  return /^\d+(?:ms|s|min)$/.test(raw) ? raw : '30s';
}

async function acquireMigrationLock(client) {
  try {
    await client.query('SELECT pg_advisory_lock(72463198)');
    return;
  } catch (lockErr) {
    if (!isTransientLockError(lockErr)) throw lockErr;
  }

  // Inspect whether an orphaned Supavisor/deploy session is stranded holding 72463198.
  try {
    const blockers = await client.query(
      `SELECT a.pid,
              a.usename,
              a.state,
              EXTRACT(EPOCH FROM (now() - COALESCE(a.query_start, a.state_change, a.backend_start)))::int AS age_s,
              left(COALESCE(a.query, ''), 120) AS query_snippet
         FROM pg_locks l
         JOIN pg_stat_activity a ON a.pid = l.pid
        WHERE l.locktype = 'advisory'
          AND (l.objid = 72463198 OR l.classid = 72463198)
          AND a.pid <> pg_backend_pid()
          AND a.usename = current_user`,
    );
    for (const row of blockers.rows) {
      const ageS = Number(row.age_s || 0);
      const isIdle = /idle/i.test(String(row.state || ''));
      console.warn(`[migrate] advisory lock 72463198 held by pid=${row.pid} state=${row.state} age=${ageS}s query=${row.query_snippet}`);
      if ((isIdle && ageS >= 15) || ageS >= 120) {
        await client.query('SELECT pg_terminate_backend($1)', [row.pid]).catch(() => {});
        console.warn(`[migrate] terminated stale migration lock holder pid=${row.pid}`);
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  } catch (_) {
    // Non-Postgres engines (PGlite) or restricted roles fall through cleanly to final lock attempt.
  }

  await client.query('SELECT pg_advisory_lock(72463198)');
}

async function migrate(pool, options = {}) {
  const client = await pool.connect();
  const migrationLockTimeout = normalizeLockTimeout(
    options.lockTimeout ?? process.env.DISCOVERY_MIGRATION_LOCK_TIMEOUT ?? '30s',
  );
  const rawAttempts = Number(options.maxLockAttempts ?? process.env.DISCOVERY_MIGRATION_LOCK_ATTEMPTS ?? 4);
  const maxLockAttempts = Number.isFinite(rawAttempts) && rawAttempts >= 1 ? Math.floor(rawAttempts) : 4;
  const rawDelay = Number(options.retryDelayMs ?? 1500);
  const retryDelayMs = Number.isFinite(rawDelay) && rawDelay >= 0 ? rawDelay : 1500;
  const statementTimeoutMs = Number(options.statementTimeoutMs);
  const statementTimeoutSetting = Number.isFinite(statementTimeoutMs) && statementTimeoutMs > 0 ? String(Math.trunc(statementTimeoutMs)) : null;
  let migrationLockTimeoutSet = false;
  let destroyConnection = false;

  try {
    // A held advisory lock used to hang boot indefinitely (the deploy then
    // failed its health check while blocked). Fail fast or recover stranded
    // lock holders from crashed rolling deploys instead.
    await client.query("SET lock_timeout = '15s'");
    await acquireMigrationLock(client);
    await client.query('CREATE TABLE IF NOT EXISTS discovery_schema_migrations(name text PRIMARY KEY, sha256 text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
    const directory = path.resolve(__dirname, '../server/db/migrations');
    const base = await client.query("SELECT to_regclass('public.listings') AS relation");
    if (!base.rows[0].relation) await client.query(fs.readFileSync(path.resolve(__dirname, '../server/db/schema.sql'), 'utf8'));
    for (const name of fs.readdirSync(directory).filter(n => /^\d+.*\.sql$/.test(n)).sort()) {
      const sql = fs.readFileSync(path.join(directory, name), 'utf8');
      const digest = crypto.createHash('sha256').update(sql).digest('hex');
      const found = await client.query('SELECT sha256 FROM discovery_schema_migrations WHERE name=$1', [name]);
      if (found.rows.length) {
        if (found.rows[0].sha256 !== digest) {
          // The file changed after it was applied (an in-place edit of an
          // already-applied migration). Re-running its SQL would be unsafe, but
          // aborting wedges every later migration permanently: production
          // recorded `024_materialized_views_and_spatial.sql`, the file was then
          // edited twice (0f9bcc8, 51e034c), and 025-027 could never apply —
          // the listings column and observation tables were missing on a live
          // deploy. Re-record the digest and continue; the applied SQL stays
          // exactly as it ran.
          console.warn(`[migrate] previously applied migration changed; re-recording digest: ${name}`);
          await client.query('UPDATE discovery_schema_migrations SET sha256=$1 WHERE name=$2', [digest, name]);
        }
        continue;
      }

      if (!migrationLockTimeoutSet) {
        await client.query(`SET lock_timeout = '${migrationLockTimeout}'`);
        migrationLockTimeoutSet = true;
      }

      for (let attempt = 1; attempt <= maxLockAttempts; attempt += 1) {
        const startedAt = Date.now();
        if (process.env.NODE_ENV !== 'test') {
          console.log(`[migrate] applying ${name} (attempt ${attempt}/${maxLockAttempts})...`);
        }
        await client.query('BEGIN');
        try {
          await client.query(statementTimeoutSetting ? `SET LOCAL statement_timeout = '${statementTimeoutSetting}'` : "SET LOCAL statement_timeout = '0'");
          await client.query(sql);
          await client.query('INSERT INTO discovery_schema_migrations(name,sha256) VALUES($1,$2)', [name, digest]);
          await client.query('COMMIT');
          if (process.env.NODE_ENV !== 'test') {
            console.log(`[migrate] applied ${name} in ${Date.now() - startedAt}ms`);
          }
          break;
        } catch (error) {
          await client.query('ROLLBACK').catch(() => {});
          if (attempt < maxLockAttempts && isTransientLockError(error)) {
            console.warn(
              `[migrate] ${name}: transient lock conflict (attempt ${attempt}/${maxLockAttempts}): ${error.message}; retrying...`,
            );
            if (retryDelayMs > 0) {
              await new Promise((resolve) => setTimeout(resolve, retryDelayMs * attempt));
            }
            continue;
          }
          // Name the file: a bare Postgres error ('column X does not exist')
          // without the migration name once cost a deploy outage.
          error.message = `${name}: ${error.message}`;
          throw error;
        }
      }
    }
  } finally {
    try { await client.query('RESET lock_timeout'); } catch (_) { destroyConnection = true; }
    try { await client.query('SELECT pg_advisory_unlock(72463198)'); } catch (_) { destroyConnection = true; }
    client.release(destroyConnection ? new Error('Migration session cleanup required socket reset') : undefined);
  }
}
function migrationTarget(env = process.env) {
  return require('../server/db/database-target').resolveDatabaseTarget(env);
}

async function openConfiguredPool(env = process.env) {
  const { databaseTargetReason } = require('../server/db/database-target');
  const target = migrationTarget(env);
  const reason = databaseTargetReason(env);
  if (reason) console.log(reason);
  if (target === 'embedded') {
    const { startEmbeddedPostgres } = require('../server/db/pglite-pool');
    const started = await startEmbeddedPostgres({ log: console.log });
    return started.pool;
  }
  if (target !== 'tcp') {
    const error = new Error('DATABASE_URL is required for discovery migrations');
    error.code = 'DISCOVERY_DATABASE_MISSING';
    throw error;
  }
  const { Pool } = require('pg');
  return new Pool({ connectionString: env.DATABASE_URL });
}

if (require.main === module) {
  const target = migrationTarget();
  if (target === 'missing') {
    console.error('DATABASE_URL is required for discovery migrations');
    process.exitCode = 1;
  } else {
    openConfiguredPool()
      .then(async (pool) => {
        try {
          await migrate(pool);
          console.log(target === 'embedded'
            ? 'Discovery migrations applied to the embedded database'
            : 'Discovery migrations applied');
        } finally {
          await pool.end();
        }
      })
      .catch((error) => { console.error(error.message); process.exitCode = 1; });
  }
}
module.exports = { migrate, migrationTarget, openConfiguredPool, isTransientLockError };
