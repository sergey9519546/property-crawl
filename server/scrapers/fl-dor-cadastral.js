// server/scrapers/fl-dor-cadastral.js
//
// Florida Department of Revenue statewide cadastral collector.
//
// Source: https://services9.arcgis.com/Gh9awoU677aKree0/arcgis/rest/services/Florida_Statewide_Cadastral/FeatureServer/0
//
// The FDOR Property Tax Oversight program publishes an annual statewide
// cadastral layer covering all 67 Florida counties. Each polygon feature is
// joined to the NAL (Name-Address-Legal) roll file and carries parcel id,
// owner name, situs and mailing addresses, just/assessed value, DOR use code,
// land square footage, and assessment year.
//
// Strategy:
//   1. Query the fixed FeatureServer layer with a bounded page of features.
//   2. Paginate via resultOffset until the configured record budget is met
//      or the publisher reports exhausted/exceeded-transfer-limit.
//   3. Map ArcGIS attributes to the canonical camelCase listing contract and
//      record the exact feature URL plus query URL as provenance.
//
// Safety:
//   - Default 100 records per run (configurable).
//   - Circuit breaker on every request (inherited from BaseScraper).
//   - 250-750ms crawl jitter between pages.
//   - Geometry is screening evidence only; assessed values are not market
//     values. Neither is a boundary survey.

const BaseScraper = require('./base');
const { buildParcelKey, normalizeApn, cleanText } = require('./normalization');
const { buildDocumentReferences } = require('./document-reference');

const SOURCE_KEY = 'fl-dor-cadastral';
const PUBLISHER = 'Florida Department of Revenue Property Tax Oversight';
const SERVICE_ROOT =
  'https://services9.arcgis.com/Gh9awoU677aKree0/arcgis/rest/services/Florida_Statewide_Cadastral/FeatureServer/0';
const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 2000;
const DEFAULT_MAX_RECORDS = 100;
const MAX_RECORDS_CAP = 5000;
const MAX_RAW_BYTES = 64 * 1024;
const FL_STATE_FIPS = '12';

