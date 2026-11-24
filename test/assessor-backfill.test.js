'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { backfillAssessorRolls, CONVERTED_STATES, candidateReady, countyEnrolled } = require('../server/enrichment/assessor-backfill');
const { cacheKeyFor, DEFAULT_CACHE_PATH, DEFAULT_MISS_TTL_MS } = require('../server/enrichment/assessor-harvest');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Same ArcGIS envelope helper the assessor-harvest tests use: a fetch mock
// returning one feature for a Maricopa APN query.
function arcgisFetchReturning(attributes) {
  return async (url) => ({
    ok: true,
    json: async () => ({ features: [{ attributes }] }),
  });
}

const MARICOPA_ATTRIBUTES = {
  APN: '10101010',
  FullCashValue: 10205862,
  ParcelValuationYear: 2027,
  TaxYear: 2026,
};

function fakeDb(rows) {
  const persisted = [];
  return {
    persisted,
    async getListings(filters) {
      return { total: rows.length, listings: rows };
    },
    async createListing(listing) {
      persisted.push(listing.id);
      return listing;
    },
  };
}

// Hermetic cache: the default cache path is shared with real harvest runs, so
// every backfill test points at its own temp file.
function temporaryCachePath() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pc-backfill-')), 'assessor-roll.json');
}

test('CONVERTED_STATES covers the states with verified conversions only', () => {
  assert.ok(CONVERTED_STATES.includes('AZ'));
  assert.ok(CONVERTED_STATES.includes('MI'));
  assert.ok(CONVERTED_STATES.includes('PA'));
  assert.ok(CONVERTED_STATES.includes('FL'));
  for (const state of CONVERTED_STATES) {
    assert.match(state, /^[A-Z]{2}$/, 'state codes must be two letters');
  }
});

test('backfill harvests roll-less stored rows and persists each roll as it attaches', async () => {
  const rollLess = {
    id: 'servicelink:mar-1',
    source: 'servicelink',
    state: 'AZ',
    county: 'Maricopa',
    address: '11350 W Civic Center Dr, Avondale, AZ',
    lat: 33.44524870764965,
    lng: -112.30307931856072,
    openingBid: 5000000,
    provenance: { origin: 'live', observed: true, publisher: 'ServiceLink', recordId: 'mar-1' },
  };
  const alreadyRolled = {
    id: 'servicelink:mar-2',
    source: 'servicelink',
    state: 'AZ',
    county: 'Maricopa',
    lat: 33.4,
    lng: -112.3,
    provenance: { origin: 'live', observed: true, derivedFields: { assessorRoll: { countyKey: 'AZ-MARICOPA' } } },
  };
  const unenrolledCounty = {
    id: 'servicelink:pin-1',
    source: 'servicelink',
    state: 'AZ',
    county: 'Pinal',
    lat: 32.75,
    lng: -111.67,
    provenance: { origin: 'live', observed: true },
  };
  const db = fakeDb([rollLess, alreadyRolled, unenrolledCounty]);
  const result = await backfillAssessorRolls({
    db,
    cachePath: temporaryCachePath(),
    fetchFn: async () => arcgisFetchReturning(MARICOPA_ATTRIBUTES)(),
    now: Date.parse('2026-11-01T00:00:00.000Z'),
  });

  assert.equal(result.considered, 1, 'only the roll-less, geo-ready, enrolled-county row is a candidate');
  assert.equal(result.harvested, 1);
  assert.equal(result.persisted, 1);
  assert.deepEqual(db.persisted, ['servicelink:mar-1']);
  const roll = rollLess.provenance.derivedFields.assessorRoll;
  assert.equal(roll.countyKey, 'AZ-MARICOPA');
  assert.equal(roll.parcel.assessedValue.total, 10205862);
  assert.equal(roll.taxYear, 2026);
  assert.equal(roll.valuationYear, 2027);
  assert.equal(rollLess.parcelKey, '04013-10101010');
  assert.equal(rollLess.provenance.derivedFields.parcelKey, true);
});

test('backfill is bounded by the candidate cap and tolerant of db and fetch failures', async () => {
  const explodingDb = {
    async getListings() { throw new Error('pg down'); },
    async createListing() { throw new Error('nope'); },
  };
  const queryFailure = await backfillAssessorRolls({ db: explodingDb });
  assert.equal(queryFailure.considered, 0);
  assert.equal(queryFailure.harvested, 0);
  assert.equal(queryFailure.skipped, null);

  const noDb = await backfillAssessorRolls({});
  assert.equal(noDb.skipped, 'db-unavailable');

  const rows = [];
  for (let i = 0; i < 10; i += 1) {
    rows.push({
      id: `servicelink:phila-${i}`,
      source: 'servicelink',
      state: 'PA',
      county: 'Philadelphia',
      lat: 39.95,
      lng: -75.16,
      provenance: { origin: 'live', observed: true },
    });
  }
  const capped = await backfillAssessorRolls({ db: fakeDb(rows), limit: 3, cachePath: temporaryCachePath(), fetchFn: async () => ({ ok: true, json: async () => ({ features: [] }) }) });
  assert.equal(capped.considered, 3, 'the candidate cap bounds the batch');
  assert.equal(capped.harvested, 0);
});

test('candidateReady requires coordinates or an APN, no existing roll, and an enrolled county', () => {
  assert.equal(candidateReady({ lat: 33.4, lng: -112.3, state: 'AZ', county: 'Maricopa' }), true);
  assert.equal(candidateReady({ provenance: { sourceFacts: { parcelNumber: '10101010' } }, state: 'AZ', county: 'Maricopa' }), true);
  assert.equal(candidateReady({ apn: '10101010', state: 'AZ', county: 'Maricopa' }), true);
  assert.equal(candidateReady({ lat: 0, lng: 0, state: 'AZ', county: 'Maricopa' }), false, 'null island is not a coordinate');
  assert.equal(candidateReady({ lat: 32.75, lng: -111.67, state: 'AZ', county: 'Pinal' }), false, 'unenrolled counties are not candidates');
  assert.equal(candidateReady({ lat: 33.4, lng: -112.3, state: 'AZ', county: 'Maricopa', provenance: { derivedFields: { assessorRoll: { countyKey: 'AZ-MARICOPA' } } } }), false, 'rolled rows are not candidates');
  assert.equal(candidateReady({ lat: 33.4, lng: -112.3, state: 'AZ', county: 'Maricopa', assessed: 300000 }), true, 'rows with a publisher assessed value but no assessorRoll remain candidates');
  assert.equal(candidateReady({}), false);
  assert.equal(candidateReady(null), false);
});

