'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  getClientIp,
  classifyRoute,
  TokenBucketRateLimiter,
  createTieredRateLimiter
} = require('../server/middleware/rate-limiter');

test('RateLimiter: client IP extraction defends against header spoofing', () => {
  // Case 1: Untrusted proxy environment (trustedProxyCount = 0)
  // Malicious client sends arbitrary X-Forwarded-For header; server MUST ignore it and use socket address
  const reqUntrusted = {
    socket: { remoteAddress: '198.51.100.42' },
    headers: { 'x-forwarded-for': '1.1.1.1, 8.8.8.8, 127.0.0.1' }
  };
  assert.equal(getClientIp(reqUntrusted, 0), '198.51.100.42');

  // Case 2: 1 Trusted proxy (e.g. edge load balancer / reverse proxy)
  // X-Forwarded-For: <spoofed_client>, <real_client_ip>
  // Trusted proxy appended <real_client_ip> at the end
  const reqSingleProxy = {
    socket: { remoteAddress: '10.0.0.1' }, // Proxy IP
    headers: { 'x-forwarded-for': '203.0.113.195, 198.51.100.55' }
  };
  assert.equal(getClientIp(reqSingleProxy, 1), '198.51.100.55');

  // Case 3: 2 Trusted proxies (CDN + load balancer)
  const reqDualProxy = {
    socket: { remoteAddress: '10.0.0.2' },
    headers: { 'x-forwarded-for': 'client.external.ip, cdn.node.ip, lb.node.ip' }
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
    trustedProxyCount: 0
  });

  const ip = '192.168.1.100';

  // First 3 requests must be allowed
  assert.equal(limiter.consume(ip).allowed, true);
  assert.equal(limiter.consume(ip).allowed, true);
  assert.equal(limiter.consume(ip).allowed, true);

  // 4th request must be rejected
  const rejected = limiter.consume(ip);
  assert.equal(rejected.allowed, false);
  assert.equal(rejected.tokensRemaining, 0);
  assert.ok(rejected.retryAfterSeconds >= 1);
});

test('RateLimiter: middleware emits standard headers and returns 429 when throttled', () => {
  const limiter = new TokenBucketRateLimiter({
    capacity: 2,
    windowMs: 60000,
    trustedProxyCount: 0
  });

  const middleware = limiter.middleware();
  const req = {
    socket: { remoteAddress: '10.20.30.40' },
    headers: {}
  };

  const createMockRes = () => {
    const headers = {};
    return {
      statusCode: 200,
      headers,
      setHeader(k, v) { headers[k] = v; },
      status(code) { this.statusCode = code; return this; },
      json(payload) { this.body = payload; return this; }
    };
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
    trustedProxyCount: 0
  });

  const middleware = tiered.middleware();
  const reqSensitive = {
    method: 'POST',
    url: '/api/operator/unlock',
    socket: { remoteAddress: '172.16.0.5' },
    headers: {}
  };
  const reqPublic = {
    method: 'GET',
    url: '/api/listings',
    socket: { remoteAddress: '172.16.0.5' },
    headers: {}
  };

  const createMockRes = () => {
    const headers = {};
    return {
      statusCode: 200,
      headers,
      setHeader(k, v) { headers[k] = v; },
      status(code) { this.statusCode = code; return this; },
      json(payload) { this.body = payload; return this; }
    };
  };

  // Exhaust sensitive limit (2 reqs)
  middleware(reqSensitive, createMockRes(), () => {});
  middleware(reqSensitive, createMockRes(), () => {});
  const resSensBlocked = createMockRes();
  middleware(reqSensitive, resSensBlocked, () => {});
  assert.equal(resSensBlocked.statusCode, 429);

  // Public listings from SAME IP should still succeed due to tiered isolation
  const resPubOk = createMockRes();
  let pubAllowed = false;
  middleware(reqPublic, resPubOk, () => { pubAllowed = true; });
  assert.equal(pubAllowed, true);
  assert.notEqual(resPubOk.statusCode, 429);
});
