const { recordSnapshot } = require('./discovery-snapshots');
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
          report.statesRequested.push(`maricopa:${docType}`);
          report.endpointsTried++;
          try {
            const targetUrl = this.getMaricopaSearchUrl(docType, options);
            const robotsUrl = new URL('/robots.txt',targetUrl).href;
            const rules = await this.fetchText(robotsUrl,{headers:{'User-Agent':'property-crawl-bot/1.0'}});
            if (require('robots-parser')(robotsUrl,rules).isAllowed(targetUrl,'property-crawl-bot/1.0') !== true) throw new Error('MARICOPA_ROBOTS_UNVERIFIED_OR_DENIED');
            const html = await this.fetchText(targetUrl);
            const records = this.parseMaricopaSearchHtml(html, { ...options, docType });
            if (!records.length) throw new Error('RECORDER_QUERY_UNVERIFIED: no validated recorder query results');
            let added = 0;

            for (const rec of records) {
              if (!rec || !rec.recordingNumber) continue;
              await recordSnapshot({sourceKey:'trustee',recordId:rec.recordingNumber,rawPayload:rec,metadata:{sourceUrl:rec.sourceUrl,recordedDate:rec.recordedDate || null}},{snapshotDir:options.snapshotDir});
              if (!rec.sourceUrl) continue;
              if (rec.distressStage === 'PRE_FORECLOSURE' || /NOTICE OF DEFAULT|LIS PENDENS|CERTIFICATE OF SALE/i.test(rec.docType || '')) continue;
              const ref = rec.recordingNumber.replace(/[^A-Za-z0-9-]/g, '');
              const itemKey = `AZ-Maricopa-${ref}-${rec.docType}`;
              if (seenRefs.has(itemKey)) continue;
              seenRefs.add(itemKey);

              const sourceFacts = {
                apn: rec.apn || null,
                docType: rec.docType || null,
                distressStage: rec.distressStage || null,
                recordedDate: rec.recordedDate || null,
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
                address: rec.situsAddress || rec.legalDescription || null,
                apn: rec.apn || null,
                openingBid: null, // Zero-Fabrication: statutory notice records debt, not opening bid
                estLow: null,
                estHigh: null,
                assessed: null,
                saleDate: rec.saleDate || null,
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
        report.statesRequested.push('harris:foreclosure');
        report.endpointsTried++;
        try {
          const targetUrl = this.getHarrisClerkSearchUrl(options);
          const cookies = new Map();
          const transport = async (url, init) => {
            const headers = { ...init.headers };
            if (cookies.size) headers.Cookie = [...cookies].map(([key, value]) => `${key}=${value}`).join('; ');
            const response = await this.fetchImpl(url, { ...init, headers, redirect:'error' });
            for (const cookie of response.headers?.getSetCookie?.() || []) {
              const pair = cookie.split(';')[0], index = pair.indexOf('=');
              if (index > 0) cookies.set(pair.slice(0,index),pair.slice(index+1));
            }
            return response;
          };
          const now = new Date();
          const query = await require('./adapters/harris-clerk-query').queryHarrisClerk({
            requestText:(url, init) => this.fetchText(url, { ...init, fetchImpl:transport }),
            year:options.year ?? now.getUTCFullYear(), month:options.month ?? now.getUTCMonth()+1,
            maxPages:options.maxPages ?? 1, baseUrl:options.baseUrl,
          });
          const records = query.records;
          report.recorderEvidence = {jurisdiction:'harris',year:query.year,month:query.month,publishedTotal:query.publishedTotal,
            capturedDocuments:records.length,truncated:query.truncated,queryComplete:query.complete,listingQualified:false};
          for (const page of query.pages) await recordSnapshot({sourceKey:'trustee',recordId:`harris:${query.year}-${query.month}:page-${page.page}`,
            html:page.html,saveMarkdown:true,metadata:{sourceUrl:targetUrl,kind:'recorder_index',...report.recorderEvidence}},{snapshotDir:options.snapshotDir});
          let added = 0;

          for (const rec of records) {
            if (!rec || !rec.fileNumber) continue;
            await recordSnapshot({sourceKey:'trustee',recordId:rec.fileNumber,rawPayload:rec,metadata:{sourceUrl:rec.sourceUrl,postingDate:rec.postingDate || null,earliestEligibleSaleDate:rec.earliestEligibleSaleDate || null}},{snapshotDir:options.snapshotDir});
            if (!rec.sourceUrl) continue;
            if (rec.evidenceOnly || (!rec.situsAddress && !rec.legalDescription && !rec.apn)) continue;
            const ref = rec.fileNumber.replace(/[^A-Za-z0-9-]/g, '');
            const itemKey = `TX-Harris-${ref}`;
            if (seenRefs.has(itemKey)) continue;
            seenRefs.add(itemKey);

            const sourceFacts = {
              apn: rec.apn || null,
              docType: rec.docType || null,
              distressStage: rec.distressStage || null,
              postingDate: rec.postingDate || null,
              earliestEligibleSaleDate: rec.earliestEligibleSaleDate || null,
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
              address: rec.situsAddress || rec.legalDescription || null,
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
        report.statesRequested.push(`${jurKey}:${docType}`);
        report.endpointsTried++;
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
              saleDate: rec.saleDate || null,
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
    if (report.recorderEvidence && (!report.recorderEvidence.queryComplete || !report.recorderEvidence.listingQualified)) {
      report.truncated = report.recorderEvidence.truncated;
      report.complete = false;
      report.fullSweepComplete = false;
      if (!standardized.length && !report.failures.length) report.outcome = 'evidence_only';
    }

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