test('countyEnrolled resolves registry entries and the Florida statewide fallback', () => {
  assert.equal(countyEnrolled('AZ', 'Maricopa'), true);
  assert.equal(countyEnrolled('AZ', 'Pinal'), false);
  assert.equal(countyEnrolled('FL', 'Orange'), true, 'Florida resolves through the statewide fallback');
  assert.equal(countyEnrolled('AZ', ''), false);
  assert.equal(countyEnrolled(null, 'Maricopa'), false);
});

test('backfill skips candidates whose miss is negatively cached within the TTL', async () => {
  const rollLess = {
    id: 'servicelink:mar-9',
    source: 'servicelink',
    state: 'AZ',
    county: 'Maricopa',
    lat: 33.5,
    lng: -112.4,
    provenance: { origin: 'live', observed: true },
  };
  const db = fakeDb([rollLess]);
  const cachePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pc-backfill-miss-')), 'assessor-roll.json');
  const key = cacheKeyFor('AZ-MARICOPA', 33.5, -112.4, null);
  fs.mkdirSync(path.dirname(cachePath), { recursive: true });
  fs.writeFileSync(cachePath, JSON.stringify({ [key]: { parcel: null, observedAt: '2026-10-30T00:00:00.000Z' } }));

  const result = await backfillAssessorRolls({
    db,
    cachePath,
    fetchFn: async () => { throw new Error('must not fetch a cached miss'); },
    now: Date.parse('2026-11-01T00:00:00.000Z'),
  });
  assert.equal(result.considered, 0, 'the cached miss is skipped during selection');
  assert.equal(result.harvested, 0);
  assert.deepEqual(db.persisted, []);
  fs.rmSync(path.dirname(cachePath), { recursive: true, force: true });
});

test('backfillAssessorRolls populates and persists listing.parcelKey when roll parcel apn is harvested', async () => {
  const row = {
    id: 'servicelink:mar-parcelkey-test',
    source: 'servicelink',
    state: 'AZ',
    county: 'Maricopa',
    countyFips: '04013',
    lat: 33.4452,
    lng: -112.303,
    openingBid: 100000,
    provenance: { origin: 'live', observed: true, publisher: 'ServiceLink', recordId: 'mar-pk-1' },
  };
  const persistedListings = [];
  const db = {
    async getListings() {
      return { total: 1, listings: [row] };
    },
    async createListing(listing) {
      persistedListings.push(listing);
      return listing;
    },
  };
  const result = await backfillAssessorRolls({
    db,
    cachePath: temporaryCachePath(),
    fetchFn: async () => arcgisFetchReturning({
      APN: '101-01-010',
      FullCashValue: 250000,
      TaxYear: 2026,
    })(),
    now: Date.parse('2026-11-01T00:00:00.000Z'),
  });

  assert.equal(result.harvested, 1);
  assert.equal(result.persisted, 1);
  assert.equal(persistedListings.length, 1);
  assert.equal(persistedListings[0].parcelKey, '04013-10101010');
  assert.equal(persistedListings[0].provenance?.derivedFields?.parcelKey, true);
  assert.equal(row.parcelKey, '04013-10101010');
});
test('backfill round-robins across states so no single state starves others', async () => {
  const rows = [
    { id: 'tx-1', source: 'servicelink', state: 'TX', county: 'Bexar', lat: 29.1, lng: -98.4, openingBid: 100000, provenance: { origin: 'live', observed: true, publisher: 'ServiceLink', recordId: 'tx-1' } },
    { id: 'tx-2', source: 'servicelink', state: 'TX', county: 'Bexar', lat: 29.2, lng: -98.5, openingBid: 100000, provenance: { origin: 'live', observed: true, publisher: 'ServiceLink', recordId: 'tx-2' } },
    { id: 'az-1', source: 'servicelink', state: 'AZ', county: 'Maricopa', lat: 33.4, lng: -112.3, openingBid: 100000, provenance: { origin: 'live', observed: true, publisher: 'ServiceLink', recordId: 'az-1' } },
    { id: 'fl-1', source: 'servicelink', state: 'FL', county: 'Miami-Dade', lat: 25.7, lng: -80.2, openingBid: 100000, provenance: { origin: 'live', observed: true, publisher: 'ServiceLink', recordId: 'fl-1' } },
  ];
  const db = {
    async getListings({ state }) {
      const matches = rows.filter(r => r.state === state);
      return { total: matches.length, listings: matches };
    },
    async createListing(listing) {
      return listing;
    },
  };
  const consideredOrder = [];
  const result = await backfillAssessorRolls({
    db,
    limit: 3,
    cachePath: temporaryCachePath(),
    fetchFn: async (url) => {
      return { ok: true, json: async () => ({ features: [] }) };
    },
    now: Date.parse('2026-11-01T00:00:00.000Z'),
  });

  assert.equal(result.considered, 3);
});

