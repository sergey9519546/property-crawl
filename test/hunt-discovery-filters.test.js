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
    // "observed" is the canonical freshness bucket: the record was captured
    // from a live publisher. An unrecognised bucket is rejected outright rather
    // than stored, because it could only ever match zero records.
    freshness: 'observed', hasDocuments: 'true',
  } } }).value.criteria;
  const hunt = { id: 'hunt_aaaaaaaaaaaaaaaaaaaaaaaa', version: 1, enabled: true, criteria };
  const firstListing = listing({ hasDocuments: true, provenance: {
    ...listing().provenance, sourceFacts: { documents: [{ id: 'doc-a', url: 'https://hud.gov/a' }] },
  } });
  const first = hunts.evaluateInventory(hunt, [firstListing], { now: '2026-09-14T17:59:59.000Z', suppressEvents: true });
  assert.equal(first.response.results[0].status, 'match');
  // The observation clock is evaluated, not a fixed TTL. A record stays
  // matchable as long as its observation is not in the future; the documented
  // contract is "non-future observation", so a week-old but valid live record
  // still matches. What must be rejected is a future-dated observation.
  assert.equal(hunts.evaluateListing(firstListing, hunt, { now: '2026-09-14T18:00:01.000Z' }).status, 'match');
  const future = listing({ sourceObservedAt: '2026-09-15T00:00:00.000Z', provenance: {
    ...listing().provenance, observedAt: '2026-09-15T00:00:00.000Z' } });
  // A future-dated observation is unjudgeable rather than a mismatch, so it
  // lands in the honest "unknown" bucket instead of silently matching.
  assert.equal(hunts.evaluateListing(future, hunt, { now: '2026-09-14T18:00:01.000Z' }).status, 'unknown');
  const changed = listing({ hasDocuments: true, sourceObservedAt: '2026-09-07T19:00:00.000Z', provenance: {
    ...listing().provenance, observedAt: '2026-09-07T19:00:00.000Z', sourceFacts: { documents: [{ id: 'doc-b', url: 'https://hud.gov/b' }] },
  } });
  const second = hunts.evaluateInventory(hunt, [changed], { now: '2026-09-07T20:00:00.000Z', previousBaseline: first.baseline });
  assert.equal(second.events[0].type, 'material_change');
  assert.deepEqual(second.events[0].changedFields.includes('documentIds'), true);
});

test('compileHuntQuery supports all 50 US states + DC and unambiguous 2-letter codes', async () => {
  const { compileHuntQuery, US_STATE_NAME_TO_CODE } = await import('../src/lib/hunt-query.ts');
  const uniqueCodes = new Set(Object.values(US_STATE_NAME_TO_CODE));
  assert.equal(uniqueCodes.size, 51);

  for (const [name, code] of Object.entries(US_STATE_NAME_TO_CODE)) {
    const compiled = compileHuntQuery(`homes in ${name}`);
    const stateRules = compiled.criteria.rules.filter((r) => r.field === 'state');
    assert.deepEqual(stateRules, [{ field: 'state', operator: 'eq', value: code }], `expected ${name} -> ${code}`);
  }

  // Disambiguation: West Virginia must not also emit VA; Washington DC must not also emit WA.
  assert.deepEqual(
    compileHuntQuery('condos in West Virginia').criteria.rules.filter((r) => r.field === 'state'),
    [{ field: 'state', operator: 'eq', value: 'WV' }],
  );
  assert.deepEqual(
    compileHuntQuery('condos in Washington DC').criteria.rules.filter((r) => r.field === 'state'),
    [{ field: 'state', operator: 'eq', value: 'DC' }],
  );

  // Explicit state code contexts & ambiguity guards
  assert.deepEqual(
    compileHuntQuery('condos in fl').criteria.rules.filter((r) => r.field === 'state'),
    [{ field: 'state', operator: 'eq', value: 'FL' }],
  );
  assert.deepEqual(
    compileHuntQuery('Austin, tx under $200k').criteria.rules.filter((r) => r.field === 'state'),
    [{ field: 'state', operator: 'eq', value: 'TX' }],
  );
  assert.deepEqual(
    compileHuntQuery('state: wy').criteria.rules.filter((r) => r.field === 'state'),
    [{ field: 'state', operator: 'eq', value: 'WY' }],
  );
  assert.deepEqual(
    compileHuntQuery('HOUSES IN ALACHUA COUNTY').criteria.rules.filter((r) => r.field === 'state'),
    [],
  );
  assert.deepEqual(
    compileHuntQuery('homes in or near Orlando').criteria.rules.filter((r) => r.field === 'state'),
    [],
  );
  assert.deepEqual(
    compileHuntQuery('listing ID under 100k in ZZ').criteria.rules.filter((r) => r.field === 'state'),
    [],
  );
});

