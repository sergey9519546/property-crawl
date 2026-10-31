// server/scrapers/trustee.js
//
// Trustee's Sale Non-Judicial Foreclosure Scraper.
// Source: County Recorders & Statutory Non-Judicial Foreclosure Registries
//
// Scrapes non-judicial power-of-sale auction notices under deed of trust state statutes.

const BaseScraper = require('./base');
const {
  getAcclaimSearchUrl,
  parseAcclaimRecordRow,
  parseAcclaimSearchHtml,
  DEFAULT_JURISDICTIONS,
  RECORD_DOC_TYPES,
} = require('./adapters/acclaimweb');
const {
  createRunReport,
  recordUnitFailure,
  recordUnitSuccess,
  finalizeRunReport,
} = require('./run-report');

class TrusteeSaleScraper extends BaseScraper {
  constructor(options = {}) {
    super({ name: 'TrusteeSaleScraper', sourceKey: 'trustee', ...options });
    this.timeoutMs = 15000;
    this.fixtureOnly = options.fixtureOnly !== false && process.env.TRUSTEE_LIVE !== '1';
    this.lastRunReport = null;
  }

  getAcclaimSearchUrl(jurisdiction, docType) {
    return getAcclaimSearchUrl(jurisdiction, docType);
  }

  parseAcclaimSearchHtml(html, jurisdiction) {
    return parseAcclaimSearchHtml(html, jurisdiction);
  }

  parseAcclaimRecordRow(rowHtml, jurisdiction) {
    return parseAcclaimRecordRow(rowHtml, jurisdiction);
  }

  async scrapeFeed(options = {}) {
    const report = createRunReport('trustee', {
      endpoints: ['acclaimweb-recorder'],
      jurisdiction: options.jurisdiction || null,
    });
    this.lastRunReport = report;

    if (this.fixtureOnly && !options.jurisdiction && !options.jurisdictions && process.env.TRUSTEE_LIVE !== '1') {
      console.warn(`[${this.name}] No live collector is implemented; fixture inventory is excluded from ingestion.`);
      finalizeRunReport(report, { emitted: 0 });
      report.outcome = 'empty';
      report.complete = true;
      return [];
    }

    const jurisdictions = options.jurisdiction
      ? [options.jurisdiction]
      : (Array.isArray(options.jurisdictions) ? options.jurisdictions : Object.keys(DEFAULT_JURISDICTIONS));

    const docTypes = options.docType
      ? [options.docType]
      : [RECORD_DOC_TYPES.NOTICE_OF_TRUSTEE_SALE, RECORD_DOC_TYPES.NOTICE_OF_DEFAULT];

    const standardized = [];
    const seenRefs = new Set();

    for (const jurisdiction of jurisdictions) {
      for (const docType of docTypes) {
        try {
          const targetUrl = this.getAcclaimSearchUrl(jurisdiction, docType);
          const html = await this.fetchText(targetUrl);
          const records = this.parseAcclaimSearchHtml(html, jurisdiction);
          let added = 0;

          for (const rec of records) {
            if (!rec || !rec.instrumentNumber) continue;
            const ref = rec.instrumentNumber.replace(/[^A-Za-z0-9-]/g, '');
            const itemKey = `${rec.state}-${rec.county}-${ref}-${rec.docType}`;
            if (seenRefs.has(itemKey)) continue;
            seenRefs.add(itemKey);

            const sourceFacts = {
              apn: rec.apn || null,
              docType: rec.docType || null,
              distressStage: rec.distressStage || null,
              grantor: rec.grantor || null,
              grantee: rec.grantee || null,
              instrumentNumber: rec.instrumentNumber || null,
            };

            standardized.push(this.standardizeListing({
              id: `TRUSTEE-${rec.state}-${rec.county.slice(0, 3).toUpperCase()}-${ref}`,
              source: 'trustee',
              state: rec.state,
              county: rec.county,
              city: null,
              zip: null,
              address: rec.legalDescription || `${rec.county} County Recorded Instrument ${rec.instrumentNumber}`,
              apn: rec.apn || null,
              openingBid: null, // Zero-Fabrication: statutory notice carries debt, not opening bid
              estLow: null,
              estHigh: null,
              assessed: null,
              saleDate: rec.recordedDate ? new Date(rec.recordedDate).toISOString().slice(0, 10) : null,
              plaintiff: rec.grantee || null,
              defendant: rec.grantor || null,
              judgment: null,
              attorney: null,
              occupancy: null,
              deposit: null,
              sourceUrl: rec.sourceUrl,
              raw: JSON.stringify(rec),
              sourceFacts,
              provenance: {
                origin: 'live',
                observed: true,
                publisher: `${rec.county} County Recorder`,
                recordId: rec.instrumentNumber,
                platform: 'acclaimweb',
                sourceFacts,
              },
            }));
            added++;
          }
          recordUnitSuccess(report, `${jurisdiction}:${docType}`, added);
        } catch (err) {
          recordUnitFailure(report, `${jurisdiction}:${docType}`, err);
          console.warn(`[${this.name}] Failed Acclaim search on ${jurisdiction} (${docType}): ${err.message}`);
        }
      }
    }

    finalizeRunReport(report, { emitted: standardized.length });
    report.outcome = standardized.length ? 'success' : 'empty';
    report.complete = report.failures.length === 0;

    return standardized;
  }
}

module.exports = new TrusteeSaleScraper();
module.exports.TrusteeSaleScraper = TrusteeSaleScraper;
module.exports.DEFAULT_JURISDICTIONS = DEFAULT_JURISDICTIONS;
module.exports.RECORD_DOC_TYPES = RECORD_DOC_TYPES;