test('NJ enrichment resolves N/K/A addresses via NJ_Geocode + NJGIN Cadastral with map policy compliance and condo disambiguation', async () => {
  const { inspectMapLocation, inspectParcelBoundaryInputs } = require('../src/lib/listing-map-policy');
  const {
    extractNjGeocodeQuery,
    enrichNjListing,
    NJ_GEOCODE_URL,
  } = require('../server/enrichment/nj-cadastral');

  assert.equal(
    extractNjGeocodeQuery({
      address: '12 OLD OAK RD N/K/A 19 WEST PARK AVENUE, PARK RIDGE, NJ 07656',
      city: 'PARK RIDGE',
      state: 'NJ',
      zip: '07656',
    }),
    '19 WEST PARK AVENUE, PARK RIDGE, NJ 07656',
  );

  const requestedUrls = [];
  const fetchMock = async (url) => {
    requestedUrls.push(String(url));
    if (String(url).startsWith(NJ_GEOCODE_URL)) {
      return {
        ok: true,
        json: async () => ({
          candidates: [
            {
              address: '19 West Park Avenue, Park Ridge, New Jersey, 07656',
              location: { x: -74.044125, y: 41.034969 },
              score: 100,
              attributes: {
                Score: 100,
                Addr_type: 'PointAddress',
                StAddr: '19 West Park Avenue',
                City: 'Park Ridge',
                RegionAbbr: 'NJ',
                Postal: '07656',
                Addr_Block: '1203',
                Addr_Lot: '7',
              },
            },
          ],
        }),
      };
    }
    return {
      ok: true,
      json: async () => ({
        features: [
          {
            attributes: {
              PAMS_PIN: '0247_1203_6',
              PCLBLOCK: '1203',
              PCLLOT: '6',
              COUNTY: 'BERGEN',
              PROP_CLASS: '2',
              NET_VALUE: 999999,
              LAND_VAL: 500000,
              IMPRVT_VAL: 499999,
              YR_CONSTR: 1960,
              DWELL: 1,
              BLDG_DESC: 'CONDO',
              ST_ADDRESS: '17 W PARK AVE',
            },
          },
          {
            attributes: {
              PAMS_PIN: '0247_1203_7',
              PCLBLOCK: '1203',
              PCLLOT: '7',
              COUNTY: 'BERGEN',
              PROP_CLASS: '2',
              NET_VALUE: 334600,
              LAND_VAL: 241500,
              IMPRVT_VAL: 93100,
              YR_CONSTR: 1952,
              DWELL: 1,
              BLDG_DESC: '1SF1G',
              ST_ADDRESS: '19 W PARK AVE',
            },
          },
        ],
      }),
    };
  };

  const listing = {
    id: 'CIV-NJ-7-2128964683',
    source: 'civilview',
    sourceUrl: 'https://salesweb.civilview.com/Sales/SaleDetails?PropertyId=2128964683',
    state: 'NJ',
    county: 'Bergen County',
    address: '19 WEST PARK AVENUE, PARK RIDGE, NJ 07656',
    city: 'PARK RIDGE',
    zip: '07656',
    propType: 'Unknown',
    apn: 'LOT 7, BLOCK 1203',
    lat: null,
    lng: null,
    assessed: null,
    estLow: null,
    estHigh: null,
    dealScore: null,
    sourceObservedAt: '2026-10-01T12:00:00.000Z',
    provenance: {
      origin: 'live',
      observed: true,
      recordKind: 'source_record',
      publisher: 'CivilView',
      recordId: '2128964683',
      observedAt: '2026-10-01T12:00:00.000Z',
      sourceFacts: { lotBlock: { block: '1203', lot: '7' } },
    },
  };

  const enriched = await enrichNjListing(listing, {
    fetchFn: fetchMock,
    now: Date.parse('2026-11-01T00:00:00.000Z'),
  });
  assert.equal(enriched.found, true);
  assert.equal(listing.lat, 41.034969);
  assert.equal(listing.lng, -74.044125);
  assert.equal(listing.assessed, 334600);
  assert.equal(listing.year, 1952);
  assert.equal(listing.propType, 'Single Family');
  assert.equal(listing.parcelKey, '34003-024712037');
  assert.equal(listing.estLow, null, 'must never fabricate estLow for NJ');
  assert.equal(listing.estHigh, null, 'must never fabricate estHigh for NJ');
  assert.equal(listing.dealScore, null, 'must never fabricate dealScore for NJ');
  assert.equal(inspectMapLocation(listing).accepted, true, 'must pass interactive map location policy');
  assert.equal(inspectParcelBoundaryInputs(listing).eligible, true, 'must pass parcel-boundary preflight');

  // Negative control: low-confidence StreetAddress geocode must NOT attach coords
  const streetOnly = {
    ...listing,
    id: 'CIV-NJ-7-STREETONLY',
    lat: null,
    lng: null,
    assessed: null,
    propType: 'Unknown',
    provenance: { ...listing.provenance, coordinates: undefined, derivedFields: {} },
  };
  const rejected = await enrichNjListing(streetOnly, {
    fetchFn: async () => ({
      ok: true,
      json: async () => ({
        candidates: [{
          address: '19 West Park Avenue, Park Ridge, NJ, 07656',
          location: { x: -74.044, y: 41.034 },
          score: 80,
          attributes: { Score: 80, Addr_type: 'StreetAddress', StAddr: '19 West Park Avenue', City: 'Park Ridge', RegionAbbr: 'NJ', Postal: '07656' },
        }],
      }),
    }),
    now: Date.parse('2026-11-01T00:00:00.000Z'),
  });
  assert.equal(rejected.found, false);
  assert.equal(streetOnly.lat, null);
  assert.equal(streetOnly.lng, null);
});

