'use strict';

/**
 * Token Bucket Rate Limiter with Trusted Proxy Count & Shared Multi-Isolate Stores
 *
 * Implements Task 19 & BE-08:
 * - Provides tiered token bucket rate limiting with safe client IP extraction
 *   via `TRUSTED_PROXY_COUNT` to defeat `X-Forwarded-For` spoofing.
 * - Supports async shared backing stores for multi-isolate / serverless deployments:
 *   1) Upstash Redis REST / Vercel KV (`UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`
 *      or `KV_REST_API_URL` + `KV_REST_API_TOKEN`)
 *   2) PostgreSQL shared bucket table (`PgRateLimitStore` via injected `database` / `pool`)
 *   3) Custom injected async store (e.g., `MemorySharedRateLimitStore` for tests)
 * - Deterministically fails open to a bounded in-memory token bucket when no
 *   shared store is configured or when a remote store experiences transient errors.
 * - Preserves synchronous `consume()` and `middleware()` compatibility.
 */

const DEFAULT_MAX_BUCKETS = 10000;
const DEFAULT_STORE_TIMEOUT_MS = 1500;
const DEFAULT_PG_TABLE = 'api_rate_limit_buckets';
const ERROR_LOG_THROTTLE_MS = 60000;

const REDIS_FIXED_WINDOW_LUA = `
local current = redis.call('INCRBY', KEYS[1], tonumber(ARGV[1]))
local pttl = redis.call('PTTL', KEYS[1])
if pttl < 0 then
  redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[2]))
  pttl = tonumber(ARGV[2])
end
return {current, pttl}
`.trim();

