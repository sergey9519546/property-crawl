'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { STATUTORY_DISTRESS_CATALOG_ENTRIES } = require('../server/sources/statutory-distress-catalog');
const {
  SOURCE_CATALOG,
  SOURCE_STATUSES,
  SOURCE_STATUS_BY_ID,
  getSource,
} = require('../server/sources/catalog');

test('statutory distress catalog contains high-trust official distress sources satisfying all catalog invariants', () => {
  assert.ok(Array.isArray(STATUTORY_DISTRESS_CATALOG_ENTRIES), 'STATUTORY_DISTRESS_CATALOG_ENTRIES must be an array');
  assert.ok(STATUTORY_DISTRESS_CATALOG_ENTRIES.length >= 80, `Expected at least 80 entries, got ${STATUTORY_DISTRESS_CATALOG_ENTRIES.length}`);

  const validStatuses = new Set(Object.keys(SOURCE_STATUSES));
  const validRoles = new Set(['opportunity', 'evidence', 'discovery']);
  const validAccess = new Set(['public', 'account', 'licensed', 'jurisdiction']);
  const validCategories = new Set([
    'tax_sale',
    'foreclosure_auction',
    'land_bank',
    'marketplace',
    'court_record',
  ]);

  const seenIds = new Set();

  for (const entry of STATUTORY_DISTRESS_CATALOG_ENTRIES) {
    // ID invariant: lowercase alphanumeric and hyphens only
    assert.match(entry.id, /^[a-z0-9-]+$/, `Entry id ${entry.id} must match /^[a-z0-9-]+$/`);
    assert.ok(!seenIds.has(entry.id), `Duplicate entry id ${entry.id}`);
    seenIds.add(entry.id);

    // Required descriptive metadata
    assert.ok(entry.label && typeof entry.label === 'string', `${entry.id}: label must be non-empty string`);
    assert.ok(entry.coverage && typeof entry.coverage === 'string', `${entry.id}: coverage must be non-empty string`);
    assert.ok(entry.notes && typeof entry.notes === 'string', `${entry.id}: notes must be non-empty string`);

    // Taxonomy enums
    assert.ok(validCategories.has(entry.category), `${entry.id}: category ${entry.category} must be in allowed categories`);
    assert.ok(validRoles.has(entry.role), `${entry.id}: role ${entry.role} must be opportunity, evidence, or discovery`);
    assert.ok(validAccess.has(entry.access), `${entry.id}: access ${entry.access} must be valid access type`);
    assert.ok(validStatuses.has(entry.status), `${entry.id}: status ${entry.status} must be valid SOURCE_STATUSES`);

    // Discovery URL must be valid https URL
    const url = new URL(entry.discoveryUrl);
    assert.equal(url.protocol, 'https:', `${entry.id}: discoveryUrl must be https protocol`);

    // Ingestion constraints: linked platform adapter or null
    if (entry.adapterKey !== null) {
      assert.ok(['sheriff', 'civilview', 'ca-controller-tax-sale'].includes(entry.adapterKey), `${entry.id}: adapterKey must be sheriff, civilview, ca-controller-tax-sale, or null`);
    }

    // Workflow specification
    assert.ok(entry.workflow, `${entry.id}: workflow must exist`);
    assert.ok(entry.workflow.primary && typeof entry.workflow.primary === 'string', `${entry.id}: workflow.primary required`);
    assert.ok(entry.workflow.fallback && typeof entry.workflow.fallback === 'string', `${entry.id}: workflow.fallback required`);
    assert.ok(Number.isFinite(entry.workflow.cadenceHours) && entry.workflow.cadenceHours > 0, `${entry.id}: cadenceHours must be positive number`);
    assert.ok(Array.isArray(entry.workflow.steps) && entry.workflow.steps.length >= 2, `${entry.id}: workflow.steps must have >= 2 items`);

    // Required evidence items
    assert.ok(Array.isArray(entry.requiredEvidence) && entry.requiredEvidence.length >= 2, `${entry.id}: requiredEvidence must have >= 2 items`);

    // Must be retrievable from unified catalog
    const resolved = getSource(entry.id);
    assert.ok(resolved, `getSource('${entry.id}') should find entry in unified SOURCE_CATALOG`);
    assert.equal(resolved.id, entry.id);
    assert.equal(resolved.status, entry.status);
    assert.equal(SOURCE_STATUS_BY_ID[entry.id], entry.status);
  }
});