test('backfillAssessorRolls includes NJ geocoding+cadastral phase without adding NJ to CONVERTED_STATES', async () => {
  assert.equal(CONVERTED_STATES.includes('NJ'), false, 'NJ equalization varies by municipality; must not be in CONVERTED_STATES');
  const njRow = {
    id: 'CIV-NJ-9-2242070159',
    source: 'civilview',
    sourceUrl: 'https://salesweb.civilview.com/Sales/SaleDetails?PropertyId=2242070159',
    state: 'NJ',
    county: 'Morris County',
    address: '10 ELM ST, MORRISTOWN, NJ 07960',
    city: 'MORRISTOWN',
    zip: '07960',
    propType: 'Unknown',
    apn: 'LOT 6, BLOCK 2002',
    lat: null,
    lng: null,
    assessed: null,
    sourceObservedAt: '2026-10-01T12:00:00.000Z',
    provenance: {
      origin: 'live',
      observed: true,
      recordKind: 'source_record',
      publisher: 'CivilView',
      recordId: '2242070159',
      observedAt: '2026-10-01T12:00:00.000Z',
      sourceFacts: { lotBlock: { block: '2002', lot: '6' } },
    },
  };
  const persisted = [];
  const db = {
    async getListings({ state }) {
      return { total: state === 'NJ' ? 1 : 0, listings: state === 'NJ' ? [njRow] : [] };
    },
    async createListing(l) {
      persisted.push(l);
      return l;
    },
  };
  const res = await backfillAssessorRolls({
    db,
    limit: 5,
    cachePath: temporaryCachePath(),
    now: Date.parse('2026-11-01T00:00:00.000Z'),
    fetchFn: async (url) => {
      if (String(url).includes('NJ_Geocode')) {
        return {
          ok: true,
          json: async () => ({
            candidates: [{
              address: '10 Elm Street, Morristown, NJ, 07960',
              location: { x: -74.48, y: 40.79 },
              score: 98,
              attributes: { Score: 98, Addr_type: 'PointAddress', StAddr: '10 Elm St', City: 'Morristown', RegionAbbr: 'NJ', Postal: '07960' },
            }],
          }),
        };
      }
      return {
        ok: true,
        json: async () => ({
          features: [{
            attributes: {
              PAMS_PIN: '1424_2002_6',
              PCLBLOCK: '2002',
              PCLLOT: '6',
              COUNTY: 'MORRIS',
              PROP_CLASS: '2',
              NET_VALUE: 412000,
              LAND_VAL: 180000,
              IMPRVT_VAL: 232000,
              YR_CONSTR: 1928,
              DWELL: 1,
              BLDG_DESC: '2SF',
              ST_ADDRESS: '10 ELM ST',
            },
          }],
        }),
      };
    },
  });
  assert.equal(res.njEnriched, 1);
  assert.equal(persisted.length, 1);
  assert.equal(njRow.lat, 40.79);
  assert.equal(njRow.assessed, 412000);
  assert.equal(njRow.propType, 'Single Family');
});

test('isCompatibleNjSitusAddress matches normalized street variants and rejects house or core-street mismatches', () => {
  const { isCompatibleNjSitusAddress } = require('../server/enrichment/nj-cadastral');

  assert.equal(isCompatibleNjSitusAddress('1427 46TH STREET, NORTH BERGEN, NJ 07047', '1427 46TH ST'), true);
  assert.equal(isCompatibleNjSitusAddress('19 WEST PARK AVENUE, PARK RIDGE, NJ 07656', '19 W PARK AVE'), true);
  assert.equal(isCompatibleNjSitusAddress('1427 46TH STREET (BLOCK 153 LOT 38), NORTH BERGEN, NJ 07047', '1427 46TH ST'), true);
  assert.equal(isCompatibleNjSitusAddress('1427 46TH STREET FKA 1425 46TH ST, NORTH BERGEN, NJ 07047', '1427 46TH ST'), true);
  assert.equal(isCompatibleNjSitusAddress('1427 46TH STREET, NORTH BERGEN, NJ 07047', ''), true);
  assert.equal(isCompatibleNjSitusAddress('1427 46TH STREET, NORTH BERGEN, NJ 07047', 'VACANT LAND'), true);
  assert.equal(isCompatibleNjSitusAddress('BLOCK 153 LOT 38, NORTH BERGEN, NJ 07047', '712 80TH ST'), true);

  assert.equal(isCompatibleNjSitusAddress('1427 46TH STREET, NORTH BERGEN, NJ 07047', '712 80TH ST'), false);
  assert.equal(isCompatibleNjSitusAddress('1427 46TH STREET, NORTH BERGEN, NJ 07047', '1427 80TH ST'), false);
  assert.equal(isCompatibleNjSitusAddress('1427 NORTH PARK AVE, NORTH BERGEN, NJ 07047', '1427 NORTH 80TH ST'), false);
  assert.equal(isCompatibleNjSitusAddress('1427 46TH ST APT 2', '1427 80TH ST APT 2'), false);
  // Relaxed positive assertions: street abbreviations, directionals, unit suffixes, ordinals, and primary stems
  assert.equal(isCompatibleNjSitusAddress('1427 46TH STREET, NORTH BERGEN, NJ 07047', '1427 46 ST'), true);
  assert.equal(isCompatibleNjSitusAddress('19 W PARK AV #2B, PARK RIDGE, NJ 07656', '19 WEST PARK AVENUE UNIT 2B'), true);
  assert.equal(isCompatibleNjSitusAddress('019 N PARK LN, PARK RIDGE, NJ 07656', '19 PARK LANE'), true);
  assert.equal(isCompatibleNjSitusAddress('42 OAK DR, WAYNE, NJ 07470', '42 S OAK DRIVE # 4'), true);
  assert.equal(isCompatibleNjSitusAddress('88 RIVER RD, HACKENSACK, NJ 07601', '88 E RIVER ROAD (UNIT A)'), true);
  assert.equal(isCompatibleNjSitusAddress('500 KENNEDY BLVD, JERSEY CITY, NJ 07306', '500 KENNEDY BOULEVARD APT 3C'), true);
  assert.equal(isCompatibleNjSitusAddress('100 ST GEORGES AVE, RAHWAY, NJ 07065', '100 SAINT GEORGE AVENUE'), true);
  assert.equal(isCompatibleNjSitusAddress('50 CEDAR GROVE DR, WAYNE, NJ 07470', '50 CEDARGROVE DRIVE'), true);
  // Strict negative assertions: different house numbers, distinct streets, unit tokens must never cross-match
  assert.equal(isCompatibleNjSitusAddress('19 W PARK AVE, PARK RIDGE, NJ 07656', '21 W PARK AVE'), false);
  assert.equal(isCompatibleNjSitusAddress('1427 46TH ST #2', '1427 80TH ST #2'), false);
  assert.equal(isCompatibleNjSitusAddress('1427 46TH ST-UNIT 2', '1427 80TH ST-UNIT 2'), false);
  assert.equal(isCompatibleNjSitusAddress('123 MAIN ST', '123 PARKWAY'), false);
});

