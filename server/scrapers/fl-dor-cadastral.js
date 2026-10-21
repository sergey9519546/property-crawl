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
//   4. Attribute county from the record's own situs evidence first (CENSUS_BK
//      census-block FIPS prefix, then a scoped situs-city cross-check), with
//      the CO_NO DOR county code as the last-resort fallback. Code-vs-situs
//      disagreements resolve to the situs-derived county and are counted in
//      the run report; they are never silently guessed.
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

// Florida DOR cadastral county code (CO_NO, 11-77) → { fips, name }.
//
// NAMESPACE WARNING: this is NOT the FDOR tax-admin 1-67 county code list.
//
// The published layer (ArcGIS item efa909d6b1c841d298b0a649e7f71cf2,
// "Florida Statewide Parcels") encodes CO_NO in a separate DOR cadastral
// namespace numbered 11-77. The authoritative definition is the DOR-provided
// reference workbook "Parcel2025AttributionDefinitions.xls" ("County Codes"
// sheet; ArcGIS item 55e830fd6c8948baae1601fbfc33a3b2, described as "DOR
// provided attribute reference and county code look up"), which the layer's
// own item description links as the "DOR reference with FIPS county codes
// and attribution definitions". Verified against the live service on
// 2026-10-21: the layer contains exactly CO_NO 0 (unassigned) plus 11-77,
// and every observed CO_NO=11 record is an Alachua County parcel
// (Gainesville/Alachua/High Springs/Waldo situs, CENSUS_BK block GEOIDs
// prefixed 12001, STATE_PAR_ parcel ids prefixed "C11").
//
// This is the namespace confusion recorded in docs/alachua-pilot.md:10 —
// "The existing statewide cadastral source uses its separate Florida DOR
// namespace, `fl-dor:11`" — which that doc ties to Alachua GEOID 12001.
// An earlier revision of this file decoded CO_NO with the FDOR tax-admin
// 1-67 list (where 11 = Collier/12021) and stamped all 101 live-store
// records (Gainesville/Alachua/High Springs/Waldo situs) as "Collier".
// The live canary observed the contradiction and passed it anyway
// (reports/live-canary-results-2026-09-13.md:22: "Counties observed |
// 12021 (Alachua)"). A later review claimed codes 13-43 were "rotated one
// position"; the official reference disproves that too — this namespace is
// offset from the tax-admin list (it starts at 11), not rotated:
// 23 = Miami-Dade, 24 = DeSoto, 25 = Dixie.
//
// Names follow the DOR reference, with spellings normalized to this repo's
// canonical listing contract ("St. Johns"/"St. Lucie" for the workbook's
// "Saint Johns"/"Saint Lucie"). FIPS codes are the Census 12001-12133
// sequence (state+county list:
// www2.census.gov/geo/docs/reference/codes/files/st12_fl_cou.txt).
const DOR_COUNTY_BY_CODE = Object.freeze({
  11: { fips: '12001', name: 'Alachua' },
  12: { fips: '12003', name: 'Baker' },
  13: { fips: '12005', name: 'Bay' },
  14: { fips: '12007', name: 'Bradford' },
  15: { fips: '12009', name: 'Brevard' },
  16: { fips: '12011', name: 'Broward' },
  17: { fips: '12013', name: 'Calhoun' },
  18: { fips: '12015', name: 'Charlotte' },
  19: { fips: '12017', name: 'Citrus' },
  20: { fips: '12019', name: 'Clay' },
  21: { fips: '12021', name: 'Collier' },
  22: { fips: '12023', name: 'Columbia' },
  23: { fips: '12086', name: 'Miami-Dade' },
  24: { fips: '12027', name: 'DeSoto' },
  25: { fips: '12029', name: 'Dixie' },
  26: { fips: '12031', name: 'Duval' },
  27: { fips: '12033', name: 'Escambia' },
  28: { fips: '12035', name: 'Flagler' },
  29: { fips: '12037', name: 'Franklin' },
  30: { fips: '12039', name: 'Gadsden' },
  31: { fips: '12041', name: 'Gilchrist' },
  32: { fips: '12043', name: 'Glades' },
  33: { fips: '12045', name: 'Gulf' },
  34: { fips: '12047', name: 'Hamilton' },
  35: { fips: '12049', name: 'Hardee' },
  36: { fips: '12051', name: 'Hendry' },
  37: { fips: '12053', name: 'Hernando' },
  38: { fips: '12055', name: 'Highlands' },
  39: { fips: '12057', name: 'Hillsborough' },
  40: { fips: '12059', name: 'Holmes' },
  41: { fips: '12061', name: 'Indian River' },
  42: { fips: '12063', name: 'Jackson' },
  43: { fips: '12065', name: 'Jefferson' },
  44: { fips: '12067', name: 'Lafayette' },
  45: { fips: '12069', name: 'Lake' },
  46: { fips: '12071', name: 'Lee' },
  47: { fips: '12073', name: 'Leon' },
  48: { fips: '12075', name: 'Levy' },
  49: { fips: '12077', name: 'Liberty' },
  50: { fips: '12079', name: 'Madison' },
  51: { fips: '12081', name: 'Manatee' },
  52: { fips: '12083', name: 'Marion' },
  53: { fips: '12085', name: 'Martin' },
  54: { fips: '12087', name: 'Monroe' },
  55: { fips: '12089', name: 'Nassau' },
  56: { fips: '12091', name: 'Okaloosa' },
  57: { fips: '12093', name: 'Okeechobee' },
  58: { fips: '12095', name: 'Orange' },
  59: { fips: '12097', name: 'Osceola' },
  60: { fips: '12099', name: 'Palm Beach' },
  61: { fips: '12101', name: 'Pasco' },
  62: { fips: '12103', name: 'Pinellas' },
  63: { fips: '12105', name: 'Polk' },
  64: { fips: '12107', name: 'Putnam' },
  65: { fips: '12109', name: 'St. Johns' },
  66: { fips: '12111', name: 'St. Lucie' },
  67: { fips: '12113', name: 'Santa Rosa' },
  68: { fips: '12115', name: 'Sarasota' },
  69: { fips: '12117', name: 'Seminole' },
  70: { fips: '12119', name: 'Sumter' },
  71: { fips: '12121', name: 'Suwannee' },
  72: { fips: '12123', name: 'Taylor' },
  73: { fips: '12125', name: 'Union' },
  74: { fips: '12127', name: 'Volusia' },
  75: { fips: '12129', name: 'Wakulla' },
  76: { fips: '12131', name: 'Walton' },
  77: { fips: '12133', name: 'Washington' }
});

