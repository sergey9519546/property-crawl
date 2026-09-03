class MemoryRateLimiter {
  constructor({ windowMs = 60000, maxRequests = 60 } = {}) {
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;
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
      const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
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
