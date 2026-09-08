'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const hunts = require('../server/intelligence/hunts');

function listing(overrides = {}) {
  return {
    id: 'HUD-012-345678', source: 'hud', state: 'CA', county: null, city: 'Ukiah',
    address: '100 Main Street, Ukiah, CA', propType: 'Single Family', status: 'active',
    auctionProgram: 'HUD REO', lifecycleStatus: 'publicly_listed', occupancy: null,
    openingBid: 125000, dealScore: 72, equity: 80000, saleDate: '2026-09-20', hasDocuments: false,
    raw: 'Official HUD source record.', sourceUrl: 'https://egis.hud.gov/arcgis/rest/services/cpdmaps/HudSfReo/MapServer/1/query?where=CASE_NUM%20%3D%20%27012-345678%27&outFields=*&f=pjson',
    sourceObservedAt: '2026-09-07T18:00:00.000Z',
    provenance: { origin: 'live', observed: true, recordKind: 'source_record', publisher: 'HUD',
      recordId: '012-345678', observedAt: '2026-09-07T18:00:00.000Z', sourceFacts: { caseNumber: '012-345678' } },
    ...overrides,
  };
}

test('saved discovery criteria validates and retains exact canonical filters', () => {
  const result = hunts.validateHuntInput({ name: 'HUD review', criteria: { discoveryFilters: {
    q: '012-345678', state: 'CA', county: 'unknown', program: 'HUD REO', lifecycle: 'publicly_listed',
    occupancy: 'unknown', saleFrom: '2026-09-01', saleTo: '2026-09-30', maxBid: '150000',
    minScore: '70', hasDocuments: 'false', redemption: 'all',
  } } });
  assert.equal(result.isValid, true);
  assert.deepEqual(result.value.criteria.discoveryFilters, {
    q: '012-345678', state: 'ca', county: 'unknown', program: 'hud reo', lifecycle: 'publicly_listed',
    saleFrom: '2026-09-01', saleTo: '2026-09-30', maxBid: '150000', minScore: '70',
    occupancy: 'unknown', hasDocuments: 'false',
  });
});

test('saved discovery criteria uses canonical unknown, date, program, and document semantics', () => {
  const validation = hunts.validateHuntInput({ name: 'HUD review', criteria: { discoveryFilters: {
    q: '012-345678', county: 'unknown', program: 'HUD REO', lifecycle: 'publicly_listed',
    occupancy: 'unknown', saleFrom: '2026-09-01', saleTo: '2026-09-30', maxBid: '150000', hasDocuments: 'false',
  } } });
  const hunt = { criteria: validation.value.criteria };
  assert.equal(hunts.evaluateListing(listing(), hunt, { now: '2026-09-07T20:00:00.000Z' }).status, 'match');
  assert.equal(hunts.evaluateListing(listing({ county: 'Mendocino' }), hunt, { now: '2026-09-07T20:00:00.000Z' }).status, 'no_match');
  assert.equal(hunts.evaluateListing(listing({ hasDocuments: null }), hunt, { now: '2026-09-07T20:00:00.000Z' }).status, 'no_match');
  assert.equal(hunts.evaluateListing(listing({ saleDate: '2026-10-01' }), hunt, { now: '2026-09-07T20:00:00.000Z' }).status, 'no_match');
});

test('saved discovery criteria rejects unknown keys and invalid values', () => {
  assert.equal(hunts.validateHuntInput({ name: 'bad', criteria: { discoveryFilters: { bbox: '-1,-1,1,1' } } }).isValid, false);
  assert.equal(hunts.validateHuntInput({ name: 'bad', criteria: { discoveryFilters: { hasDocuments: 'maybe' } } }).isValid, false);
  assert.equal(hunts.validateHuntInput({ name: 'bad', criteria: { discoveryFilters: { saleFrom: '2026-02-30' } } }).isValid, false);
});

test('discovery hunts use the evaluation clock and retain document identity for change events', () => {
  const criteria = hunts.validateHuntInput({ name: 'Fresh documents', criteria: { discoveryFilters: {
    freshness: 'fresh', hasDocuments: 'true',
  } } }).value.criteria;
  const hunt = { id: 'hunt_aaaaaaaaaaaaaaaaaaaaaaaa', version: 1, enabled: true, criteria };
  const firstListing = listing({ hasDocuments: true, provenance: {
    ...listing().provenance, sourceFacts: { documents: [{ id: 'doc-a', url: 'https://hud.gov/a' }] },
  } });
  const first = hunts.evaluateInventory(hunt, [firstListing], { now: '2026-09-14T17:59:59.000Z', suppressEvents: true });
  assert.equal(first.response.results[0].status, 'match');
  assert.equal(hunts.evaluateListing(firstListing, hunt, { now: '2026-09-14T18:00:01.000Z' }).status, 'no_match');
  const changed = listing({ hasDocuments: true, sourceObservedAt: '2026-09-07T19:00:00.000Z', provenance: {
    ...listing().provenance, observedAt: '2026-09-07T19:00:00.000Z', sourceFacts: { documents: [{ id: 'doc-b', url: 'https://hud.gov/b' }] },
  } });
  const second = hunts.evaluateInventory(hunt, [changed], { now: '2026-09-07T20:00:00.000Z', previousBaseline: first.baseline });
  assert.equal(second.events[0].type, 'material_change');
  assert.deepEqual(second.events[0].changedFields.includes('documentIds'), true);
});