function getClientIp(req, trustedProxyCount = 0) {
  const proxyCount = Math.max(0, Math.floor(Number(trustedProxyCount) || 0));
  if (proxyCount > 0) {
    const forwarded = String(req.headers?.['x-forwarded-for'] || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const idx = forwarded.length - proxyCount;
    if (idx >= 0 && forwarded[idx]) {
      return forwarded[idx];
    }
  }
  return req.socket?.remoteAddress || 'unknown';
}

function classifyRoute(req) {
  const method = String(req?.method || 'GET').toUpperCase();
  let pathname = '';
  try {
    pathname = new URL(String(req?.url || '/'), 'http://localhost').pathname;
  } catch {
    return 'general';
  }

  // Sensitive operator and administrative endpoints
  if (
    pathname.startsWith('/api/operator') ||
    pathname.startsWith('/api/scrapers/run') ||
    pathname.startsWith('/api/workspace')
  ) {
    return 'sensitive';
  }

  // High-volume public read endpoints
  if (method === 'GET' && pathname.startsWith('/api/listings')) {
    return 'public_read';
  }

  // Media and binary endpoints
  if (method === 'GET' && pathname === '/api/property-image') {
    return 'media';
  }

  // Health and readiness probes
  if ((method === 'GET' || method === 'HEAD') && (pathname === '/api/health' || pathname === '/api/health/ready')) {
    return 'readiness';
  }

  return 'general';
}

function resolveEnvRedisConfig(env = process.env) {
  if (!env || typeof env !== 'object') return null;
  const upstashUrl = String(env.UPSTASH_REDIS_REST_URL || '').trim();
  const upstashToken = String(env.UPSTASH_REDIS_REST_TOKEN || '').trim();
  if (upstashUrl && upstashToken) {
    return { url: upstashUrl.replace(/\/+$/, ''), token: upstashToken, provider: 'upstash' };
  }
  const kvUrl = String(env.KV_REST_API_URL || '').trim();
  const kvToken = String(env.KV_REST_API_TOKEN || '').trim();
  if (kvUrl && kvToken) {
    return { url: kvUrl.replace(/\/+$/, ''), token: kvToken, provider: 'vercel-kv' };
  }
  return null;
}

function computeTokenBucketTransition(bucket, { capacity, windowMs, cost, now }) {
  const safeCost = Math.max(0, Number(cost) || 1);
  let tokens = Number(bucket.tokens);
  let lastRefill = Number(bucket.lastRefill);
  let resetAt = Number(bucket.resetAt);

  const elapsedMs = Math.max(0, now - lastRefill);
  if (elapsedMs > 0) {
    const tokensToAdd = elapsedMs * (capacity / windowMs);
    tokens = Math.min(capacity, tokens + tokensToAdd);
    lastRefill = now;
  }

  if (now >= resetAt) {
    resetAt = now + windowMs;
    bucket.count = 0;
  }

  if (tokens >= safeCost) {
    tokens -= safeCost;
    bucket.tokens = tokens;
    bucket.lastRefill = lastRefill;
    bucket.resetAt = resetAt;
    bucket.count = (bucket.count || 0) + safeCost;
    return {
      allowed: true,
      tokensRemaining: Math.floor(tokens),
      resetAt,
      retryAfterSeconds: 0,
    };
  }

  bucket.tokens = tokens;
  bucket.lastRefill = lastRefill;
  bucket.resetAt = resetAt;
  const missingTokens = safeCost - tokens;
  const waitMs = Math.ceil(missingTokens / (capacity / windowMs));
  const retryAfterSeconds = Math.max(1, Math.ceil(waitMs / 1000));

  return {
    allowed: false,
    tokensRemaining: 0,
    resetAt,
    retryAfterSeconds,
  };
}

/**
 * Async shared token-bucket store backed by an in-process Map.
 * Useful for multi-isolate simulations and deterministic tests without
 * external Redis or PostgreSQL dependencies.
 */
class MemorySharedRateLimitStore {
  constructor(options = {}) {
    this.maxBuckets = Math.max(100, Math.floor(Number(options.maxBuckets) || DEFAULT_MAX_BUCKETS));
    this.buckets = new Map();
  }

  async consume({ key, capacity, windowMs, cost = 1, now = Date.now() }) {
    let bucket = this.buckets.get(key);
    if (!bucket) {
      if (this.buckets.size >= this.maxBuckets) {
        for (const [k, b] of this.buckets.entries()) {
          if (now - b.lastRefill > windowMs * 2) this.buckets.delete(k);
        }
        if (this.buckets.size >= this.maxBuckets) {
          const oldestKey = this.buckets.keys().next().value;
          if (oldestKey !== undefined) this.buckets.delete(oldestKey);
        }
      }
      bucket = {
        tokens: capacity,
        lastRefill: now,
        resetAt: now + windowMs,
        count: 0,
      };
      this.buckets.set(key, bucket);
    }
    return computeTokenBucketTransition(bucket, { capacity, windowMs, cost, now });
  }
}

/**
 * Upstash Redis REST / Vercel KV REST shared rate-limit store.
 * Executes an atomic Lua script via REST POST so separate serverless isolates
 * share exact per-window counters with bounded network timeout.
 */
class UpstashRedisRateLimitStore {
  constructor(options = {}) {
    this.url = String(options.url || '').replace(/\/+$/, '');
    this.token = String(options.token || '');
    this.timeoutMs = Math.max(100, Math.floor(Number(options.timeoutMs) || DEFAULT_STORE_TIMEOUT_MS));
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
  }

  async consume({ key, capacity, windowMs, cost = 1, now = Date.now() }) {
    if (!this.url || !this.token) {
      throw new Error('Upstash Redis REST URL and token are required');
    }
    if (typeof this.fetchImpl !== 'function') {
      throw new Error('fetch implementation unavailable for Upstash Redis REST');
    }

    const safeCost = Math.max(1, Math.floor(Number(cost) || 1));
    const safeWindowMs = Math.max(1000, Math.floor(Number(windowMs) || 60000));
    const signal = typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
      ? AbortSignal.timeout(this.timeoutMs)
      : undefined;

    const response = await this.fetchImpl(this.url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([
        'EVAL',
        REDIS_FIXED_WINDOW_LUA,
        '1',
        String(key),
        String(safeCost),
        String(safeWindowMs),
      ]),
      ...(signal ? { signal } : {}),
    });

    if (!response || !response.ok) {
      throw new Error(`Upstash Redis REST returned HTTP ${response ? response.status : 'unknown'}`);
    }

    const payload = await response.json();
    if (payload && payload.error) {
      throw new Error(`Upstash Redis REST error: ${payload.error}`);
    }
    const result = Array.isArray(payload?.result) ? payload.result : payload;
    if (!Array.isArray(result) || result.length < 2) {
      throw new Error('Unexpected Upstash Redis REST response shape');
    }

    const currentCount = Number(result[0]);
    const pttlMs = Math.max(1, Number(result[1]) || safeWindowMs);
    if (!Number.isFinite(currentCount)) {
      throw new Error('Invalid counter returned by Upstash Redis REST');
    }

    const resetAt = now + pttlMs;
    if (currentCount <= capacity) {
      return {
        allowed: true,
        tokensRemaining: Math.max(0, Math.floor(capacity - currentCount)),
        resetAt,
        retryAfterSeconds: 0,
      };
    }

    return {
      allowed: false,
      tokensRemaining: 0,
      resetAt,
      retryAfterSeconds: Math.max(1, Math.ceil(pttlMs / 1000)),
    };
  }
}

