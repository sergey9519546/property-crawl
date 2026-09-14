'use strict';

const DEFAULT_WAVE = 'wave1';
const { DEFAULT_MAX_AGE_SECONDS, workerHealthStatus } = require('../server/discovery/worker-health');
const MIN_MAX_AGE_SECONDS = 330;
const MAX_MAX_AGE_SECONDS = 3600;

function workerKey(value) {
  const key = String(value || DEFAULT_WAVE).trim();
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(key)) throw new Error('DISCOVERY_WAVE must be a simple 1-64 character worker key');
  return key;
}

function maxAgeSeconds(value) {
  if (value === undefined || value === null || value === '') return DEFAULT_MAX_AGE_SECONDS;
  const seconds = Number(value);
  if (!Number.isInteger(seconds) || seconds < MIN_MAX_AGE_SECONDS || seconds > MAX_MAX_AGE_SECONDS) {
    throw new Error(`DISCOVERY_WORKER_MAX_AGE_SECONDS must be an integer from ${MIN_MAX_AGE_SECONDS} to ${MAX_MAX_AGE_SECONDS}`);
  }
  return seconds;
}

async function probe({ pool, wave = DEFAULT_WAVE, maxAge = DEFAULT_MAX_AGE_SECONDS, now = Date.now() } = {}) {
  const key = workerKey(wave);
  const boundedMaxAge = maxAgeSeconds(maxAge);
  if (!pool || typeof pool.query !== 'function') {
    return { ok: false, status: 'database_unavailable', wave: key, maxAgeSeconds: boundedMaxAge };
  }
  try {
    const result = await pool.query(
      'SELECT worker_key, last_seen_at, last_loop_status, current_job_id FROM discovery_worker_health WHERE worker_key=$1',
      [key]
    );
    const row = result.rows[0];
    if (!row) return { ok: false, status: 'not_started', wave: key, maxAgeSeconds: boundedMaxAge };
    const lastSeenMs = Date.parse(row.last_seen_at);
    const ageSeconds = Number.isFinite(lastSeenMs) ? Math.max(0, Math.floor((Number(now) - lastSeenMs) / 1000)) : null;
    const diagnostic = {
      wave: key,
      maxAgeSeconds: boundedMaxAge,
      lastSeenAt: Number.isFinite(lastSeenMs) ? new Date(lastSeenMs).toISOString() : null,
      ageSeconds,
      lastLoopStatus: row.last_loop_status || null,
      currentJobId: row.current_job_id || null,
    };
    const status = workerHealthStatus(row, Number(now), boundedMaxAge);
    return { ok: status === 'healthy', status, ...diagnostic };
  } catch (_) {
    return { ok: false, status: 'database_unavailable', wave: key, maxAgeSeconds: boundedMaxAge };
  }
}

async function main({ env = process.env, logger = console, Pool, now } = {}) {
  let pool;
  try {
    const wave = workerKey(env.DISCOVERY_WAVE || DEFAULT_WAVE);
    const maxAge = maxAgeSeconds(env.DISCOVERY_WORKER_MAX_AGE_SECONDS);
    if (!env.DATABASE_URL) {
      const result = await probe({ wave, maxAge, now });
      logger.log(JSON.stringify(result));
      return result;
    }
    const PoolClass = Pool || require('pg').Pool;
    pool = new PoolClass({
      connectionString: env.DATABASE_URL,
      max: 1,
      connectionTimeoutMillis: 5000,
      query_timeout: 5000,
      statement_timeout: 5000,
    });
    const result = await probe({ pool, wave, maxAge, now });
    logger.log(JSON.stringify(result));
    return result;
  } finally {
    if (pool) await pool.end();
  }
}

if (require.main === module) {
  main().then(result => { if (!result.ok) process.exitCode = 1; }).catch(() => {
    console.error(JSON.stringify({ ok: false, status: 'invalid_configuration' }));
    process.exitCode = 1;
  });
}

module.exports = { DEFAULT_MAX_AGE_SECONDS, MAX_MAX_AGE_SECONDS, MIN_MAX_AGE_SECONDS, main, maxAgeSeconds, probe, workerKey };
