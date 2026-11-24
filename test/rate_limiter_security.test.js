'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  getClientIp,
  classifyRoute,
  TokenBucketRateLimiter,
  createTieredRateLimiter,
  MemorySharedRateLimitStore,
  UpstashRedisRateLimitStore,
  PgRateLimitStore,
  resolveRateLimitStore,
} = require('../server/middleware/rate-limiter');

function createMockRes() {
  const headers = {};
  return {
    statusCode: 200,
    headers,
    body: null,
    setHeader(k, v) { headers[k] = v; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

test('RateLimiter: client IP extraction defends against header spoofing', () => {
  // Case 1: Untrusted proxy environment (trustedProxyCount = 0)
  const reqUntrusted = {
    socket: { remoteAddress: '198.51.100.42' },
    headers: { 'x-forwarded-for': '1.1.1.1, 8.8.8.8, 127.0.0.1' },
  };
  assert.equal(getClientIp(reqUntrusted, 0), '198.51.100.42');

  // Case 2: 1 Trusted proxy
  const reqSingleProxy = {
    socket: { remoteAddress: '10.0.0.1' },
    headers: { 'x-forwarded-for': '203.0.113.195, 198.51.100.55' },
  };
  assert.equal(getClientIp(reqSingleProxy, 1), '198.51.100.55');

  // Case 3: 2 Trusted proxies
  const reqDualProxy = {
    socket: { remoteAddress: '10.0.0.2' },
    headers: { 'x-forwarded-for': 'client.external.ip, cdn.node.ip, lb.node.ip' },
  };
  assert.equal(getClientIp(reqDualProxy, 2), 'cdn.node.ip');

  // Case 4: Malformed or missing headers
  const reqEmpty = { socket: { remoteAddress: '127.0.0.1' }, headers: {} };
  assert.equal(getClientIp(reqEmpty, 1), '127.0.0.1');
});

test('RateLimiter: route classification correctly maps sensitive vs public endpoints', () => {
  assert.equal(classifyRoute({ method: 'POST', url: '/api/operator/unlock' }), 'sensitive');
  assert.equal(classifyRoute({ method: 'POST', url: '/api/scrapers/run' }), 'sensitive');
  assert.equal(classifyRoute({ method: 'GET', url: '/api/workspace/documents-review' }), 'sensitive');

  assert.equal(classifyRoute({ method: 'GET', url: '/api/listings' }), 'public_read');
  assert.equal(classifyRoute({ method: 'GET', url: '/api/listings/123' }), 'public_read');
  assert.equal(classifyRoute({ method: 'GET', url: '/api/property-image?id=abc' }), 'media');
  assert.equal(classifyRoute({ method: 'GET', url: '/api/health' }), 'readiness');
  assert.equal(classifyRoute({ method: 'HEAD', url: '/api/health/ready' }), 'readiness');

  assert.equal(classifyRoute({ method: 'POST', url: '/api/unknown' }), 'general');
});

test('RateLimiter: token bucket enforces burst limits and emits RFC & legacy headers', () => {
  const limiter = new TokenBucketRateLimiter({
    capacity: 3,
    windowMs: 60000,
    trustedProxyCount: 0,
  });

  const ip = '192.168.1.100';

  assert.equal(limiter.consume(ip).allowed, true);
  assert.equal(limiter.consume(ip).allowed, true);
  assert.equal(limiter.consume(ip).allowed, true);

  const rejected = limiter.consume(ip);
  assert.equal(rejected.allowed, false);
  assert.equal(rejected.tokensRemaining, 0);
  assert.ok(rejected.retryAfterSeconds >= 1);
});

test('RateLimiter: middleware emits standard headers and returns 429 when throttled', () => {
  const limiter = new TokenBucketRateLimiter({
    capacity: 2,
    windowMs: 60000,
    trustedProxyCount: 0,
  });

  const middleware = limiter.middleware();
  const req = {
    socket: { remoteAddress: '10.20.30.40' },
    headers: {},
  };

  // Req 1 - Success
  const res1 = createMockRes();
  let next1Called = false;
  middleware(req, res1, () => { next1Called = true; });
  assert.equal(next1Called, true);
  assert.equal(res1.headers['RateLimit-Limit'], 2);
  assert.equal(res1.headers['RateLimit-Remaining'], 1);

  // Req 2 - Success
  const res2 = createMockRes();
  let next2Called = false;
  middleware(req, res2, () => { next2Called = true; });
  assert.equal(next2Called, true);
  assert.equal(res2.headers['RateLimit-Remaining'], 0);

  // Req 3 - Throttled (429)
  const res3 = createMockRes();
  let next3Called = false;
  middleware(req, res3, () => { next3Called = true; });
  assert.equal(next3Called, false);
  assert.equal(res3.statusCode, 429);
  assert.equal(res3.headers['RateLimit-Remaining'], 0);
  assert.ok(Number(res3.headers['Retry-After']) >= 1);
  assert.equal(res3.body.error, 'Too Many Requests');
  assert.ok(res3.body.retryAfter >= 1);
});

test('RateLimiter: tiered rate limiter isolates sensitive quota from public traffic', () => {
  const tiered = createTieredRateLimiter({
    sensitiveLimit: 2,
    publicReadLimit: 10,
    trustedProxyCount: 0,
  });

  const middleware = tiered.middleware();
  const reqSensitive = {
    method: 'POST',
    url: '/api/operator/unlock',
    socket: { remoteAddress: '172.16.0.5' },
    headers: {},
  };
  const reqPublic = {
    method: 'GET',
    url: '/api/listings',
    socket: { remoteAddress: '172.16.0.5' },
    headers: {},
  };

  middleware(reqSensitive, createMockRes(), () => {});
  middleware(reqSensitive, createMockRes(), () => {});
  const resSensBlocked = createMockRes();
  middleware(reqSensitive, resSensBlocked, () => {});
  assert.equal(resSensBlocked.statusCode, 429);

  const resPubOk = createMockRes();
  let pubAllowed = false;
  middleware(reqPublic, resPubOk, () => { pubAllowed = true; });
  assert.equal(pubAllowed, true);
  assert.notEqual(resPubOk.statusCode, 429);
});

test('RateLimiter (multi-isolate): shared store exhaustion in Isolate A triggers 429 + Retry-After + X-RateLimit-* in Isolate B', async () => {
  const sharedStore = new MemorySharedRateLimitStore();

  const isolateA = new TokenBucketRateLimiter({
    capacity: 2,
    windowMs: 60000,
    keyPrefix: 'rl:api',
    store: sharedStore,
  });
  const isolateB = new TokenBucketRateLimiter({
    capacity: 2,
    windowMs: 60000,
    keyPrefix: 'rl:api',
    store: sharedStore,
  });

  const mwA = isolateA.middlewareAsync();
  const mwB = isolateB.middlewareAsync();
  const req = {
    socket: { remoteAddress: '198.51.100.77' },
    headers: {},
  };

  // Exhaust quota in Isolate A (2 requests)
  const resA1 = createMockRes();
  let nextA1 = false;
  await mwA(req, resA1, () => { nextA1 = true; });
  assert.equal(nextA1, true);
  assert.equal(resA1.headers['X-RateLimit-Limit'], 2);
  assert.equal(resA1.headers['X-RateLimit-Remaining'], 1);

  const resA2 = createMockRes();
  let nextA2 = false;
  await mwA(req, resA2, () => { nextA2 = true; });
  assert.equal(nextA2, true);
  assert.equal(resA2.headers['X-RateLimit-Remaining'], 0);

  // Next request hits Isolate B and MUST be rejected with 429 + headers
  const resB = createMockRes();
  let nextB = false;
  await mwB(req, resB, () => { nextB = true; });
  assert.equal(nextB, false);
  assert.equal(resB.statusCode, 429);
  assert.ok(Number(resB.headers['Retry-After']) >= 1);
  assert.equal(resB.headers['X-RateLimit-Limit'], 2);
  assert.equal(resB.headers['X-RateLimit-Remaining'], 0);
  assert.ok(Number(resB.headers['X-RateLimit-Reset']) > 0);
  assert.equal(resB.body.error, 'Too Many Requests');
});

test('RateLimiter (multi-isolate): Upstash Redis REST / Vercel KV store coordinates across isolates', async () => {
  const kvCounters = new Map();
  const mockFetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    assert.equal(body[0], 'EVAL');
    const key = body[3];
    const cost = Number(body[4]);
    const windowMs = Number(body[5]);
    const entry = kvCounters.get(key) || { count: 0, pttl: windowMs };
    entry.count += cost;
    kvCounters.set(key, entry);
    return {
      ok: true,
      status: 200,
      async json() {
        return { result: [entry.count, entry.pttl] };
      },
    };
  };

  const env = {
    KV_REST_API_URL: 'https://kv.example.upstash.io',
    KV_REST_API_TOKEN: 'test-kv-token',
  };

  const isolateA = createTieredRateLimiter({
    sensitiveLimit: 2,
    env,
    fetchImpl: mockFetch,
  });
  const isolateB = createTieredRateLimiter({
    sensitiveLimit: 2,
    env,
    fetchImpl: mockFetch,
  });

  assert.equal(isolateA.hasSharedStore(), true);
  assert.equal(isolateB.hasSharedStore(), true);

  const req = {
    method: 'POST',
    url: '/api/operator/unlock',
    socket: { remoteAddress: '203.0.113.10' },
    headers: {},
  };

  const mwA = isolateA.middlewareAsync();
  const mwB = isolateB.middlewareAsync();

  const res1 = createMockRes();
  let ok1 = false;
  await mwA(req, res1, () => { ok1 = true; });
  assert.equal(ok1, true);
  assert.equal(res1.headers['X-RateLimit-Remaining'], 1);

  const res2 = createMockRes();
  let ok2 = false;
  await mwB(req, res2, () => { ok2 = true; });
  assert.equal(ok2, true);
  assert.equal(res2.headers['X-RateLimit-Remaining'], 0);

  const res3 = createMockRes();
  let ok3 = false;
  await mwB(req, res3, () => { ok3 = true; });
  assert.equal(ok3, false);
  assert.equal(res3.statusCode, 429);
  assert.ok(Number(res3.headers['Retry-After']) >= 1);
  assert.equal(res3.headers['X-RateLimit-Limit'], 2);
  assert.equal(res3.headers['X-RateLimit-Remaining'], 0);
});

test('RateLimiter (multi-isolate): PgRateLimitStore coordinates across isolates via shared Postgres table', async () => {
  const rows = new Map();
  let tableCreated = false;

  const createFakePool = () => ({
    async query(sql, params = []) {
      if (/CREATE TABLE IF NOT EXISTS api_rate_limit_buckets/i.test(sql)) {
        tableCreated = true;
        return { rows: [] };
      }
      if (/DELETE FROM api_rate_limit_buckets/i.test(sql)) {
        return { rows: [] };
      }
      throw new Error(`Unexpected pool query: ${sql}`);
    },
    async connect() {
      return {
        async query(sql, params = []) {
          if (/^(BEGIN|COMMIT|ROLLBACK)$/i.test(sql.trim())) {
            return { rows: [] };
          }
          if (/INSERT INTO api_rate_limit_buckets/i.test(sql)) {
            const [key, tokens, lastRefillMs, resetAtMs] = params;
            if (!rows.has(key)) {
              rows.set(key, {
                bucket_key: key,
                tokens,
                last_refill_ms: lastRefillMs,
                reset_at_ms: resetAtMs,
              });
            }
            return { rows: [] };
          }
          if (/SELECT tokens, last_refill_ms, reset_at_ms FROM api_rate_limit_buckets/i.test(sql)) {
            const [key] = params;
            return { rows: rows.has(key) ? [{ ...rows.get(key) }] : [] };
          }
          if (/UPDATE api_rate_limit_buckets/i.test(sql)) {
            const [key, tokens, lastRefillMs, resetAtMs] = params;
            rows.set(key, {
              bucket_key: key,
              tokens,
              last_refill_ms: lastRefillMs,
              reset_at_ms: resetAtMs,
            });
            return { rows: [] };
          }
          throw new Error(`Unexpected client query: ${sql}`);
        },
        release() {},
      };
    },
  });

  const sharedPool = createFakePool();
  const isolateA = new TokenBucketRateLimiter({
    capacity: 2,
    windowMs: 60000,
    keyPrefix: 'rl:pg',
    database: { isPg: true, pool: sharedPool },
  });
  const isolateB = new TokenBucketRateLimiter({
    capacity: 2,
    windowMs: 60000,
    keyPrefix: 'rl:pg',
    database: { isPg: true, pool: sharedPool },
  });

  assert.equal(isolateA.hasSharedStore(), true);
  assert.equal(isolateB.hasSharedStore(), true);

  const mwA = isolateA.middlewareAsync();
  const mwB = isolateB.middlewareAsync();
  const req = { socket: { remoteAddress: '198.51.100.88' }, headers: {} };

  const res1 = createMockRes();
  let ok1 = false;
  await mwA(req, res1, () => { ok1 = true; });
  assert.equal(ok1, true);
  assert.equal(tableCreated, true);

  const res2 = createMockRes();
  let ok2 = false;
  await mwB(req, res2, () => { ok2 = true; });
  assert.equal(ok2, true);
  assert.equal(res2.headers['X-RateLimit-Remaining'], 0);

  const res3 = createMockRes();
  let ok3 = false;
  await mwB(req, res3, () => { ok3 = true; });
  assert.equal(ok3, false);
  assert.equal(res3.statusCode, 429);
  assert.ok(Number(res3.headers['Retry-After']) >= 1);
  assert.equal(res3.headers['X-RateLimit-Remaining'], 0);
});

test('RateLimiter: remote store outage fails open to bounded in-memory bucket', async () => {
  let errorsLogged = 0;
  const brokenStore = new UpstashRedisRateLimitStore({
    url: 'https://redis.example.invalid',
    token: 'bad-token',
    fetchImpl: async () => {
      throw new Error('ECONNREFUSED');
    },
  });

  const limiter = new TokenBucketRateLimiter({
    capacity: 2,
    windowMs: 60000,
    maxBuckets: 100,
    store: brokenStore,
    onStoreError: () => { errorsLogged += 1; },
  });

  const mw = limiter.middlewareAsync();
  const req = { socket: { remoteAddress: '192.0.2.50' }, headers: {} };

  const r1 = createMockRes();
  let ok1 = false;
  await mw(req, r1, () => { ok1 = true; });
  assert.equal(ok1, true);

  const r2 = createMockRes();
  let ok2 = false;
  await mw(req, r2, () => { ok2 = true; });
  assert.equal(ok2, true);

  // Bounded fallback still enforces capacity=2 locally when store fails
  const r3 = createMockRes();
  let ok3 = false;
  await mw(req, r3, () => { ok3 = true; });
  assert.equal(ok3, false);
  assert.equal(r3.statusCode, 429);
  assert.equal(errorsLogged, 3);

  // Verify bounded Map eviction under IP spray
  for (let i = 0; i < 150; i += 1) {
    limiter.consume(`198.51.100.${i}`);
  }
  assert.ok(limiter.buckets.size <= 100);
});

test('resolveRateLimitStore prefers Upstash/KV REST over Postgres and returns null when unconfigured', () => {
  assert.equal(resolveRateLimitStore({ env: {} }), null);
  const upstash = resolveRateLimitStore({
    env: {
      UPSTASH_REDIS_REST_URL: 'https://upstash.example.io',
      UPSTASH_REDIS_REST_TOKEN: 'secret',
    },
    database: { isPg: true, pool: { query: async () => ({ rows: [] }) } },
  });
  assert.ok(upstash instanceof UpstashRedisRateLimitStore);

  const pg = resolveRateLimitStore({
    env: {},
    database: { isPg: true, pool: { query: async () => ({ rows: [] }) } },
  });
  assert.ok(pg instanceof PgRateLimitStore);
});
