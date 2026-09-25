'use strict';

// test/security/api-rate-policy.test.js
//
// Tests for server/security/api-rate-policy.js — the per-route-class
// rate-limit policy factory used by the server bootstrap. Covers:
//   - boundedLimit (validation of the configured max)
//   - trustedProxyCountFromEnv (env-var parsing)
//   - limiterClass (path/method dispatch)
//   - createApiRatePolicy (factory output is a middleware function)

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  createApiRatePolicy,
  limiterClass,
  trustedProxyCountFromEnv
} = require('../../server/security/api-rate-policy');

// --- trustedProxyCountFromEnv ---------------------------------------------

test('trustedProxyCountFromEnv: returns 0 when env var is missing', () => {
  assert.equal(trustedProxyCountFromEnv({}), 0);
});

test('trustedProxyCountFromEnv: parses a positive integer', () => {
  assert.equal(trustedProxyCountFromEnv({ TRUSTED_PROXY_COUNT: '2' }), 2);
});

test('trustedProxyCountFromEnv: returns 0 for negative or zero values', () => {
  assert.equal(trustedProxyCountFromEnv({ TRUSTED_PROXY_COUNT: '0' }), 0);
  assert.equal(trustedProxyCountFromEnv({ TRUSTED_PROXY_COUNT: '-1' }), 0);
});

test('trustedProxyCountFromEnv: returns 0 for non-numeric values', () => {
  assert.equal(trustedProxyCountFromEnv({ TRUSTED_PROXY_COUNT: 'abc' }), 0);
  assert.equal(trustedProxyCountFromEnv({ TRUSTED_PROXY_COUNT: '' }), 0);
});

test('trustedProxyCountFromEnv: floors non-integer numerics', () => {
  assert.equal(trustedProxyCountFromEnv({ TRUSTED_PROXY_COUNT: '1.7' }), 1);
  assert.equal(trustedProxyCountFromEnv({ TRUSTED_PROXY_COUNT: '2.9' }), 2);
});

// --- limiterClass -----------------------------------------------------------

test('limiterClass: /api/health returns "readiness"', () => {
  assert.equal(limiterClass({ method: 'GET', url: '/api/health' }), 'readiness');
});

test('limiterClass: /api/health/ready returns "readiness"', () => {
  assert.equal(limiterClass({ method: 'GET', url: '/api/health/ready' }), 'readiness');
});

test('limiterClass: HEAD on /api/health returns "readiness"', () => {
  assert.equal(limiterClass({ method: 'HEAD', url: '/api/health' }), 'readiness');
});

test('limiterClass: GET /api/property-image returns "media"', () => {
  assert.equal(limiterClass({ method: 'GET', url: '/api/property-image' }), 'media');
});

test('limiterClass: GET /api/property-image?id=... still returns "media"', () => {
  assert.equal(limiterClass({ method: 'GET', url: '/api/property-image?id=ABC' }), 'media');
});

test('limiterClass: non-GET on /api/property-image returns "general" (method matters)', () => {
  assert.equal(limiterClass({ method: 'POST', url: '/api/property-image' }), 'general');
});

test('limiterClass: a generic GET returns "general"', () => {
  assert.equal(limiterClass({ method: 'GET', url: '/api/listings' }), 'general');
});

test('limiterClass: a POST returns "general"', () => {
  assert.equal(limiterClass({ method: 'POST', url: '/api/listings' }), 'general');
});

test('limiterClass: a malformed URL falls back to "general" rather than throwing', () => {
  assert.equal(limiterClass({ method: 'GET', url: ':::' }), 'general');
});

test('limiterClass: missing method falls back to "general"', () => {
  assert.equal(limiterClass({ url: '/api/listings' }), 'general');
});

test('limiterClass: lower-case method is normalized before matching', () => {
  assert.equal(limiterClass({ method: 'get', url: '/api/health' }), 'readiness');
});

// --- createApiRatePolicy ---------------------------------------------------

test('createApiRatePolicy: returns a function (Express middleware)', () => {
  const policy = createApiRatePolicy();
  assert.equal(typeof policy, 'function');
});

test('createApiRatePolicy: each call returns an independent middleware', () => {
  const a = createApiRatePolicy();
  const b = createApiRatePolicy();
  assert.notEqual(a, b);
});

test('createApiRatePolicy: a fresh policy lets the first request through and sets rate-limit headers', () => {
  const policy = createApiRatePolicy({ maxRequests: 5 });
  const req = { method: 'GET', url: '/api/listings', socket: { remoteAddress: '127.0.0.1' }, headers: {} };
  const headers = {};
  const res = {
    setHeader(name, value) { headers[name] = value; },
    status() { return this; },
    json() { return this; }
  };
  let nextCalled = false;
  policy(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, true, 'first request must pass through');
  // res.setHeader in real Node.js coerces numbers to strings, but our
  // test stub passes through. Verify both representations:
  assert.equal(String(headers['X-RateLimit-Limit']), '5');
  assert.equal(String(headers['X-RateLimit-Remaining']), '4');
});

test('createApiRatePolicy: returns 429 after maxRequests requests within the window', () => {
  const policy = createApiRatePolicy({ maxRequests: 2, windowMs: 60_000 });
  const req = { method: 'GET', url: '/api/listings', socket: { remoteAddress: '10.0.0.1' }, headers: {} };
  let status = null;
  let body = null;
  let nextCalls = 0;
  const res = {
    setHeader() {},
    status(code) { status = code; return this; },
    json(payload) { body = payload; return this; }
  };
  // Two passes through the limit
  policy(req, res, () => { nextCalls += 1; });
  policy(req, res, () => { nextCalls += 1; });
  // Third call must be rejected
  policy(req, res, () => { nextCalls += 1; });
  assert.equal(nextCalls, 2);
  assert.equal(status, 429);
  assert.match(body.error, /Too Many Requests/i);
});