test('compileHuntQuery adds on_or_after today bound for within-N-days and maps property types, occupancy, and warnings', async () => {
  const { compileHuntQuery } = await import('../src/lib/hunt-query.ts');

  const upcoming = compileHuntQuery('Vacant land in Alachua County under $150k within 30 days', { today: '2026-11-24' });
  assert.deepEqual(upcoming.criteria.rules, [
    { field: 'propType', operator: 'eq', value: 'Land' },
    { field: 'county', operator: 'eq', value: 'Alachua' },
    { field: 'openingBid', operator: 'lte', value: 150000 },
    { field: 'saleDate', operator: 'on_or_after', value: '2026-11-24' },
    { field: 'saleDate', operator: 'on_or_before', value: '2026-12-24' },
  ]);
  assert.deepEqual(upcoming.unrecognizedTerms, []);
  assert.deepEqual(upcoming.warnings, []);
  assert.equal(hunts.validateHuntInput({ name: 'Upcoming land', criteria: upcoming.criteria }).isValid, true);

  const vacantCondos = compileHuntQuery('vacant condos in Ohio within 14 days', '2026-11-24T12:00:00.000Z');
  assert.deepEqual(vacantCondos.criteria.rules, [
    { field: 'propType', operator: 'eq', value: 'Condo' },
    { field: 'occupancy', operator: 'eq', value: 'Vacant' },
    { field: 'state', operator: 'eq', value: 'OH' },
    { field: 'saleDate', operator: 'on_or_after', value: '2026-11-24' },
    { field: 'saleDate', operator: 'on_or_before', value: '2026-12-08' },
  ]);
  assert.deepEqual(vacantCondos.unrecognizedTerms, []);
  assert.equal(hunts.validateHuntInput({ name: 'Vacant condos', criteria: vacantCondos.criteria }).isValid, true);

  const typeCases = [
    ['townhome in GA', 'Town House', null],
    ['multi-family in NY', 'Multi Family', null],
    ['commercial in TX', 'Commercial', null],
    ['single-family in NJ', 'Single Family', null],
    ['occupied duplex in FL', 'Multi Family', 'Occupied'],
  ];
  for (const [query, expectedType, expectedOccupancy] of typeCases) {
    const res = compileHuntQuery(query);
    assert.ok(
      res.criteria.rules.some((r) => r.field === 'propType' && r.operator === 'eq' && r.value === expectedType),
      `expected ${query} -> propType ${expectedType}`,
    );
    if (expectedOccupancy) {
      assert.ok(
        res.criteria.rules.some((r) => r.field === 'occupancy' && r.operator === 'eq' && r.value === expectedOccupancy),
        `expected ${query} -> occupancy ${expectedOccupancy}`,
      );
    }
    assert.equal(hunts.validateHuntInput({ name: query, criteria: res.criteria }).isValid, true);
  }

  const warned = compileHuntQuery('Condos with waterfront pool in FL');
  assert.deepEqual(warned.unrecognizedTerms, ['waterfront', 'pool']);
  assert.equal(warned.warnings.length, 1);
  assert.match(warned.warnings[0], /waterfront, pool/);
});

test('hunts UI components wire prefilled email, date bounds, edit/delete, inbox error handling, and honest membership CTA', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const root = path.resolve(__dirname, '..');
  const saveBtn = fs.readFileSync(path.join(root, 'src/components/hunts/save-search-button.tsx'), 'utf8');
  const savedHunts = fs.readFileSync(path.join(root, 'src/components/hunts/saved-hunts.tsx'), 'utf8');

  assert.match(saveBtn, /session\.member\?\.email \|\| ""/);
  assert.match(saveBtn, /"distressStage", "minQuality"/);

  assert.match(savedHunts, /name: "Approaching published sale"[\s\S]*operator: "on_or_after"[\s\S]*operator: "on_or_before"/);
  assert.match(savedHunts, /queryWarnings/);
  assert.match(savedHunts, /"PATCH"/);
  assert.match(savedHunts, /"DELETE"/);
  assert.match(savedHunts, /Confirm delete/);
  assert.match(savedHunts, /applySelectedHunt/);
  assert.match(savedHunts, /setEditWebhookUrl\(huntDetail\.webhookUrl \|\| ""\)/);
  assert.match(savedHunts, /setEditNotifyEmail\(huntDetail\.notifyEmail \|\| ""\)/);
  assert.match(savedHunts, /inboxError/);
  assert.match(savedHunts, /eventsError/);
  assert.match(savedHunts, /href="\/pricing"/);
  assert.match(savedHunts, /md:grid-cols-3/);
  assert.doesNotMatch(savedHunts, /md:grid-cols-5/);
  assert.doesNotMatch(savedHunts, /collect more source evidence/i);
});

