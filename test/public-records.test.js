'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parcelIdentity, sameParcel, buildFloridaQuery, collectFloridaParcels, lookupFloridaParcel,
  ACS_METRICS, getAcsContext, geocodeCensusAddress, estimateEquityScenario, amortizedBalance,
  buildPublicRecordEvidence,
} = require('../server/public-records');

const response = data => ({ ok: true, status: 200, json: async () => data });
const polygon = { type: 'Polygon', coordinates: [[[-82, 29], [-81, 29], [-81, 30], [-82, 29]]] };
const feature = (id = 1, changes = {}) => ({ type: 'Feature', properties: {
  OBJECTID: id, CO_NO: 11, PARCEL_ID: '07702-000-000', ASMNT_YR: 2025, JV: 144984,
  AV_SD: 84709, AV_NSD: 84709, LND_SQFOOT: 1437480, TOT_LVG_AR: 825, NO_BULDNG: 1,
  NO_RES_UNT: 1, PHY_ADDR1: '2601 NE 160TH LN', PHY_CITY: 'GAINESVILLE', DOR_UC: '052', ...changes,
}, geometry: polygon });
const collection = features => ({ type: 'FeatureCollection', features });
const liveListing = { id: 'FL-TEST', address: '2601 NE 160TH LN', city: 'Gainesville', state: 'FL', zip: '32609', lat: 29.8, lng: -82.2, provenance: { observed: true, origin: 'live' } };
const acs = overrides => {
  const row = { NAME: 'Census Tract 2; Alachua County; Florida', state: '12', county: '001', tract: '000200' };
  for (const code of Object.values(ACS_METRICS)) { row[code + 'E'] = '100'; row[code + 'M'] = '10'; }
  Object.assign(row, { B25002_001E: '1000', B25002_003E: '50' }, overrides);
  return [Object.keys(row), Object.values(row)];
};
const geocode = (matches = 1) => ({ result: { addressMatches: Array.from({ length: matches }, () => ({
  matchedAddress: '2601 NE 160TH LN, GAINESVILLE, FL, 32609', addressComponents: { state: 'FL' },
  coordinates: { x: -82.2, y: 29.8 }, geographies: { 'Census Tracts': [{ GEOID: '12001000200', STATE: '12', COUNTY: '001' }] },
})) } });

test('parcel identity preserves all zeros, separator distinctions and jurisdiction scope', () => {
  const first = { rawParcelId: '07702-000-000', stateFips: '12', countyFips: '001' };
  const identity = parcelIdentity(first);
  assert.equal(identity.normalizedParcelId, '07702-000-000');
  assert.equal(identity.jurisdiction, 'us-fips:12001');
  assert.equal(sameParcel(first, { ...first, countyFips: 1 }), true);
  assert.equal(sameParcel(first, { ...first, rawParcelId: '7702-0-0' }), false);
  assert.equal(sameParcel(first, { ...first, rawParcelId: '07702 000 000' }), false);
  assert.equal(sameParcel(first, { ...first, countyFips: 3 }), false);
  assert.equal(parcelIdentity({ rawParcelId: 7702000000, countyFips: 1, stateFips: 12 }), null);
  assert.equal(parcelIdentity({ rawParcelId: '07702-000-000' }), null);
});

test('Florida query requires scope, combines bounded filters, and quotes raw parcel strings', () => {
  assert.throws(() => buildFloridaQuery({ parcelId: '123' }), /county code or observed coordinates/);
  const url = buildFloridaQuery({ countyNo: 11, parcelId: "000'123", pageSize: 200 });
  assert.equal(url.hostname, 'services9.arcgis.com');
  assert.equal(url.searchParams.get('where'), "CO_NO=11 AND PARCEL_ID='000''123'");
  assert.equal(url.searchParams.get('resultRecordCount'), '100');
  assert.equal(url.searchParams.get('outSR'), '4326');
});

test('Florida preserves source geometry and roll facts, never substitutes them for market value', async () => {
  const result = await collectFloridaParcels({ countyNo: 11 }, { fetchImpl: async () => response(collection([feature()])) });
  assert.deepEqual(result.records[0].geometry, polygon);
  assert.equal(result.records[0].properties.assessmentYear, 2025);
  assert.equal(result.records[0].properties.justValue, 144984);
  assert.equal(result.records[0].properties.marketValue, undefined);
  assert.equal(result.records[0].jurisdiction, 'fl-dor:11');
  assert.equal(result.hasMore, false);
});

