class MemoryRateLimiter {
  constructor({ windowMs = 60000, maxRequests = 60, trustedProxyCount = 0 } = {}) {
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;
    this.trustedProxyCount = Math.max(0, Math.floor(Number(trustedProxyCount) || 0));
    this.hits = new Map();

    // Periodic eviction so stale IP records are removed regardless of traffic
    // volume. .unref() ensures this timer doesn't keep the Node process alive
    // after all other async work has completed (e.g. in tests).
    this._evictTimer = setInterval(() => {
      const now = Date.now();
      for (const [key, record] of this.hits.entries()) {
        if (now > record.resetAt) this.hits.delete(key);
      }
    }, this.windowMs).unref();
  }

  middleware() {
    return (req, res, next) => {
      // Forwarded headers are caller-controlled without a trusted edge.
      // When TRUSTED_PROXY_COUNT > 0, parse X-Forwarded-For from the right:
      // take the address at position length - TRUSTED_PROXY_COUNT (i.e. the
      // client address as seen by the innermost trusted proxy).
      let ip;
      if (this.trustedProxyCount > 0) {
        const forwarded = String(req.headers['x-forwarded-for'] || '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        const idx = forwarded.length - this.trustedProxyCount;
        ip = (idx >= 0 && forwarded[idx]) || req.socket?.remoteAddress || 'unknown';
      } else {
        ip = req.socket?.remoteAddress || 'unknown';
      }
      const now = Date.now();
      // Periodically evict expired entries to prevent memory leak
      if (this.hits.size > 100) {
        for (const [key, record] of this.hits.entries()) {
          if (now > record.resetAt) this.hits.delete(key);
        }
      }

      const clientRecord = this.hits.get(ip) || { count: 0, resetAt: now + this.windowMs };

      if (now > clientRecord.resetAt) {
        clientRecord.count = 1;
        clientRecord.resetAt = now + this.windowMs;
      } else {
        clientRecord.count++;
      }

      this.hits.set(ip, clientRecord);

      res.setHeader('X-RateLimit-Limit', this.maxRequests);
      res.setHeader('X-RateLimit-Remaining', Math.max(0, this.maxRequests - clientRecord.count));
      res.setHeader('X-RateLimit-Reset', Math.ceil(clientRecord.resetAt / 1000));

      if (clientRecord.count > this.maxRequests) {
        res.setHeader('Retry-After', Math.ceil((clientRecord.resetAt - now) / 1000));
        return res.status(429).json({
          error: 'Too Many Requests',
          message: 'Rate limit exceeded. Please slow down.',
          retryAfterSeconds: Math.ceil((clientRecord.resetAt - now) / 1000)
        });
      }

      next();
    };
  }
}

module.exports = MemoryRateLimiter;