// Reverse index (county FIPS → code-table entry) derived from the single
// source of truth above; used to validate CENSUS_BK prefixes and to resolve
// situs-city map entries.
const FL_COUNTY_BY_FIPS = new Map(
  Object.values(DOR_COUNTY_BY_CODE).map((county) => [county.fips, county])
);

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

// CENSUS_BK carries the parcel's census block GEOID (e.g. "120010019081");
// its first five digits are the state+county FIPS. This is the layer's own
// per-record FIPS attribution ("The dataset extends countywide and is
// attribute[d] by Federal Information Processing Standards (FIPS) code" —
// layer item description), which makes it the strongest situs evidence a
// record can carry: parcel-precise geography straight from the publisher.
function countyFipsFromCensusBlock(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  if (digits.length < 5) return null;
  const fips = digits.slice(0, 5);
  if (!/^12\d{3}$/.test(fips)) return null;
  return FL_COUNTY_BY_FIPS.get(fips) || null;
}

// Situs-city → county cross-check, scoped to the municipalities of the one
// county this source has actually served live (Alachua; see the namespace
// comment above and docs/alachua-pilot.md). PHY_CITY is a mailing-city
// string, not parcel geography, so this is deliberately a FALLBACK behind
// CENSUS_BK: observed record FLDOR-123 ("21728 NW 29TH TER, BROOKER, FL
// 32622", live OBJECTID 123) is an Alachua parcel in census block
// 120010019083 even though Brooker is a Bradford County municipality —
// rural-route situs cities can point at a neighboring county. Brooker is
// therefore intentionally absent here: a city whose municipality-county is
// unreliable evidence of the PARCEL's county must not produce situs
// evidence at all. Keys are normalized (uppercase, punctuation removed) to
// absorb roll spellings like "LA CROSSE" vs "LaCrosse".
const FL_SITUS_CITY_TO_COUNTY = Object.freeze({
  ALACHUA: '12001',
  ARCHER: '12001',
  GAINESVILLE: '12001',
  HAWTHORNE: '12001',
  HIGHSPRINGS: '12001',
  LACROSSE: '12001',
  MICANOPY: '12001',
  NEWBERRY: '12001',
  WALDO: '12001'
});

