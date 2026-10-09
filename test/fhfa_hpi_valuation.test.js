'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  US_NATIONAL_HPI,
  STATE_HPI_WEIGHTS,
  getHpiIndex,
  getAppreciationMultiplier
} = require('../server/intelligence/fhfa-hpi');

const {
  calculateMacroValuation,
  enrichListingWithMacroValuation
} = require('../server/enrichment/macro-valuation');

test('FHFA HPI Engine: retrieves state and national indices correctly', () => {
  const nat2018 = getHpiIndex('US', '2018Q2');
  assert.equal(nat2018, 275.8);

  const nat2026 = getHpiIndex('US', '2026Q1');
  assert.equal(nat2026, 494.5);

  // Florida has positive appreciation momentum weight (1.25)
  const fl2018 = getHpiIndex('FL', '2018Q2');
  assert.ok(fl2018 > nat2018);

  // Ohio has steady appreciation weight (0.92)
  const oh2018 = getHpiIndex('OH', '2018Q2');
  assert.ok(oh2018 < nat2018);
});

test('FHFA HPI Engine: computes macroeconomic appreciation multiplier', () => {
  // From 2018 to 2026
  const multiplierOH = getAppreciationMultiplier('OH', 2018, '2026Q1');
  assert.ok(multiplierOH > 1.5, `OH multiplier should be > 1.5, got ${multiplierOH}`);
  assert.ok(multiplierOH < 2.2, `OH multiplier should be < 2.2, got ${multiplierOH}`);

  const multiplierFL = getAppreciationMultiplier('FL', 2018, '2026Q1');
  assert.ok(multiplierFL > 1.5, `FL multiplier should be > 1.5, got ${multiplierFL}`);
});

test('Macro Valuation: calculates indexed value and calibrated variance bands', () => {
  const result = calculateMacroValuation({
    historicalValue: 150000,
    historicalYear: 2018,
    state: 'OH',
    basisType: 'TAX_ASSESSMENT'
  });

  assert.ok(result);
  assert.equal(result.valuationMethod, 'FHFA_HPI_TREND');
  assert.equal(result.isAvmAppraisal, false, 'Must strictly disclose that this is NOT a certified appraisal');
  assert.ok(result.estimatedMacroValue > 150000);
  assert.equal(result.estLow, Math.round(result.estimatedMacroValue * 0.92));
  assert.equal(result.estHigh, Math.round(result.estimatedMacroValue * 1.08));
  assert.equal(result.basis.type, 'TAX_ASSESSMENT');
  assert.match(result.disclaimer, /Federal Housing Finance Agency/);
});

test('Macro Valuation: enriches raw listing lacking valuation', () => {
  const rawListing = {
    id: 'SHERIFF-OH-CUY-9988',
    state: 'OH',
    county: 'Cuyahoga',
    assessedValue: 120000,
    yearBuilt: 2016,
    openingBid: 80000
  };

  const enriched = enrichListingWithMacroValuation(rawListing);
  assert.ok(enriched.macroValuation);
  assert.ok(enriched.estLow > 0);
  assert.ok(enriched.estHigh > enriched.estLow);
  assert.equal(enriched.macroValuation.isAvmAppraisal, false);
});

test('Macro Valuation: fails closed on invalid parameters', () => {
  assert.equal(calculateMacroValuation({ historicalValue: 0, state: 'OH', historicalYear: 2018 }), null);
  assert.equal(calculateMacroValuation({ historicalValue: 100000, state: '', historicalYear: 2018 }), null);
  assert.equal(calculateMacroValuation({ historicalValue: 100000, state: 'OH', historicalYear: null }), null);
});