test('Florida error JSON and schema drift cannot become a successful empty collection', async () => {
  await assert.rejects(collectFloridaParcels({ countyNo: 11 }, { fetchImpl: async () => response({ error: { message: 'bad token' } }) }), { code: 'SOURCE_REJECTED_QUERY' });
  await assert.rejects(collectFloridaParcels({ countyNo: 11 }, { fetchImpl: async () => response({}) }), { code: 'PARCEL_SCHEMA_CHANGED' });
});

test('Florida full-page GeoJSON retains hasMore and follows bounded offsets without claiming exhaustive coverage', async () => {
  const offsets = [];
  const fetchImpl = async url => {
    const offset = Number(new URL(url).searchParams.get('resultOffset')); offsets.push(offset);
    return response(collection([feature(offset + 1)]));
  };
  const result = await collectFloridaParcels({ countyNo: 11, pageSize: 1 }, { fetchImpl, maxPages: 2 });
  assert.deepEqual(offsets, [0, 1]);
  assert.equal(result.records.length, 2);
  assert.equal(result.hasMore, true);
  assert.equal(result.nextOffset, 2);
  assert.equal(result.complete, false);
});

test('Florida repeated pages fail visibly instead of looping or reporting completion', async () => {
  await assert.rejects(collectFloridaParcels({ countyNo: 11, pageSize: 1 }, { fetchImpl: async () => response(collection([feature()])), maxPages: 3 }), { code: 'PARCEL_PAGINATION_STALLED' });
});

test('parcel point hits remain candidates, exact scoped IDs can match and multiple records stay ambiguous', async () => {
  const fetchImpl = async () => response(collection([feature()]));
  assert.equal((await lookupFloridaParcel(liveListing, { fetchImpl })).status, 'candidate');
  assert.equal((await lookupFloridaParcel({ ...liveListing, parcelId: '07702-000-000', floridaDorCountyNo: 11 }, { fetchImpl })).status, 'matched');
  assert.equal((await lookupFloridaParcel(liveListing, { fetchImpl: async () => response(collection([feature(), feature(2)])) })).status, 'ambiguous');
  await assert.rejects(lookupFloridaParcel({ ...liveListing, provenance: { ...liveListing.provenance, derivedFields: { coordinates: true } } }, { fetchImpl }), { code: 'PARCEL_LINK_REQUIRED' });
});

test('Census uses requested year/tract, retains margins of error, redacts keys, and exposes aggregate scope', async () => {
  let query;
  const result = await getAcsContext({ geoid: '12001000200' }, { apiKey: 'test-secret', acsYear: 2024, fetchImpl: async url => { query = new URL(url); return response(acs()); } });
  assert.equal(query.pathname, '/data/2024/acs/acs5');
  assert.equal(query.searchParams.get('for'), 'tract:000200');
  assert.equal(query.searchParams.get('key'), 'test-secret');
  assert.equal(result.geographyLevel, 'tract');
  assert.equal(result.period, '2020–2024');
  assert.equal(result.metrics.vacancyRate, 0.05);
  assert.equal(result.marginsOfError.vacantHousingUnits, 10);
  assert.equal(result.marginsOfError.vacancyRate, null);
  assert.equal(JSON.stringify(result).includes('test-secret'), false);
  assert.match(result.label, /not property facts/);
});

test('Census sentinel values and zero denominators stay unavailable', async () => {
  const result = await getAcsContext({ geoid: '12001000200' }, { apiKey: 'key', fetchImpl: async () => response(acs({ B25077_001E: '-666666666', B25077_001M: '-222222222', B25002_001E: '0' })) });
  assert.equal(result.metrics.medianHomeValue, null);
  assert.equal(result.marginsOfError.medianHomeValue, null);
  assert.equal(result.metrics.vacancyRate, null);
});

test('Census supports county context and rejects geography mismatches', async () => {
  const result = await getAcsContext({ stateFips: '12', countyFips: '001' }, { apiKey: 'key', fetchImpl: async () => response(acs({ NAME: 'Alachua County; Florida' })) });
  assert.equal(result.geographyLevel, 'county');
  assert.equal(result.geoid, '12001');
  await assert.rejects(getAcsContext({ geoid: '12001000200' }, { apiKey: 'key', fetchImpl: async () => response(acs({ county: '003' })) }), { code: 'CENSUS_GEOGRAPHY_MISMATCH' });
});

