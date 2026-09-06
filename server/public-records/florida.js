'use strict';

const { PublicRecordError, fetchOfficialJson, nonnegative, cleanText } = require('./http');
const { parcelIdentity, normalizeParcelId } = require('./identity');

const FLORIDA_LAYER = 'https://services9.arcgis.com/Gh9awoU677aKree0/arcgis/rest/services/Florida_Statewide_Cadastral/FeatureServer/0';
const FLORIDA_FIELDS = [
  'OBJECTID', 'CO_NO', 'PARCEL_ID', 'ASMNT_YR', 'DOR_UC', 'JV', 'AV_SD', 'AV_NSD',
  'LND_SQFOOT', 'TOT_LVG_AR', 'NO_BULDNG', 'NO_RES_UNT', 'PHY_ADDR1', 'PHY_CITY',
  'SALE_PRC1', 'SALE_YR1', 'SALE_MO1', 'QUAL_CD1', 'M_PAR_SAL1',
];

function validCoordinate(value, min, max) {
  if (value === null || value === undefined || typeof value === 'boolean' || String(value).trim() === '') return null;
  const result = Number(value);
  return Number.isFinite(result) && result >= min && result <= max ? result : null;
}

function validGeometry(value) {
  const polygons = value?.type === 'Polygon' ? [value.coordinates] : value?.type === 'MultiPolygon' ? value.coordinates : null;
  return Array.isArray(polygons) && polygons.length > 0 && polygons.every(polygon => Array.isArray(polygon) && polygon.length > 0 && polygon.every(ring => {
    if (!Array.isArray(ring) || ring.length < 4) return false;
    if (!ring.every(point => Array.isArray(point) && point.length >= 2
      && typeof point[0] === 'number' && validCoordinate(point[0], -180, 180) !== null
      && typeof point[1] === 'number' && validCoordinate(point[1], -90, 90) !== null)) return false;
    return ring[0][0] === ring.at(-1)[0] && ring[0][1] === ring.at(-1)[1];
  }));
}

function buildFloridaQuery(input = {}) {
  const county = input.countyNo === null || input.countyNo === undefined ? null : Number(input.countyNo);
  if (county !== null && (!Number.isInteger(county) || county < 1 || county > 99)) throw new PublicRecordError('INVALID_COUNTY', 'Use an official Florida DOR county code.');
  const parcelId = normalizeParcelId(input.parcelId);
  if (input.parcelId !== undefined && input.parcelId !== null && !parcelId) throw new PublicRecordError('INVALID_PARCEL_ID', 'Parcel ID must be an intact text identifier.');
  const lat = validCoordinate(input.lat, -90, 90), lng = validCoordinate(input.lng, -180, 180);
  if (county === null && (lat === null || lng === null)) throw new PublicRecordError('PARCEL_SCOPE_REQUIRED', 'Florida parcel lookup requires a DOR county code or observed coordinates.');
  const clauses = [];
  if (county !== null) clauses.push(`CO_NO=${county}`);
  if (parcelId) clauses.push(`PARCEL_ID='${parcelId.replace(/'/g, "''")}'`);
  const url = new URL(`${FLORIDA_LAYER}/query`);
  url.search = new URLSearchParams({
    where: clauses.join(' AND ') || '1=1', outFields: FLORIDA_FIELDS.join(','),
    returnGeometry: 'true', outSR: '4326', returnZ: 'false', returnM: 'false',
    orderByFields: 'OBJECTID ASC', resultRecordCount: String(Math.max(1, Math.min(100, Math.floor(Number(input.pageSize) || 25)))),
    resultOffset: String(Math.max(0, Math.min(1000000, Math.floor(Number(input.offset) || 0)))), f: 'geojson',
  }).toString();
  if (lat !== null && lng !== null) {
    url.searchParams.set('geometry', `${lng},${lat}`);
    url.searchParams.set('geometryType', 'esriGeometryPoint');
    url.searchParams.set('inSR', '4326');
    url.searchParams.set('spatialRel', 'esriSpatialRelIntersects');
  }
  return url;
}

function normalizeFloridaFeature(feature, source) {
  const attributes = feature?.properties;
  if (!attributes || !Number.isSafeInteger(attributes.OBJECTID) || !Number.isInteger(attributes.CO_NO)) {
    throw new PublicRecordError('PARCEL_SCHEMA_CHANGED', 'Florida parcel identity fields are unavailable.');
  }
  const rawParcelId = cleanText(attributes.PARCEL_ID, 120);
  const identity = parcelIdentity({ rawParcelId, jurisdiction: `fl-dor:${attributes.CO_NO}` });
  if (!identity) throw new PublicRecordError('PARCEL_SCHEMA_CHANGED', 'Florida parcel ID is unavailable.');
  return {
    id: String(attributes.OBJECTID), rawParcelId, identity, jurisdiction: identity.jurisdiction,
    properties: {
      assessmentYear: nonnegative(attributes.ASMNT_YR), justValue: nonnegative(attributes.JV),
      assessedValueSchool: nonnegative(attributes.AV_SD), assessedValueNonSchool: nonnegative(attributes.AV_NSD),
      landSqft: nonnegative(attributes.LND_SQFOOT), livingAreaSqft: nonnegative(attributes.TOT_LVG_AR),
      buildingCount: nonnegative(attributes.NO_BULDNG), residentialUnits: nonnegative(attributes.NO_RES_UNT),
      useCode: cleanText(attributes.DOR_UC), physicalAddress: cleanText(attributes.PHY_ADDR1), city: cleanText(attributes.PHY_CITY),
      recordedSalePrice: nonnegative(attributes.SALE_PRC1), recordedSaleYear: nonnegative(attributes.SALE_YR1),
      recordedSaleMonth: cleanText(attributes.SALE_MO1), saleQualificationCode: cleanText(attributes.QUAL_CD1),
      multiParcelSaleCode: cleanText(attributes.M_PAR_SAL1),
    },
    geometry: validGeometry(feature.geometry) ? feature.geometry : null,
    evidenceStatus: 'source_observed', surveyStatus: 'not_a_survey', source,
  };
}

