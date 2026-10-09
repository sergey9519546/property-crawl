'use strict';

/**
 * Token Bucket Rate Limiter with Trusted Proxy Count
 *
 * Implements Task 19:
 * Provides tiered token bucket rate limiting with safe client IP extraction
 * via `TRUSTED_PROXY_COUNT` to defeat `X-Forwarded-For` spoofing.
 */

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

class TokenBucketRateLimiter {
  constructor(options = {}) {
    this.windowMs = options.windowMs || 60000;
    this.capacity = options.capacity || options.maxRequests || 60;
    this.trustedProxyCount = Math.max(0, Math.floor(Number(options.trustedProxyCount) || 0));
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

  getClientIp(req) {
    return getClientIp(req, this.trustedProxyCount);
  }

  consume(ip, cost = 1) {
    const now = Date.now();
    let bucket = this.buckets.get(ip);

    if (!bucket) {
      bucket = {
        tokens: this.capacity,
        lastRefill: now,
        resetAt: now + this.windowMs,
        count: 0
      };
      this.buckets.set(ip, bucket);
    }

    // Refill tokens based on elapsed time
    const elapsedMs = now - bucket.lastRefill;
    if (elapsedMs > 0) {
      const tokensToAdd = elapsedMs * (this.capacity / this.windowMs);
      bucket.tokens = Math.min(this.capacity, bucket.tokens + tokensToAdd);
      bucket.lastRefill = now;
    }

    if (now >= bucket.resetAt) {
      bucket.resetAt = now + this.windowMs;
      bucket.count = 0;
    }

    if (bucket.tokens >= cost) {
      bucket.tokens -= cost;
      bucket.count += cost;
      return {
        allowed: true,
        tokensRemaining: Math.floor(bucket.tokens),
        resetAt: bucket.resetAt,
        retryAfterSeconds: 0
      };
    }

    const missingTokens = cost - bucket.tokens;
    const waitMs = Math.ceil(missingTokens / (this.capacity / this.windowMs));
    const retryAfterSeconds = Math.max(1, Math.ceil(waitMs / 1000));

    return {
      allowed: false,
      tokensRemaining: 0,
      resetAt: bucket.resetAt,
      retryAfterSeconds
    };
  }

  middleware() {
    return (req, res, next) => {
      const ip = this.getClientIp(req);
      const result = this.consume(ip, 1);

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
          retryAfterSeconds: result.retryAfterSeconds
        });
      }

      if (typeof next === 'function') next();
    };
  }
}

function createTieredRateLimiter(options = {}) {
  const windowMs = options.windowMs || 60000;
  const trustedProxyCount = options.trustedProxyCount !== undefined
    ? options.trustedProxyCount
    : (process.env.TRUSTED_PROXY_COUNT ? Number(process.env.TRUSTED_PROXY_COUNT) : 1);

  const limits = {
    sensitive: options.sensitiveLimit || 10,
    public_read: options.publicReadLimit || options.maxRequests || 120,
    media: options.mediaLimit || options.maxRequests || 120,
    readiness: options.readinessLimit || options.maxRequests || 120,
    general: options.generalLimit || 60
  };

  const limiters = {
    sensitive: new TokenBucketRateLimiter({ windowMs, capacity: limits.sensitive, trustedProxyCount }),
    public_read: new TokenBucketRateLimiter({ windowMs, capacity: limits.public_read, trustedProxyCount }),
    media: new TokenBucketRateLimiter({ windowMs, capacity: limits.media, trustedProxyCount }),
    readiness: new TokenBucketRateLimiter({ windowMs, capacity: limits.readiness, trustedProxyCount }),
    general: new TokenBucketRateLimiter({ windowMs, capacity: limits.general, trustedProxyCount })
  };

  return {
    limiters,
    classifyRoute,
    getClientIp: (req) => getClientIp(req, trustedProxyCount),
    middleware() {
      return (req, res, next) => {
        const routeClass = classifyRoute(req);
        const limiter = limiters[routeClass] || limiters.general;
        return limiter.middleware()(req, res, next);
      };
    }
  };
}

module.exports = {
  getClientIp,
  classifyRoute,
  TokenBucketRateLimiter,
  createTieredRateLimiter
};
