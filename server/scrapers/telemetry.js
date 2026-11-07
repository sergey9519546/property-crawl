/**
 * Scraper Telemetry & DOM Drift Detector
 * Monitors scraper yield and circuit-breaker states across executions.
 */

const fs = require('node:fs');
const path = require('node:path');
const { inspectPublisherPhoto } = require('./media-policy');
const { evaluateDrift, calculateFieldYield, computeDomStructureHash } = require('./drift-detector');

const DEFAULT_TELEMETRY_PATH = path.resolve(__dirname, '../../.cache/scraper-telemetry.json');

class ScraperTelemetry {
  constructor(options = {}) {
    // In-memory store for scraper run telemetry
    this.history = {};
    // Tests and ephemeral runs pass { persist: false } to skip the
    // disk-load + disk-save round-trip; the persisted file leaks
    // state between test invocations otherwise (every fresh test was
    // observing whatever the previous run had written).
    this._persistEnabled = options.persist !== false;
    this.persistPath = this._persistEnabled
      ? (options.path || process.env.SCRAPER_TELEMETRY_PATH || DEFAULT_TELEMETRY_PATH)
      : null;
    this._saveTimer = null;
    if (this._persistEnabled) this._load();
  }

  _load() {
    try {
      if (fs.existsSync(this.persistPath)) {
        const raw = JSON.parse(fs.readFileSync(this.persistPath, 'utf8'));
        if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
          this.history = raw;
        }
      }
    } catch {
      // Corrupted telemetry file — start fresh rather than crash.
      this.history = {};
    }
  }

  _save() {
    if (!this._persistEnabled) return;
    // Debounce writes to avoid excessive disk I/O on rapid scraper runs.
    if (this._saveTimer) return;
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      this._saveNow();
    }, 200);
    this._saveTimer.unref?.();
  }

  _saveNow() {
    if (!this._persistEnabled) return;
    try {
      fs.mkdirSync(path.dirname(this.persistPath), { recursive: true });
      const tmp = `${this.persistPath}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.history), 'utf8');
      fs.renameSync(tmp, this.persistPath);
    } catch {
      // Persistence failure must not crash scrapers.
    }
  }

  /**
   * Records a scraper run and analyzes field completeness to detect DOM drift.
   * @param {string} sourceName
   * @param {Array<Object>} listings
   * @param {number} latencyMs
   * @param {Error} error
   */
  recordRun(sourceName, listings = [], latencyMs = 0, error = null, metadata = {}) {
    if (!this.history[sourceName]) {
      this.history[sourceName] = {
        runs: 0,
        lastRunAt: null,
        successes: 0,
        failures: 0,
        consecutiveFailures: 0,
        zeroYieldRuns: 0,
        consecutiveZeroYieldRuns: 0,
        hasNonZeroBaseline: false,
        lastYieldCount: null,
        rejectedListings: 0,
        lastRejectedCount: 0,
        circuitBreakerTripped: false,
        circuitBreakerReason: null,
        yieldMetrics: {
          totalListings: 0,
          addressYield: 0,
          openingBidYield: 0,
          dateYield: 0,
          photoYield: 0
        },
        driftDetected: false,
        lastError: null,
        lastErrorCode: null
      };
    }

    const state = this.history[sourceName];
    state.runs += 1;
    state.lastRunAt = new Date().toISOString();
    const rejectedCount = Number.isFinite(Number(metadata.rejectedCount))
      ? Math.max(0, Number(metadata.rejectedCount))
      : 0;
    state.lastRejectedCount = rejectedCount;
    state.rejectedListings += rejectedCount;

    if (error) {
      state.failures += 1;
      state.consecutiveFailures += 1;
      state.lastError = error.message;
      state.lastErrorCode = metadata.errorCode || error.code || error.name || 'SCRAPER_ERROR';
      state.circuitBreakerReason = metadata.circuitReason || null;
      if (metadata.circuitOpen || error.haltScraper || state.consecutiveFailures >= 3) {
        state.circuitBreakerTripped = true;
      }
      this._save();
      return;
    }

    state.successes += 1;
    state.consecutiveFailures = 0;
    state.circuitBreakerTripped = false;
    state.circuitBreakerReason = null;
    state.lastError = null;
    state.lastErrorCode = null;

    const scopeKey = metadata.scopeKey || 'default';
    state.baselines ||= {};
    const baseline = metadata.historicalBaseline || state.baselines[scopeKey] || null;
    const domHashes = metadata.domHashes || (metadata.html ? {page:computeDomStructureHash(metadata.html)} : {});
    const driftReport = evaluateDrift(sourceName, metadata.html || '', listings, baseline ? {fieldYield:baseline.fieldYield, ...(baseline.domHash ? {domHash:baseline.domHash} : {})} : {});
    const changedPages = Object.keys(domHashes).filter(key => baseline?.domHashes?.[key] && baseline.domHashes[key] !== domHashes[key]);
    if (changedPages.length) {
      driftReport.domDrift = true;
      driftReport.hasDrift = true;
      if (!driftReport.flags.includes('DOM_STRUCTURE_DRIFT')) driftReport.flags.push('DOM_STRUCTURE_DRIFT');
    }
    driftReport.changedPages = changedPages;
    state.driftReport = driftReport;
    state.driftDetected = driftReport.hasDrift;
    if (listings.length > 0 && !driftReport.hasDrift) {
      state.baselines[scopeKey] = {version:1, fieldYield:calculateFieldYield(listings).fieldYield, domHashes:{...(baseline?.domHashes || {}),...domHashes}, capturedAt:state.lastRunAt};
      // Bound source scope history; never retain publisher HTML in health telemetry.
      for (const key of Object.keys(state.baselines).slice(0, -16)) delete state.baselines[key];
    }
    if (listings.length === 0) {
      state.zeroYieldRuns += 1;
      state.consecutiveZeroYieldRuns += 1;
      state.lastYieldCount = 0;
      if (state.hasNonZeroBaseline) state.driftDetected = true;
      this._save();
      return;
    }

    state.hasNonZeroBaseline = true;
    state.consecutiveZeroYieldRuns = 0;
    state.lastYieldCount = listings.length;

    // Calculate yield for this run
    let addressCount = 0;
    let openingBidCount = 0;
    let dateCount = 0;
    let photoCount = 0;
    const mediaReasons = {};

    for (const listing of listings) {
      if (listing.address && listing.address.trim() !== "") addressCount++;
      if (listing.openingBid && listing.openingBid > 0) openingBidCount++;
      if (listing.saleDate && listing.saleDate.trim() !== "") dateCount++;
      const photo = inspectPublisherPhoto(listing);
      if (photo.accepted) photoCount++;
      else {
        const reason = listing.provenance?.media?.photoStatus?.reason || photo.reason;
        mediaReasons[reason] = (mediaReasons[reason] || 0) + 1;
      }
    }

    state.media = { accepted: photoCount, unavailable: listings.length - photoCount, reasons: mediaReasons };

    // Rolling average approach for simple telemetry tracking
    const total = listings.length;
    
    // Weight new run at 20% to smooth out anomalies
    const weight = state.runs === 1 ? 1 : 0.2;
    const oldWeight = 1 - weight;

    state.yieldMetrics.totalListings = Math.round((state.yieldMetrics.totalListings * oldWeight) + (total * weight));
    state.yieldMetrics.addressYield = (state.yieldMetrics.addressYield * oldWeight) + ((addressCount / total) * weight);
    state.yieldMetrics.openingBidYield = (state.yieldMetrics.openingBidYield * oldWeight) + ((openingBidCount / total) * weight);
    state.yieldMetrics.dateYield = (state.yieldMetrics.dateYield * oldWeight) + ((dateCount / total) * weight);
    state.yieldMetrics.photoYield = (state.yieldMetrics.photoYield * oldWeight) + ((photoCount / total) * weight);

    this._save();
  }

  /**
   * Retrieves the current health state for all scrapers.
   * @returns {Object}
   */
  getHealthReport() {
    const total = Object.keys(this.history).length;
    const report = {
      systemStatus: total === 0 ? 'idle' : 'healthy',
      snapshotEvidence: require('./discovery-snapshots').evidenceStoreHealth(),
      totalScrapers: total,
      scrapersInFault: 0,
      scrapersChallengeGated: 0,
      scrapersWithDrift: 0,
      details: {}
    };

    for (const [sourceName, state] of Object.entries(this.history)) {
      const isChallengeGated = Boolean(
        state.lastErrorCode === 'UPSTREAM_BOT_CHALLENGE' ||
        /bot\s*challenge|turnstile|captcha|waf/i.test(state.circuitBreakerReason || '')
      );
      if (isChallengeGated) {
        report.scrapersChallengeGated += 1;
      } else if (state.circuitBreakerTripped) {
        report.scrapersInFault += 1;
      }
      if (state.driftDetected) report.scrapersWithDrift += 1;
      
      report.details[sourceName] = {
        runs: state.runs,
        lastRunAt: state.lastRunAt,
        successes: state.successes,
        failures: state.failures,
        consecutiveFailures: state.consecutiveFailures,
        zeroYieldRuns: state.zeroYieldRuns,
        consecutiveZeroYieldRuns: state.consecutiveZeroYieldRuns,
        lastYieldCount: state.lastYieldCount,
        rejectedListings: state.rejectedListings,
        lastRejectedCount: state.lastRejectedCount,
        circuitBreakerTripped: state.circuitBreakerTripped,
        driftDetected: state.driftDetected,
        lastErrorCode: state.lastErrorCode,
        circuitBreakerReason: state.circuitBreakerReason,
        media: state.media || undefined,
        // Redacted from the public report: lastError may leak source URLs and
        // internals; baselines / domHashes reveal page structure and prior
        // field-yield baselines. Yield percentages, breaker state, codes and
        // test-derived telemetry remain visible.
        yieldMetrics: {
          totalListings: state.yieldMetrics.totalListings,
          addressYieldPct: Math.round(state.yieldMetrics.addressYield * 100) + '%',
          openingBidYieldPct: Math.round(state.yieldMetrics.openingBidYield * 100) + '%',
          dateYieldPct: Math.round(state.yieldMetrics.dateYield * 100) + '%',
          photoYieldPct: Math.round(state.yieldMetrics.photoYield * 100) + '%'
        }
      };
    }

    if (report.scrapersInFault > 0 || report.scrapersWithDrift > 0) {
      report.systemStatus = 'degraded';
    } else if (report.scrapersChallengeGated > 0) {
      report.systemStatus = 'nominal_gated';
    }

    return report;
  }
}

// Singleton instance for global app tracking
const telemetryInstance = new ScraperTelemetry();

module.exports = { ScraperTelemetry, telemetryInstance, evaluateDrift, calculateFieldYield, computeDomStructureHash };