async function collectFloridaParcels(input = {}, options = {}) {
  const maxPages = Math.max(1, Math.min(10, Math.floor(Number(options.maxPages) || 1)));
  const maxRecords = Math.max(1, Math.min(500, Math.floor(Number(options.maxRecords) || 100)));
  const pageSize = Math.max(1, Math.min(100, maxRecords, Math.floor(Number(input.pageSize) || 25)));
  let offset = Math.max(0, Math.floor(Number(input.offset) || 0));
  const records = [], seen = new Set(), sources = [];
  let hasMore = false, pagesFetched = 0;
  for (let page = 0; page < maxPages && records.length < maxRecords; page++) {
    const requested = Math.min(pageSize, maxRecords - records.length);
    const url = buildFloridaQuery({ ...input, pageSize: requested, offset });
    const data = await fetchOfficialJson(url, options);
    if (data?.type !== 'FeatureCollection' || !Array.isArray(data.features) || data.features.length > requested) {
      throw new PublicRecordError('PARCEL_SCHEMA_CHANGED', 'Florida parcel response has an unexpected format.');
    }
    const source = { id: 'florida-statewide-parcels', label: 'Florida DOR cadastral and assessment records', url: url.toString(), observedAt: new Date(options.now || Date.now()).toISOString() };
    sources.push(source);
    let added = 0;
    for (const feature of data.features) {
      const record = normalizeFloridaFeature(feature, source);
      if (seen.has(record.id)) continue;
      seen.add(record.id); records.push(record); added++;
    }
    pagesFetched++;
    offset += data.features.length;
    // GeoJSON often omits exceededTransferLimit. A full page never proves exhaustion.
    hasMore = data.exceededTransferLimit === true || (data.exceededTransferLimit !== false && data.features.length === requested);
    if (hasMore && !added) throw new PublicRecordError('PARCEL_PAGINATION_STALLED', 'Florida parcel pagination stopped advancing.');
    if (!hasMore) break;
  }
  return { records, sources, pagesFetched, hasMore, nextOffset: hasMore ? offset : null, coverage: 'bounded_query', complete: !hasMore };
}

function observedCoordinates(listing) {
  const provenance = listing?.provenance;
  const derived = provenance?.derivedFields || {};
  return provenance?.observed === true && provenance.origin === 'live' && provenance.recordKind !== 'demo'
    && !derived.geocode && !derived.coordinates && !derived.location
    && validCoordinate(listing.lat, -90, 90) !== null && validCoordinate(listing.lng, -180, 180) !== null;
}

async function lookupFloridaParcel(listing, options = {}) {
  const parcelId = listing.parcelId || listing.provenance?.parcelNumber;
  const countyNo = listing.floridaDorCountyNo || listing.provenance?.floridaDorCountyNo;
  const exactScope = Boolean(parcelId && countyNo);
  if (!exactScope && !observedCoordinates(listing)) throw new PublicRecordError('PARCEL_LINK_REQUIRED', 'Add a source parcel ID with its Florida DOR county code, or source-observed coordinates.');
  const result = await collectFloridaParcels(exactScope ? { parcelId, countyNo, pageSize: 10 } : { lat: listing.lat, lng: listing.lng, pageSize: 10 }, { ...options, maxPages: 1, maxRecords: 10 });
  const record = result.records.length === 1 && !result.hasMore ? result.records[0] : null;
  const exact = record && exactScope && normalizeParcelId(parcelId) === record.identity.normalizedParcelId && record.jurisdiction === `fl-dor:${Number(countyNo)}`;
  const status = !result.records.length ? 'not_found' : !record ? 'ambiguous' : exact ? 'matched' : 'candidate';
  return {
    status, matchState: exact ? 'exact_scoped_parcel_id' : status === 'candidate' ? 'point_intersection_requires_confirmation' : status,
    rawParcelId: record?.rawParcelId || null, jurisdiction: record?.jurisdiction || null,
    properties: record?.properties || null, geometry: record?.geometry || null,
    records: result.records, hasMore: result.hasMore, source: result.sources[0],
  };
}

module.exports = { FLORIDA_LAYER, FLORIDA_FIELDS, buildFloridaQuery, collectFloridaParcels, lookupFloridaParcel, normalizeFloridaFeature, validGeometry, observedCoordinates };
