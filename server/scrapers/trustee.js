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
  getMaricopaSearchUrl,
  parseMaricopaRecordRow,
  parseMaricopaSearchHtml,
  MARICOPA_DOC_TYPES,
} = require('./adapters/maricopa-recorder');
const {
  getHarrisClerkSearchUrl,
  parseHarrisClerkNotice,
  parseHarrisClerkHtml,
  calculateTexasForeclosureSaleDate,
  HARRIS_DOC_TYPES,
} = require('./adapters/harris-clerk-foreclosure');
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

  // AcclaimWeb recorder helpers
  getAcclaimSearchUrl(jurisdiction, docType) {
    return getAcclaimSearchUrl(jurisdiction, docType);
  }

  parseAcclaimSearchHtml(html, jurisdiction) {
    return parseAcclaimSearchHtml(html, jurisdiction);
  }

  parseAcclaimRecordRow(rowHtml, jurisdiction) {
    return parseAcclaimRecordRow(rowHtml, jurisdiction);
  }

  // Maricopa County recorder helpers
  getMaricopaSearchUrl(docType, options) {
    return getMaricopaSearchUrl(docType, options);
  }

  parseMaricopaSearchHtml(html, options) {
    return parseMaricopaSearchHtml(html, options);
  }

  parseMaricopaRecordRow(rowHtml, options) {
    return parseMaricopaRecordRow(rowHtml, options);
  }

  // Harris County clerk foreclosure helpers
  getHarrisClerkSearchUrl(options) {
    return getHarrisClerkSearchUrl(options);
  }

  parseHarrisClerkNotice(noticeHtml, options) {
    return parseHarrisClerkNotice(noticeHtml, options);
  }

  parseHarrisClerkHtml(html, options) {
    return parseHarrisClerkHtml(html, options);
  }

  calculateTexasForeclosureSaleDate(postingDate) {
    return calculateTexasForeclosureSaleDate(postingDate);
  }

  async scrapeFeed(options = {}) {
    const report = createRunReport('trustee', {
      endpoints: ['acclaimweb-recorder', 'maricopa-recorder', 'harris-clerk-foreclosure'],
      jurisdiction: options.jurisdiction || null,
    });
    this.lastRunReport = report;

    if (
      this.fixtureOnly &&
      !options.jurisdiction &&
      !options.jurisdictions &&
      !options.platform &&
      process.env.TRUSTEE_LIVE !== '1'
    ) {
      console.warn(`[${this.name}] No live collector is implemented; fixture inventory is excluded from ingestion.`);
      finalizeRunReport(report, { emitted: 0 });
      report.outcome = 'empty';
      report.complete = true;
      return [];
    }

    const jurisdictions = options.jurisdiction
      ? [options.jurisdiction]
      : (Array.isArray(options.jurisdictions) ? options.jurisdictions : Object.keys(DEFAULT_JURISDICTIONS));

    const standardized = [];
    const seenRefs = new Set();

    for (const rawJur of jurisdictions) {
      const jurKey = String(rawJur || '').toLowerCase().trim();

      // -----------------------------------------------------------------------
      // 1. Maricopa County, AZ Recorder (recorder.maricopa.gov)
      // -----------------------------------------------------------------------
      if (jurKey === 'maricopa') {
        const maricopaDocTypes = options.docType
          ? [options.docType]
          : [MARICOPA_DOC_TYPES.NOTICE_OF_TRUSTEE_SALE, MARICOPA_DOC_TYPES.NOTICE_OF_DEFAULT];

        for (const docType of maricopaDocTypes) {
          try {
            const targetUrl = this.getMaricopaSearchUrl(docType, options);
            const html = await this.fetchText(targetUrl);
            const records = this.parseMaricopaSearchHtml(html, { ...options, docType });
            let added = 0;

            for (const rec of records) {
              if (!rec || !rec.recordingNumber) continue;
              const ref = rec.recordingNumber.replace(/[^A-Za-z0-9-]/g, '');
              const itemKey = `AZ-Maricopa-${ref}-${rec.docType}`;
              if (seenRefs.has(itemKey)) continue;
              seenRefs.add(itemKey);

              const sourceFacts = {
                apn: rec.apn || null,
                docType: rec.docType || null,
                distressStage: rec.distressStage || null,
                grantor: rec.grantor || null,
                grantee: rec.grantee || null,
                recordingNumber: rec.recordingNumber || null,
                instrumentNumber: rec.recordingNumber || null,
              };

              standardized.push(this.standardizeListing({
                id: `TRUSTEE-AZ-MAR-${ref}`,
                source: 'trustee',
                state: 'AZ',
                county: 'Maricopa',
                city: null,
                zip: null,
                address: rec.legalDescription || `Maricopa County Recorded Instrument ${rec.recordingNumber}`,
                apn: rec.apn || null,
                openingBid: null, // Zero-Fabrication: statutory notice records debt, not opening bid
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
                  publisher: 'Maricopa County Recorder',
                  recordId: rec.recordingNumber,
                  platform: 'maricopa-recorder',
                  sourceFacts,
                },
              }));
              added++;
            }
            recordUnitSuccess(report, `maricopa:${docType}`, added);
          } catch (err) {
            recordUnitFailure(report, `maricopa:${docType}`, err);
            console.warn(`[${this.name}] Failed Maricopa search on docType ${docType}: ${err.message}`);
          }
        }
        continue;
      }

      // -----------------------------------------------------------------------
      // 2. Harris County, TX Clerk Foreclosure Filings (cclerk.hctx.net)
      // -----------------------------------------------------------------------
      if (jurKey === 'harris') {
        try {
          const targetUrl = this.getHarrisClerkSearchUrl(options);
          const html = await this.fetchText(targetUrl);
          const records = this.parseHarrisClerkHtml(html, options);
          let added = 0;

          for (const rec of records) {
            if (!rec || !rec.fileNumber) continue;
            const ref = rec.fileNumber.replace(/[^A-Za-z0-9-]/g, '');
            const itemKey = `TX-Harris-${ref}`;
            if (seenRefs.has(itemKey)) continue;
            seenRefs.add(itemKey);

            const sourceFacts = {
              apn: rec.apn || null,
              docType: rec.docType || null,
              distressStage: rec.distressStage || null,
              postingDate: rec.postingDate || null,
              debtor: rec.debtor || null,
              trustee: rec.trustee || null,
              fileNumber: rec.fileNumber || null,
              instrumentNumber: rec.fileNumber || null,
            };

            standardized.push(this.standardizeListing({
              id: `TRUSTEE-TX-HAR-${ref}`,
              source: 'trustee',
              state: 'TX',
              county: 'Harris',
              city: 'Houston',
              zip: null,
              address: rec.situsAddress || rec.legalDescription || `Harris County Foreclosure Filing ${rec.fileNumber}`,
              apn: rec.apn || null,
              openingBid: null, // Zero-Fabrication: statutory notice records debt balance, not opening bid
              estLow: null,
              estHigh: null,
              assessed: null,
              saleDate: rec.saleDate || null,
              plaintiff: rec.trustee || null,
              defendant: rec.debtor || null,
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
                publisher: 'Harris County Clerk',
                recordId: rec.fileNumber,
                platform: 'harris-clerk-foreclosure',
                sourceFacts,
              },
            }));
            added++;
          }
          recordUnitSuccess(report, `harris:foreclosure`, added);
        } catch (err) {
          recordUnitFailure(report, `harris:foreclosure`, err);
          console.warn(`[${this.name}] Failed Harris foreclosure notice search: ${err.message}`);
        }
        continue;
      }

      // -----------------------------------------------------------------------
      // 3. AcclaimWeb Multi-County Jurisdictions (Clark, Washoe, etc.)
      // -----------------------------------------------------------------------
      const docTypes = options.docType
        ? [options.docType]
        : [RECORD_DOC_TYPES.NOTICE_OF_TRUSTEE_SALE, RECORD_DOC_TYPES.NOTICE_OF_DEFAULT];

      for (const docType of docTypes) {
        try {
          const targetUrl = this.getAcclaimSearchUrl(jurKey, docType);
          const html = await this.fetchText(targetUrl);
          const records = this.parseAcclaimSearchHtml(html, jurKey);
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
          recordUnitSuccess(report, `${jurKey}:${docType}`, added);
        } catch (err) {
          recordUnitFailure(report, `${jurKey}:${docType}`, err);
          console.warn(`[${this.name}] Failed Acclaim search on ${jurKey} (${docType}): ${err.message}`);
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
module.exports.MARICOPA_DOC_TYPES = MARICOPA_DOC_TYPES;
module.exports.HARRIS_DOC_TYPES = HARRIS_DOC_TYPES;
module.exports.calculateTexasForeclosureSaleDate = calculateTexasForeclosureSaleDate;
