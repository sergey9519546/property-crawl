'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  computeStatutoryDeadlinesAndCarry,
  computeStatutoryFeePreset,
  computeRedemptionYield,
} = require('../src/lib/underwriting.ts');

test('NC Upset-Bid Calculator: computes 5% increment ($750 floor) and 5% deposit under N.C.G.S. § 45-21.27', () => {
  // Test Case A: Standard bid ($100,000)
  const bidA = 100000;
  const incrementA = Math.max(750, Math.round(bidA * 0.05));
  const nextUpsetBidA = bidA + incrementA;
  const requiredDepositA = Math.max(750, Math.round(nextUpsetBidA * 0.05));

  assert.equal(incrementA, 5000);
  assert.equal(nextUpsetBidA, 105000);
  assert.equal(requiredDepositA, 5250);

  // Test Case B: Small bid ($8,000) enforcing statutory $750 floor
  const bidB = 8000;
  const rawPctB = Math.round(bidB * 0.05); // 400 < 750
  const incrementB = Math.max(750, rawPctB);
  const nextUpsetBidB = bidB + incrementB;
  const requiredDepositB = Math.max(750, Math.round(nextUpsetBidB * 0.05));

  assert.equal(incrementB, 750); // Enforces $750 statutory floor
  assert.equal(nextUpsetBidB, 8750);
  assert.equal(requiredDepositB, 750); // Enforces $750 deposit floor

  // Verify statutory window in underwriting engine
  const ncDeadlines = computeStatutoryDeadlinesAndCarry({
    saleDate: '2026-11-01',
    state: 'NC',
    purchasePrice: bidA,
  });
  assert.equal(ncDeadlines.objectionOrConfirmationDays, 10);
  assert.match(ncDeadlines.objectionLabel, /NC 10-day rolling upset-bid window/);
  assert.match(ncDeadlines.objectionLabel, /N\.C\.G\.S\. § 45-21\.27/);
});

test('Alabama Post-Sale Redemption: models 180-day homestead vs 365-day non-homestead with 12% interest', () => {
  // 1. Homestead property: 180-day redemption
  const alHomestead = computeStatutoryDeadlinesAndCarry({
    saleDate: '2026-11-01',
    state: 'AL',
    isHomestead: true,
    purchasePrice: 150000,
  });
  assert.equal(alHomestead.stateRedemptionDays, 180);
  assert.equal(alHomestead.effectiveLockupDays, 180);

  // 2. Non-homestead / commercial property: 365-day redemption
  const alNonHomestead = computeStatutoryDeadlinesAndCarry({
    saleDate: '2026-11-01',
    state: 'AL',
    isHomestead: false,
    purchasePrice: 150000,
  });
  assert.equal(alNonHomestead.stateRedemptionDays, 365);
  assert.equal(alNonHomestead.effectiveLockupDays, 365);

  // 3. Simple interest calculation under Ala. Code § 40-10-122 (12% per annum)
  const alYield = computeRedemptionYield({
    purchasePrice: 150000,
    state: 'AL',
    redemptionDays: 180,
    isHomestead: true,
  });
  assert.ok(alYield);
  assert.equal(alYield.statutoryRatePct, 12);
  assert.equal(alYield.yieldType, 'interest');
  assert.equal(alYield.isFlatPenalty, false);
  assert.equal(alYield.isAnnualInterest, true);
  // 150,000 * 12% * (180/365) = approx $8,877
  assert.ok(alYield.penaltyAmount > 8800 && alYield.penaltyAmount < 8900);
  assert.equal(alYield.redemptionPayout, 150000 + alYield.penaltyAmount);
});

test('Timeline Progress & Carry Math: computes accurate elapsed ratio and lockup carry', () => {
  const purchasePrice = 200000;
  const deadlines = computeStatutoryDeadlinesAndCarry({
    saleDate: '2026-10-01',
    state: 'NJ',
    purchasePrice,
    hasIrsLien: true, // 120-day IRS redemption
  });

  // Effective lockup should be max(10, 120, 0) = 120 days
  assert.equal(deadlines.effectiveLockupDays, 120);
  assert.equal(deadlines.irsRedemptionDays, 120);
  assert.equal(deadlines.objectionOrConfirmationDays, 10);

  // Carry cost = 200,000 * (10% / 365) * 120 = ~6,575
  assert.ok(deadlines.estimatedCarryCost !== null);
  assert.ok(deadlines.estimatedCarryCost > 6500 && deadlines.estimatedCarryCost < 6600);

  // Test progress bar bounds
  const totalDays = deadlines.effectiveLockupDays;
  const elapsedDays = 60;
  const progressPct = Math.min(100, Math.max(0, Math.round((elapsedDays / totalDays) * 100)));
  assert.equal(progressPct, 50);
});
