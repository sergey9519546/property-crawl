'use strict';

const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function resolvePgPool(options = {}) {
  if (options.pool && typeof options.pool.query === 'function') return options.pool;
  const candidate = options.db || require('../db/client');
  if (candidate && candidate.isPg && candidate.pool && typeof candidate.pool.query === 'function') {
    return candidate.pool;
  }
  return null;
}

async function getDurableCache(namespace, cacheKey, options = {}) {
  if (!namespace || !cacheKey) return null;
  const pool = resolvePgPool(options);
  if (!pool) return null;
  try {
    const res = await pool.query(
      `SELECT payload
         FROM durable_kv_cache
        WHERE namespace = $1
          AND cache_key = $2
          AND expires_at > NOW()
        LIMIT 1`,
      [String(namespace).slice(0, 64), String(cacheKey)],
    );
    return res.rows?.[0]?.payload ?? null;
  } catch {
    return null;
  }
}

async function setDurableCache(namespace, cacheKey, payload, options = {}) {
  if (!namespace || !cacheKey || payload === undefined) return false;
  const pool = resolvePgPool(options);
  if (!pool) return false;
  const ttlMs = Number.isFinite(Number(options.ttlMs)) && Number(options.ttlMs) > 0
    ? Math.trunc(Number(options.ttlMs))
    : DEFAULT_TTL_MS;
  try {
    await pool.query(
      `INSERT INTO durable_kv_cache (namespace, cache_key, payload, expires_at, updated_at)
       VALUES ($1, $2, $3::jsonb, NOW() + ($4::bigint * INTERVAL '1 millisecond'), NOW())
       ON CONFLICT (namespace, cache_key) DO UPDATE SET
         payload = EXCLUDED.payload,
         expires_at = EXCLUDED.expires_at,
         updated_at = NOW()`,
      [String(namespace).slice(0, 64), String(cacheKey), JSON.stringify(payload), ttlMs],
    );
    return true;
  } catch {
    return false;
  }
}

async function pruneDurableCache(options = {}) {
  const pool = resolvePgPool(options);
  if (!pool) return 0;
  try {
    const res = await pool.query('DELETE FROM durable_kv_cache WHERE expires_at < NOW()');
    return res.rowCount || 0;
  } catch {
    return 0;
  }
}

module.exports = {
  DEFAULT_TTL_MS,
  getDurableCache,
  setDurableCache,
  pruneDurableCache,
};
