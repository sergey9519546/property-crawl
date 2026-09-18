'use strict';

/**
 * Government land-sale enrollment template collector.
 *
 * There is no universal U.S. federal/state land-sale feed. This adapter is
 * scheduled so the "government land" end is always present in Source Radar.
 * It never invents inventory. Live collection runs only when an operator
 * enrolls an official HTTPS discovery URL via GOV_LAND_DISCOVERY_URL after
 * validating the issuer, legal description format, and sale terms.
 */

const BaseScraper = require('./base');
const {
  createRunReport,
  recordUnitFailure,
  finalizeRunReport,
} = require('./run-report');

function validateEnrollmentUrl(raw) {
  const url = String(raw || '').trim();
  if (!url) return { ok: false, reason: 'not-configured' };
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: 'invalid-url' };
  }
  if (parsed.protocol !== 'https:') return { ok: false, reason: 'https-required' };
  if (parsed.username || parsed.password) return { ok: false, reason: 'credentials-rejected' };
  const host = parsed.hostname.toLowerCase();
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') {
    return { ok: false, reason: 'loopback-rejected' };
  }
  return { ok: true, url: parsed.toString() };
}

class GovernmentLandScraper extends BaseScraper {
  constructor(options = {}) {
    super({ name: 'GovernmentLandCollector', sourceKey: 'government-land' });
    this.catalogId = 'state-land-auctions';
    this.enrollmentUrl = options.enrollmentUrl
      ?? process.env.GOV_LAND_DISCOVERY_URL
      ?? '';
    this.lastRunReport = null;
  }

  async scrapeFeed() {
    return this.executeWithRetry(async () => {
      const report = createRunReport('government-land', {
        end: 'government_land',
        enrollmentUrl: this.enrollmentUrl || null,
        catalogTemplates: ['blm-public-land-sales', 'state-land-auctions'],
      });
      report.statesRequested = ['enrollment'];
      report.endpointsTried = 1;
      this.lastRunReport = report;

      const validation = validateEnrollmentUrl(this.enrollmentUrl);
      if (!validation.ok) {
        report.statesFailed.push('enrollment');
        report.failures.push({
          unit: 'enrollment',
          kind: 'not_enrolled',
          message: validation.reason === 'not-configured'
            ? 'No GOV_LAND_DISCOVERY_URL enrolled; catalog templates only (BLM / state land offices). Live land-sale inventory requires jurisdiction enrollment.'
            : `Enrollment URL rejected: ${validation.reason}`,
        });
        finalizeRunReport(report, { emitted: 0 });
        report.outcome = 'skipped_not_enrolled';
        report.complete = false;
        report.fullSweepComplete = false;
        report.observationError = 'government_land end is enrollment-only until GOV_LAND_DISCOVERY_URL is configured';
        // Empty array is correct here: we did not fetch; we refuse to invent land sales.
        return [];
      }

      // Enrolled but this template collector does not yet parse publisher HTML.
      // Fail closed — never return invented parcels.
      report.statesFailed.push('enrollment');
      report.failures.push({
        unit: 'enrollment',
        kind: 'parser_not_implemented',
        message: `Enrollment URL accepted (${validation.url}) but no land-sale parser is bound; import official notices via source intake until an adapter is written.`,
      });
      finalizeRunReport(report, { emitted: 0 });
      report.outcome = 'failed';
      report.complete = false;
      report.observationError = 'government-land parser not implemented for enrolled publisher';
      throw new Error('GOV_LAND_PARSER_NOT_IMPLEMENTED: enrollment URL set but no land-sale HTML parser is bound');
    });
  }
}

module.exports = new GovernmentLandScraper();
module.exports.GovernmentLandScraper = GovernmentLandScraper;
module.exports.validateEnrollmentUrl = validateEnrollmentUrl;
module.exports.SOURCE_KEY = 'government-land';