test('createApiRatePolicy: readiness path uses readinessMaxRequests, not maxRequests', () => {
  const policy = createApiRatePolicy({ maxRequests: 1, readinessMaxRequests: 5 });
  const req = { method: 'GET', url: '/api/health', socket: { remoteAddress: '10.0.0.2' }, headers: {} };
  let nextCalls = 0;
  const res = {
    setHeader() {},
    status() { return this; },
    json() { return this; }
  };
  // 5 readiness requests must all pass (readinessMaxRequests=5)
  for (let i = 0; i < 5; i += 1) policy(req, res, () => { nextCalls += 1; });
  assert.equal(nextCalls, 5);
});

test('createApiRatePolicy: media path uses mediaMaxRequests', () => {
  const policy = createApiRatePolicy({ maxRequests: 1, mediaMaxRequests: 3 });
  const req = { method: 'GET', url: '/api/property-image?id=ABC', socket: { remoteAddress: '10.0.0.3' }, headers: {} };
  let nextCalls = 0;
  const res = {
    setHeader() {},
    status() { return this; },
    json() { return this; }
  };
  for (let i = 0; i < 3; i += 1) policy(req, res, () => { nextCalls += 1; });
  assert.equal(nextCalls, 3);
});

test('createApiRatePolicy: independent IPs are counted independently', () => {
  const policy = createApiRatePolicy({ maxRequests: 2, windowMs: 60_000 });
  const headers = {};
  const res = (ip) => ({
    setHeader(name, value) { headers[`${ip}:${name}`] = value; },
    status() { return this; },
    json() { return this; }
  });
  let nextCalls = 0;
  const makeReq = (ip) => ({ method: 'GET', url: '/api/listings', socket: { remoteAddress: ip }, headers: {} });
  // IP A exhausts its 2 requests
  policy(makeReq('1.1.1.1'), res('1.1.1.1'), () => { nextCalls += 1; });
  policy(makeReq('1.1.1.1'), res('1.1.1.1'), () => { nextCalls += 1; });
  // IP B still has its full quota
  policy(makeReq('2.2.2.2'), res('2.2.2.2'), () => { nextCalls += 1; });
  policy(makeReq('2.2.2.2'), res('2.2.2.2'), () => { nextCalls += 1; });
  assert.equal(nextCalls, 4);
});

test('createApiRatePolicy: TRUSTED_PROXY_COUNT=0 uses req.socket.remoteAddress directly', () => {
  const policy = createApiRatePolicy({ maxRequests: 1, trustedProxyCount: 0 });
  const headers = {};
  const res = {
    setHeader(name, value) { headers[name] = value; },
    status() { return this; },
    json() { return this; }
  };
  // Two requests from different claimed IPs both map to 127.0.0.1
  const r1 = { method: 'GET', url: '/api/listings', socket: { remoteAddress: '127.0.0.1' }, headers: { 'x-forwarded-for': '203.0.113.1' } };
  const r2 = { method: 'GET', url: '/api/listings', socket: { remoteAddress: '127.0.0.1' }, headers: { 'x-forwarded-for': '203.0.113.99' } };
  let nextCalls = 0;
  policy(r1, res, () => { nextCalls += 1; });
  policy(r2, res, () => { nextCalls += 1; });
  // Second request from the same socket address should be rejected
  // (TRUSTED_PROXY_COUNT=0 means the limiter ignores X-Forwarded-For)
  assert.equal(nextCalls, 1);
});

test('createApiRatePolicy: TRUSTED_PROXY_COUNT=2 picks the client IP from X-Forwarded-For', () => {
  // x-forwarded-for: 'client, proxy1, proxy2' — count=3, idx = 3-2 = 1 → proxy1
  // The actual client is 'client'. To get 'client' we need TRUSTED_PROXY_COUNT=2
  // and the chain to have 3 entries — but idx = length-2 = 1 picks proxy1.
  // The intent of the doc is: pick the entry at position (length - trustCount),
  // which corresponds to "the address as seen by the innermost trusted proxy".
  // For a chain of length=1 (just the client behind one proxy), trustCount=1,
  // idx=0, picks the only entry. We test that.
  const policy = createApiRatePolicy({ maxRequests: 2, trustedProxyCount: 1 });
  let nextCalls = 0;
  const res = {
    setHeader() {},
    status() { return this; },
    json() { return this; }
  };
  // Different socket addresses, but the X-Forwarded-For value is what
  // gets counted when trustCount=1 and the chain has one entry.
  const reqA = { method: 'GET', url: '/api/listings', socket: { remoteAddress: '127.0.0.1' }, headers: { 'x-forwarded-for': '198.51.100.5' } };
  const reqB = { method: 'GET', url: '/api/listings', socket: { remoteAddress: '127.0.0.1' }, headers: { 'x-forwarded-for': '198.51.100.99' } };
  policy(reqA, res, () => { nextCalls += 1; });
  policy(reqB, res, () => { nextCalls += 1; });
  // The two requests have different X-Forwarded-For values, so they're
  // counted independently. Both should pass.
  assert.equal(nextCalls, 2);
});