/**
 * PostgreSQL shared token-bucket store.
 * Self-initializes `api_rate_limit_buckets` with `CREATE TABLE IF NOT EXISTS`
 * so existing schema mirrors remain untouched while multi-isolate servers
 * enforce shared limits inside transactional row locks.
 */
class PgRateLimitStore {
  constructor(options = {}) {
    this.database = options.database || null;
    this.pool = options.pool || options.database?.pool || null;
    this.tableName = options.tableName || DEFAULT_PG_TABLE;
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(this.tableName)) {
      throw new Error(`Invalid rate-limit table name: ${this.tableName}`);
    }
    this._tableReadyPromise = null;
    this._lastPruneAt = 0;
  }

  _resolvePool() {
    if (this.pool) return this.pool;
    if (this.database && this.database.isPg && this.database.pool) {
      return this.database.pool;
    }
    return null;
  }

  isReady() {
    return Boolean(this._resolvePool());
  }

  async ensureTable(pool) {
    if (!this._tableReadyPromise) {
      this._tableReadyPromise = pool
        .query(
          `CREATE TABLE IF NOT EXISTS ${this.tableName} (
            bucket_key TEXT PRIMARY KEY,
            tokens DOUBLE PRECISION NOT NULL,
            last_refill_ms BIGINT NOT NULL,
            reset_at_ms BIGINT NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          )`
        )
        .catch((err) => {
          this._tableReadyPromise = null;
          throw err;
        });
    }
    return this._tableReadyPromise;
  }

  async _runWithExecutor(executor, { key, capacity, windowMs, cost, now }) {
    await executor.query(
      `INSERT INTO ${this.tableName} (bucket_key, tokens, last_refill_ms, reset_at_ms, updated_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (bucket_key) DO NOTHING`,
      [key, capacity, now, now + windowMs]
    );
    const selectSql = typeof executor.connect === 'function'
      ? `SELECT tokens, last_refill_ms, reset_at_ms FROM ${this.tableName} WHERE bucket_key = $1`
      : `SELECT tokens, last_refill_ms, reset_at_ms FROM ${this.tableName} WHERE bucket_key = $1 FOR UPDATE`;
    const res = await executor.query(selectSql, [key]);
    const row = res?.rows?.[0] || {
      tokens: capacity,
      last_refill_ms: now,
      reset_at_ms: now + windowMs,
    };

    const bucket = {
      tokens: Number(row.tokens),
      lastRefill: Number(row.last_refill_ms),
      resetAt: Number(row.reset_at_ms),
      count: 0,
    };
    const outcome = computeTokenBucketTransition(bucket, { capacity, windowMs, cost, now });

    await executor.query(
      `UPDATE ${this.tableName}
       SET tokens = $2, last_refill_ms = $3, reset_at_ms = $4, updated_at = NOW()
       WHERE bucket_key = $1`,
      [key, bucket.tokens, bucket.lastRefill, bucket.resetAt]
    );
    return outcome;
  }

  async consume({ key, capacity, windowMs, cost = 1, now = Date.now() }) {
    const pool = this._resolvePool();
    if (!pool) {
      throw new Error('PostgreSQL pool unavailable for PgRateLimitStore');
    }
    await this.ensureTable(pool);

    let outcome;
    if (typeof pool.connect === 'function') {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        outcome = await this._runWithExecutor(
          { query: (sql, params) => client.query(sql, params) },
          { key, capacity, windowMs, cost, now }
        );
        await client.query('COMMIT');
      } catch (err) {
        try {
          await client.query('ROLLBACK');
        } catch {
          // ignore rollback error
        }
        throw err;
      } finally {
        client.release();
      }
    } else {
      outcome = await this._runWithExecutor(pool, { key, capacity, windowMs, cost, now });
    }

    if (now - this._lastPruneAt > windowMs * 2) {
      this._lastPruneAt = now;
      pool
        .query(`DELETE FROM ${this.tableName} WHERE last_refill_ms < $1`, [now - windowMs * 2])
        .catch(() => {});
    }

    return outcome;
  }
}

