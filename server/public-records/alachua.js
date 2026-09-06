'use strict';

const { PublicRecordError, fetchOfficialJson, cleanText, nonnegative } = require('./http');
const { normalizeParcelId, parcelIdentity } = require('./identity');
const { validGeometry } = require('./florida');
const { ScraperCircuitBreaker } = require('../scrapers/circuit-breaker');

const ALACHUA_LAYER = 'https://maps.alachuacounty.us/server/rest/services/Hosted/ParcelsACGM/FeatureServer/0';
const ALACHUA_FIELDS = Object.freeze(['objectid', 'parcel', 'taxyear', 'buildingquantity', 'heatedsquarefeet', 'acres', 'justvalue', 'jurisno', 'zonecode', 'zonelink', 'flucode', 'flulink', 'epdwetland', 'link_acpa']);
const defaultBreaker = new ScraperCircuitBreaker();
const JURISDICTIONS = Object.freeze({ 0: 'Alachua County', 100: 'Alachua', 200: 'Archer', 300: 'Gainesville', 400: 'Hawthorne', 500: 'High Springs', 600: 'Lacrosse', 700: 'Micanopy', 800: 'Newberry', 900: 'Waldo', 1000: 'Undefined' });
const WETLAND_CODES = Object.freeze({ 0: 'Existence of wetlands undetermined', 1: 'Wetlands existence likely', 2: 'Wetlands exist on or near site', 3: 'Wetlands existence unlikely', 4: 'Parcel in unincorporated area of county' });

function isAlachuaListing(listing) {
  if (String(listing?.state).toUpperCase() !== 'FL') return false;
  const dor = listing.floridaDorCountyNo || listing.provenance?.floridaDorCountyNo;
  const county = String(listing.county || '').trim();
  const stateFips = listing.stateFips || listing.provenance?.stateFips;
  const countyFips = listing.countyFips || listing.provenance?.countyFips;
  if (dor != null && Number(dor) !== 11) return false;
  if (county && !/^alachua(?: county)?$/i.test(county)) return false;
  if (stateFips != null && String(stateFips) !== '12') return false;
  if (countyFips != null && String(countyFips).padStart(3, '0') !== '001') return false;
  return Number(dor) === 11 || Boolean(county) || (String(stateFips) === '12' && String(countyFips).padStart(3, '0') === '001');
}

function buildAlachuaQuery({ rawParcelId } = {}) {
  const parcel = normalizeParcelId(rawParcelId);
  if (!parcel) throw new PublicRecordError('ALACHUA_PARCEL_ID_REQUIRED', 'An intact Alachua parcel identifier is required.');
  const url = new URL(`${ALACHUA_LAYER}/query`);
  url.search = new URLSearchParams({ where: `parcel='${parcel.replace(/'/g, "''")}'`, outFields: ALACHUA_FIELDS.join(','), returnGeometry: 'true', outSR: '4326', returnZ: 'false', returnM: 'false', orderByFields: 'objectid ASC', resultRecordCount: '10', resultOffset: '0', f: 'geojson' }).toString();
  return url;
}

function referenceUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== 'https:' || url.username || url.password || url.port || /token|key|password|authorization/i.test(url.search)) return null;
    if (!['alachuacounty.us', 'www.alachuacounty.us', 'maps.alachuacounty.us', 'acpafl.org', 'www.acpafl.org', 'qpublic.schneidercorp.com', 'library.municode.com'].includes(host)) return null;
    return url.toString();
  } catch { return null; }
}

