'use strict';

/**
 * Distress lifecycle enum + source-to-stage mapping (P1).
 *
 * - The enum shape lives in `server/scrapers/lifecycle.js`.
 * - The per-source mapping lives in `server/scrapers/source-lifecycle.js`.
 * - The catalog summary exposes a `lifecycleBySource` field through
 *   `summarizeCatalog()` so `/api/source-network` can render it.
 */

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  DISTRESS_LIFECYCLE_STAGES,
  STAGE_IDS,
  isStageId
} = require('../server/scrapers/lifecycle');

const {
  getStagesForSource,
  lifecycleBySourceFromCatalog
} = require('../server/scrapers/source-lifecycle');

const { SOURCE_CATALOG, summarizeCatalog } = require('../server/sources/catalog');

test('DISTRESS_LIFECYCLE_STAGES exposes nine stages with label, description, and sourceKinds', () => {
  assert.equal(STAGE_IDS.length, 9);
  assert.deepEqual(STAGE_IDS, [
    'PRE_FORECLOSURE',
    'FORECLOSURE_FILED',
    'FORECLOSURE_SCHEDULED',
    'TRUSTEE_SALE_SCHEDULED',
    'AUCTION_SCHEDULED',
    'REO_ACQUIRED',
    'REO_LISTED',
    'TAX_DEFAULTED',
    'UNKNOWN'
  ]);
  assert.ok(STAGE_IDS.includes('UNKNOWN'), 'UNKNOWN must exist so non-distress sources map cleanly');
  for (const stageId of STAGE_IDS) {
    const stage = DISTRESS_LIFECYCLE_STAGES[stageId];
    assert.ok(stage, `stage ${stageId} missing`);
    assert.equal(typeof stage.label, 'string');
    assert.ok(stage.label.length > 0, `stage ${stageId} has empty label`);
    assert.equal(typeof stage.description, 'string');
    assert.ok(stage.description.length > 0, `stage ${stageId} has empty description`);
    assert.ok(Array.isArray(stage.sourceKinds), `stage ${stageId} sourceKinds is not an array`);
    for (const kind of stage.sourceKinds) {
      assert.equal(typeof kind, 'string');
      assert.ok(kind.length > 0, `stage ${stageId} contains empty source kind`);
    }
  }
  // UNKNOWN never claims a category — it is the fallback, not a default.
  assert.deepEqual(DISTRESS_LIFECYCLE_STAGES.UNKNOWN.sourceKinds, []);
});

test('enum and per-stage entries are frozen and isStageId accepts only catalog stage ids', () => {
  assert.ok(Object.isFrozen(DISTRESS_LIFECYCLE_STAGES));
  assert.ok(Object.isFrozen(STAGE_IDS));
  for (const stageId of STAGE_IDS) {
    assert.ok(Object.isFrozen(DISTRESS_LIFECYCLE_STAGES[stageId]));
    assert.ok(isStageId(stageId));
  }
  for (const bogus of ['unknown', 'pre_foreclosure', 'pre-foreclosure', 'REO', '', null, undefined, 42]) {
    assert.equal(isStageId(bogus), false, `isStageId should reject ${bogus}`);
  }
});

test('every catalog source maps to at least one lifecycle stage', () => {
  const map = lifecycleBySourceFromCatalog(SOURCE_CATALOG);
  assert.equal(Object.keys(map).length, SOURCE_CATALOG.length,
    'lifecycleBySource must cover every catalog source');
  for (const entry of SOURCE_CATALOG) {
    const stages = map[entry.id];
    assert.ok(Array.isArray(stages), `${entry.id} stages not an array`);
    assert.ok(stages.length > 0, `${entry.id} has no lifecycle stages`);
    for (const stageId of stages) {
      assert.ok(isStageId(stageId), `${entry.id} has unknown stage ${stageId}`);
    }
    assert.ok(Object.isFrozen(stages), `${entry.id} stage array must be frozen`);
  }
});

test('government REO sources publish both REO_ACQUIRED and REO_LISTED', () => {
  const map = lifecycleBySourceFromCatalog(SOURCE_CATALOG);
  for (const id of ['hud-homestore', 'fannie-homepath', 'freddie-homesteps', 'usda-resales', 'va-vrm', 'fdic-asset-sales', 'ncua-amac']) {
    assert.ok(map[id].includes('REO_ACQUIRED'), `${id} missing REO_ACQUIRED`);
    assert.ok(map[id].includes('REO_LISTED'), `${id} missing REO_LISTED`);
  }
});

test('government seizure sources surface the pre-foreclosure stage', () => {
  const map = lifecycleBySourceFromCatalog(SOURCE_CATALOG);
  for (const id of ['irs-auctions', 'treasury-forfeiture', 'cws-marketing']) {
    assert.ok(map[id].includes('PRE_FORECLOSURE'), `${id} missing PRE_FORECLOSURE`);
  }
  // US Marshals and RealLook publish across seizure + REO.
  for (const id of ['us-marshals', 'real-look']) {
    assert.ok(map[id].includes('PRE_FORECLOSURE') && map[id].includes('REO_ACQUIRED'),
      `${id} should bridge PRE_FORECLOSURE → REO_ACQUIRED`);
  }
});

