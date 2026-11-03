'use strict';

/**
 * test/intelligence/post-sale-possession.test.js
 *
 * Comprehensive unit tests for server/intelligence/post-sale-possession.js
 *
 * Covers:
 *  1. estimateQuietTitleTimeline – known states, sheriff sale variant, unknown state
 *  2. estimateWritOfPossessionTimeline – known states, unknown state
 *  3. estimateHoldingCarryCost – positive bid, null bid (Zero-Fabrication), edge cases
 *  4. buildPossessionDossier – complete dossier structure and null-safe behavior
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  estimateQuietTitleTimeline,
  estimateWritOfPossessionTimeline,
  estimateHoldingCarryCost,
  buildPossessionDossier,
  QUIET_TITLE_DATA,
  WRIT_OF_POSSESSION_DATA,
} = require('../../server/intelligence/post-sale-possession');

// ============================================================================
// SUITE 1: estimateQuietTitleTimeline
// ============================================================================

test('estimateQuietTitleTimeline: FL tax-deed returns correct minDays/maxDays/statutory', () => {
  const result = estimateQuietTitleTimeline('FL', 'tax-deed');

  assert.equal(result.minDays, 90, 'FL quiet title minDays should be 90 (Fla. Stat. Ch. 65; § 197.522)');
  assert.equal(result.maxDays, 365, 'FL quiet title maxDays should be 365');
  assert.ok(result.statutory.includes('197.522'), 'FL statutory must reference § 197.522');
  assert.ok(typeof result.notes === 'string' && result.notes.length > 0, 'notes must be a non-empty string');
});

test('estimateQuietTitleTimeline: TX sheriff sale returns valid values', () => {
  const result = estimateQuietTitleTimeline('TX', 'sheriff');

  assert.equal(result.minDays, 30, 'TX quiet title minDays should be 30 (Tex. Tax Code § 34.21)');
  assert.equal(result.maxDays, 365, 'TX quiet title maxDays should be 365');
  assert.ok(result.statutory.includes('34.21'), 'TX statutory must reference § 34.21');
  assert.ok(result.notes.includes('sheriff'), 'TX notes should mention sheriff sale variant');
});

test('estimateQuietTitleTimeline: GA tax-deed statutory reference', () => {
  const result = estimateQuietTitleTimeline('GA', 'tax-deed');

  assert.equal(result.minDays, 60);
  assert.equal(result.maxDays, 180);
  assert.ok(result.statutory.includes('9-12-60'), 'GA statutory must cite O.C.G.A. § 9-12-60');
});

test('estimateQuietTitleTimeline: IL returns 30-120 day range', () => {
  const result = estimateQuietTitleTimeline('IL', 'tax-deed');

  assert.equal(result.minDays, 30);
  assert.equal(result.maxDays, 120);
  assert.ok(result.statutory.includes('735 ILCS'));
});

test('estimateQuietTitleTimeline: NJ returns 60-180 day range with N.J.S.A. § 54:5-104.83', () => {
  const result = estimateQuietTitleTimeline('NJ', 'tax-deed');

  assert.equal(result.minDays, 60);
  assert.equal(result.maxDays, 180);
  assert.ok(result.statutory.includes('54:5-104.83'));
});

test('estimateQuietTitleTimeline: OH returns 90-365 day range', () => {
  const result = estimateQuietTitleTimeline('OH', 'tax-deed');

  assert.equal(result.minDays, 90);
  assert.equal(result.maxDays, 365);
  assert.ok(result.statutory.includes('5322.01'));
});

test('estimateQuietTitleTimeline: PA returns 60-180 day range', () => {
  const result = estimateQuietTitleTimeline('PA', 'tax-deed');

  assert.equal(result.minDays, 60);
  assert.equal(result.maxDays, 180);
  assert.ok(result.statutory.includes('3180'));
});

test('estimateQuietTitleTimeline: CA returns 180-365 day range (C.C.P. § 760.010)', () => {
  const result = estimateQuietTitleTimeline('CA', 'tax-deed');

  assert.equal(result.minDays, 180);
  assert.equal(result.maxDays, 365);
  assert.ok(result.statutory.includes('760.010'));
});

test('estimateQuietTitleTimeline: NY returns 90-365 day range (RPAPL § 1521)', () => {
  const result = estimateQuietTitleTimeline('NY', 'tax-deed');

  assert.equal(result.minDays, 90);
  assert.equal(result.maxDays, 365);
  assert.ok(result.statutory.includes('1521'));
});

test('estimateQuietTitleTimeline: MI returns 30-120 day range (MCL § 211.78m)', () => {
  const result = estimateQuietTitleTimeline('MI', 'tax-deed');

  assert.equal(result.minDays, 30);
  assert.equal(result.maxDays, 120);
  assert.ok(result.statutory.includes('211.78m'));
});

test('estimateQuietTitleTimeline: unknown state returns null minDays/maxDays without throwing', () => {
  let result;
  assert.doesNotThrow(() => {
    result = estimateQuietTitleTimeline('ZZ', 'tax-deed');
  });

  assert.equal(result.minDays, null, 'unknown state: minDays should be null');
  assert.equal(result.maxDays, null, 'unknown state: maxDays should be null');
  assert.equal(result.statutory, null, 'unknown state: statutory should be null');
  assert.ok(typeof result.notes === 'string', 'unknown state: notes should still be a string');
});

test('estimateQuietTitleTimeline: null state returns null without throwing', () => {
  let result;
  assert.doesNotThrow(() => {
    result = estimateQuietTitleTimeline(null, 'tax-deed');
  });
  assert.equal(result.minDays, null);
  assert.equal(result.maxDays, null);
});

test('estimateQuietTitleTimeline: trustee sale returns same statutory range as tax-deed for FL', () => {
  const taxDeed = estimateQuietTitleTimeline('FL', 'tax-deed');
  const trustee = estimateQuietTitleTimeline('FL', 'trustee');

  assert.equal(taxDeed.minDays, trustee.minDays, 'trustee and tax-deed share same FL quiet title framework');
  assert.equal(taxDeed.maxDays, trustee.maxDays);
  assert.equal(taxDeed.statutory, trustee.statutory);
});

// ============================================================================
// SUITE 2: estimateWritOfPossessionTimeline
// ============================================================================

test('estimateWritOfPossessionTimeline: NJ sheriff returns correct statutory (N.J. Court R. 4:59)', () => {
  const result = estimateWritOfPossessionTimeline('NJ', 'sheriff');

  assert.equal(result.minDays, 30, 'NJ writ minDays should be 30');
  assert.equal(result.maxDays, 60, 'NJ writ maxDays should be 60');
  assert.ok(result.statutory.includes('4:59'), 'NJ statutory must cite R. 4:59');
  assert.ok(typeof result.notes === 'string' && result.notes.length > 0);
});

test('estimateWritOfPossessionTimeline: FL returns 5-30 day range (Fla. R. Civ. P. 1.580)', () => {
  const result = estimateWritOfPossessionTimeline('FL', 'sheriff');

  assert.equal(result.minDays, 5);
  assert.equal(result.maxDays, 30);
  assert.ok(result.statutory.includes('1.580'));
});

test('estimateWritOfPossessionTimeline: TX writ timeline (Tex. R. Civ. P. 310)', () => {
  const result = estimateWritOfPossessionTimeline('TX', 'sheriff');

  assert.equal(result.minDays, 30);
  assert.equal(result.maxDays, 90);
  assert.ok(result.statutory.includes('310'));
});

test('estimateWritOfPossessionTimeline: IL returns 30-60 day range (735 ILCS 5/9-211)', () => {
  const result = estimateWritOfPossessionTimeline('IL', 'sheriff');

  assert.equal(result.minDays, 30);
  assert.equal(result.maxDays, 60);
  assert.ok(result.statutory.includes('9-211'));
});

test('estimateWritOfPossessionTimeline: OH returns 14-30 day range (Ohio Civ. R. 70)', () => {
  const result = estimateWritOfPossessionTimeline('OH', 'sheriff');

  assert.equal(result.minDays, 14);
  assert.equal(result.maxDays, 30);
  assert.ok(result.statutory.includes('Civ. R. 70'));
});

test('estimateWritOfPossessionTimeline: PA returns 30-90 day range (Pa. R.C.P. 3180)', () => {
  const result = estimateWritOfPossessionTimeline('PA', 'sheriff');

  assert.equal(result.minDays, 30);
  assert.equal(result.maxDays, 90);
  assert.ok(result.statutory.includes('3180'));
});

test('estimateWritOfPossessionTimeline: CA returns 30-60 day range (C.C.P. § 712.010)', () => {
  const result = estimateWritOfPossessionTimeline('CA', 'sheriff');

  assert.equal(result.minDays, 30);
  assert.equal(result.maxDays, 60);
  assert.ok(result.statutory.includes('712.010'));
});

test('estimateWritOfPossessionTimeline: NY returns 30-90 day range (RPAPL § 713)', () => {
  const result = estimateWritOfPossessionTimeline('NY', 'sheriff');

  assert.equal(result.minDays, 30);
  assert.equal(result.maxDays, 90);
  assert.ok(result.statutory.includes('713'));
});

test('estimateWritOfPossessionTimeline: MI returns 7-30 day range (MCR 4.201)', () => {
  const result = estimateWritOfPossessionTimeline('MI', 'sheriff');

  assert.equal(result.minDays, 7);
  assert.equal(result.maxDays, 30);
  assert.ok(result.statutory.includes('4.201'));
});

test('estimateWritOfPossessionTimeline: GA returns 7-30 day range (O.C.G.A. § 9-13-14)', () => {
  const result = estimateWritOfPossessionTimeline('GA', 'sheriff');

  assert.equal(result.minDays, 7);
  assert.equal(result.maxDays, 30);
  assert.ok(result.statutory.includes('9-13-14'));
});

test('estimateWritOfPossessionTimeline: unknown state returns null without throwing', () => {
  let result;
  assert.doesNotThrow(() => {
    result = estimateWritOfPossessionTimeline('AA', 'sheriff');
  });

  assert.equal(result.minDays, null);
  assert.equal(result.maxDays, null);
  assert.equal(result.statutory, null);
});

test('estimateWritOfPossessionTimeline: trustee sale notes mention sale type variant', () => {
  const result = estimateWritOfPossessionTimeline('FL', 'trustee');

  assert.ok(result.notes.includes('trustee'), 'trustee sale should be noted in notes for non-sheriff saleType');
});

// ============================================================================
// SUITE 3: estimateHoldingCarryCost
// ============================================================================

test('estimateHoldingCarryCost: FL tax-deed with openingBid=100000 returns non-null positive cost', () => {
  const result = estimateHoldingCarryCost({
    state: 'FL',
    saleType: 'tax-deed',
    openingBid: 100000,
  });

  assert.ok(result.dailyCost !== null, 'dailyCost must be non-null');
  assert.ok(result.dailyCost > 0, 'dailyCost must be positive');
  assert.ok(result.estimatedHoldDays !== null, 'estimatedHoldDays must be non-null for known state');
  assert.ok(result.estimatedHoldDays > 0, 'estimatedHoldDays must be positive');
  assert.ok(result.totalEstimatedCost !== null, 'totalEstimatedCost must be non-null');
  assert.ok(result.totalEstimatedCost > 0, 'totalEstimatedCost must be positive');
  assert.ok(typeof result.basis === 'string' && result.basis.length > 0, 'basis must be a non-empty string');
});

test('estimateHoldingCarryCost: FL tax-deed with openingBid=null returns null totalEstimatedCost (Zero-Fabrication)', () => {
  const result = estimateHoldingCarryCost({
    state: 'FL',
    saleType: 'tax-deed',
    openingBid: null,
  });

  assert.equal(result.totalEstimatedCost, null, 'totalEstimatedCost must be null when openingBid is null');
  assert.equal(result.dailyCost, null, 'dailyCost must be null when openingBid is null');
  assert.ok(result.basis.includes('Zero-Fabrication'), 'basis must mention Zero-Fabrication invariant');
});

test('estimateHoldingCarryCost: openingBid=undefined returns null totalEstimatedCost (Zero-Fabrication)', () => {
  const result = estimateHoldingCarryCost({
    state: 'CA',
    saleType: 'trustee',
    openingBid: undefined,
  });

  assert.equal(result.totalEstimatedCost, null);
  assert.equal(result.dailyCost, null);
});

test('estimateHoldingCarryCost: unknown state returns null hold days and null total even with valid bid', () => {
  const result = estimateHoldingCarryCost({
    state: 'ZZ',
    saleType: 'tax-deed',
    openingBid: 50000,
  });

  assert.equal(result.estimatedHoldDays, null, 'estimatedHoldDays must be null for unknown state');
  assert.equal(result.totalEstimatedCost, null, 'totalEstimatedCost must be null when hold days unknown');
  // dailyCost can still be computed; openingBid is provided
  assert.ok(result.dailyCost !== null, 'dailyCost should still be computed from bid even for unknown state');
  assert.ok(result.dailyCost > 0);
});

test('estimateHoldingCarryCost: monthlyHoaFee and monthlyUtilities are incorporated into daily cost', () => {
  const baseline = estimateHoldingCarryCost({
    state: 'GA',
    saleType: 'tax-deed',
    openingBid: 75000,
    monthlyHoaFee: 0,
    monthlyUtilities: 0,
  });

  const withHoa = estimateHoldingCarryCost({
    state: 'GA',
    saleType: 'tax-deed',
    openingBid: 75000,
    monthlyHoaFee: 300,
    monthlyUtilities: 150,
  });

  assert.ok(withHoa.dailyCost > baseline.dailyCost, 'dailyCost must increase with HOA and utility fees');
  assert.ok(withHoa.totalEstimatedCost > baseline.totalEstimatedCost, 'totalEstimatedCost must increase');
});

test('estimateHoldingCarryCost: annualTaxRate default is 0.015 (1.5%)', () => {
  const result = estimateHoldingCarryCost({
    state: 'FL',
    saleType: 'tax-deed',
    openingBid: 365000, // $1,000/day tax at 0.1% → easy math
  });

  // Expected daily tax at 1.5% = 365000 * 0.015 / 365 = 15.00
  const expectedDailyTax = (365000 * 0.015) / 365;
  // Default insurance = $200/mo → $200 / (365/12) per day
  const expectedDailyInsurance = 200 / (365 / 12);
  const expectedDailyTotal = expectedDailyTax + expectedDailyInsurance;

  assert.ok(Math.abs(result.dailyCost - expectedDailyTotal) < 0.01, `dailyCost should be ~${expectedDailyTotal.toFixed(2)}, got ${result.dailyCost}`);
});

test('estimateHoldingCarryCost: null params object does not throw', () => {
  let result;
  assert.doesNotThrow(() => {
    result = estimateHoldingCarryCost(null);
  });
  assert.equal(result.totalEstimatedCost, null);
  assert.equal(result.dailyCost, null);
});

// ============================================================================
// SUITE 4: buildPossessionDossier
// ============================================================================

test('buildPossessionDossier: GA tax-deed with openingBid=75000 returns complete dossier', () => {
  const result = buildPossessionDossier({
    state: 'GA',
    saleType: 'tax-deed',
    openingBid: 75000,
  });

  assert.equal(result.state, 'GA');
  assert.equal(result.saleType, 'tax-deed');

  // quietTitle
  assert.ok(result.quietTitle, 'dossier must include quietTitle');
  assert.equal(result.quietTitle.minDays, 60);
  assert.equal(result.quietTitle.maxDays, 180);
  assert.ok(result.quietTitle.statutory.includes('9-12-60'));

  // writOfPossession
  assert.ok(result.writOfPossession, 'dossier must include writOfPossession');
  assert.equal(result.writOfPossession.minDays, 7);
  assert.equal(result.writOfPossession.maxDays, 30);
  assert.ok(result.writOfPossession.statutory.includes('9-13-14'));

  // carryCost
  assert.ok(result.carryCost, 'dossier must include carryCost');
  assert.ok(result.carryCost.totalEstimatedCost > 0, 'totalEstimatedCost must be positive with valid bid');
  assert.ok(result.carryCost.estimatedHoldDays > 0);

  // summary
  assert.ok(typeof result.summary === 'string' && result.summary.includes('GA'), 'summary must reference state');
  assert.ok(result.summary.includes('tax-deed'));

  // generatedAt
  assert.ok(typeof result.generatedAt === 'string', 'generatedAt must be a string');
  assert.ok(!isNaN(Date.parse(result.generatedAt)), 'generatedAt must be a valid ISO date');
});

test('buildPossessionDossier: FL tax-deed dossier references § 197.522 and Rule 1.580', () => {
  const result = buildPossessionDossier({
    state: 'FL',
    saleType: 'tax-deed',
    openingBid: 120000,
  });

  assert.ok(result.quietTitle.statutory.includes('197.522'));
  assert.ok(result.writOfPossession.statutory.includes('1.580'));
  assert.ok(result.carryCost.totalEstimatedCost > 0);
});

test('buildPossessionDossier: null openingBid produces null carry cost in dossier (Zero-Fabrication)', () => {
  const result = buildPossessionDossier({
    state: 'FL',
    saleType: 'tax-deed',
    openingBid: null,
  });

  assert.equal(result.carryCost.totalEstimatedCost, null);
  assert.equal(result.carryCost.dailyCost, null);
  assert.ok(result.summary.includes('Zero-Fabrication') || result.carryCost.basis.includes('Zero-Fabrication'));
});

test('buildPossessionDossier: unknown state completes without throwing and returns null ranges', () => {
  let result;
  assert.doesNotThrow(() => {
    result = buildPossessionDossier({
      state: 'WW',
      saleType: 'sheriff',
      openingBid: 50000,
    });
  });

  assert.equal(result.quietTitle.minDays, null);
  assert.equal(result.writOfPossession.minDays, null);
  assert.equal(result.carryCost.estimatedHoldDays, null);
  assert.equal(result.carryCost.totalEstimatedCost, null);
});

test('buildPossessionDossier: NJ sheriff sale dossier has correct statutory citations', () => {
  const result = buildPossessionDossier({
    state: 'NJ',
    saleType: 'sheriff',
    openingBid: 250000,
  });

  assert.ok(result.quietTitle.statutory.includes('54:5-104.83'));
  assert.ok(result.writOfPossession.statutory.includes('4:59'));
  assert.ok(result.carryCost.totalEstimatedCost > 0);
});

test('buildPossessionDossier: property with HOA and utility fees produces larger carry cost than bare minimum', () => {
  const bare = buildPossessionDossier({
    state: 'OH',
    saleType: 'sheriff',
    openingBid: 100000,
  });

  const withFees = buildPossessionDossier({
    state: 'OH',
    saleType: 'sheriff',
    openingBid: 100000,
    monthlyHoaFee: 250,
    monthlyUtilities: 100,
  });

  assert.ok(withFees.carryCost.totalEstimatedCost > bare.carryCost.totalEstimatedCost);
});

// ============================================================================
// SUITE 5: Data Integrity Checks
// ============================================================================

test('QUIET_TITLE_DATA contains all 10 required states', () => {
  const required = ['FL', 'GA', 'TX', 'IL', 'NJ', 'OH', 'PA', 'CA', 'NY', 'MI'];
  for (const state of required) {
    assert.ok(
      QUIET_TITLE_DATA[state],
      `QUIET_TITLE_DATA must contain entry for ${state}`
    );
  }
});

test('WRIT_OF_POSSESSION_DATA contains all 10 required states', () => {
  const required = ['FL', 'GA', 'TX', 'IL', 'NJ', 'OH', 'PA', 'CA', 'NY', 'MI'];
  for (const state of required) {
    assert.ok(
      WRIT_OF_POSSESSION_DATA[state],
      `WRIT_OF_POSSESSION_DATA must contain entry for ${state}`
    );
  }
});

test('All quiet title data entries have valid day ranges and non-empty statutory', () => {
  for (const [state, data] of Object.entries(QUIET_TITLE_DATA)) {
    assert.ok(typeof data.minDays === 'number' && data.minDays > 0, `${state}: minDays must be > 0`);
    assert.ok(typeof data.maxDays === 'number' && data.maxDays >= data.minDays, `${state}: maxDays must be >= minDays`);
    assert.ok(typeof data.statutory === 'string' && data.statutory.length > 0, `${state}: statutory must be non-empty`);
    assert.ok(typeof data.notes === 'string' && data.notes.length > 0, `${state}: notes must be non-empty`);
  }
});

test('All writ of possession data entries have valid day ranges and non-empty statutory', () => {
  for (const [state, data] of Object.entries(WRIT_OF_POSSESSION_DATA)) {
    assert.ok(typeof data.minDays === 'number' && data.minDays > 0, `${state}: minDays must be > 0`);
    assert.ok(typeof data.maxDays === 'number' && data.maxDays >= data.minDays, `${state}: maxDays must be >= minDays`);
    assert.ok(typeof data.statutory === 'string' && data.statutory.length > 0, `${state}: statutory must be non-empty`);
    assert.ok(typeof data.notes === 'string' && data.notes.length > 0, `${state}: notes must be non-empty`);
  }
});

test('estimateHoldingCarryCost: TX homestead with all optional params returns valid result', () => {
  const result = estimateHoldingCarryCost({
    state: 'TX',
    saleType: 'tax-deed',
    openingBid: 180000,
    annualTaxRate: 0.02,
    monthlyHoaFee: 150,
    monthlyInsurance: 175,
    monthlyUtilities: 80,
  });

  assert.ok(result.dailyCost > 0);
  assert.ok(result.estimatedHoldDays > 0);
  assert.ok(result.totalEstimatedCost > 0);

  // Manual check: daily tax = 180000 * 0.02 / 365 = ~9.86
  // daily hoa = 150 / (365/12) = ~4.93
  // daily insurance = 175 / (365/12) = ~5.75
  // daily utilities = 80 / (365/12) = ~2.63
  const daysPerMonth = 365 / 12;
  const expectedDaily =
    (180000 * 0.02) / 365 +
    150 / daysPerMonth +
    175 / daysPerMonth +
    80 / daysPerMonth;

  assert.ok(Math.abs(result.dailyCost - Math.round(expectedDaily * 100) / 100) < 0.02,
    `dailyCost mismatch: expected ~${expectedDaily.toFixed(2)}, got ${result.dailyCost}`);
});
