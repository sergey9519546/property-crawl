'use strict';

/**
 * server/sources/collector-registry.js
 *
 * Anti-Poisoning Ingestion Gate & Collector Circuit Breaker Registry.
 * Guarantees that upstream WAF challenges, 403s, or anomalous zero-count drops
 * never overwrite existing verified listings or corrupt database state.
 */

const fs = require('node:fs');
const path = require('node:path');
const { ScraperCircuitBreaker, findBotChallengeSignature } = require('../scrapers/circuit-breaker');

const DEFAULT_SNAPSHOT_DIR = path.resolve(__dirname, '..', '..', '.cache', 'collector-snapshots');

class CollectorRegistry {
  constructor(options = {}) {
    this.snapshotDir = options.snapshotDir || DEFAULT_SNAPSHOT_DIR;
    this.collectors = new Map();
    this.circuitBreakers = new Map();
    this.snapshots = new Map();
    this.telemetry = new Map();
  }

  /**
   * Register a source collector with circuit breaker protection
   */
  registerCollector(sourceKey, collectorFn, options = {}) {
    const key = String(sourceKey || '').trim().toLowerCase();
    if (!key) throw new Error('sourceKey is required');

    this.collectors.set(key, collectorFn);
    this.circuitBreakers.set(key, new ScraperCircuitBreaker({
      failureThreshold: options.failureThreshold || 3,
      minPayloadBytes: options.minPayloadBytes || 50,
    }));
    this.telemetry.set(key, {
      sourceKey: key,
      status: 'IDLE',
      lastRunAt: null,
      lastSuccessAt: null,
      listingCount: 0,
      circuitState: 'CLOSED',
      suppressedOverwrites: 0,
      lastError: null,
    });
  }

  getCircuitBreaker(sourceKey) {
    return this.circuitBreakers.get(String(sourceKey || '').toLowerCase()) || null;
  }

  getTelemetry(sourceKey) {
    const key = String(sourceKey || '').toLowerCase();
    const breaker = this.circuitBreakers.get(key);
    const telem = this.telemetry.get(key) || { sourceKey: key };
    return {
      ...telem,
      circuitState: breaker ? breaker.state : 'UNKNOWN',
      isOpen: breaker ? breaker.isOpen() : false,
      consecutiveFailures: breaker ? breaker.consecutiveFailures : 0,
    };
  }

  getAllTelemetry() {
    const all = {};
    for (const [key] of this.collectors) {
      all[key] = this.getTelemetry(key);
    }
    return all;
  }

  /**
   * Load the last verified snapshot for a source from memory or disk
   */
  getSnapshot(sourceKey) {
    const key = String(sourceKey || '').toLowerCase();
    if (this.snapshots.has(key)) {
      return this.snapshots.get(key);
    }

    const filePath = path.join(this.snapshotDir, `${key}-snapshot.json`);
    if (fs.existsSync(filePath)) {
      try {
        const raw = fs.readFileSync(filePath, 'utf8');
        const data = JSON.parse(raw);
        this.snapshots.set(key, data.listings || []);
        return data.listings || [];
      } catch (_) {
        return [];
      }
    }
    return [];
  }

  /**
   * Save a verified snapshot to memory and disk
   */
  saveSnapshot(sourceKey, listings = []) {
    const key = String(sourceKey || '').toLowerCase();
    this.snapshots.set(key, listings);

    try {
      if (!fs.existsSync(this.snapshotDir)) {
        fs.mkdirSync(this.snapshotDir, { recursive: true });
      }
      const filePath = path.join(this.snapshotDir, `${key}-snapshot.json`);
      fs.writeFileSync(filePath, JSON.stringify({
        version: 1,
        sourceKey: key,
        savedAt: new Date().toISOString(),
        count: listings.length,
        listings,
      }, null, 2), 'utf8');
    } catch (_) {
      // Non-fatal disk write error
    }
  }

  /**
   * Ingest gate executing a collector with anti-poisoning verification
   */
  async executeCollector(sourceKey, context = {}) {
    const key = String(sourceKey || '').toLowerCase();
    const collectorFn = this.collectors.get(key);
    const breaker = this.circuitBreakers.get(key);
    const telem = this.telemetry.get(key);

    if (!collectorFn || !breaker || !telem) {
      throw new Error(`Collector for '${key}' is not registered`);
    }

    telem.lastRunAt = new Date().toISOString();

    // 1. If circuit is already OPEN, fail closed and serve prior verified snapshot
    if (breaker.isOpen()) {
      telem.status = 'CIRCUIT_OPEN';
      telem.lastError = breaker.lastFailureReason;
      return {
        ok: false,
        sourceKey: key,
        circuitState: 'OPEN',
        error: 'CIRCUIT_OPEN_FAIL_CLOSED',
        reason: breaker.lastFailureReason,
        listings: this.getSnapshot(key),
        preservedSnapshot: true,
      };
    }

    try {
      // 2. Execute collector
      const result = await collectorFn(context);

      // Handle raw response validation if response payload is supplied
      if (result && result.rawResponse) {
        const validation = breaker.validateResponse(result.rawResponse, context);
        if (!validation.isValid) {
          telem.status = 'WAF_CHALLENGE_BLOCKED';
          telem.lastError = validation.error;
          telem.suppressedOverwrites++;
          return {
            ok: false,
            sourceKey: key,
            circuitState: breaker.state,
            error: validation.error,
            listings: this.getSnapshot(key),
            preservedSnapshot: true,
          };
        }
      }

      const listings = Array.isArray(result) ? result : (result?.listings || []);
      const priorSnapshot = this.getSnapshot(key);

      // 3. Anti-Poisoning Gate: An empty array when previous snapshot was non-empty
      if (listings.length === 0 && priorSnapshot.length > 0) {
        breaker.trip(`Anomalous zero-count collection (previous: ${priorSnapshot.length} listings)`);
        telem.status = 'ANOMALOUS_DROP_SUPPRESSED';
        telem.lastError = 'Zero listings returned when verified snapshot exists';
        telem.suppressedOverwrites++;

        return {
          ok: false,
          sourceKey: key,
          circuitState: breaker.state,
          error: 'ANOMALOUS_EMPTY_COLLECTION_SUPPRESSED',
          listings: priorSnapshot,
          preservedSnapshot: true,
          previousCount: priorSnapshot.length,
        };
      }

      // 4. Valid collection: update snapshot, reset breaker, update telemetry
      breaker.reset();
      this.saveSnapshot(key, listings);
      telem.status = 'HEALTHY';
      telem.lastSuccessAt = new Date().toISOString();
      telem.listingCount = listings.length;
      telem.lastError = null;

      return {
        ok: true,
        sourceKey: key,
        circuitState: 'CLOSED',
        listings,
        count: listings.length,
        preservedSnapshot: false,
      };
    } catch (err) {
      breaker.trip(err.message || 'Scraper execution exception');
      telem.status = 'EXECUTION_FAILED';
      telem.lastError = err.message;
      telem.suppressedOverwrites++;

      return {
        ok: false,
        sourceKey: key,
        circuitState: breaker.state,
        error: err.message,
        listings: this.getSnapshot(key),
        preservedSnapshot: true,
      };
    }
  }
}

module.exports = {
  CollectorRegistry,
};
