'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { backfillAssessorRolls, CONVERTED_STATES, candidateReady } = require('../server/enrichment/assessor-backfill');

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

test('CONVERTED_STATES covers the states with verified conversions only', () => {
  assert.ok(CONVERTED_STATES.includes('AZ'));
  assert.ok(CONVERTED_STATES.includes('MI'));
  assert.ok(CONVERTED_STATES.includes('PA'));
  assert.ok(CONVERTED_STATES.includes('FL'));
  for (const state of CONVERTED_STATES) {
    assert.match(state, /^[A-Z]{2}$/, 'state codes must be two letters');
  }
});

test('backfill harvests roll-less stored rows and persists only the ones that got rolls', async () => {
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
  const noGeo = {
    id: 'servicelink:mar-3',
    source: 'servicelink',
    state: 'AZ',
    county: 'Maricopa',
    provenance: { origin: 'live', observed: true },
  };
  const db = fakeDb([rollLess, alreadyRolled, noGeo]);
  const result = await backfillAssessorRolls({
    db,
    fetchFn: async () => arcgisFetchReturning(MARICOPA_ATTRIBUTES)(),
    now: Date.parse('2026-11-01T00:00:00.000Z'),
  });

  assert.equal(result.considered, 1, 'only the roll-less, geo-ready row is a candidate');
  assert.equal(result.harvested, 1);
  assert.equal(result.persisted, 1);
  assert.deepEqual(db.persisted, ['servicelink:mar-1']);
  const roll = rollLess.provenance.derivedFields.assessorRoll;
  assert.equal(roll.countyKey, 'AZ-MARICOPA');
  assert.equal(roll.parcel.assessedValue.total, 10205862);
  assert.equal(roll.taxYear, 2026);
  assert.equal(roll.valuationYear, 2027);
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
  const capped = await backfillAssessorRolls({ db: fakeDb(rows), limit: 3, fetchFn: async () => ({ ok: true, json: async () => ({ features: [] }) }) });
  assert.equal(capped.considered, 3, 'the candidate cap bounds the batch');
  assert.equal(capped.harvested, 0);
});

test('candidateReady accepts coordinates or APN spellings and rejects bare rows', () => {
  assert.equal(candidateReady({ lat: 33.4, lng: -112.3 }), true);
  assert.equal(candidateReady({ provenance: { sourceFacts: { parcelNumber: '10101010' } } }), true);
  assert.equal(candidateReady({ apn: '10101010' }), true);
  assert.equal(candidateReady({ lat: 0, lng: 0 }), false, 'null island is not a coordinate');
  assert.equal(candidateReady({}), false);
  assert.equal(candidateReady(null), false);
});