function normalizeAlachuaFeature(feature, source) {
  const a = feature?.properties;
  const identity = parcelIdentity({ rawParcelId: a?.parcel, stateFips: '12', countyFips: '001' });
  if (!a || !Number.isSafeInteger(a.objectid) || !identity) throw new PublicRecordError('ALACHUA_SCHEMA_CHANGED', 'County parcel identity fields are unavailable.');
  const jurisdictionCode = Number.isInteger(a.jurisno) ? a.jurisno : null;
  const wetlandCode = Number.isInteger(a.epdwetland) ? a.epdwetland : null;
  return {
    id: String(a.objectid), rawParcelId: a.parcel, identity, jurisdiction: identity.jurisdiction,
    properties: { assessmentYear: nonnegative(a.taxyear), buildingCount: nonnegative(a.buildingquantity), livingAreaSqft: nonnegative(a.heatedsquarefeet), landAcres: nonnegative(a.acres), assessorJustValue: nonnegative(a.justvalue) },
    planning: {
      jurisdictionCode, jurisdictionLabel: JURISDICTIONS[jurisdictionCode] || null,
      countyRulesApplicable: jurisdictionCode === 0, zoningCode: cleanText(a.zonecode), zoningReference: referenceUrl(a.zonelink),
      futureLandUseCode: cleanText(a.flucode), futureLandUseReference: referenceUrl(a.flulink),
      wetlandReview: { code: wetlandCode, label: WETLAND_CODES[wetlandCode] || null, conclusion: 'requires_site_review' },
      developmentRights: 'unresolved',
    },
    propertyAppraiserUrl: referenceUrl(a.link_acpa), geometry: validGeometry(feature.geometry) ? feature.geometry : null,
    evidenceClass: 'public_record_observed', surveyStatus: 'not_a_survey', source,
  };
}

async function lookupAlachuaParcel(input, options = {}) {
  const url = buildAlachuaQuery(input);
  const breaker = options.circuitBreaker || defaultBreaker;
  if (breaker.isOpen()) throw new PublicRecordError('ALACHUA_CIRCUIT_OPEN', 'County parcel lookup is paused after upstream failures.');
  let data;
  try {
    data = await fetchOfficialJson(url, options);
    if (data?.type !== 'FeatureCollection' || !Array.isArray(data.features) || data.features.length > 10) throw new PublicRecordError('ALACHUA_SCHEMA_CHANGED', 'County parcel response has an unexpected format.');
    const check = breaker.validateResponse({ status: 200, body: JSON.stringify(data) });
    if (!check.isValid) throw new PublicRecordError('ALACHUA_RESPONSE_REJECTED', 'County parcel response failed its evidence checks.');
  } catch (error) {
    if (!breaker.isOpen()) breaker.trip(error.code || 'SOURCE_UNAVAILABLE', { immediate: error.code === 'SOURCE_HTTP_ERROR' && /403/.test(error.message) });
    throw error;
  }
  const source = { id: 'alachua-county-parcels', label: 'Alachua County parcel and planning records', url: url.toString(), observedAt: new Date(options.now ?? Date.now()).toISOString() };
  const records = data.features.map(feature => normalizeAlachuaFeature(feature, source));
  const hasMore = data.exceededTransferLimit === true || (data.exceededTransferLimit !== false && records.length === 10);
  const record = records.length === 1 && !hasMore ? records[0] : null;
  const exact = record && record.identity.normalizedParcelId === normalizeParcelId(input.rawParcelId);
  const status = !records.length ? 'not_found' : !record ? 'ambiguous' : exact ? 'matched' : 'candidate';
  return {
    status,
    matchState: exact ? 'exact_scoped_parcel_id' : status,
    queriedRawParcelId: input.rawParcelId,
    rawParcelId: record?.rawParcelId || null,
    identity: record?.identity || null,
    jurisdiction: 'us-fips:12001',
    properties: record?.properties || null,
    planning: record?.planning || null,
    propertyAppraiserUrl: record?.propertyAppraiserUrl || null,
    geometry: record?.geometry || null,
    records,
    hasMore,
    coverage: 'bounded_exact_parcel_query',
    source,
  };
}

module.exports = { ALACHUA_LAYER, ALACHUA_FIELDS, isAlachuaListing, buildAlachuaQuery, normalizeAlachuaFeature, lookupAlachuaParcel };