test('statutory distress catalog covers the 5 major official distress pillars', () => {
  const byCat = {};
  for (const entry of STATUTORY_DISTRESS_CATALOG_ENTRIES) {
    byCat[entry.category] = (byCat[entry.category] || 0) + 1;
  }

  // Tax deeds / sales
  assert.ok((byCat.tax_sale || 0) >= 30, `Expected >= 30 tax sale entries, got ${byCat.tax_sale}`);
  // Sheriff / foreclosure auctions
  assert.ok((byCat.foreclosure_auction || 0) >= 10, `Expected >= 10 foreclosure entries, got ${byCat.foreclosure_auction}`);
  // Land banks
  assert.ok((byCat.land_bank || 0) >= 8, `Expected >= 8 land bank entries, got ${byCat.land_bank}`);
  // Bank REO
  assert.ok((byCat.marketplace || 0) >= 5, `Expected >= 5 bank REO entries, got ${byCat.marketplace}`);
  // Probate court records
  assert.ok((byCat.court_record || 0) >= 10, `Expected >= 10 probate court entries, got ${byCat.court_record}`);
});

test('key anchor sources are present and correctly classified', () => {
  // Florida RealForeclose & RealTaxDeed
  const miamiForeclose = getSource('tax-miamidade-realforeclose');
  assert.ok(miamiForeclose);
  assert.equal(miamiForeclose.category, 'tax_sale');
  assert.equal(miamiForeclose.role, 'opportunity');
  assert.match(miamiForeclose.discoveryUrl, /miamidade\.realforeclose\.com/);

  // Detroit Land Bank Authority
  const detroitLb = getSource('landbank-detroit-dlba');
  assert.ok(detroitLb);
  assert.equal(detroitLb.category, 'land_bank');
  assert.equal(detroitLb.role, 'opportunity');
  assert.match(detroitLb.discoveryUrl, /buildingdetroit\.org/);

  // Bank of America REO
  const boaReo = getSource('bankreo-bank-of-america-foreclosures');
  assert.ok(boaReo);
  assert.equal(boaReo.category, 'marketplace');
  assert.equal(boaReo.role, 'opportunity');

  // NYC Surrogate Court WebSurrogate
  const nycSurrogate = getSource('probate-nyc-websurrogates-case-search');
  assert.ok(nycSurrogate);
  assert.equal(nycSurrogate.category, 'court_record');
  assert.equal(nycSurrogate.role, 'evidence');

  // Cook County IL Sheriff
  const cookSheriff = getSource('sheriff-cook-il-civil-services');
  assert.ok(cookSheriff);
  assert.equal(cookSheriff.category, 'foreclosure_auction');
  assert.equal(cookSheriff.role, 'opportunity');
});

test('Florida RealTaxDeed county sources are mapped to sheriff adapter and have valid discovery URLs', () => {
  const flRealTaxDeedCounties = [
    'broward', 'palmbeach', 'orange', 'hillsborough', 'lee', 'pinellas', 'duval', 'polk',
    'brevard', 'volusia', 'sarasota', 'manatee', 'collier', 'pasco', 'marion', 'lake',
    'osceola', 'seminole', 'stlucie', 'escambia', 'charlotte', 'clay', 'citrus', 'hernando',
    'martin', 'okaloosa', 'santarosa', 'stjohns', 'bay'
  ];

  for (const county of flRealTaxDeedCounties) {
    const id = `tax-${county}-realtaxdeed`;
    const entry = getSource(id);
    assert.ok(entry, `Source ${id} must exist in catalog`);
    assert.equal(entry.category, 'tax_sale', `${id} must be category tax_sale`);
    assert.equal(entry.role, 'opportunity', `${id} must be role opportunity`);
    assert.equal(entry.access, 'public', `${id} must be access public`);
    assert.equal(entry.adapterKey, 'sheriff', `${id} must have adapterKey sheriff`);
    assert.equal(entry.status, 'LOCAL_ROUTE', `${id} must have status LOCAL_ROUTE`);
    assert.match(entry.discoveryUrl, new RegExp(`^https://(www\\.)?${county}\\.realtaxdeed\\.com`));
    assert.ok(entry.workflow && entry.workflow.primary);
    assert.ok(Array.isArray(entry.requiredEvidence) && entry.requiredEvidence.length >= 2);
  }
});

