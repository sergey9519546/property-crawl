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
  queryLiveAcclaimPortal,
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
  getCookRecorderSearchUrl,
  parseCookRecordRow,
  parseCookSearchHtml,
  COOK_DOC_TYPES,
} = require('./adapters/cook-recorder');
const {
  getMiamiDadeClerkSearchUrl,
  parseMiamiDadeRecordRow,
  parseMiamiDadeSearchHtml,
  MIAMI_DADE_DOC_TYPES,
} = require('./adapters/miami-dade-clerk');
const {
  createRunReport,
  recordUnitFailure,
  recordUnitSuccess,
  finalizeRunReport,
} = require('./run-report');

const DEFAULT_TRUSTEE_JURISDICTIONS = Object.freeze([
  ...Object.keys(DEFAULT_JURISDICTIONS),
  'maricopa',
  'harris',
  'cook',
  'miami-dade',
]);

function accumulateRecorderEvidence(report, jurKey, entry = {}) {
  if (!report) return null;
  const key = String(jurKey || entry.jurisdiction || entry.platform || 'unknown').toLowerCase();
  const prev = report.recorderEvidence && typeof report.recorderEvidence === 'object'
    ? report.recorderEvidence
    : {};
  const nextByJur = { ...(prev.byJurisdiction || {}), [key]: { ...entry, jurisdiction: entry.jurisdiction || key } };
  const entries = Object.values(nextByJur);
  const capturedDocuments = entries.reduce((sum, item) => sum + (Number(item.capturedDocuments) || 0), 0);
  const qualifiedListings = entries.reduce((sum, item) => sum + (Number(item.qualifiedListings) || 0), 0);
  const droppedNoIdentity = entries.reduce((sum, item) => sum + (Number(item.droppedNoIdentity) || 0), 0);
  const publishedTotal = entries.reduce((sum, item) => sum + (Number(item.publishedTotal) || 0), 0);
  const truncated = entries.some((item) => Boolean(item.truncated));
  const queryComplete = entries.every((item) => item.queryComplete !== false);
  const listingQualified = qualifiedListings > 0 || entries.some((item) => Boolean(item.listingQualified));
  const evidenceOnlySamples = entries
    .flatMap((item) => (Array.isArray(item.evidenceOnlySamples) ? item.evidenceOnlySamples : []))
    .slice(0, 20);
  report.recorderEvidence = {
    ...(entries.length === 1 ? entry : {}),
    jurisdictions: nextByJur,
    byJurisdiction: nextByJur,
    capturedDocuments,
    qualifiedListings,
    droppedNoIdentity,
    publishedTotal,
    truncated,
    queryComplete,
    listingQualified,
    evidenceOnlySamples,
  };
  return report.recorderEvidence;
}

class TrusteeSaleScraper extends BaseScraper {
  constructor(options = {}) {
    super({ name: 'TrusteeSaleScraper', sourceKey: 'trustee', ...options });
    this.timeoutMs = 15000;
    this.fixtureOnly = Boolean(options.fixtureOnly);
    this.lastRunReport = null;
  }

  getJurisdictionCircuitBreaker(scopeKey, url = null) {
    let host = null;
    if (url) {
      try { host = new URL(url).hostname; } catch {}
    }
    return this.getScopedCircuitBreaker(host || scopeKey);
  }

  async fetchJurisdictionText(url, scopeKey, fetchOptions = {}) {
    const circuitBreaker = this.getJurisdictionCircuitBreaker(scopeKey, url);
    if (circuitBreaker.isOpen()) {
      throw new Error(`[${this.name}] Skipped ${scopeKey}: host circuit breaker is OPEN`);
    }
    return this.fetchText(url, { ...fetchOptions, circuitBreaker });
  }