test('isExactNjGeocodeMatch rejects same-house-number different-street candidates and accepts valid equivalents', () => {
  const { isExactNjGeocodeMatch } = require('../server/enrichment/nj-cadastral');

  const listing = {
    address: '1427 46TH STREET, NORTH BERGEN, NJ 07047',
    city: 'NORTH BERGEN',
    state: 'NJ',
    zip: '07047',
  };

  assert.equal(
    isExactNjGeocodeMatch(listing, {
      address: '1427 80th St, North Bergen, NJ, 07047',
      location: { x: -74.01, y: 40.80 },
      score: 100,
      attributes: {
        Score: 100,
        Addr_type: 'PointAddress',
        AddNum: '1427',
        StAddr: '1427 80th St',
        City: 'North Bergen',
        RegionAbbr: 'NJ',
        Postal: '07047',
      },
    }),
    false,
  );

  assert.equal(
    isExactNjGeocodeMatch(listing, {
      address: '1427 46th St, North Bergen, NJ, 07047',
      location: { x: -74.02, y: 40.78 },
      score: 99,
      attributes: {
        Score: 99,
        Addr_type: 'PointAddress',
        AddNum: '1427',
        StAddr: '1427 46th St',
        City: 'North Bergen',
        RegionAbbr: 'NJ',
        Postal: '07047',
      },
    }),
    true,
  );
});

test('selectBestNjCadastralFeature rejects NJGIN 0908_153_38 mismatched situs despite Block/Lot match', () => {
  const { selectBestNjCadastralFeature } = require('../server/enrichment/nj-cadastral');

  const listing = {
    address: '1427 46TH STREET, NORTH BERGEN, NJ 07047',
    city: 'NORTH BERGEN',
    state: 'NJ',
    zip: '07047',
    apn: 'LOT 38, BLOCK 153',
    provenance: {
      sourceFacts: { lotBlock: { block: '153', lot: '38' } },
    },
  };

  const mismatchedFeature = {
    attributes: {
      PAMS_PIN: '0908_153_38',
      PCLBLOCK: '153',
      PCLLOT: '38',
      COUNTY: 'HUDSON',
      MUN_NAME: 'NORTH BERGEN TWP',
      ST_ADDRESS: '712 80TH ST',
      NET_VALUE: 705700,
    },
  };

  assert.equal(
    selectBestNjCadastralFeature([mismatchedFeature], listing, { Addr_Block: '153', Addr_Lot: '38' }),
    null,
  );

  const matchingFeature = {
    attributes: {
      PAMS_PIN: '0908_153_38_REAL',
      PCLBLOCK: '153',
      PCLLOT: '38',
      COUNTY: 'HUDSON',
      MUN_NAME: 'NORTH BERGEN TWP',
      ST_ADDRESS: '1427 46TH ST',
      NET_VALUE: 425000,
    },
  };
  assert.equal(
    selectBestNjCadastralFeature([mismatchedFeature, matchingFeature], listing),
    matchingFeature,
  );
});