function normalizeCityKey(value) {
  return String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function countyFromSitusCity(city) {
  const fips = FL_SITUS_CITY_TO_COUNTY[normalizeCityKey(city)];
  return fips ? (FL_COUNTY_BY_FIPS.get(fips) || null) : null;
}

// County attribution hierarchy for one cadastral feature:
//   1. CENSUS_BK census-block FIPS prefix (the layer's own per-record
//      attribution — parcel-precise).
//   2. Scoped situs-city cross-check (see FL_SITUS_CITY_TO_COUNTY).
//   3. CO_NO via the official DOR cadastral code table.
// Situs evidence (1, then 2) outranks the code. When the code-derived
// county and the situs-derived county disagree, the record carries the
// situs-derived county and the disagreement is surfaced as a counted
// discrepancy — never silently guessed, and never left as two competing
// county claims on the record. A feature with no county evidence at all is
// rejected by the caller rather than attributed by guesswork.
function resolveCountyAttribution(attrs) {
  const dorCountyCode = Number.parseInt(attrs.CO_NO, 10);
  const codeCounty = countyFromDorCode(attrs.CO_NO);
  const censusCounty = countyFipsFromCensusBlock(attrs.CENSUS_BK);
  const situsCityCounty = countyFromSitusCity(attrs.PHY_CITY);
  const resolved = censusCounty || situsCityCounty || codeCounty;
  if (!resolved) return null;
  return {
    county: resolved,
    method: censusCounty ? 'census_block' : situsCityCounty ? 'situs_city' : 'dor_county_code',
    dorCountyCode: Number.isInteger(dorCountyCode) ? dorCountyCode : null,
    codeCounty,
    censusBlockFips: censusCounty ? censusCounty.fips : null,
    discrepancy: Boolean(codeCounty && codeCounty.fips !== resolved.fips)
  };
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
        'OBJECTID', 'CO_NO', 'CENSUS_BK', 'PARCEL_ID', 'PARCELNO', 'ASMNT_YR', 'DOR_UC', 'PA_UC',
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

    const situs = situsFromAttributes(attrs);
    // Every ingested listing needs a usable situs address. Parcels without
    // one are evidence noise for opportunity screening and are rejected.
    if (!situs.address || situs.address.length < 8 || !/^\d/.test(situs.street || '')) {
      return null;
    }

    // County attribution: the record's own situs evidence (CENSUS_BK census
    // block, then the scoped situs-city cross-check) outranks the CO_NO
    // county code. A feature with no county evidence at all is rejected
    // rather than attributed by guesswork.
    const countyAttribution = resolveCountyAttribution(attrs);
    if (!countyAttribution) return null;
    const county = countyAttribution.county;

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
          dorCountyCode: countyAttribution.dorCountyCode,
          countyFips: county.fips,
          countyName: county.name,
          // Exactly one county claim (the resolved one) is carried. The raw
          // CO_NO is retained as publisher evidence; any disagreement
          // between the code and the situs-derived county is flagged and
          // counted in the run report — never silently resolved and never
          // duplicated as a second county claim.
          countyAttributionMethod: countyAttribution.method,
          countyCodeDiscrepancy: countyAttribution.discrepancy,
          censusBlockCountyFips: countyAttribution.censusBlockFips,
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
            'OBJECTID', 'CO_NO', 'CENSUS_BK', 'PARCEL_ID', 'ASMNT_YR', 'DOR_UC',
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

      // County attribution evidence for the run report: how many records
      // were attributed from each evidence class, and how many carried a
      // CO_NO code that contradicted the resolved (situs-derived) county.
      const countyAttributionCounts = { censusBlock: 0, situsCity: 0, dorCountyCode: 0 };
      let countyCodeDiscrepancies = 0;
      for (const listing of collected) {
        const facts = listing.provenance && listing.provenance.sourceFacts;
        if (!facts) continue;
        if (facts.countyCodeDiscrepancy === true) countyCodeDiscrepancies += 1;
        if (facts.countyAttributionMethod === 'census_block') countyAttributionCounts.censusBlock += 1;
        else if (facts.countyAttributionMethod === 'situs_city') countyAttributionCounts.situsCity += 1;
        else if (facts.countyAttributionMethod === 'dor_county_code') countyAttributionCounts.dorCountyCode += 1;
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
        countyCodeDiscrepancies,
        countyAttributionCounts,
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
module.exports.FL_COUNTY_BY_FIPS = FL_COUNTY_BY_FIPS;
module.exports.FL_SITUS_CITY_TO_COUNTY = FL_SITUS_CITY_TO_COUNTY;
module.exports.countyFipsFromCensusBlock = countyFipsFromCensusBlock;
module.exports.countyFromSitusCity = countyFromSitusCity;
module.exports.resolveCountyAttribution = resolveCountyAttribution;