test('unadapted statutory distress sources have adapterKey null and status DISCOVERY_ONLY', () => {
  const unadaptedSampleIds = [
    'landbank-detroit-dlba', 'landbank-detroit-sidelots', 'landbank-detroit-opendata-dataset',
    'landbank-cuyahoga-available-properties', 'landbank-cuyahoga-sideyard-properties', 'landbank-cuyahoga-homes',
    'landbank-cook-county-inventory', 'landbank-cook-county-government', 'landbank-cleveland-program',
    'landbank-community-progress-national-map',
    'sheriff-union-nj-sales-info', 'sheriff-middlesex-nj-foreclosures', 'sheriff-philadelphia-pa-foreclosures',
    'sheriff-montgomery-pa-sales', 'sheriff-chester-pa-handbills', 'sheriff-delaware-pa-real-estate',
    'probate-nyc-websurrogates-case-search', 'probate-cook-il-probate-division',
    'probate-harris-tx-court-search', 'probate-losangeles-ca-superior-court',
    'probate-fulton-ga-court-search', 'probate-miamidade-fl-civil-probate',
    'tax-mecklenburg-nc-foreclosure', 'tax-durham-nc-foreclosure', 'tax-wake-nc-foreclosure',
    'tax-shelby-tn-county-sale', 'tax-shelby-tn-trustee-sale', 'tax-knox-tn-trustee-sale', 'tax-nashville-davidson-chancery-clerk',
    'tax-king-wa-treasury-foreclosure', 'tax-pierce-wa-foreclosure-purchase', 'tax-snohomish-wa-foreclosure-details',
    'tax-cook-il-scavenger-sale', 'sheriff-cook-il-civil-services', 'sheriff-cook-il-foreclosure-portal',
    'bankreo-bank-of-america-foreclosures', 'bankreo-wells-fargo-listings', 'bankreo-us-bank-residential',
    'bankreo-hud-gov-homes-for-sale'
  ];
  for (const id of unadaptedSampleIds) {
    const entry = getSource(id);
    assert.ok(entry, `Source ${id} must exist in catalog`);
    assert.equal(entry.adapterKey, null, `${id} must have adapterKey null`);
    assert.equal(entry.status, 'DISCOVERY_ONLY', `${id} must have status DISCOVERY_ONLY`);
  }

  // Texas tax sale portals keep sheriff adapter
  const txTaxSaleIds = [
    'tax-dallas-tx-pubworks', 'tax-bexar-tx-resale', 'tax-tarrant-tx-constable', 'tax-travis-tx-constable'
  ];
  for (const id of txTaxSaleIds) {
    const entry = getSource(id);
    assert.ok(entry, `Source ${id} must exist in catalog`);
    assert.equal(entry.adapterKey, 'sheriff', `${id} must retain adapterKey sheriff`);
    assert.equal(entry.status, 'LOCAL_ROUTE', `${id} must retain status LOCAL_ROUTE`);
  }

  // CA state controller keeps ca-controller-tax-sale adapter
  const caController = getSource('tax-ca-state-controller-auctions');
  assert.ok(caController, 'tax-ca-state-controller-auctions must exist');
  assert.equal(caController.adapterKey, 'ca-controller-tax-sale');
  assert.equal(caController.status, 'DISCOVERY_ONLY');
});
