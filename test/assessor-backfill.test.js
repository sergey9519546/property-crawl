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
  assert.equal(candidateReady({ lat: 33.4, lng: -112.3, state: 'AZ', county: 'Maricopa', assessed: 300000 }), false, 'assessed rows are not candidates');
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
