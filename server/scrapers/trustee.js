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

class TrusteeSaleScraper extends BaseScraper {
  constructor(options = {}) {
    super({ name: 'TrusteeSaleScraper', sourceKey: 'trustee' });
    this.timeoutMs = 15000;
    this.fixtureOnly = options.fixtureOnly !== false && process.env.TRUSTEE_LIVE !== '1';
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
    if (this.fixtureOnly && !options.jurisdiction && process.env.TRUSTEE_LIVE !== '1') {
      console.warn(`[${this.name}] No live collector is implemented; fixture inventory is excluded from ingestion.`);
      return [];
    }

    const jurisdiction = options.jurisdiction || 'clark';
    const targetUrl = this.getAcclaimSearchUrl(jurisdiction, RECORD_DOC_TYPES.NOTICE_OF_TRUSTEE_SALE);
    const html = await this.fetchText(targetUrl);
    const records = this.parseAcclaimSearchHtml(html, jurisdiction);

    const standardized = [];
    for (const rec of records) {
      if (!rec || !rec.instrumentNumber) continue;
      const ref = rec.instrumentNumber.replace(/[^A-Za-z0-9-]/g, '');
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
        sourceFacts: { apn: rec.apn || null },
        provenance: {
          origin: 'live',
          observed: true,
          publisher: `${rec.county} County Recorder`,
          recordId: rec.instrumentNumber,
          platform: 'acclaimweb',
          sourceFacts: { apn: rec.apn || null },
        },
      }));
    }
    return standardized;
  }
}

module.exports = new TrusteeSaleScraper();
module.exports.TrusteeSaleScraper = TrusteeSaleScraper;
module.exports.DEFAULT_JURISDICTIONS = DEFAULT_JURISDICTIONS;
module.exports.RECORD_DOC_TYPES = RECORD_DOC_TYPES;