function resolveRateLimitStore(options = {}) {
  if (options.store) return options.store;

  const redisConfig = resolveEnvRedisConfig(options.env || process.env);
  if (redisConfig) {
    return new UpstashRedisRateLimitStore({
      url: redisConfig.url,
      token: redisConfig.token,
      timeoutMs: options.storeTimeoutMs,
      fetchImpl: options.fetchImpl,
    });
  }

  if (options.pool || (options.database && options.database.isPg && options.database.pool)) {
    return new PgRateLimitStore({
      database: options.database || null,
      pool: options.pool || null,
      tableName: options.tableName,
    });
  }

  return null;
}

class TokenBucketRateLimiter {
  constructor(options = {}) {
    this.windowMs = options.windowMs || 60000;
    this.capacity = options.capacity || options.maxRequests || 60;
    this.trustedProxyCount = Math.max(0, Math.floor(Number(options.trustedProxyCount) || 0));
    this.maxBuckets = Math.max(100, Math.floor(Number(options.maxBuckets) || DEFAULT_MAX_BUCKETS));
    this.keyPrefix = String(options.keyPrefix || 'rl:general');
    this.env = options.env || process.env;
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
    this.storeTimeoutMs = options.storeTimeoutMs;
    this.tableName = options.tableName;
    this.onStoreError = typeof options.onStoreError === 'function' ? options.onStoreError : null;
    this._store = options.store || null;
    this._pool = options.pool || null;
    this._database = options.database || null;
    this._resolvedStore = null;
    this._lastWarnAt = 0;
    this.buckets = new Map();

    // Periodic cleanup of idle buckets
    this._cleanupTimer = setInterval(() => {
      const now = Date.now();
      for (const [key, bucket] of this.buckets.entries()) {
        if (now - bucket.lastRefill > this.windowMs * 2) {
          this.buckets.delete(key);
        }
      }
    }, this.windowMs).unref();
  }

  setStore(store) {
    this._store = store || null;
    this._resolvedStore = null;
  }

  setDatabase(database) {
    this._database = database || null;
    this._resolvedStore = null;
  }

  getActiveStore() {
    if (this._store) return this._store;
    if (this._resolvedStore) {
      if (typeof this._resolvedStore.isReady !== 'function' || this._resolvedStore.isReady()) {
        return this._resolvedStore;
      }
    }
    const resolved = resolveRateLimitStore({
      store: this._store,
      database: this._database,
      pool: this._pool,
      env: this.env,
      fetchImpl: this.fetchImpl,
      storeTimeoutMs: this.storeTimeoutMs,
      tableName: this.tableName,
    });
    if (resolved) {
      this._resolvedStore = resolved;
    }
    return resolved;
  }

  hasSharedStore() {
    return Boolean(this.getActiveStore());
  }

  getClientIp(req) {
    return getClientIp(req, this.trustedProxyCount);
  }

  consume(ip, cost = 1) {
    const now = Date.now();
    let bucket = this.buckets.get(ip);

    if (!bucket) {
      if (this.buckets.size >= this.maxBuckets) {
        for (const [key, entry] of this.buckets.entries()) {
          if (now - entry.lastRefill > this.windowMs * 2) {
            this.buckets.delete(key);
          }
        }
        if (this.buckets.size >= this.maxBuckets) {
          const oldestKey = this.buckets.keys().next().value;
          if (oldestKey !== undefined) this.buckets.delete(oldestKey);
        }
      }
      bucket = {
        tokens: this.capacity,
        lastRefill: now,
        resetAt: now + this.windowMs,
        count: 0,
      };
      this.buckets.set(ip, bucket);
    }

    return computeTokenBucketTransition(bucket, {
      capacity: this.capacity,
      windowMs: this.windowMs,
      cost,
      now,
    });
  }

  async consumeAsync(ip, cost = 1) {
    const store = this.getActiveStore();
    if (!store) {
      return this.consume(ip, cost);
    }

    try {
      return await store.consume({
        key: `${this.keyPrefix}:${ip}`,
        capacity: this.capacity,
        windowMs: this.windowMs,
        cost,
        now: Date.now(),
      });
    } catch (err) {
      const now = Date.now();
      if (this.onStoreError) {
        this.onStoreError(err);
      } else if (now - this._lastWarnAt > ERROR_LOG_THROTTLE_MS) {
        this._lastWarnAt = now;
        console.warn('[RateLimiter] Shared store failed; falling back to bounded memory:', err?.message || err);
      }
      return this.consume(ip, cost);
    }
  }

