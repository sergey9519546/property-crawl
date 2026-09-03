/**
 * Scraper Telemetry & DOM Drift Detector
 * Monitors scraper yield and circuit-breaker states across executions.
 */

class ScraperTelemetry {
  constructor() {
    // In-memory store for scraper run telemetry
    this.history = {};
  }

  /**
   * Records a scraper run and analyzes field completeness to detect DOM drift.
   * @param {string} sourceName
   * @param {Array<Object>} listings
   * @param {number} latencyMs
   * @param {Error} error
   */
  recordRun(sourceName, listings = [], latencyMs = 0, error = null) {
    if (!this.history[sourceName]) {
      this.history[sourceName] = {
        runs: 0,
        lastRunAt: null,
        successes: 0,
        failures: 0,
        circuitBreakerTripped: false,
        yieldMetrics: {
          totalListings: 0,
          addressYield: 0,
          openingBidYield: 0,
          dateYield: 0,
          photoYield: 0
        },
        driftDetected: false,
        lastError: null
      };
    }

    const state = this.history[sourceName];
    state.runs += 1;
    state.lastRunAt = new Date().toISOString();

    if (error) {
      state.failures += 1;
      state.lastError = error.message;
      if (state.failures >= 3) {
        state.circuitBreakerTripped = true;
      }
      return;
    }

    state.successes += 1;
    state.circuitBreakerTripped = false;
    state.lastError = null;

    if (listings.length === 0) {
      return;
    }

    // Calculate yield for this run
    let addressCount = 0;
    let openingBidCount = 0;
    let dateCount = 0;
    let photoCount = 0;

    for (const listing of listings) {
      if (listing.address && listing.address.trim() !== "") addressCount++;
      if (listing.openingBid && listing.openingBid > 0) openingBidCount++;
      if (listing.saleDate && listing.saleDate.trim() !== "") dateCount++;
      if (listing.photo && listing.photo.trim() !== "") photoCount++;
    }

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

    // Drift Detection: If critical fields drop below 50% yield, DOM likely changed
    state.driftDetected = (
      state.yieldMetrics.addressYield < 0.5 ||
      state.yieldMetrics.openingBidYield < 0.5
    );
  }

  /**
   * Retrieves the current health state for all scrapers.
   * @returns {Object}
   */
  getHealthReport() {
    const report = {
      systemStatus: 'healthy',
      totalScrapers: Object.keys(this.history).length,
      scrapersInFault: 0,
      scrapersWithDrift: 0,
      details: {}
    };

    for (const [sourceName, state] of Object.entries(this.history)) {
      if (state.circuitBreakerTripped) report.scrapersInFault += 1;
      if (state.driftDetected) report.scrapersWithDrift += 1;
      
      report.details[sourceName] = {
        ...state,
        // Format yields as percentages for the report
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
    }

    return report;
  }
}

// Singleton instance for global app tracking
const telemetryInstance = new ScraperTelemetry();

module.exports = { ScraperTelemetry, telemetryInstance };