// Florida DOR county code (CO_NO, 1-67) → { fips, name }.
// FIPS county codes are the standard 12001-12133 odd-number sequence.
const DOR_COUNTY_BY_CODE = Object.freeze({
  1: { fips: '12001', name: 'Alachua' },
  2: { fips: '12003', name: 'Baker' },
  3: { fips: '12005', name: 'Bay' },
  4: { fips: '12007', name: 'Bradford' },
  5: { fips: '12009', name: 'Brevard' },
  6: { fips: '12011', name: 'Broward' },
  7: { fips: '12013', name: 'Calhoun' },
  8: { fips: '12015', name: 'Charlotte' },
  9: { fips: '12017', name: 'Citrus' },
  10: { fips: '12019', name: 'Clay' },
  11: { fips: '12021', name: 'Collier' },
  12: { fips: '12023', name: 'Columbia' },
  13: { fips: '12027', name: 'DeSoto' },
  14: { fips: '12029', name: 'Dixie' },
  15: { fips: '12031', name: 'Duval' },
  16: { fips: '12033', name: 'Escambia' },
  17: { fips: '12035', name: 'Flagler' },
  18: { fips: '12037', name: 'Franklin' },
  19: { fips: '12039', name: 'Gadsden' },
  20: { fips: '12041', name: 'Gilchrist' },
  21: { fips: '12043', name: 'Glades' },
  22: { fips: '12045', name: 'Gulf' },
  23: { fips: '12047', name: 'Hamilton' },
  24: { fips: '12049', name: 'Hardee' },
  25: { fips: '12051', name: 'Hendry' },
  26: { fips: '12053', name: 'Hernando' },
  27: { fips: '12055', name: 'Highlands' },
  28: { fips: '12057', name: 'Hillsborough' },
  29: { fips: '12059', name: 'Holmes' },
  30: { fips: '12061', name: 'Indian River' },
  31: { fips: '12063', name: 'Jackson' },
  32: { fips: '12065', name: 'Jefferson' },
  33: { fips: '12067', name: 'Lafayette' },
  34: { fips: '12069', name: 'Lake' },
  35: { fips: '12071', name: 'Lee' },
  36: { fips: '12073', name: 'Leon' },
  37: { fips: '12075', name: 'Levy' },
  38: { fips: '12077', name: 'Liberty' },
  39: { fips: '12079', name: 'Madison' },
  40: { fips: '12081', name: 'Manatee' },
  41: { fips: '12083', name: 'Marion' },
  42: { fips: '12085', name: 'Martin' },
  43: { fips: '12086', name: 'Miami-Dade' },
  44: { fips: '12087', name: 'Monroe' },
  45: { fips: '12089', name: 'Nassau' },
  46: { fips: '12091', name: 'Okaloosa' },
  47: { fips: '12093', name: 'Okeechobee' },
  48: { fips: '12095', name: 'Orange' },
  49: { fips: '12097', name: 'Osceola' },
  50: { fips: '12099', name: 'Palm Beach' },
  51: { fips: '12101', name: 'Pasco' },
  52: { fips: '12103', name: 'Pinellas' },
  53: { fips: '12105', name: 'Polk' },
  54: { fips: '12107', name: 'Putnam' },
  55: { fips: '12109', name: 'St. Johns' },
  56: { fips: '12111', name: 'St. Lucie' },
  57: { fips: '12113', name: 'Santa Rosa' },
  58: { fips: '12115', name: 'Sarasota' },
  59: { fips: '12117', name: 'Seminole' },
  60: { fips: '12119', name: 'Sumter' },
  61: { fips: '12121', name: 'Suwannee' },
  62: { fips: '12123', name: 'Taylor' },
  63: { fips: '12125', name: 'Union' },
  64: { fips: '12127', name: 'Volusia' },
  65: { fips: '12129', name: 'Wakulla' },
  66: { fips: '12131', name: 'Walton' },
  67: { fips: '12133', name: 'Washington' }
});

// DOR use-code first two digits → coarse property type. Codes are published
// by FDOR Property Tax Oversight; this is a screening label only.
// Reference: 00 vacant residential, 01 single family, 02 mobile home,
// 03 condo, 04 coop, 05-06 multi-family, 10-39 commercial, 40-69 agricultural.
function classifyDorUse(dorUc) {
  const raw = String(dorUc ?? '').replace(/\D/g, '');
  if (!raw) return null;
  const tens = Number(raw.slice(0, 2).padStart(2, '0'));
  if (!Number.isInteger(tens)) return null;
  if (tens === 0) return 'Land';
  if (tens === 1) return 'Single Family';
  if (tens === 2) return 'Mobile Home';
  if (tens === 3) return 'Condo';
  if (tens === 4) return 'Coop';
  if (tens === 5 || tens === 6) return 'Multi-Family';
  if (tens >= 10 && tens <= 39) return 'Commercial';
  if (tens >= 40 && tens <= 69) return 'Agricultural';
  if (tens >= 70 && tens <= 99) return 'Industrial';
  return null;
}

function boundedInt(value, fallback, maximum) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, maximum);
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function textOrNull(value, maximum = 200) {
  if (value === null || value === undefined) return null;
  const text = String(value).replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, maximum) : null;
}

function zipText(value) {
  if (value === null || value === undefined || value === '') return null;
  const digits = String(value).replace(/\D/g, '');
  if (digits.length === 4) return `0${digits}`;
  if (digits.length === 5 || digits.length === 9) return digits;
  return null;
}

function truncateRaw(payload, maxBytes = MAX_RAW_BYTES) {
  const text = JSON.stringify(payload);
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) return text;
  // Keep a valid JSON envelope even when the publisher payload is huge.
  return JSON.stringify({ truncated: true, originalBytes: Buffer.byteLength(text, 'utf8'), preview: text.slice(0, Math.floor(maxBytes * 0.8)) });
}

