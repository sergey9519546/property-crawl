'use strict';

const MemoryRateLimiter = require('./rate_limiter');

const DEFAULT_MAX_REQUESTS = 120;
const MAX_REQUESTS_BOUND = 10_000;

function boundedLimit(value, fallback = DEFAULT_MAX_REQUESTS) {
  return Number.isInteger(value) && value >= 1 && value <= MAX_REQUESTS_BOUND ? value : fallback;
}

function trustedProxyCountFromEnv(env = process.env) {
  const parsed = Number(env.TRUSTED_PROXY_COUNT);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

function limiterClass(req) {
  const method = String(req?.method || '').toUpperCase();
  let pathname = '';
  try { pathname = new URL(String(req?.url || '/'), 'http://localhost').pathname; }
  catch { return 'general'; }
  if ((method === 'GET' || method === 'HEAD') && (pathname === '/api/health' || pathname === '/api/health/ready')) return 'readiness';
  if (method === 'GET' && pathname === '/api/property-image') return 'media';
  return 'general';
}

function createApiRatePolicy({
  windowMs = 60_000,
  maxRequests = DEFAULT_MAX_REQUESTS,
  readinessMaxRequests = maxRequests,
  mediaMaxRequests = maxRequests,
  trustedProxyCount = trustedProxyCountFromEnv(),
} = {}) {
  const generalLimit = boundedLimit(maxRequests);
  const readinessLimit = boundedLimit(readinessMaxRequests, generalLimit);
  const mediaLimit = boundedLimit(mediaMaxRequests, generalLimit);
  const proxyCount = Math.max(0, Math.floor(Number(trustedProxyCount) || 0));
  const middlewareByClass = {
    general: new MemoryRateLimiter({ windowMs, maxRequests: generalLimit, trustedProxyCount: proxyCount }).middleware(),
    readiness: new MemoryRateLimiter({ windowMs, maxRequests: readinessLimit, trustedProxyCount: proxyCount }).middleware(),
    media: new MemoryRateLimiter({ windowMs, maxRequests: mediaLimit, trustedProxyCount: proxyCount }).middleware(),
  };
  return (req, res, next) => middlewareByClass[limiterClass(req)](req, res, next);
}

module.exports = { createApiRatePolicy, limiterClass, trustedProxyCountFromEnv };
