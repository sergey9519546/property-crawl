'use strict';

/**
 * County/municipal surplus enrollment template collector.
 *
 * Local surplus (RFP, sealed bid, excess land) has no national feed. This
 * adapter is scheduled so the "local surplus" end is always present in
 * Source Radar. Live collection requires LOCAL_SURPLUS_DISCOVERY_URL
 * (official HTTPS county/municipal publisher) after operator validation.
 */

const BaseScraper = require('./base');
const {
  createRunReport,
  finalizeRunReport,
} = require('./run-report');
const { validateEnrollmentUrl } = require('./government-land');

class LocalSurplusScraper extends BaseScraper {
  constructor(options = {}) {
    super({ name: 'LocalSurplusCollector', sourceKey: 'local-surplus' });
    this.catalogId = 'county-surplus-property';
    this.enrollmentUrl = options.enrollmentUrl
      ?? process.env.LOCAL_SURPLUS_DISCOVERY_URL
      ?? '';
    this.lastRunReport = null;
  }

  async scrapeFeed() {
    return this.executeWithRetry(async () => {
      const report = createRunReport('local-surplus', {
        end: 'local_surplus',
        enrollmentUrl: this.enrollmentUrl || null,
        catalogTemplates: ['county-surplus-property'],
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
            ? 'No LOCAL_SURPLUS_DISCOVERY_URL enrolled; catalog template only. Each county/municipality must be enrolled separately.'
            : `Enrollment URL rejected: ${validation.reason}`,
        });
        finalizeRunReport(report, { emitted: 0 });
        report.outcome = 'skipped_not_enrolled';
        report.complete = false;
        report.fullSweepComplete = false;
        report.observationError = 'local_surplus end is enrollment-only until LOCAL_SURPLUS_DISCOVERY_URL is configured';
        return [];
      }

      report.statesFailed.push('enrollment');
      report.failures.push({
        unit: 'enrollment',
        kind: 'parser_not_implemented',
        message: `Enrollment URL accepted (${validation.url}) but no surplus HTML parser is bound; use source intake for official bid packets until an adapter is written.`,
      });
      finalizeRunReport(report, { emitted: 0 });
      report.outcome = 'failed';
      throw new Error('LOCAL_SURPLUS_PARSER_NOT_IMPLEMENTED: enrollment URL set but no surplus parser is bound');
    });
  }
}

module.exports = new LocalSurplusScraper();
module.exports.LocalSurplusScraper = LocalSurplusScraper;
module.exports.SOURCE_KEY = 'local-surplus';