  // AcclaimWeb recorder helpers
  getAcclaimSearchUrl(jurisdiction, docType, options) {
    return getAcclaimSearchUrl(jurisdiction, docType, options);
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

  // Cook County, IL Clerk recorder helpers
  getCookRecorderSearchUrl(docType, options) {
    return getCookRecorderSearchUrl(docType, options);
  }

  parseCookRecordRow(rowHtml, options) {
    return parseCookRecordRow(rowHtml, options);
  }

  parseCookSearchHtml(html, options) {
    return parseCookSearchHtml(html, options);
  }

  // Miami-Dade County, FL Clerk Official Records helpers
  getMiamiDadeClerkSearchUrl(options) {
    return getMiamiDadeClerkSearchUrl(options);
  }

  parseMiamiDadeRecordRow(rowHtml, options) {
    return parseMiamiDadeRecordRow(rowHtml, options);
  }

  parseMiamiDadeSearchHtml(html, options) {
    return parseMiamiDadeSearchHtml(html, options);
  }

  async scrapeFeed(options = {}) {
    const report = createRunReport('trustee', {
      endpoints: ['acclaimweb-recorder', 'maricopa-recorder', 'harris-clerk-foreclosure', 'cook-recorder', 'miami-dade-clerk'],
      jurisdiction: options.jurisdiction || null,
    });
    this.lastRunReport = report;

    const isUnconfiguredTestNoop =
      (process.env.NODE_ENV === 'test' || Boolean(process.env.NODE_TEST_CONTEXT)) &&
      (!this.fetchImpl || this.fetchImpl === globalThis.fetch) &&
      this.fetchText === BaseScraper.prototype.fetchText;
    if (
      (this.fixtureOnly || isUnconfiguredTestNoop) &&
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
      : (Array.isArray(options.jurisdictions) ? options.jurisdictions : DEFAULT_TRUSTEE_JURISDICTIONS);

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
            const rules = await this.fetchJurisdictionText(robotsUrl, jurKey, { headers: { 'User-Agent': 'property-crawl-bot/1.0' } });
            if (require('robots-parser')(robotsUrl,rules).isAllowed(targetUrl,'property-crawl-bot/1.0') !== true) throw new Error('MARICOPA_ROBOTS_UNVERIFIED_OR_DENIED');
            const html = await this.fetchJurisdictionText(targetUrl, jurKey);
            const records = this.parseMaricopaSearchHtml(html, { ...options, docType });
            if (!records.length) throw new Error('RECORDER_QUERY_UNVERIFIED: no validated recorder query results');
            let added = 0;
            let dropped = 0;
            let captured = 0;
            const samples = [];

            for (const rec of records) {
              if (!rec || !rec.recordingNumber) continue;
              captured += 1;
              await recordSnapshot({sourceKey:'trustee',recordId:rec.recordingNumber,rawPayload:rec,metadata:{sourceUrl:rec.sourceUrl,recordedDate:rec.recordedDate || null}},{snapshotDir:options.snapshotDir});
              if (!rec.sourceUrl || rec.distressStage === 'PRE_FORECLOSURE' || /NOTICE OF DEFAULT|LIS PENDENS|CERTIFICATE OF SALE/i.test(rec.docType || '')) {
                dropped += 1;
                if (samples.length < 20) {
                  samples.push({
                    jurisdiction: 'maricopa',
                    instrumentNumber: rec.recordingNumber,
                    docType: rec.docType || null,
                    recordedDate: rec.recordedDate || null,
                    sourceUrl: rec.sourceUrl || null,
                  });
                }
                continue;
              }
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
            const prevMar = report.recorderEvidence?.byJurisdiction?.maricopa || {};
            const nextQualified = (prevMar.qualifiedListings || 0) + added;
            accumulateRecorderEvidence(report, 'maricopa', {
              jurisdiction: 'maricopa',
              platform: 'maricopa-recorder',
              capturedDocuments: (prevMar.capturedDocuments || 0) + captured,
              qualifiedListings: nextQualified,
              droppedNoIdentity: (prevMar.droppedNoIdentity || 0) + dropped,
              evidenceOnlySamples: [...(prevMar.evidenceOnlySamples || []), ...samples].slice(0, 20),
              truncated: Boolean(prevMar.truncated),
              queryComplete: prevMar.queryComplete !== false,
              listingQualified: nextQualified > 0,
            });
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
            requestText:(url, init) => this.fetchJurisdictionText(url, jurKey, { ...init, fetchImpl:transport }),
            year:options.year ?? now.getUTCFullYear(), month:options.month ?? now.getUTCMonth()+1,
            maxPages:options.maxPages ?? 1, baseUrl:options.baseUrl,
          });
          const records = query.records;
          const harrisEvidence = {
            jurisdiction: 'harris',
            platform: 'harris-clerk-foreclosure',
            year: query.year,
            month: query.month,
            publishedTotal: query.publishedTotal,
            capturedDocuments: records.length,
            qualifiedListings: 0,
            droppedNoIdentity: records.length,
            truncated: query.truncated,
            queryComplete: query.complete,
            listingQualified: false,
          };
          accumulateRecorderEvidence(report, 'harris', harrisEvidence);
          for (const page of query.pages) await recordSnapshot({sourceKey:'trustee',recordId:`harris:${query.year}-${query.month}:page-${page.page}`,
            html:page.html,saveMarkdown:true,metadata:{sourceUrl:targetUrl,kind:'recorder_index',...harrisEvidence}},{snapshotDir:options.snapshotDir});
          let added = 0;

          for (const rec of records) {
            if (!rec || !rec.fileNumber) continue;
            await recordSnapshot({sourceKey:'trustee',recordId:rec.fileNumber,rawPayload:rec,metadata:{sourceUrl:rec.sourceUrl,postingDate:rec.postingDate || null,earliestEligibleSaleDate:rec.earliestEligibleSaleDate || null,reviewRequired:Boolean(rec.evidenceOnly && options.intakeStorePath),confidenceScore:rec.evidenceOnly ? 0.0 : 1.0}},{snapshotDir:options.snapshotDir,intakeStorePath:options.intakeStorePath});
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
          accumulateRecorderEvidence(report, 'harris', {
            jurisdiction: 'harris',
            platform: 'harris-clerk-foreclosure',
            year: query.year,
            month: query.month,
            publishedTotal: query.publishedTotal,
            capturedDocuments: records.length,
            qualifiedListings: added,
            droppedNoIdentity: Math.max(0, records.length - added),
            truncated: query.truncated,
            queryComplete: query.complete,
            listingQualified: added > 0,
          });
          recordUnitSuccess(report, `harris:foreclosure`, added);
        } catch (err) {
          recordUnitFailure(report, `harris:foreclosure`, err);
          console.warn(`[${this.name}] Failed Harris foreclosure notice search: ${err.message}`);
        }
        continue;
      }

      // -----------------------------------------------------------------------
      // 3. Cook County, IL Clerk Recording Division (recording.cookcountyclerkil.gov)
      // -----------------------------------------------------------------------
      if (jurKey === 'cook') {
        const cookDocTypes = options.docType
          ? [options.docType]
          : [COOK_DOC_TYPES.SHERIFF_SALE_NOTICE, COOK_DOC_TYPES.LIS_PENDENS_FORECLOSURE];

        for (const docType of cookDocTypes) {
          report.statesRequested.push(`cook:${docType}`);
          report.endpointsTried++;
          try {
            const targetUrl = this.getCookRecorderSearchUrl(docType, options);
            const html = await this.fetchJurisdictionText(targetUrl, jurKey);
            const records = this.parseCookSearchHtml(html, { ...options, docType });
            let added = 0;

            for (const rec of records) {
              if (!rec || (!rec.recordingNumber && !rec.pin && !rec.caseNumber)) continue;
              const recId = rec.recordingNumber || rec.caseNumber || rec.pin;
              await recordSnapshot(
                {
                  sourceKey: 'trustee',
                  recordId: `cook:${recId}`,
                  rawPayload: rec,
                  metadata: { sourceUrl: rec.sourceUrl, recordedDate: rec.recordedDate || null },
                },
                { snapshotDir: options.snapshotDir }
              );
              if (!rec.sourceUrl) continue;
              const ref = String(recId).replace(/[^A-Za-z0-9-]/g, '');
              const itemKey = `IL-Cook-${ref}-${rec.docType}`;
              if (seenRefs.has(itemKey)) continue;
              seenRefs.add(itemKey);

              const sourceFacts = {
                apn: rec.pin || rec.apn || null,
                pin: rec.pin || null,
                caseNumber: rec.caseNumber || null,
                docType: rec.docType || null,
                distressStage: rec.distressStage || null,
                recordedDate: rec.recordedDate || null,
                grantor: rec.grantor || rec.defendant || null,
                grantee: rec.grantee || rec.plaintiff || null,
                recordingNumber: rec.recordingNumber || null,
                instrumentNumber: rec.instrumentNumber || null,
              };

              standardized.push(this.standardizeListing({
                id: `TRUSTEE-IL-COO-${ref}`,
                source: 'trustee',
                state: 'IL',
                county: 'Cook',
                city: 'Chicago',
                zip: null,
                address: rec.legalDescription || null,
                apn: rec.pin || rec.apn || null,
                openingBid: null, // Zero-Fabrication: statutory recorder notice records suit/sale notice, never opening bid
                estLow: null,
                estHigh: null,
                assessed: null,
                saleDate: null,
                plaintiff: rec.plaintiff || rec.grantee || null,
                defendant: rec.defendant || rec.grantor || null,
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
                  publisher: 'Cook County Clerk Recording Division',
                  recordId: String(recId),
                  platform: 'cook-recorder',
                  sourceFacts,
                },
              }));
              added++;
            }
            recordUnitSuccess(report, `cook:${docType}`, added);
          } catch (err) {
            recordUnitFailure(report, `cook:${docType}`, err);
            console.warn(`[${this.name}] Failed Cook County search on docType ${docType}: ${err.message}`);
          }
        }
        continue;
      }

