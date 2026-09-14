'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createApiRatePolicy, limiterClass } = require('../server/security/api-rate-policy');

function request(method, url, remoteAddress = '127.0.0.1', forwardedFor = 'caller-controlled') {
  return { method, url, socket: { remoteAddress }, headers: { 'x-forwarded-for': forwardedFor } };
}

function invoke(policy, req) {
  let allowed = false;
  let body = null;
  const headers = {};
  const res = {
    statusCode: 200,
    setHeader(name, value) { headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(value) { body = value; return this; },
  };
  policy(req, res, () => { allowed = true; });
  return { allowed, statusCode: res.statusCode, headers, body };
}

test('route classification uses exact paths and intended methods', () => {
  assert.equal(limiterClass(request('GET', '/api/health?probe=1')), 'readiness');
  assert.equal(limiterClass(request('HEAD', '/api/health/ready')), 'readiness');
  assert.equal(limiterClass(request('POST', '/api/health')), 'general');
  assert.equal(limiterClass(request('GET', '/api/health/ready/deep')), 'general');
  assert.equal(limiterClass(request('GET', '/api/property-image?listingId=1')), 'media');
  assert.equal(limiterClass(request('HEAD', '/api/property-image')), 'general');
});

test('general API exhaustion cannot make health or media probes fail', () => {
  const policy = createApiRatePolicy({ maxRequests: 1, readinessMaxRequests: 1, mediaMaxRequests: 1 });
  assert.equal(invoke(policy, request('GET', '/api/listings')).allowed, true);
  assert.equal(invoke(policy, request('GET', '/api/discovery/jobs')).statusCode, 429);
  assert.equal(invoke(policy, request('GET', '/api/health')).allowed, true);
  assert.equal(invoke(policy, request('GET', '/api/property-image')).allowed, true);
});

test('media traffic has a bounded budget independent from discovery and health', () => {
  const policy = createApiRatePolicy({ maxRequests: 1, readinessMaxRequests: 1, mediaMaxRequests: 1 });
  assert.equal(invoke(policy, request('GET', '/api/property-image')).allowed, true);
  const limited = invoke(policy, request('GET', '/api/property-image?listingId=2'));
  assert.equal(limited.statusCode, 429);
  assert.equal(limited.headers['X-RateLimit-Limit'], 1);
  assert.equal(invoke(policy, request('GET', '/api/discovery/jobs')).allowed, true);
  assert.equal(invoke(policy, request('GET', '/api/health/ready')).allowed, true);
});

test('each limiter still enforces its own request ceiling and ignores forwarded identity', () => {
  const policy = createApiRatePolicy({ maxRequests: 1, readinessMaxRequests: 1, mediaMaxRequests: 1 });
  assert.equal(invoke(policy, request('GET', '/api/health', '10.0.0.8', '198.51.100.1')).allowed, true);
  const healthLimited = invoke(policy, request('HEAD', '/api/health/ready', '10.0.0.8', '198.51.100.2'));
  assert.equal(healthLimited.statusCode, 429);
  assert.equal(healthLimited.body.error, 'Too Many Requests');

  assert.equal(invoke(policy, request('GET', '/api/listings', '10.0.0.9')).allowed, true);
  assert.equal(invoke(policy, request('GET', '/api/listings', '10.0.0.9')).statusCode, 429);
});
