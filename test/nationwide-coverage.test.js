'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { US_STATES } = require('../server/sources/nationwide-us-catalog');
const { SOURCE_CATALOG, SOURCE_STATUS_BY_ID } = require('../server/sources/catalog');
const { CIVILVIEW_NATIONWIDE, allStateCodes, idsForState } = require('../config/nationwide-civilview');
const { MARKET_ENROLLMENT } = require('../config/market-enrollment');

test('CivilView nationwide registry covers multiple states', () => {
  const states = allStateCodes();
  assert.ok(states.length >= 15);
  assert.ok(CIVILVIEW_NATIONWIDE.counties.length >= 60);
  assert.ok(idsForState('NJ').length >= 10);
  assert.ok(idsForState('TX').length >= 5);
});

test('catalog includes nationwide state tax-sale and surplus templates for all 50 states + DC', () => {
  const tax = SOURCE_CATALOG.filter((s) => /^state-tax-sale-[a-z]{2}$/.test(s.id));
  const surplus = SOURCE_CATALOG.filter((s) => /^state-surplus-[a-z]{2}$/.test(s.id));
  assert.equal(tax.length, US_STATES.length);
  assert.equal(surplus.length, US_STATES.length);
  assert.ok(US_STATES.length >= 51);
  assert.ok(SOURCE_CATALOG.some((s) => s.id === 'civilview-nationwide'));
  assert.ok(SOURCE_CATALOG.some((s) => s.id === 'realeauction-sheriff-multi-state'));
});

test('nationwide templates are LOCAL_ROUTE enrollment, not live scrapers', () => {
  assert.equal(SOURCE_STATUS_BY_ID['state-tax-sale-ca'], 'LOCAL_ROUTE');
  assert.equal(SOURCE_STATUS_BY_ID['state-surplus-ny'], 'LOCAL_ROUTE');
  assert.equal(SOURCE_STATUS_BY_ID['civilview-nationwide'], 'SCOPE_LIMITED');
  assert.equal(SOURCE_STATUS_BY_ID.bid4assets, 'INCONCLUSIVE_BLOCKED');
});

test('market enrollment defaults to nationwide CivilView participating set', () => {
  assert.equal(MARKET_ENROLLMENT.civilview.nationwide, true);
  assert.ok(MARKET_ENROLLMENT.civilview.targetStates.length >= 15);
  assert.ok(MARKET_ENROLLMENT.civilview.registryCountyCount >= 60);
});

test('state tax sale entries have explicit statutory regimes, citations, and ingestion methods', () => {
  const taxEntries = SOURCE_CATALOG.filter((s) => /^state-tax-sale-[a-z]{2}$/.test(s.id));
  assert.equal(taxEntries.length, 51);

  const allowedRegimes = new Set(['tax_deed', 'tax_lien', 'hybrid_redeemable_deed']);
  for (const entry of taxEntries) {
    assert.ok(allowedRegimes.has(entry.regime), `${entry.id}: regime ${entry.regime} must be valid enum`);
    assert.ok(typeof entry.legalRef === 'string' && entry.legalRef.length > 0, `${entry.id}: legalRef required`);
    assert.ok(typeof entry.ingestionMethod === 'string' && entry.ingestionMethod.length > 0, `${entry.id}: ingestionMethod required`);
    assert.match(entry.notes, new RegExp(entry.regime), `${entry.id}: notes must mention statutory regime`);
  }

  // Key exemplar states
  const fl = taxEntries.find((s) => s.id === 'state-tax-sale-fl');
  assert.equal(fl.regime, 'tax_deed');
  assert.match(fl.legalRef, /197\.542/);

  const ca = taxEntries.find((s) => s.id === 'state-tax-sale-ca');
  assert.equal(ca.regime, 'tax_deed');
  assert.match(ca.legalRef, /3691/);

  const tx = taxEntries.find((s) => s.id === 'state-tax-sale-tx');
  assert.equal(tx.regime, 'hybrid_redeemable_deed');
  assert.match(tx.legalRef, /34\.21/);

  const ga = taxEntries.find((s) => s.id === 'state-tax-sale-ga');
  assert.equal(ga.regime, 'hybrid_redeemable_deed');
  assert.match(ga.legalRef, /48-4-1/);

  const az = taxEntries.find((s) => s.id === 'state-tax-sale-az');
  assert.equal(az.regime, 'tax_lien');
  assert.match(az.legalRef, /42-18101/);

  const pa = taxEntries.find((s) => s.id === 'state-tax-sale-pa');
  assert.equal(pa.regime, 'hybrid_redeemable_deed');
  assert.match(pa.legalRef, /5860\.601|1701/);
});