function countyFromDorCode(value) {
  const code = Number.parseInt(value, 10);
  return DOR_COUNTY_BY_CODE[code] || null;
}

function acreageFromAttributes(attrs) {
  const landSqft = finiteNumber(attrs.LND_SQFOOT);
  if (landSqft !== null && landSqft > 0) {
    return Math.round((landSqft / 43560) * 10000) / 10000;
  }
  const unitsCode = textOrNull(attrs.LND_UNTS_C, 4);
  const landUnits = finiteNumber(attrs.NO_LND_UNT);
  if (unitsCode === '1' && landUnits !== null && landUnits > 0) {
    return landUnits;
  }
  return null;
}

function mailingAddressFromAttributes(attrs) {
  const line1 = textOrNull(attrs.OWN_ADDR1, 120);
  const line2 = textOrNull(attrs.OWN_ADDR2, 120);
  const city = textOrNull(attrs.OWN_CITY, 80);
  const state = textOrNull(attrs.OWN_STATE_, 2) || textOrNull(attrs.OWN_STATE, 30);
  const zip = zipText(attrs.OWN_ZIPCD);
  const parts = [line1, line2].filter(Boolean);
  if (!parts.length && !city) return null;
  return {
    line1: line1 || null,
    line2: line2 || null,
    city: city || null,
    state: state || null,
    zip: zip || null,
    formatted: [parts.join(' '), [city, state, zip].filter(Boolean).join(' ')].filter(Boolean).join(', ') || null
  };
}

function situsFromAttributes(attrs) {
  const line1 = textOrNull(attrs.PHY_ADDR1, 120);
  const line2 = textOrNull(attrs.PHY_ADDR2, 120);
  const city = textOrNull(attrs.PHY_CITY, 80);
  const zip = zipText(attrs.PHY_ZIPCD);
  const street = [line1, line2].filter(Boolean).join(' ');
  // Conventional US format: "street, city, ST zip"
  const locality = [city, zip].filter(Boolean).join(' ');
  const address = street && city
    ? `${street}, ${city}, FL${zip ? ` ${zip}` : ''}`
    : street || null;
  return { street: street || null, city: city || null, zip: zip || null, address };
}

class FlDorCadastralError extends Error {
  constructor(message, code = 'FL_DOR_UPSTREAM_UNAVAILABLE') {
    super(message);
    this.name = 'FlDorCadastralError';
    this.code = code;
  }
}