  _applyHeadersAndRespond(res, result, next) {
    // Emit standard IETF and legacy headers
    res.setHeader('RateLimit-Limit', this.capacity);
    res.setHeader('RateLimit-Remaining', result.tokensRemaining);
    res.setHeader('RateLimit-Reset', Math.ceil(result.resetAt / 1000));
    res.setHeader('X-RateLimit-Limit', this.capacity);
    res.setHeader('X-RateLimit-Remaining', result.tokensRemaining);
    res.setHeader('X-RateLimit-Reset', Math.ceil(result.resetAt / 1000));

    if (!result.allowed) {
      res.setHeader('Retry-After', result.retryAfterSeconds);
      return res.status(429).json({
        error: 'Too Many Requests',
        message: 'Rate limit exceeded. Please slow down.',
        retryAfter: result.retryAfterSeconds,
        retryAfterSeconds: result.retryAfterSeconds,
      });
    }

    if (typeof next === 'function') next();
    return undefined;
  }

  middleware() {
    return (req, res, next) => {
      const ip = this.getClientIp(req);
      const result = this.consume(ip, 1);
      return this._applyHeadersAndRespond(res, result, next);
    };
  }

  middlewareAsync() {
    return async (req, res, next) => {
      const ip = this.getClientIp(req);
      const result = await this.consumeAsync(ip, 1);
      return this._applyHeadersAndRespond(res, result, next);
    };
  }
}

function createTieredRateLimiter(options = {}) {
  const windowMs = options.windowMs || 60000;
  const env = options.env || process.env;
  const trustedProxyCount = options.trustedProxyCount !== undefined
    ? options.trustedProxyCount
    : (env.TRUSTED_PROXY_COUNT ? Number(env.TRUSTED_PROXY_COUNT) : 0);

  const limits = {
    sensitive: options.sensitiveLimit || 10,
    public_read: options.publicReadLimit || options.maxRequests || 120,
    media: options.mediaLimit || options.maxRequests || 120,
    readiness: options.readinessLimit || options.maxRequests || 120,
    general: options.generalLimit || 60,
  };

  const basePrefix = String(options.keyPrefix || 'rl');
  const sharedOpts = (tier, capacity) => ({
    windowMs,
    capacity,
    trustedProxyCount,
    maxBuckets: options.maxBuckets,
    keyPrefix: `${basePrefix}:${tier}`,
    store: options.store,
    database: options.database,
    pool: options.pool,
    env,
    fetchImpl: options.fetchImpl,
    storeTimeoutMs: options.storeTimeoutMs,
    tableName: options.tableName,
    onStoreError: options.onStoreError,
  });

  const limiters = {
    sensitive: new TokenBucketRateLimiter(sharedOpts('sensitive', limits.sensitive)),
    public_read: new TokenBucketRateLimiter(sharedOpts('public_read', limits.public_read)),
    media: new TokenBucketRateLimiter(sharedOpts('media', limits.media)),
    readiness: new TokenBucketRateLimiter(sharedOpts('readiness', limits.readiness)),
    general: new TokenBucketRateLimiter(sharedOpts('general', limits.general)),
  };

  return {
    limiters,
    classifyRoute,
    getClientIp: (req) => getClientIp(req, trustedProxyCount),
    hasSharedStore: () => Object.values(limiters).some((limiter) => limiter.hasSharedStore()),
    setDatabase(database) {
      for (const limiter of Object.values(limiters)) {
        limiter.setDatabase(database);
      }
    },
    setStore(store) {
      for (const limiter of Object.values(limiters)) {
        limiter.setStore(store);
      }
    },
    async consumeAsync(req, cost = 1) {
      const routeClass = classifyRoute(req);
      const limiter = limiters[routeClass] || limiters.general;
      return limiter.consumeAsync(limiter.getClientIp(req), cost);
    },
    middleware() {
      return (req, res, next) => {
        const routeClass = classifyRoute(req);
        const limiter = limiters[routeClass] || limiters.general;
        return limiter.middleware()(req, res, next);
      };
    },
    middlewareAsync() {
      return async (req, res, next) => {
        const routeClass = classifyRoute(req);
        const limiter = limiters[routeClass] || limiters.general;
        return limiter.middlewareAsync()(req, res, next);
      };
    },
  };
}

module.exports = {
  getClientIp,
  classifyRoute,
  TokenBucketRateLimiter,
  createTieredRateLimiter,
  MemorySharedRateLimitStore,
  UpstashRedisRateLimitStore,
  PgRateLimitStore,
  resolveRateLimitStore,
};
