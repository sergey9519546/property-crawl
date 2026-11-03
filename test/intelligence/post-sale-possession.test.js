'use strict';

/**
 * test/intelligence/post-sale-possession.test.js
 *
 * Comprehensive unit tests for server/intelligence/post-sale-possession.js
 *
 * Covers:
 *  1. estimateQuietTitleTimeline – verified statutes for FL, GA, TX, IL, NJ, OH, PA, CA, NY, MI
 *  2. estimateWritOfPossessionTimeline – verified statutes and notice periods
 *  3. estimateHoldingCarryCost – Zero-Fabrication enforcement, missing tax/insurance reporting,
 *     hold duration split (quiet title only for tax deeds or explicit requests)
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

test('estimateQuietTitleTimeline: GA statutory cites O.C.G.A. § 23-3-40 and § 48-4-45', () => {
  const result = estimateQuietTitleTimeline('GA', 'tax-deed');

  assert.equal(result.minDays, 60);
  assert.equal(result.maxDays, 180);
  assert.ok(result.statutory.includes('23-3-40'), 'GA statutory must cite O.C.G.A. § 23-3-40');
  assert.ok(result.statutory.includes('48-4-45'), 'GA statutory must cite O.C.G.A. § 48-4-45');
});

test('estimateQuietTitleTimeline: IL cites Property Tax Code 35 ILCS 200/22-40', () => {
  const result = estimateQuietTitleTimeline('IL', 'tax-deed');

  assert.equal(result.minDays, 30);
  assert.equal(result.maxDays, 120);
  assert.ok(result.statutory.includes('35 ILCS 200/22-40'), 'IL must cite 35 ILCS 200/22-40');
});

test('estimateQuietTitleTimeline: NJ returns 60-180 day range with N.J.S.A. § 54:5-104.83', () => {
  const result = estimateQuietTitleTimeline('NJ', 'tax-deed');

  assert.equal(result.minDays, 60);
  assert.equal(result.maxDays, 180);
  assert.ok(result.statutory.includes('54:5-104.83'));
});

test('estimateQuietTitleTimeline: OH cites R.C. § 5303.01 for Action to Quiet Title', () => {
  const result = estimateQuietTitleTimeline('OH', 'tax-deed');

  assert.equal(result.minDays, 90);
  assert.equal(result.maxDays, 365);
  assert.ok(result.statutory.includes('5303.01'), 'OH must cite R.C. § 5303.01');
});

test('estimateQuietTitleTimeline: PA cites Pa. R.C.P. 1061 for Action to Quiet Title', () => {
  const result = estimateQuietTitleTimeline('PA', 'tax-deed');

  assert.equal(result.minDays, 60);
  assert.equal(result.maxDays, 180);
  assert.ok(result.statutory.includes('1061'), 'PA must cite Pa. R.C.P. 1061');
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

test('estimateQuietTitleTimeline: unknown state returns null values and informative note', () => {
  const result = estimateQuietTitleTimeline('ZZ', 'tax-deed');

  assert.equal(result.minDays, null);
  assert.equal(result.maxDays, null);
  assert.equal(result.statutory, null);
  assert.ok(result.notes.includes('ZZ'), 'notes should mention the unknown state');
});

test('estimateQuietTitleTimeline: lowercase state is normalized', () => {
  const result = estimateQuietTitleTimeline('fl', 'tax-deed');

  assert.equal(result.minDays, 90);
  assert.equal(result.maxDays, 365);
});

// ============================================================================
// SUITE 2: estimateWritOfPossessionTimeline
// ============================================================================

test('estimateWritOfPossessionTimeline: FL judicial foreclosure returns 5-30 days', () => {
  const result = estimateWritOfPossessionTimeline('FL', 'sheriff');

  assert.equal(result.minDays, 5);
  assert.equal(result.maxDays, 30);
  assert.ok(result.statutory.includes('1.580'));
});

test('estimateWritOfPossessionTimeline: GA cites O.C.G.A. § 44-7-50 / § 44-7-55', () => {
  const result = estimateWritOfPossessionTimeline('GA', 'sheriff');

  assert.equal(result.minDays, 7);
  assert.equal(result.maxDays, 30);
  assert.ok(result.statutory.includes('44-7-50') || result.statutory.includes('44-7-55'));
});

test('estimateWritOfPossessionTimeline: TX returns 30-90 days with Rule 310', () => {
  const result = estimateWritOfPossessionTimeline('TX', 'sheriff');

  assert.equal(result.minDays, 30);
  assert.equal(result.maxDays, 90);
  assert.ok(result.statutory.includes('310'));
});

test('estimateWritOfPossessionTimeline: IL cites 735 ILCS 5/15-1701', () => {
  const result = estimateWritOfPossessionTimeline('IL', 'sheriff');

  assert.equal(result.minDays, 30);
  assert.equal(result.maxDays, 60);
  assert.ok(result.statutory.includes('15-1701'));
});

test('estimateWritOfPossessionTimeline: NJ returns 30-60 days with Court Rule 4:59-1', () => {
  const result = estimateWritOfPossessionTimeline('NJ', 'sheriff');

  assert.equal(result.minDays, 30);
  assert.equal(result.maxDays, 60);
  assert.ok(result.statutory.includes('4:59'));
});

test('estimateWritOfPossessionTimeline: OH cites R.C. § 2329.31 and § 2329.09', () => {
  const result = estimateWritOfPossessionTimeline('OH', 'sheriff');

  assert.equal(result.minDays, 14);
  assert.equal(result.maxDays, 30);
  assert.ok(result.statutory.includes('2329.31') || result.statutory.includes('2329.09'));
});

test('estimateWritOfPossessionTimeline: PA returns 30-90 days with Pa. R.C.P. 3180', () => {
  const result = estimateWritOfPossessionTimeline('PA', 'sheriff');

  assert.equal(result.minDays, 30);
  assert.equal(result.maxDays, 90);
  assert.ok(result.statutory.includes('3180'));
});

test('estimateWritOfPossessionTimeline: CA returns 30-60 days with C.C.P. § 712.010', () => {
  const result = estimateWritOfPossessionTimeline('CA', 'sheriff');

  assert.equal(result.minDays, 30);
  assert.equal(result.maxDays, 60);
  assert.ok(result.statutory.includes('712.010'));
});

test('estimateWritOfPossessionTimeline: NY returns 30-90 days with RPAPL § 713', () => {
  const result = estimateWritOfPossessionTimeline('NY', 'sheriff');

  assert.equal(result.minDays, 30);
  assert.equal(result.maxDays, 90);
  assert.ok(result.statutory.includes('713'));
});

test('estimateWritOfPossessionTimeline: MI returns 7-30 days with MCR 4.201', () => {
  const result = estimateWritOfPossessionTimeline('MI', 'sheriff');

  assert.equal(result.minDays, 7);
  assert.equal(result.maxDays, 30);
  assert.ok(result.statutory.includes('4.201'));
});

test('estimateWritOfPossessionTimeline: unknown state returns null safely', () => {
  const result = estimateWritOfPossessionTimeline('AA', 'sheriff');

  assert.equal(result.minDays, null);
  assert.equal(result.maxDays, null);
  assert.equal(result.statutory, null);
});

// ============================================================================
// SUITE 3: estimateHoldingCarryCost (Zero-Fabrication Invariant)
// ============================================================================

test('estimateHoldingCarryCost: complete parameters return non-null costs and range', () => {
  const result = estimateHoldingCarryCost({
    state: 'FL',
    saleType: 'tax-deed',
    openingBid: 100000,
    annualTaxRate: 0.015,
    monthlyInsurance: 200,
    monthlyHoaFee: 50,
  });

  assert.ok(result.dailyCost !== null, 'dailyCost must be non-null');
  assert.ok(result.dailyCost > 0, 'dailyCost must be positive');
  assert.ok(result.estimatedHoldDays !== null, 'estimatedHoldDays must be non-null for known state');
  assert.ok(result.estimatedHoldDays > 0, 'estimatedHoldDays must be positive');
  assert.ok(result.totalEstimatedCost !== null, 'totalEstimatedCost must be non-null when inputs complete');
  assert.ok(result.totalEstimatedCost > 0, 'totalEstimatedCost must be positive');
  assert.equal(result.missingInputs.length, 0);
});

test('estimateHoldingCarryCost: openingBid=null returns null totalEstimatedCost (Zero-Fabrication)', () => {
  const result = estimateHoldingCarryCost({
    state: 'FL',
    saleType: 'tax-deed',
    openingBid: null,
    annualTaxRate: 0.015,
    monthlyInsurance: 200,
  });

  assert.equal(result.totalEstimatedCost, null, 'totalEstimatedCost must be null when openingBid is null');
  assert.equal(result.dailyCost, null, 'dailyCost must be null when openingBid is null');
  assert.ok(result.missingInputs.includes('openingBid'));
  assert.ok(result.basis.includes('Zero-Fabrication'), 'basis must mention Zero-Fabrication invariant');
});

test('estimateHoldingCarryCost: missing tax/insurance does not fabricate default numbers', () => {
  const result = estimateHoldingCarryCost({
    state: 'FL',
    saleType: 'tax-deed',
    openingBid: 100000,
    // No annualTaxRate, annualPropertyTax, or monthlyInsurance
  });

  assert.equal(result.totalEstimatedCost, null, 'totalEstimatedCost must be null when tax/insurance absent');
  assert.ok(result.missingInputs.includes('monthlyInsurance'), 'monthlyInsurance must be reported missing');
  assert.ok(result.basis.includes('Zero-Fabrication'), 'basis must document Zero-Fabrication invariant');
});

test('estimateHoldingCarryCost: sheriff sale does not add quiet title unless requested', () => {
  const sheriffResult = estimateHoldingCarryCost({
    state: 'FL',
    saleType: 'sheriff',
    openingBid: 100000,
    annualTaxRate: 0.015,
    monthlyInsurance: 200,
  });

  const taxDeedResult = estimateHoldingCarryCost({
    state: 'FL',
    saleType: 'tax-deed',
    openingBid: 100000,
    annualTaxRate: 0.015,
    monthlyInsurance: 200,
  });

  // Sheriff writ is 5-30 days (midpoint 18 d); tax deed adds quiet title 90-365 d
  assert.ok(sheriffResult.estimatedHoldDays < taxDeedResult.estimatedHoldDays, 'sheriff sale hold days must be shorter than tax-deed');
  assert.equal(sheriffResult.requiresQuietTitle, false);
  assert.equal(taxDeedResult.requiresQuietTitle, true);
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

test('buildPossessionDossier: builds structured object with verified citations', () => {
  const dossier = buildPossessionDossier({
    state: 'OH',
    saleType: 'sheriff',
    openingBid: 150000,
    annualTaxRate: 0.02,
    monthlyInsurance: 150,
  });

  assert.equal(dossier.state, 'OH');
  assert.equal(dossier.saleType, 'sheriff');
  assert.ok(dossier.quietTitle.statutory.includes('5303.01'));
  assert.ok(dossier.writOfPossession.statutory.includes('2329.31'));
  assert.ok(typeof dossier.summary === 'string');
  assert.ok(dossier.generatedAt);
});
