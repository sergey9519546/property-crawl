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
const { extractWithScrapling, isScraplingEnabled } = require('./scrapling-bridge');
const { runEnrolledTemplateScrape } = require('./government-land');

class LocalSurplusScraper extends BaseScraper {
  constructor(options = {}) {
    super({ name: 'LocalSurplusCollector', sourceKey: 'local-surplus', ...options });
    this.catalogId = 'county-surplus-property';
    this.enrollmentUrl = options.enrollmentUrl
      ?? process.env.LOCAL_SURPLUS_DISCOVERY_URL
      ?? '';
    this.lastRunReport = null;
    this.useScrapling = options.useScrapling ?? isScraplingEnabled('local-surplus');
    this.extract = options.extractImpl || extractWithScrapling;
  }

  async scrapeFeed() {
    return this.executeWithRetry(() => runEnrolledTemplateScrape(this, {
      sourceKey: 'local-surplus',
      end: 'local_surplus',
      catalogTemplates: ['county-surplus-property'],
      publisher: 'County / Municipal Surplus',
      envVarName: 'LOCAL_SURPLUS_DISCOVERY_URL',
      notConfiguredMessage: 'No LOCAL_SURPLUS_DISCOVERY_URL enrolled; catalog template only. Each county/municipality must be enrolled separately.',
      observationErrorNotEnrolled: 'local_surplus end is enrollment-only until LOCAL_SURPLUS_DISCOVERY_URL is configured',
      parserNotImplementedMessage: (url) => `Enrollment URL accepted (${url}) but no surplus HTML parser is bound; use source intake for official bid packets until an adapter is written.`,
      observationErrorParserMissing: 'local-surplus parser not implemented for enrolled publisher',
      errorCodeMessage: 'LOCAL_SURPLUS_PARSER_NOT_IMPLEMENTED: enrollment URL set but no surplus parser is bound',
    }));
  }
}

module.exports = new LocalSurplusScraper();
module.exports.LocalSurplusScraper = LocalSurplusScraper;
module.exports.SOURCE_KEY = 'local-surplus';