test('foreclosure-auction sources split into sheriff, trustee, and marketplace lanes', () => {
  const map = lifecycleBySourceFromCatalog(SOURCE_CATALOG);
  // Sheriff sale: foreclosure scheduled only.
  assert.deepEqual(new Set(map['ohio-sheriff-sale']), new Set(['FORECLOSURE_SCHEDULED']));
  // Trustee sale: trustee + foreclosure scheduled.
  assert.ok(map['county-trustee-sale'].includes('TRUSTEE_SALE_SCHEDULED'));
  assert.ok(map['county-trustee-sale'].includes('FORECLOSURE_SCHEDULED'));
  // CivilView covers sheriff sales and tax sales.
  assert.ok(map['civilview'].includes('FORECLOSURE_SCHEDULED'));
  assert.ok(map['civilview'].includes('TAX_DEFAULTED'));
  // ServiceLink auction platform.
  assert.ok(map['servicelink'].includes('AUCTION_SCHEDULED'));
  assert.ok(map['servicelink'].includes('TRUSTEE_SALE_SCHEDULED'));
  // Bid4Assets aggregates foreclosure, tax, and auction.
  assert.ok(map['bid4assets'].includes('AUCTION_SCHEDULED'));
  assert.ok(map['bid4assets'].includes('TAX_DEFAULTED'));
});

test('tax-sale sources map to TAX_DEFAULTED', () => {
  const map = lifecycleBySourceFromCatalog(SOURCE_CATALOG);
  for (const id of ['alachua-tax-deeds', 'harris-county-tax-sale', 'maricopa-tax-deed', 'county-tax-sale-template', 'ca-controller-tax-sale']) {
    assert.ok(map[id].includes('TAX_DEFAULTED'), `${id} missing TAX_DEFAULTED`);
  }
});

test('marketplace and REO-listing sources map to AUCTION_SCHEDULED and REO_LISTED', () => {
  const map = lifecycleBySourceFromCatalog(SOURCE_CATALOG);
  for (const id of ['auction-dot-com', 'hubzu', 'xome', 'mls-licensed-feed']) {
    assert.ok(map[id].includes('AUCTION_SCHEDULED'), `${id} missing AUCTION_SCHEDULED`);
    assert.ok(map[id].includes('REO_LISTED'), `${id} missing REO_LISTED`);
  }
});

test('parcel-evidence, hazard, and aggregate-context sources fall back to UNKNOWN', () => {
  const map = lifecycleBySourceFromCatalog(SOURCE_CATALOG);
  const unknownOnly = [
    'florida-statewide-parcels',
    'alachua-county-parcels',
    'tx-cad-bulk',
    'fl-dor-cadastral',
    'county-gis',
    'census-acs',
    'fhfa-hpi',
    'census-geocoder',
    'hud-usps-vacancy',
    'fema-flood-map',
    'epa-envirofacts',
    'usfws-wetlands',
    'local-zoning',
    'county-surplus-property',
    'state-land-auctions',
    'blm-public-land-sales',
    'excess-funds'
  ];
  for (const id of unknownOnly) {
    assert.deepEqual(map[id], ['UNKNOWN'], `${id} should be UNKNOWN only`);
  }
});

test('getStagesForSource is robust to bad input and falls back to UNKNOWN', () => {
  assert.deepEqual(getStagesForSource(null), ['UNKNOWN']);
  assert.deepEqual(getStagesForSource(undefined), ['UNKNOWN']);
  assert.deepEqual(getStagesForSource('not-an-object'), ['UNKNOWN']);
  assert.deepEqual(getStagesForSource({}), ['UNKNOWN']);
  assert.deepEqual(getStagesForSource({ id: 'no-such-source', category: 'no-such-kind' }), ['UNKNOWN']);
});

test('getStagesForSource derives stages from category when no override is registered', () => {
  // government_reo is in REO_ACQUIRED.sourceKinds and REO_LISTED.sourceKinds
  const stages = getStagesForSource({ id: 'mock-source', category: 'government_reo' });
  assert.ok(stages.includes('REO_ACQUIRED'));
  assert.ok(stages.includes('REO_LISTED'));
});

test('summarizeCatalog exposes a frozen lifecycleBySource map keyed by every source id', () => {
  const summary = summarizeCatalog();
  assert.ok(summary.lifecycleBySource, 'lifecycleBySource missing from summarizeCatalog()');
  assert.equal(Object.keys(summary.lifecycleBySource).length, SOURCE_CATALOG.length);
  for (const entry of SOURCE_CATALOG) {
    const stages = summary.lifecycleBySource[entry.id];
    assert.ok(Array.isArray(stages), `${entry.id} lifecycleBySource value is not an array`);
    assert.ok(stages.length > 0, `${entry.id} lifecycleBySource is empty`);
    for (const stageId of stages) {
      assert.ok(isStageId(stageId), `${entry.id} has unknown stage ${stageId}`);
    }
  }
  assert.ok(Object.isFrozen(summary.lifecycleBySource),
    'lifecycleBySource must be frozen so API consumers cannot mutate it');
});

test('summarizeCatalog still preserves the prior summary fields (no regression)', () => {
  const summary = summarizeCatalog();
  assert.equal(summary.total, SOURCE_CATALOG.length);
  assert.ok(summary.byRole && summary.byCategory && summary.byStatus);
  assert.ok(Array.isArray(summary.scheduledAdapterKeys));
  assert.ok(summary.scheduledAdapterKeys.includes('hud'));
});