class FlDorCadastralScraper extends BaseScraper {
  constructor(options = {}) {
    super({
      ...options,
      name: options.name || 'FlDorCadastralCollector',
      sourceKey: SOURCE_KEY
    });
    this.serviceRoot = options.serviceRoot || SERVICE_ROOT;
    this.pageSize = boundedInt(options.pageSize ?? process.env.FL_DOR_PAGE_SIZE, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
    this.maxRecords = boundedInt(options.maxRecords ?? process.env.FL_DOR_MAX_RECORDS, DEFAULT_MAX_RECORDS, MAX_RECORDS_CAP);
    this.lastRunReport = null;
    // Publisher feature JSON keyed by the listing object we emit, so the
    // scheduler can ingest the original ArcGIS payload as evidence.
    this.rawPublisherRecords = new WeakMap();
  }

  getCollectionScope() {
    return {
      endpoint: '/arcgis/rest/services/Florida_Statewide_Cadastral/FeatureServer/0/query',
      filters: { states: ['FL'] },
      pageSize: this.pageSize
    };
  }

  getRawPublisherRecord(listing) {
    return this.rawPublisherRecords.get(listing) || null;
  }

  buildQueryUrl({ resultOffset, resultRecordCount }) {
    const url = new URL(`${this.serviceRoot}/query`);
    // Geometry is not required for listing ingestion and keeps payloads small.
    url.searchParams.set('where', '1=1');
    url.searchParams.set(
      'outFields',
      [
        'OBJECTID', 'CO_NO', 'PARCEL_ID', 'PARCELNO', 'ASMNT_YR', 'DOR_UC', 'PA_UC',
        'JV', 'AV_SD', 'AV_NSD', 'TV_SD', 'LND_VAL', 'LND_SQFOOT', 'LND_UNTS_C',
        'NO_LND_UNT', 'NO_RES_UNT', 'TOT_LVG_AR', 'EFF_YR_BLT', 'ACT_YR_BLT',
        'OWN_NAME', 'OWN_ADDR1', 'OWN_ADDR2', 'OWN_CITY', 'OWN_STATE', 'OWN_STATE_',
        'OWN_ZIPCD', 'PHY_ADDR1', 'PHY_ADDR2', 'PHY_CITY', 'PHY_ZIPCD',
        'S_LEGAL', 'ALT_KEY', 'STATE_PAR_'
      ].join(',')
    );
    url.searchParams.set('returnGeometry', 'false');
    url.searchParams.set('outSR', '4326');
    url.searchParams.set('f', 'json');
    url.searchParams.set('resultRecordCount', String(resultRecordCount));
    url.searchParams.set('resultOffset', String(resultOffset));
    return url.toString();
  }

  featureUrl(objectId) {
    return `${this.serviceRoot}/${objectId}`;
  }

  async fetchPage({ resultOffset, resultRecordCount }) {
    const queryUrl = this.buildQueryUrl({ resultOffset, resultRecordCount });
    const payload = await this.requestJson(queryUrl, {
      headers: {
        'User-Agent': 'property-crawl-bot/1.0 (research; contact: ops@property-crawl.example)',
        Accept: 'application/json'
      }
    });
    if (payload && typeof payload === 'object' && payload.error) {
      const message = payload.error.message || 'ArcGIS query error';
      const code = Number(payload.error.code);
      throw new FlDorCadastralError(
        `FL DOR cadastral query failed (${code || 'unknown'}): ${message}`,
        Number.isInteger(code) && code >= 400 && code < 500
          ? 'FL_DOR_QUERY_REJECTED'
          : 'FL_DOR_UPSTREAM_UNAVAILABLE'
      );
    }
    if (!payload || !Array.isArray(payload.features)) {
      throw new FlDorCadastralError(
        'FL DOR cadastral response is missing a features array',
        'FL_DOR_SCHEMA_UNRECOGNIZED'
      );
    }
    return { queryUrl, payload };
  }

  mapFeature(feature, { queryUrl, observedAt }) {
    const attrs = feature && typeof feature === 'object' ? feature.attributes : null;
    if (!attrs || typeof attrs !== 'object') return null;

    const objectId = finiteNumber(attrs.OBJECTID);
    if (objectId === null || objectId <= 0) return null;

    const parcelId = textOrNull(attrs.PARCEL_ID, 40) || textOrNull(attrs.PARCELNO, 40);
    if (!parcelId) return null;

    const county = countyFromDorCode(attrs.CO_NO);
    if (!county) return null;

    const situs = situsFromAttributes(attrs);
    // Every ingested listing needs a usable situs address. Parcels without
    // one are evidence noise for opportunity screening and are rejected.
    if (!situs.address || situs.address.length < 8 || !/^\d/.test(situs.street || '')) {
      return null;
    }

    const ownerName = textOrNull(attrs.OWN_NAME, 120);
    const mailing = mailingAddressFromAttributes(attrs);
    const dorUse = textOrNull(attrs.DOR_UC, 8);
    const justValue = finiteNumber(attrs.JV);
    const assessedValue = finiteNumber(attrs.AV_SD);
    const landValue = finiteNumber(attrs.LND_VAL);
    const acreage = acreageFromAttributes(attrs);
    const landSqft = finiteNumber(attrs.LND_SQFOOT);
    const sqft = finiteNumber(attrs.TOT_LVG_AR);
    const year = finiteNumber(attrs.EFF_YR_BLT) || finiteNumber(attrs.ACT_YR_BLT);
    const assessmentYear = finiteNumber(attrs.ASMNT_YR);
    const residentialUnits = finiteNumber(attrs.NO_RES_UNT);
    const legalDescription = textOrNull(attrs.S_LEGAL, 35);
    const normalizedApn = normalizeApn(parcelId);
    const sourceUrl = this.featureUrl(objectId);

    const listingId = `FLDOR-${objectId}`;
    const rawPayload = {
      attributes: { ...attrs },
      geometry: feature.geometry ?? null
    };

    const preNormalized = {
      id: listingId,
      source: SOURCE_KEY,
      state: 'FL',
      county: county.name,
      city: situs.city,
      zip: situs.zip,
      address: situs.address,
      lat: null,
      lng: null,
      beds: null,
      baths: null,
      sqft: sqft !== null && sqft > 0 ? sqft : null,
      year: year !== null && year >= 1800 && year <= new Date().getFullYear() + 2 ? year : null,
      propType: classifyDorUse(dorUse),
      openingBid: null,
      price: null,
      estLow: null,
      estHigh: null,
      assessed: justValue !== null && justValue >= 0 ? justValue : (assessedValue !== null && assessedValue >= 0 ? assessedValue : null),
      saleDate: null,
      sourceUrl,
      raw: truncateRaw(rawPayload),
      apn: parcelId,
      parcelId,
      countyFips: county.fips,
      stateFips: FL_STATE_FIPS,
      provenance: {
        origin: 'live',
        observed: true,
        publisher: PUBLISHER,
        recordId: listingId,
        countyFips: county.fips,
        stateFips: FL_STATE_FIPS,
        sourceFacts: {
          serviceRoot: this.serviceRoot,
          queryUrl,
          featureUrl: sourceUrl,
          objectId,
          parcelId,
          normalizedApn,
          dorCountyCode: Number(attrs.CO_NO) || null,
          countyFips: county.fips,
          countyName: county.name,
          dorUseCode: dorUse,
          paUseCode: textOrNull(attrs.PA_UC, 8),
          assessmentYear,
          justValue,
          assessedSchoolDistrict: assessedValue,
          taxableSchoolDistrict: finiteNumber(attrs.TV_SD),
          landValue,
          landSquareFeet: landSqft,
          landUnitCode: textOrNull(attrs.LND_UNTS_C, 4),
          landUnits: finiteNumber(attrs.NO_LND_UNT),
          acreage,
          totalLivingAreaSqft: sqft,
          effectiveYearBuilt: finiteNumber(attrs.EFF_YR_BLT),
          actualYearBuilt: finiteNumber(attrs.ACT_YR_BLT),
          residentialUnits,
          ownerName,
          mailingAddress: mailing,
          situs: {
            line1: textOrNull(attrs.PHY_ADDR1, 120),
            line2: textOrNull(attrs.PHY_ADDR2, 120),
            city: situs.city,
            zip: situs.zip
          },
          legalDescription,
          alternateKey: textOrNull(attrs.ALT_KEY, 40),
          stateParcelId: textOrNull(attrs.STATE_PAR_, 24),
          arcgisFieldNames: [
            'OBJECTID', 'CO_NO', 'PARCEL_ID', 'ASMNT_YR', 'DOR_UC',
            'JV', 'LND_SQFOOT', 'NO_LND_UNT', 'OWN_NAME',
            'PHY_ADDR1', 'PHY_CITY', 'PHY_ZIPCD'
          ],
          evidenceClass: 'publisher_reported',
          caveat: 'Cadastral geometry is not a boundary survey. Assessed values are not market values.',
          documents: buildDocumentReferences([
            sourceUrl && { kind: 'feature', url: sourceUrl, label: `FL DOR ArcGIS feature ${objectId}` },
            queryUrl && { kind: 'parcel', url: queryUrl, label: `FL DOR query page (parcel ${parcelId || objectId})` }
          ], { observedAt })
        }
      },
      sourceObservedAt: observedAt
    };

    // The shared normalizer computes parcelKey from countyFips + APN and
    // enforces the canonical camelCase listing contract.
    const listing = this.standardizeListing(preNormalized);
    this.rawPublisherRecords.set(listing, rawPayload);
    return listing;
  }

  async scrapeFeed() {
    return this.executeWithRetry(async () => {
      const observedAt = new Date().toISOString();
      const collected = [];
      const failures = [];
      let resultOffset = 0;
      let pagesFetched = 0;
      let publisherFeatures = 0;
      let rejectedFeatures = 0;
      let exceededTransferLimit = false;

      while (collected.length < this.maxRecords) {
        const remaining = this.maxRecords - collected.length;
        const resultRecordCount = Math.min(this.pageSize, remaining);
        let page;
        try {
          page = await this.fetchPage({ resultOffset, resultRecordCount });
        } catch (error) {
          // Halt-class errors (403, bot challenge, open circuit) and a
          // first-page failure must surface so the scheduler records a
          // failure instead of treating the run as empty inventory.
          if (error.haltScraper === true || pagesFetched === 0) throw error;
          failures.push({ resultOffset, error: error.message, code: error.code || null });
          break;
        }
        pagesFetched += 1;
        const features = page.payload.features;
        publisherFeatures += features.length;
        if (page.payload.exceededTransferLimit === true) exceededTransferLimit = true;

        if (features.length === 0) break;

        for (const feature of features) {
          if (collected.length >= this.maxRecords) break;
          const listing = this.mapFeature(feature, { queryUrl: page.queryUrl, observedAt });
          if (listing) collected.push(listing);
          else rejectedFeatures += 1;
        }

        resultOffset += features.length;
        // Stop when the publisher returns a short page or the budget is met.
        if (features.length < resultRecordCount) break;
        if (collected.length >= this.maxRecords) break;
        if (pagesFetched > 0 && collected.length < this.maxRecords) {
          await this.crawlJitter();
        }
      }

      const truncated = collected.length >= this.maxRecords || exceededTransferLimit;
      const complete = failures.length === 0 && !truncated;
      this.lastRunReport = {
        outcome: failures.length
          ? (collected.length ? 'partial_failure' : 'failed')
          : (collected.length ? 'success' : 'empty'),
        scope: this.getCollectionScope(),
        pagesFetched,
        resultOffset,
        publisherFeatures,
        recordsDiscovered: publisherFeatures,
        recordsEmitted: collected.length,
        recordsRejected: rejectedFeatures,
        exceededTransferLimit,
        truncated,
        complete,
        fullSweepComplete: complete,
        fixtureFallbackUsed: false,
        failures,
        sweepStartedAt: observedAt,
        nextContinuationToken: truncated ? String(resultOffset) : null
      };

      console.log(
        `[${this.name}] Scraped ${collected.length} FL DOR cadastral parcels ` +
        `(${pagesFetched} page(s), ${publisherFeatures} publisher features, ${rejectedFeatures} rejected)`
      );
      return collected;
    });
  }
}

module.exports = new FlDorCadastralScraper();
module.exports.FlDorCadastralScraper = FlDorCadastralScraper;
module.exports.DOR_COUNTY_BY_CODE = DOR_COUNTY_BY_CODE;
module.exports.SERVICE_ROOT = SERVICE_ROOT;
module.exports.classifyDorUse = classifyDorUse;
module.exports.acreageFromAttributes = acreageFromAttributes;
module.exports.countyFromDorCode = countyFromDorCode;
