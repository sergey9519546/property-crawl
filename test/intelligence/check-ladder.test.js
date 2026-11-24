'use strict';

/**
 * test/intelligence/check-ladder.test.js
 *
 * Positive and negative unit tests for server/intelligence/check-ladder.js:
 * - Pre-wire vs at-gavel separation
 * - Struck/postponed/stayed target exclusion
 * - Peak simultaneous same-day gavel deposit grouping & denomination decomposition
 * - Subset feasibility within <= $999 over-tender
 * - Capital shortfall / surplus math & empty-targets edge case
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  computeCashiersCheckLadder,
  classifyTargetStatus,
  roundUpToCheckUnit,
} = require('../../server/intelligence/check-ladder');

test('check-ladder: empty targets edge case returns clean zeroed summary', () => {
  const result = computeCashiersCheckLadder({ targets: [] });

  assert.equal(result.summary.activeTargetCount, 0);
  assert.equal(result.summary.struckTargetCount, 0);
  assert.equal(result.summary.totalPreWireEscrowRequired, 0);
  assert.equal(result.summary.peakAtGavelCheckRequired, 0);
  assert.equal(result.summary.checkLadderTotal, 0);
  assert.equal(result.summary.totalCapitalRequired, 0);
  assert.equal(result.summary.availableCapital, null);
  assert.equal(result.summary.capitalShortfall, null);
  assert.equal(result.summary.feasible, null);
  assert.deepEqual(result.checkLadder, []);
  assert.deepEqual(result.preWireSchedule, []);
  assert.deepEqual(result.gavelTargets, []);
  assert.deepEqual(result.struckTargets, []);
  assert.equal(result.escrowPlan.fundedAuctionCount || 0, 0);

  const withCapital = computeCashiersCheckLadder({ targets: [], availableCapital: 50000 });
  assert.equal(withCapital.summary.availableCapital, 50000);
  assert.equal(withCapital.summary.capitalShortfall, 0);
  assert.equal(withCapital.summary.feasible, true);
});

test('check-ladder: separates pre-wire escrow deposits from at-gavel cashier checks', () => {
  const result = computeCashiersCheckLadder({
    targets: [
      {
        id: 'real_1',
        source: 'realauction',
        state: 'FL',
        saleDate: '2026-12-10T15:00:00Z',
        maxAllowableOffer: 120000,
      },
      {
        id: 'b4a_1',
        source: 'bid4assets',
        state: 'CA',
        saleDate: '2026-12-12T18:00:00Z',
        maxAllowableOffer: 80000,
      },
      {
        id: 'sl_1',
        source: 'servicelink',
        state: 'OH',
        saleDate: '2026-12-15T16:00:00Z',
        maxAllowableOffer: 30000, // 5% = $1,500 -> $2,500 minimum floor
      },
      {
        id: 'civ_1',
        source: 'civilview',
        state: 'NJ',
        saleDate: '2026-12-10T14:00:00Z',
        maxAllowableOffer: 150000, // 20% = $30,000 at gavel
      },
      {
        id: 'tx_1',
        source: 'texas_tax',
        state: 'TX',
        saleDate: '2026-12-18T15:00:00Z',
        maxAllowableOffer: 22500, // 100% = $22,500 -> rounded up to $23,000
      },
    ],
    availableCapital: 100000,
  });

  assert.equal(result.summary.activeTargetCount, 5);
  assert.equal(result.summary.struckTargetCount, 0);
  assert.equal(result.preWireSchedule.length, 3);
  assert.equal(result.gavelTargets.length, 2);

  // Pre-wire: 12,000 (realauction 10%) + 8,000 (bid4assets 10%) + 2,500 (servicelink floor) = 22,500
  assert.equal(result.summary.totalPreWireEscrowRequired, 22500);

  // At-gavel different days: max(30,000, 23,000) = 30,000
  assert.equal(result.summary.peakAtGavelCheckRequired, 30000);
  assert.equal(result.summary.checkLadderTotal, 30000);
  assert.equal(result.summary.totalCapitalRequired, 52500);
  assert.equal(result.summary.capitalShortfall, 0);
  assert.equal(result.summary.feasible, true);

  const txTarget = result.gavelTargets.find((t) => t.id === 'tx_1');
  assert.equal(txTarget.exactDeposit, 22500);
  assert.equal(txTarget.requiredDeposit, 23000);
  assert.equal(txTarget.tenderedAmount, 23000);
  assert.ok(txTarget.overTenderAmount <= 999);
});

test('check-ladder: automatically strikes postponed, canceled, stayed, retired, and halted targets', () => {
  const result = computeCashiersCheckLadder({
    targets: [
      { id: 'active_nj', source: 'civilview', state: 'NJ', maxBid: 100000, status: 'scheduled' },
      { id: 'postponed_1', source: 'civilview', state: 'NJ', maxBid: 200000, status: 'Postponed by Sheriff' },
      { id: 'canceled_1', source: 'texas_tax', state: 'TX', maxBid: 150000, lifecycleStatus: 'Canceled' },
      { id: 'cancelled_1', source: 'realauction', state: 'FL', maxBid: 150000, lifecycle: 'cancelled' },
      { id: 'stayed_1', source: 'generic_sheriff', state: 'OH', maxBid: 150000, status: 'Bankruptcy Stayed' },
      { id: 'retired_1', source: 'bid4assets', state: 'CA', maxBid: 150000, lifecycleStatus: 'retired' },
      { id: 'stat_stay', source: 'civilview', state: 'NJ', maxBid: 150000, statutoryStay: true },
      { id: 'halted_1', source: 'civilview', state: 'NJ', maxBid: 150000, halted: true },
    ],
    availableCapital: 25000,
  });

  assert.equal(result.summary.activeTargetCount, 1);
  assert.equal(result.summary.struckTargetCount, 7);
  assert.equal(result.summary.totalPreWireEscrowRequired, 0);
  assert.equal(result.summary.peakAtGavelCheckRequired, 20000);
  assert.equal(result.summary.checkLadderTotal, 20000);
  assert.equal(result.summary.feasible, true);
  assert.equal(classifyTargetStatus({ status: 'active' }).struck, false);
});

test('check-ladder: decomposes peak same-day gavel ladder so smaller off-day targets pay cleanly within <= $999', () => {
  // Day 1 (peak): single NJ CivilView target requiring $100,000 deposit (20% of $500k)
  // Day 2: two simultaneous generic_sheriff targets requiring $12,300 -> $13,000 and $4,100 -> $5,000
  // Day 3: one TX target requiring $7,000
  const result = computeCashiersCheckLadder({
    targets: [
      {
        id: 'day1_big',
        source: 'civilview',
        state: 'NJ',
        saleDate: '2026-12-10T10:00:00Z',
        maxBid: 500000, // 20% = $100,000
      },
      {
        id: 'day2_small_a',
        source: 'generic_sheriff',
        state: 'PA',
        saleDate: '2026-12-11T10:00:00Z',
        maxBid: 123000, // 10% = $12,300 -> $13,000
      },
      {
        id: 'day2_small_b',
        source: 'generic_sheriff',
        state: 'PA',
        saleDate: '2026-12-11T11:00:00Z',
        maxBid: 41000, // 10% = $4,100 -> $5,000
      },
      {
        id: 'day3_med',
        source: 'texas_tax',
        state: 'TX',
        saleDate: '2026-12-12T10:00:00Z',
        maxBid: 7000, // 100% = $7,000
      },
    ],
  });

  assert.equal(result.summary.peakAtGavelCheckRequired, 100000);
  assert.equal(result.summary.checkLadderTotal, 100000);

  // Verify ladder rows sum accurately
  const ladderSum = result.checkLadder.reduce((sum, row) => {
    assert.equal(row.subtotal, row.denomination * row.count);
    assert.ok(row.count > 0);
    return sum + row.subtotal;
  }, 0);
  assert.equal(ladderSum, 100000);

  // Verify smaller denominations were generated (not a single monolithic $100,000 check)
  const smallChecks = result.checkLadder.filter((r) => r.denomination <= 10000);
  assert.ok(smallChecks.length > 0, 'Ladder must decompose into smaller checks for smaller targets');

  // Verify EVERY active at-gavel target can be formed from a subset within <= $999 over-tender
  for (const target of result.gavelTargets) {
    assert.ok(target.subsetChecks.length > 0, `Target ${target.id} must have subsetChecks`);
    assert.ok(target.tenderedAmount >= target.exactDeposit);
    assert.ok(
      target.overTenderAmount <= 999,
      `Target ${target.id} over-tendered by ${target.overTenderAmount} (> $999)`,
    );
  }
});

test('check-ladder: sums simultaneous same-day gavel targets and reports capital shortfall', () => {
  const result = computeCashiersCheckLadder({
    targets: [
      {
        id: 'same_day_1',
        source: 'civilview',
        state: 'NJ',
        saleDate: '2026-12-20T10:00:00Z',
        maxBid: 200000, // $40,000
      },
      {
        id: 'same_day_2',
        source: 'civilview',
        state: 'NJ',
        saleDate: '2026-12-20T13:30:00Z',
        maxBid: 150000, // $30,000
      },
      {
        id: 'pre_wire_1',
        source: 'realauction',
        state: 'FL',
        saleDate: '2026-12-22T14:00:00Z',
        maxBid: 100000, // $10,000
      },
    ],
    availableCapital: 60000,
  });

  // Same-day peak = 40,000 + 30,000 = 70,000
  assert.equal(result.summary.peakAtGavelCheckRequired, 70000);
  assert.equal(result.summary.checkLadderTotal, 70000);
  assert.equal(result.summary.totalPreWireEscrowRequired, 10000);
  assert.equal(result.summary.totalCapitalRequired, 80000);
  assert.equal(result.summary.availableCapital, 60000);
  assert.equal(result.summary.capitalShortfall, 20000);
  assert.equal(result.summary.feasible, false);
});

test('check-ladder: handles zero-bid / unresolved targets without fabricating minimum deposits', () => {
  assert.equal(roundUpToCheckUnit(0), 0);
  assert.equal(roundUpToCheckUnit(1001), 2000);

  const result = computeCashiersCheckLadder({
    targets: [
      {
        id: 'unpriced_1',
        source: 'generic_sheriff',
        state: 'OH',
        openingBid: null,
        maxAllowableOffer: null,
      },
    ],
    availableCapital: 10000,
  });

  assert.equal(result.summary.activeTargetCount, 1);
  assert.equal(result.summary.peakAtGavelCheckRequired, 0);
  assert.equal(result.summary.checkLadderTotal, 0);
  assert.equal(result.gavelTargets[0].requiredDeposit, 0);
  assert.equal(result.gavelTargets[0].bidBasis, 'unresolved');
});