test('queryNjCadastralByAddress & enrichNjListing recover parcel centroid and refuse uncorroborated rejected coordinates', async () => {
  const { inspectMapLocation } = require('../src/lib/listing-map-policy');
  const {
    queryNjCadastralByAddress,
    enrichNjListing,
    NJ_GEOCODE_URL,
    NJ_CADASTRAL_URL,
  } = require('../server/enrichment/nj-cadastral');

  const baseListing = () => ({
    id: 'CIV-NJ-HUDSON-1427',
    source: 'civilview',
    sourceUrl: 'https://salesweb.civilview.com/Sales/SaleDetails?PropertyId=142746',
    state: 'NJ',
    county: 'Hudson County',
    address: '1427 46TH STREET, NORTH BERGEN, NJ 07047',
    city: 'NORTH BERGEN',
    zip: '07047',
    propType: 'Unknown',
    apn: 'LOT 38, BLOCK 153',
    lat: null,
    lng: null,
    assessed: null,
    sourceObservedAt: '2026-10-01T12:00:00.000Z',
    provenance: {
      origin: 'live',
      observed: true,
      recordKind: 'source_record',
      publisher: 'CivilView',
      recordId: '142746',
      observedAt: '2026-10-01T12:00:00.000Z',
      sourceFacts: { lotBlock: { block: '153', lot: '38' } },
    },
  });

  // Direct queryNjCadastralByAddress computes ring centroid and filters MUN_NAME + situs
  let capturedWhere = null;
  const direct = await queryNjCadastralByAddress(baseListing(), {
    fetchFn: async (url) => {
      const parsed = new URL(String(url));
      capturedWhere = parsed.searchParams.get('where');
      assert.equal(parsed.searchParams.get('returnGeometry'), 'true');
      assert.equal(parsed.searchParams.get('outSR'), '4326');
      return {
        ok: true,
        json: async () => ({
          features: [
            {
              attributes: {
                PAMS_PIN: '0908_153_38',
                COUNTY: 'HUDSON',
                MUN_NAME: 'NORTH BERGEN TWP',
                ST_ADDRESS: '712 80TH ST',
                NET_VALUE: 705700,
              },
              geometry: { rings: [[[-74.01, 40.80], [-74.00, 40.80], [-74.00, 40.81], [-74.01, 40.81], [-74.01, 40.80]]] },
            },
            {
              attributes: {
                PAMS_PIN: '0908_64_12',
                PCLBLOCK: '64',
                PCLLOT: '12',
                COUNTY: 'HUDSON',
                MUN_NAME: 'NORTH BERGEN TWP',
                ST_ADDRESS: '1427 46TH ST',
                PROP_CLASS: '2',
                NET_VALUE: 485000,
                LAND_VAL: 185000,
                IMPRVT_VAL: 300000,
                YR_CONSTR: 1935,
                DWELL: 2,
                BLDG_DESC: '2SF',
              },
              geometry: { rings: [[[-74.030, 40.780], [-74.020, 40.780], [-74.020, 40.790], [-74.030, 40.790], [-74.030, 40.780]]] },
            },
          ],
        }),
      };
    },
  });
  assert.equal(capturedWhere, "UPPER(COUNTY) = 'HUDSON' AND UPPER(ST_ADDRESS) LIKE '1427%46TH%'");
  assert.ok(direct);
  assert.equal(direct.feature.attributes.PAMS_PIN, '0908_64_12');
  assert.equal(direct.lat, 40.785);
  assert.equal(direct.lng, -74.025);

  // Fallback in enrichNjListing when NJ_Geocode misses: attaches ParcelCentroid & passes inspectMapLocation
  const recoveredListing = baseListing();
  const recovered = await enrichNjListing(recoveredListing, {
    now: Date.parse('2026-11-01T00:00:00.000Z'),
    fetchFn: async (url) => {
      if (String(url).startsWith(NJ_GEOCODE_URL)) {
        return { ok: true, json: async () => ({ candidates: [] }) };
      }
      assert.ok(String(url).startsWith(NJ_CADASTRAL_URL));
      return {
        ok: true,
        json: async () => ({
          features: [{
            attributes: {
              PAMS_PIN: '0908_64_12',
              PCLBLOCK: '64',
              PCLLOT: '12',
              COUNTY: 'HUDSON',
              MUN_NAME: 'NORTH BERGEN TWP',
              ST_ADDRESS: '1427 46TH ST',
              PROP_CLASS: '2',
              NET_VALUE: 485000,
              LAND_VAL: 185000,
              IMPRVT_VAL: 300000,
              YR_CONSTR: 1935,
              DWELL: 2,
              BLDG_DESC: '2SF',
            },
            geometry: { rings: [[[-74.030, 40.780], [-74.020, 40.780], [-74.020, 40.790], [-74.030, 40.790], [-74.030, 40.780]]] },
          }],
        }),
      };
    },
  });
  assert.equal(recovered.found, true);
  assert.equal(recovered.geocoded, true);
  assert.equal(recovered.cadastral, true);
  assert.equal(recoveredListing.lat, 40.785);
  assert.equal(recoveredListing.lng, -74.025);
  assert.equal(recoveredListing.assessed, 485000);
  assert.equal(recoveredListing.propType, 'Duplex');
  assert.equal(recoveredListing.provenance.coordinates.provider, 'NJGIN Cadastral Parcel Centroid');
  assert.equal(inspectMapLocation(recoveredListing).accepted, true);

  // Negative control: geocode matches 1427 46th St, point-in-polygon returns 712 80th St (rejected), address fallback misses -> no coords persisted
  const rejectedListing = baseListing();
  const rejectedRes = await enrichNjListing(rejectedListing, {
    now: Date.parse('2026-11-01T00:00:00.000Z'),
    fetchFn: async (url) => {
      if (String(url).startsWith(NJ_GEOCODE_URL)) {
        return {
          ok: true,
          json: async () => ({
            candidates: [{
              address: '1427 46th St, North Bergen, NJ, 07047',
              location: { x: -74.01, y: 40.80 },
              score: 100,
              attributes: {
                Score: 100,
                Addr_type: 'PointAddress',
                AddNum: '1427',
                StAddr: '1427 46th St',
                City: 'North Bergen',
                RegionAbbr: 'NJ',
                Postal: '07047',
              },
            }],
          }),
        };
      }
      const parsed = new URL(String(url));
      if (parsed.searchParams.get('geometryType') === 'esriGeometryPoint') {
        return {
          ok: true,
          json: async () => ({
            features: [{
              attributes: {
                PAMS_PIN: '0908_153_38',
                PCLBLOCK: '153',
                PCLLOT: '38',
                COUNTY: 'HUDSON',
                ST_ADDRESS: '712 80TH ST',
                NET_VALUE: 705700,
              },
            }],
          }),
        };
      }
      return { ok: true, json: async () => ({ features: [] }) };
    },
  });
  assert.equal(rejectedRes.found, false);
  assert.equal(rejectedListing.lat, null);
  assert.equal(rejectedListing.lng, null);
  assert.equal(rejectedListing.assessorParcel, undefined);
});

test('GET /api/listings/:id/assessor rejects cached or queried parcels with mismatched situsAddress', async () => {
  const handleListings = require('../server/routes/listings');

  function makeMockRes() {
    const out = { statusCode: 200, body: null };
    return {
      status(code) { out.statusCode = code; return this; },
      json(payload) { out.body = payload; return out; },
      out,
    };
  }

  // 1. Cached parcel with mismatched situsAddress (712 80TH ST for 1427 46TH STREET)
  const cachedListing = {
    id: 'CIV-NJ-10-MISMATCH-CACHED',
    state: 'NJ',
    county: 'Hudson County',
    address: '1427 46TH STREET, NORTH BERGEN, NJ 07047',
    openingBid: 100000,
    parcelKey: '34017-090815338',
    assessorParcel: {
      source: 'NJGIN_MODIV_CADASTRAL',
      countyFips: '34017',
      canonicalApn: '090815338',
      situsAddress: '712 80TH ST',
      assessedValue: { total: 705700, land: 300000, improvements: 405700 },
    },
  };
  const cachedRes = makeMockRes();
  await handleListings(
    { method: 'GET', url: `/api/listings/${cachedListing.id}/assessor`, headers: {} },
    cachedRes,
    { async getListingById(id) { return id === cachedListing.id ? cachedListing : null; } },
  );
  assert.equal(cachedRes.out.statusCode, 200);
  assert.equal(cachedRes.out.body.enrolled, true);
  assert.equal(cachedRes.out.body.found, false);
  assert.equal(cachedRes.out.body.rawFigure, null);
  assert.equal(cachedRes.out.body.parcelKey, null);
  assert.equal(cachedRes.out.body.reason, 'Parcel situs address does not corroborate listing street address.');
  assert.equal(cachedRes.out.body.withheldReason, 'Parcel situs address does not corroborate listing street address.');
  assert.ok(cachedRes.out.body.countyName);
  assert.ok(cachedRes.out.body.endpoint);

  // 2. Live queryArcgisParcel returning mismatched situsAddress is also rejected and never persisted
  const queriedListing = {
    id: 'CIV-NJ-10-MISMATCH-LIVE',
    state: 'NJ',
    county: 'Hudson County',
    address: '1427 46TH STREET, NORTH BERGEN, NJ 07047',
    openingBid: 100000,
    lat: 40.80,
    lng: -74.01,
  };
  let persistedCount = 0;
  const liveRes = makeMockRes();
  await handleListings(
    { method: 'GET', url: `/api/listings/${queriedListing.id}/assessor`, headers: {} },
    liveRes,
    {
      async getListingById(id) { return id === queriedListing.id ? queriedListing : null; },
      async createListing() { persistedCount += 1; },
    },
    {
      queryArcgisParcel: async () => ({
        rawApn: '0908_153_38',
        canonicalApn: '090815338',
        countyFips: '34017',
        situsAddress: '712 80TH ST',
        assessedValue: { total: 705700, land: 300000, improvements: 405700 },
      }),
    },
  );
  assert.equal(liveRes.out.statusCode, 200);
  assert.equal(liveRes.out.body.enrolled, true);
  assert.equal(liveRes.out.body.found, false);
  assert.equal(liveRes.out.body.rawFigure, null);
  assert.equal(liveRes.out.body.reason, 'Parcel situs address does not corroborate listing street address.');
  assert.equal(persistedCount, 0);
  assert.equal(queriedListing.assessorParcel, undefined);
});

