const { ScraperCircuitBreaker, ScraperResponseError } = require('./circuit-breaker');
const {
  DEFAULT_REQUEST_TIMEOUT_MS,
  crawlJitter,
  fetchJsonWithPolicy,
  fetchTextWithPolicy,
  normalizeRequestTimeout
} = require('./http');
const { standardizeListingRecord } = require('./normalization');
const { validateListingShape } = require('./listing-schema');

class BaseScraper {
  constructor({
    name,
    sourceKey,
    timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
    maxRetries = 3,
    fetchImpl = globalThis.fetch,
    random = Math.random,
    sleep
  } = {}) {
    this.name = name;
    this.sourceKey = sourceKey;
    this.timeoutMs = normalizeRequestTimeout(timeoutMs);
    this.maxRetries = maxRetries;
    this.circuitBreaker = new ScraperCircuitBreaker();
    this.fetchImpl = fetchImpl;
    this.random = random;
    this.sleepImpl = sleep;
  }

  async executeWithRetry(fn) {
    if (this.circuitBreaker.isOpen()) {
      throw new Error(`[${this.name}] Scraper halted: Circuit breaker is OPEN`);
    }

    let lastError;
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastError = err;
        console.warn(`[${this.name}] Attempt ${attempt} failed: ${err.message}`);
        if (err instanceof ScraperResponseError && err.haltScraper) {
          throw err;
        }
        if (!err.circuitRecorded) {
          this.circuitBreaker.trip(err.message || 'Scraper request failed');
          err.circuitRecorded = true;
        }
        if (this.circuitBreaker.isOpen()) {
          throw err;
        }
        if (attempt < this.maxRetries) {
          await this.crawlJitter({ minMs: 250, maxMs: 750 });
        }
      }
    }
    throw lastError;
  }

  async requestText(url, options = {}) {
    return fetchTextWithPolicy(url, {
      ...options,
      timeoutMs: options.timeoutMs ?? this.timeoutMs,
      circuitBreaker: this.circuitBreaker,
      fetchImpl: options.fetchImpl || this.fetchImpl
    });
  }

  async requestJson(url, options = {}) {
    return fetchJsonWithPolicy(url, {
      ...options,
      timeoutMs: options.timeoutMs ?? this.timeoutMs,
      circuitBreaker: this.circuitBreaker,
      fetchImpl: options.fetchImpl || this.fetchImpl
    });
  }

  // Compatibility wrapper for the existing (url, timeout, method, body)
  // scraper convention. New collectors should prefer requestText().
  async fetchText(url, timeoutOrOptions = this.timeoutMs, method = 'GET', body = null) {
    const options = typeof timeoutOrOptions === 'object' && timeoutOrOptions !== null
      ? { ...timeoutOrOptions }
      : { timeoutMs: timeoutOrOptions, method, body };
    return this.requestText(url, options);
  }

  async crawlJitter(options = {}) {
    return crawlJitter({
      minMs: 250,
      maxMs: 750,
      random: this.random,
      sleep: this.sleepImpl,
      ...options
    });
  }

  standardizeListing(raw) {
    const listing = standardizeListingRecord(raw, { sourceKey: this.sourceKey });
    // Schema-first gate (foolproof scrape P0): fail only on identity-critical
    // errors. Provenance/host policy remains the ingestion validator's job.
    const schema = validateListingShape(listing, { expectedSource: this.sourceKey });
    const critical = new Set([
      'invalid_id', 'invalid_state', 'invalid_address', 'missing_source',
      'missing_id', 'missing_source', 'missing_state', 'missing_address',
    ]);
    const blocking = (schema.errors || []).filter((e) => critical.has(e) || e === 'invalid_id');
    if (blocking.length) {
      const error = new Error(`LISTING_SCHEMA_INVALID(${this.sourceKey}): ${blocking.join(',')}`);
      error.code = 'LISTING_SCHEMA_INVALID';
      error.errors = blocking;
      throw error;
    }
    return listing;
  }

  passesFilter(item) {
    if (!item) return false;
    if (!item.state || item.state === 'US' || item.state.length !== 2) return false;
    if (!item.address || item.address.length < 8) return false;
    if (item.openingBid != null && (!Number.isFinite(Number(item.openingBid)) || Number(item.openingBid) <= 0)) return false;
    return true;
  }

  markFixtureInventory(listings, fixtureName = 'embedded-demo-inventory') {
    if (!Array.isArray(listings)) return [];
    return listings.map((listing) => ({
      ...listing,
      provenance: {
        ...(listing && listing.provenance && typeof listing.provenance === 'object'
          ? listing.provenance
          : {}),
        origin: 'fixture',
        observed: false,
        fixtureName
      }
    }));
  }

  getVerifiedInventory() {
    try {
      const fs = require('fs');
      const path = require('path');
      const snapshotPath = path.resolve(__dirname, '../../data/listings.snapshot.json');
      if (fs.existsSync(snapshotPath)) {
        const payload = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
        const listings = Array.isArray(payload) ? payload : (payload.listings || []);
        const filtered = listings.filter(l => l.source === this.sourceKey);
        if (filtered.length > 0) {
          return this.markFixtureInventory(filtered, 'data/listings.snapshot.json');
        }
      }
    } catch (_) {}
    return [];
  }
}

module.exports = BaseScraper;