test('saved discovery criteria supports distressStage (string or string[]) and minQuality (0..100)', () => {
  const validSingle = hunts.validateHuntInput({
    name: 'REO quality hunt',
    criteria: { discoveryFilters: { distressStage: 'reo', minQuality: '70' } },
  });
  assert.equal(validSingle.isValid, true);
  assert.deepEqual(validSingle.value.criteria.discoveryFilters, {
    distressStage: 'reo',
    minQuality: '70',
  });

  const validArray = hunts.validateHuntInput({
    name: 'Multi-stage quality hunt',
    criteria: { discoveryFilters: { distressStage: ['REO', 'scheduled'], minQuality: 55 } },
  });
  assert.equal(validArray.isValid, true);
  assert.deepEqual(validArray.value.criteria.discoveryFilters.distressStage, ['reo', 'scheduled']);
  assert.equal(validArray.value.criteria.discoveryFilters.minQuality, '55');

  assert.equal(hunts.validateHuntInput({ name: 'bad stage', criteria: { discoveryFilters: { distressStage: 'not_a_stage' } } }).isValid, false);
  assert.equal(hunts.validateHuntInput({ name: 'empty stage', criteria: { discoveryFilters: { distressStage: [] } } }).isValid, false);
  assert.equal(hunts.validateHuntInput({ name: 'neg quality', criteria: { discoveryFilters: { minQuality: '-1' } } }).isValid, false);
  assert.equal(hunts.validateHuntInput({ name: 'over quality', criteria: { discoveryFilters: { minQuality: '101' } } }).isValid, false);
  assert.equal(hunts.validateHuntInput({ name: 'nan quality', criteria: { discoveryFilters: { minQuality: 'abc' } } }).isValid, false);

  const stageHunt = { criteria: validArray.value.criteria };
  const strongReo = listing({ qualityScore: 80 });
  const weakReo = listing({ qualityScore: 40 });
  const stageOverride = listing({
    distressStage: 'SCHEDULED_AUCTION',
    qualityScore: 75,
  });
  const nonMatchStage = listing({ source: 'sheriff', sourceUrl: 'https://www.realforeclose.com/index.cfm?zaction=AUCTION&Zmethod=PREVIEW&AID=123', saleDate: '2027-06-01', qualityScore: 90 });

  assert.equal(hunts.explainListingMatch(strongReo, stageHunt, { now: '2026-09-07T20:00:00.000Z' }).status, 'match');
  assert.equal(hunts.explainListingMatch(weakReo, stageHunt, { now: '2026-09-07T20:00:00.000Z' }).status, 'no_match');
  assert.equal(hunts.explainListingMatch(stageOverride, stageHunt, { now: '2026-09-07T20:00:00.000Z' }).status, 'match');
  assert.equal(hunts.explainListingMatch(nonMatchStage, stageHunt, { now: '2026-09-07T20:00:00.000Z' }).status, 'no_match');
});

test('discoveryFilters.maxBid fails closed on null or blank openingBid while rule openingBid stays tri-state unknown', () => {
  const discoveryHunt = { criteria: hunts.validateHuntInput({ name: 'Max bid', criteria: { discoveryFilters: { maxBid: '150000' } } }).value.criteria };
  assert.equal(hunts.evaluateListing(listing({ openingBid: null }), discoveryHunt, { now: '2026-09-07T20:00:00.000Z' }).status, 'no_match');
  const missingBid = listing();
  delete missingBid.openingBid;
  assert.equal(hunts.evaluateListing(missingBid, discoveryHunt, { now: '2026-09-07T20:00:00.000Z' }).status, 'no_match');
  assert.equal(hunts.evaluateListing(listing({ openingBid: '' }), discoveryHunt, { now: '2026-09-07T20:00:00.000Z' }).status, 'unknown');

  const ruleHunt = { criteria: { mode: 'all', rules: [{ field: 'openingBid', operator: 'lte', value: 150000 }] } };
  assert.equal(hunts.evaluateListing(listing({ openingBid: null }), ruleHunt, { now: '2026-09-07T20:00:00.000Z' }).status, 'unknown');
});