      // -----------------------------------------------------------------------
      // 4. Miami-Dade County, FL Clerk Official Records (onrecords.miamidadeclerk.gov)
      // -----------------------------------------------------------------------
      if (jurKey === 'miami-dade' || jurKey === 'miamidade') {
        const miamiDocTypes = options.docType
          ? [options.docType]
          : [MIAMI_DADE_DOC_TYPES.NOTICE_OF_SALE, MIAMI_DADE_DOC_TYPES.LIS_PENDENS];

        for (const docType of miamiDocTypes) {
          report.statesRequested.push(`miamidade:${docType}`);
          report.endpointsTried++;
          try {
            const targetUrl = this.getMiamiDadeClerkSearchUrl({ ...options, docType });
            const html = await this.fetchJurisdictionText(targetUrl, jurKey);
            const records = this.parseMiamiDadeSearchHtml(html, { ...options, docType });
            let added = 0;

            for (const rec of records) {
              if (!rec || (!rec.cfn && !rec.folio && !rec.caseNumber)) continue;
              const recId = rec.cfn || rec.caseNumber || rec.folio;
              await recordSnapshot(
                {
                  sourceKey: 'trustee',
                  recordId: `miamidade:${recId}`,
                  rawPayload: rec,
                  metadata: { sourceUrl: rec.sourceUrl, recordedDate: rec.recordedDate || null },
                },
                { snapshotDir: options.snapshotDir }
              );
              if (!rec.sourceUrl) continue;
              const ref = String(recId).replace(/[^A-Za-z0-9-]/g, '');
              const itemKey = `FL-MiamiDade-${ref}-${rec.docType}`;
              if (seenRefs.has(itemKey)) continue;
              seenRefs.add(itemKey);

              const sourceFacts = {
                apn: rec.folio || rec.apn || null,
                folio: rec.folio || null,
                caseNumber: rec.caseNumber || null,
                docType: rec.docType || null,
                distressStage: rec.distressStage || null,
                recordedDate: rec.recordedDate || null,
                grantor: rec.grantor || rec.defendant || null,
                grantee: rec.grantee || rec.plaintiff || null,
                recordingNumber: rec.cfn || rec.recordingNumber || null,
                instrumentNumber: rec.instrumentNumber || null,
              };

              standardized.push(this.standardizeListing({
                id: `TRUSTEE-FL-MIA-${ref}`,
                source: 'trustee',
                state: 'FL',
                county: 'Miami-Dade',
                city: 'Miami',
                zip: null,
                address: rec.address || rec.legalDescription || null,
                apn: rec.folio || rec.apn || null,
                openingBid: null, // Zero-Fabrication: Official Records Lis Pendens/Notice never fabricates openingBid
                estLow: null,
                estHigh: null,
                assessed: null,
                saleDate: rec.saleDate || null,
                plaintiff: rec.plaintiff || rec.grantee || null,
                defendant: rec.defendant || rec.grantor || null,
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
                  publisher: 'Miami-Dade County Clerk of Courts',
                  recordId: String(recId),
                  platform: 'miami-dade-clerk',
                  sourceFacts,
                },
              }));
              added++;
            }
            recordUnitSuccess(report, `miamidade:${docType}`, added);
          } catch (err) {
            recordUnitFailure(report, `miamidade:${docType}`, err);
            console.warn(`[${this.name}] Failed Miami-Dade Clerk search on docType ${docType}: ${err.message}`);
          }
        }
        continue;
      }

      // -----------------------------------------------------------------------
      // 5. AcclaimWeb Multi-County Jurisdictions (Clark, Washoe, Collin, etc.)
      // -----------------------------------------------------------------------
      const jurConfig = DEFAULT_JURISDICTIONS[jurKey] || null;
      const isCustomFetch = (this.fetchText !== BaseScraper.prototype.fetchText) || (this.fetchImpl && this.fetchImpl !== globalThis.fetch);
      const useLiveAcclaim = !isCustomFetch && options.useLivePortal !== false && Boolean(jurConfig && (jurKey === 'clark' || jurConfig.docTypeIds));

      let docTypes = options.docType
        ? [options.docType]
        : (jurConfig && jurConfig.docTypeIds
          ? Object.keys(jurConfig.docTypeIds)
          : [RECORD_DOC_TYPES.NOTICE_OF_TRUSTEE_SALE, RECORD_DOC_TYPES.NOTICE_OF_DEFAULT]);

      if (useLiveAcclaim && !options.docType && jurConfig && jurConfig.docTypeIds) {
        const seenDocIds = new Set();
        docTypes = docTypes.filter((dt) => {
          const k = String(dt).toUpperCase().replace(/_/g, ' ').trim();
          const cfg = jurConfig.docTypeIds[k] || jurConfig.docTypeIds[dt];
          const id = cfg ? cfg.id : k;
          if (seenDocIds.has(id)) return false;
          seenDocIds.add(id);
          return true;
        });
      }

      for (const docType of docTypes) {
        report.statesRequested.push(`${jurKey}:${docType}`);
        report.endpointsTried++;
        try {
          let records = [];
          if (useLiveAcclaim) {
            const targetUrl = this.getAcclaimSearchUrl(jurKey, docType, { useLivePortal: true });
            const circuitBreaker = this.getJurisdictionCircuitBreaker(jurKey, targetUrl);
            if (circuitBreaker.isOpen()) {
              throw new Error(`[${this.name}] Skipped ${jurKey}: host circuit breaker is OPEN`);
            }
            const liveResult = await queryLiveAcclaimPortal(jurKey, docType, {
              fetchImpl: this.fetchImpl,
              lookbackDays: options.lookbackDays || 7,
              pageSize: options.pageSize || 50,
              maxPages: options.maxPages,
              circuitBreaker,
            });
            circuitBreaker.recordSuccess();
            await recordSnapshot({
              sourceKey: 'trustee',
              recordId: `${jurKey}:${docType.replace(/\s+/g, '_')}:page-1`,
              rawPayload: liveResult.rawPayload,
              metadata: {
                sourceUrl: liveResult.searchUrl || liveResult.url,
                kind: 'recorder_index',
                jurisdiction: jurKey,
                docType,
                totalAvailable: liveResult.totalAvailable,
                collected: liveResult.parsedRows.length,
              },
            }, { snapshotDir: options.snapshotDir });

            const prevJurEv = report.recorderEvidence?.byJurisdiction?.[jurKey];
            const jurEv = prevJurEv
              ? {
                  ...prevJurEv,
                  evidenceOnlySamples: [...(prevJurEv.evidenceOnlySamples || [])],
                }
              : {
                  jurisdiction: jurKey,
                  platform: 'acclaimweb',
                  capturedDocuments: 0,
                  qualifiedListings: 0,
                  droppedNoIdentity: 0,
                  evidenceOnlySamples: [],
                  truncated: false,
                  queryComplete: true,
                  listingQualified: false,
                };
            jurEv.capturedDocuments += liveResult.parsedRows.length;
            if (liveResult.truncated || liveResult.totalAvailable > liveResult.parsedRows.length) {
              jurEv.truncated = true;
              jurEv.queryComplete = false;
            }
            accumulateRecorderEvidence(report, jurKey, jurEv);

            for (const rec of liveResult.parsedRows) {
              if (!rec || !rec.instrumentNumber) continue;
              if (rec.evidenceOnly || (!rec.apn && !rec.situsAddress)) {
                jurEv.droppedNoIdentity += 1;
                if (jurEv.evidenceOnlySamples.length < 20) {
                  jurEv.evidenceOnlySamples.push({
                    jurisdiction: jurKey,
                    instrumentNumber: rec.instrumentNumber,
                    docType: rec.docType,
                    recordedDate: rec.recordedDate || null,
                    sourceUrl: rec.sourceUrl,
                  });
                }
                continue;
              }
              jurEv.qualifiedListings += 1;
              jurEv.listingQualified = true;
              await recordSnapshot({
                sourceKey: 'trustee',
                recordId: `${jurKey}:${rec.instrumentNumber}`,
                rawPayload: rec,
                metadata: {
                  sourceUrl: rec.sourceUrl,
                  recordedDate: rec.recordedDate || null,
                  confidenceScore: 1.0,
                },
              }, { snapshotDir: options.snapshotDir });
              records.push(rec);
            }
            accumulateRecorderEvidence(report, jurKey, jurEv);
          } else {
            const targetUrl = this.getAcclaimSearchUrl(jurKey, docType);
            const html = await this.fetchJurisdictionText(targetUrl, jurKey);
            records = this.parseAcclaimSearchHtml(html, jurKey);
          }

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
              ...(rec.recordedDate ? { recordedDate: rec.recordedDate } : {}),
            };

            standardized.push(this.standardizeListing({
              id: `TRUSTEE-${rec.state}-${rec.county.slice(0, 3).toUpperCase()}-${ref}`,
              source: 'trustee',
              state: rec.state,
              county: rec.county,
              city: null,
              zip: null,
              address: rec.situsAddress || rec.legalDescription || null,
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
          if (err && err.code === 'UPSTREAM_BOT_CHALLENGE') {
            report.challengeGated = true;
            report.lastErrorCode = 'UPSTREAM_BOT_CHALLENGE';
          }
          recordUnitFailure(report, `${jurKey}:${docType}`, err, err && err.code === 'UPSTREAM_BOT_CHALLENGE' ? 'bot_challenge' : 'upstream');
          console.warn(`[${this.name}] Failed Acclaim search on ${jurKey} (${docType}): ${err.message}`);
        }
      }
    }

    finalizeRunReport(report, { emitted: standardized.length });
    if (
      report.recorderEvidence &&
      (
        report.recorderEvidence.truncated ||
        !report.recorderEvidence.queryComplete ||
        (report.recorderEvidence.capturedDocuments > 0 && !report.recorderEvidence.listingQualified)
      )
    ) {
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
module.exports.DEFAULT_TRUSTEE_JURISDICTIONS = DEFAULT_TRUSTEE_JURISDICTIONS;
module.exports.RECORD_DOC_TYPES = RECORD_DOC_TYPES;
module.exports.MARICOPA_DOC_TYPES = MARICOPA_DOC_TYPES;
module.exports.HARRIS_DOC_TYPES = HARRIS_DOC_TYPES;
module.exports.COOK_DOC_TYPES = COOK_DOC_TYPES;
module.exports.MIAMI_DADE_DOC_TYPES = MIAMI_DADE_DOC_TYPES;
module.exports.calculateTexasForeclosureSaleDate = calculateTexasForeclosureSaleDate;