test('backfill selects sheriff listings that carry a publisher assessed value without an assessorRoll', async () => {
  const sheriffRow = {
    id: 'sheriff:oh-cuy-1',
    source: 'sheriff',
    state: 'OH',
    county: 'Cuyahoga',
    address: '100 Public Square, Cleveland, OH 44114',
    lat: 41.4993,
    lng: -81.6944,
    openingBid: 80000,
    assessed: 180000,
    provenance: { origin: 'live', observed: true, publisher: 'Sheriff', recordId: 'oh-cuy-1' },
  };
  assert.equal(candidateReady(sheriffRow), true);
  const db = fakeDb([sheriffRow]);
  const res = await backfillAssessorRolls({
    db,
    cachePath: temporaryCachePath(),
    now: Date.parse('2026-11-01T00:00:00.000Z'),
    fetchFn: async () => arcgisFetchReturning({
      PARCELPIN: '101-01-001',
      TOTAL_ASSESSED_VAL: 63000,
    })(),
  });
  assert.equal(res.considered, 1);
  assert.equal(res.harvested, 1);
  assert.equal(res.persisted, 1);
  assert.equal(sheriffRow.provenance.derivedFields.assessorRoll.countyKey, 'OH-CUYAHOGA');
  assert.equal(sheriffRow.provenance.derivedFields.assessorRoll.parcel.assessedValue.total, 63000);
  assert.equal(sheriffRow.assessed, 180000, 'existing publisher assessed appraisal must remain untouched when assessorRoll attaches');
});

test('presentListing sets enrolledAssessor corridor flag and discovery query filters enrolledOnly with SQL/memory parity', async () => {
  const { presentListing } = require('../server/routes/listings');
  const { queryFromUrl, matches, search } = require('../server/discovery/query');
  const { readDiscoveryFilters, discoverySearchParams } = await import('../src/lib/discovery-query.ts');
  const { PGlite } = require('@electric-sql/pglite');

  assert.equal(presentListing({ id: 'e1', source: 'sheriff', state: 'OH', county: 'Cuyahoga' }).enrolledAssessor, true);
  assert.equal(presentListing({ id: 'e2', source: 'sheriff', state: 'FL', county: 'Orange' }).enrolledAssessor, true);
  assert.equal(presentListing({ id: 'e3', source: 'civilview', state: 'NJ', county: 'Hudson' }).enrolledAssessor, true);
  assert.equal(presentListing({ id: 'u1', source: 'servicelink', state: 'AZ', county: 'Pinal' }).enrolledAssessor, false);
  assert.equal(presentListing({ id: 'u2', source: 'sheriff', state: 'IL', county: 'Cook' }).enrolledAssessor, false);
  assert.equal(presentListing({ id: 'u3', source: 'trustee', state: 'CA', county: 'Los Angeles' }).enrolledAssessor, false);
  assert.equal(presentListing({ id: 'u4', source: 'civilview', state: 'PA', county: 'Chester' }).enrolledAssessor, false);

  const clientFilters = readDiscoveryFilters(new URLSearchParams('enrolledOnly=true&state=OH'));
  assert.equal(clientFilters.enrolledOnly, 'true');
  assert.equal(discoverySearchParams(clientFilters).get('enrolledOnly'), 'true');
  assert.equal('enrolledOnly' in readDiscoveryFilters(new URLSearchParams('enrolledOnly=maybe')), false);

  const parsedTrue = queryFromUrl(new URL('http://localhost/api/listings?enrolledOnly=true'));
  assert.equal(parsedTrue.enrolledOnly, true);
  const parsedFalse = queryFromUrl(new URL('http://localhost/api/listings?enrolledOnly=false'));
  assert.equal(parsedFalse.enrolledOnly, false);
  assert.throws(() => queryFromUrl(new URL('http://localhost/api/listings?enrolledOnly=bogus')), (err) => err.status === 400);

  const rows = [
    { id: 'r-oh-cuy', source: 'sheriff', state: 'OH', county: 'Cuyahoga County', provenance: { origin: 'live' } },
    { id: 'r-fl-stl', source: 'sheriff', state: 'FL', county: 'St. Lucie', provenance: { origin: 'live' } },
    { id: 'r-nj-hud', source: 'civilview', state: 'NJ', county: 'Hudson', provenance: { origin: 'live' } },
    { id: 'r-il-cook', source: 'sheriff', state: 'IL', county: 'Cook', provenance: { origin: 'live' } },
    { id: 'r-az-pin', source: 'servicelink', state: 'AZ', county: 'Pinal', provenance: { origin: 'live' } },
    { id: 'r-null-co', source: 'hud', state: 'FL', county: null, provenance: { origin: 'live' } },
  ];

  assert.deepEqual(rows.filter((r) => matches(r, parsedTrue)).map((r) => r.id), ['r-oh-cuy', 'r-fl-stl', 'r-nj-hud']);
  assert.deepEqual(rows.filter((r) => matches(r, parsedFalse)).map((r) => r.id), ['r-il-cook', 'r-az-pin', 'r-null-co']);

  const pglite = new PGlite();
  try {
    await pglite.query(`CREATE TABLE listings (
      id text PRIMARY KEY, updated_at timestamptz DEFAULT now(), deal_score int,
      state text, county text, city text, address text,
      source_key text, prop_type text, occupancy text,
      auction_program text, lifecycle_status text, status text, transaction_outcome text,
      has_documents boolean, provenance jsonb, sale_date date, opening_bid numeric,
      equity_spread numeric, senior_lien_risk text, redemption_days int,
      est_low numeric, est_high numeric, triage_priority int, latitude float8, longitude float8
    )`);
    for (const r of rows) {
      await pglite.query(
        'INSERT INTO listings (id, source_key, state, county, provenance) VALUES ($1, $2, $3, $4, $5::jsonb)',
        [r.id, r.source, r.state, r.county, JSON.stringify(r.provenance)],
      );
    }
    const pgDb = { isPg: true, pool: pglite, listingSelect: 'id, source_key AS source, state, county, provenance' };
    const memDb = { isPg: false, getListings: async () => ({ total: rows.length, listings: rows }) };

    for (const qs of ['enrolledOnly=true', 'enrolledOnly=false']) {
      const f = queryFromUrl(new URL(`http://localhost/api/listings?${qs}&limit=50`));
      const pgRes = await search(pgDb, f);
      const memRes = await search(memDb, f);
      assert.deepEqual(
        pgRes.listings.map((l) => l.id).sort(),
        memRes.listings.map((l) => l.id).sort(),
        `PG/memory parity failed for ${qs}`,
      );
      assert.equal(pgRes.total, memRes.total);
    }
  } finally {
    await pglite.close();
  }
});