test('Census geocoder uses matching ACS geography vintage and never promotes address-range coordinates', async () => {
  let query;
  const result = await geocodeCensusAddress(liveListing, { acsYear: 2024, fetchImpl: async url => { query = new URL(url); return response(geocode()); } });
  assert.equal(query.searchParams.get('vintage'), 'ACS2024_Current');
  assert.equal(result.geoid, '12001000200');
  assert.equal(result.propertyCoordinates, null);
  await assert.rejects(geocodeCensusAddress(liveListing, { fetchImpl: async () => response(geocode(2)) }), { code: 'ADDRESS_AMBIGUOUS' });
});

test('Missing Census key is explicit and never invokes network', async () => {
  let calls = 0;
  await assert.rejects(getAcsContext({ geoid: '12001000200' }, { apiKey: null, fetchImpl: async () => { calls++; } }), { code: 'CENSUS_API_KEY_REQUIRED' });
  assert.equal(calls, 0);
});

const scenario = () => ({
  lastSalePrice: 200000, lastSaleDate: '2010-01-01', asOf: '2026-01-01', debtKnown: true,
  hpiThen: { value: 100, seriesId: 'test-series', geographyId: 'test-metro', date: '2010-01-01' },
  hpiNow: { value: 150, seriesId: 'test-series', geographyId: 'test-metro', date: '2025-10-01' },
  mortgages: [{ principal: 100000, originationDate: '2025-01-01', annualRate: 0, termMonths: 120 }],
});

test('equity scenario needs complete debt and HPI instead of filling missing values with zero', () => {
  assert.equal(estimateEquityScenario({ ...scenario(), debtKnown: false }).status, 'unavailable');
  assert.equal(estimateEquityScenario({ ...scenario(), mortgages: undefined }).status, 'unavailable');
  assert.equal(estimateEquityScenario({ ...scenario(), hpiNow: null }).status, 'unavailable');
  assert.equal(estimateEquityScenario({ ...scenario(), hpiNow: { ...scenario().hpiNow, geographyId: 'other' } }).status, 'unavailable');
  assert.equal(estimateEquityScenario({ ...scenario(), mortgages: [{ principal: 100000 }] }).status, 'unavailable');
  assert.equal(estimateEquityScenario({ ...scenario(), mortgages: [] }).estimatedDebt, 0);
});

test('equity amortizes from each loan origination date, not the property sale date', () => {
  const result = estimateEquityScenario(scenario());
  assert.equal(result.estimatedValue, 300000);
  assert.equal(result.estimatedDebt, 90000);
  assert.equal(result.estimatedEquity, 210000);
  assert.equal(result.status, 'scenario');
  assert.equal(amortizedBalance({ principal: 100000, annualRate: 0, termMonths: 120, originationDate: '2027-01-01' }, '2026-01-01'), null);
});

test('builder requires explicit lookup and observed live provenance before outgoing requests', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; return response({}); };
  const idle = await buildPublicRecordEvidence(liveListing, { fetchImpl });
  assert.deepEqual(idle.issueCodes, ['LOOKUP_NOT_REQUESTED']);
  const demo = await buildPublicRecordEvidence({ ...liveListing, provenance: { observed: true, origin: 'snapshot' } }, { allowNetwork: true, fetchImpl });
  assert.deepEqual(demo.issueCodes, ['SOURCE_OBSERVATION_REQUIRED']);
  assert.equal(calls, 0);
});

test('builder preserves successful parcel evidence when Census credentials are unavailable', async () => {
  const result = await buildPublicRecordEvidence(liveListing, { allowNetwork: true, apiKey: null, fetchImpl: async () => response(collection([feature()])) });
  assert.equal(result.parcel.status, 'candidate');
  assert.equal(result.areaContext, null);
  assert.equal(result.equityScenario.status, 'unavailable');
  assert.ok(result.issueCodes.includes('CENSUS_API_KEY_REQUIRED'));
  assert.ok(result.issueCodes.includes('PARCEL_MATCH_UNCONFIRMED'));
  assert.equal(result.sources[0].id, 'florida-statewide-parcels');
});