test('extractLeadingHouseNumberRange, isCompatibleNjSitusAddress, and queryNjCadastralByAddress support contiguous NJ multi-lot house ranges', async () => {
  const {
    extractLeadingHouseNumberRange,
    isCompatibleNjSitusAddress,
    queryNjCadastralByAddress,
  } = require('../server/enrichment/nj-cadastral');

  assert.deepEqual(extractLeadingHouseNumberRange('548'), { low: 548, high: 548, raw: '548' });
  assert.deepEqual(extractLeadingHouseNumberRange('548-550 SANDFORD AVE'), { low: 548, high: 550, raw: '548-550' });
  assert.deepEqual(extractLeadingHouseNumberRange('548-550 SANDFORD AVE, NEWARK, NJ 07106'), { low: 548, high: 550, raw: '548-550' });
  assert.equal(extractLeadingHouseNumberRange('548-560 SANDFORD AVE'), null);
  assert.equal(extractLeadingHouseNumberRange('550-548 SANDFORD AVE'), null);
  assert.equal(extractLeadingHouseNumberRange('0-2 SANDFORD AVE'), null);
  assert.equal(extractLeadingHouseNumberRange('548-2B SANDFORD AVE'), null);
  assert.equal(extractLeadingHouseNumberRange('VACANT LAND'), null);

  assert.equal(isCompatibleNjSitusAddress('548-550 SANDFORD AVE, NEWARK, NJ 07106', '548 SANDFORD AVE'), true);
  assert.equal(isCompatibleNjSitusAddress('548-550 SANDFORD AVE, NEWARK, NJ 07106', '550 SANDFORD AVE'), true);
  assert.equal(isCompatibleNjSitusAddress('548-550 SANDFORD AVE, NEWARK, NJ 07106', '548-550 SANDFORD AVE'), true);
  assert.equal(isCompatibleNjSitusAddress('548-549 SANDFORD AVE, NEWARK, NJ 07106', '549 SANDFORD AVE'), true);

  assert.equal(isCompatibleNjSitusAddress('548-550 SANDFORD AVE, NEWARK, NJ 07106', '556 SANDFORD AVE'), false);
  assert.equal(isCompatibleNjSitusAddress('548-550 SANDFORD AVE, NEWARK, NJ 07106', '549 SANDFORD AVE'), false);
  assert.equal(isCompatibleNjSitusAddress('548-550 SANDFORD AVE, NEWARK, NJ 07106', '548 BROAD ST'), false);

  let capturedWhere = null;
  const result = await queryNjCadastralByAddress({
    address: '548-550 SANDFORD AVE, NEWARK, NJ 07106',
    city: 'NEWARK',
    county: 'Essex County',
    state: 'NJ',
    zip: '07106',
  }, {
    fetchFn: async (url) => {
      capturedWhere = new URL(String(url)).searchParams.get('where');
      return {
        ok: true,
        json: async () => ({
          features: [{
            attributes: {
              PAMS_PIN: '0714_4100_12',
              PCLBLOCK: '4100',
              PCLLOT: '12',
              COUNTY: 'ESSEX',
              MUN_NAME: 'NEWARK CITY',
              ST_ADDRESS: '548 SANDFORD AVE',
              NET_VALUE: 315000,
            },
            geometry: { rings: [[[-74.22, 40.73], [-74.21, 40.73], [-74.21, 40.74], [-74.22, 40.74], [-74.22, 40.73]]] },
          }],
        }),
      };
    },
  });
  assert.equal(capturedWhere, "UPPER(COUNTY) = 'ESSEX' AND UPPER(ST_ADDRESS) LIKE '548%SANDFORD%'");
  assert.ok(result);
  assert.equal(result.feature.attributes.ST_ADDRESS, '548 SANDFORD AVE');
});
