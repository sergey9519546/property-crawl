'use strict';

// test/ai/bidding-simulator.test.js
//
// Pure-function coverage for server/ai/bidding-simulator.js. Three static
// methods back the LOI/Memo generator and the BiddingSimulator UI. They are
// pure, deterministic, and called on every bid simulation, so silent drift
// (a percentage change, a sign flip in plaintiffUpsetRisk) would silently
// move every bid recommendation in the system. Pin the contract.
//
//   - calculateMAO: 70% ARV Max Allowable Offer minus all cost layers.
//                   Returns 0 for non-positive ARV and floors to integer.
//   - calculateHoldingCosts: points + interest + transfer tax + insurance.
//                            Floors to integer, never negative.
//   - simulateClearingProbability: normalises win probability to [0,100]
//                                  and surfaces plaintiffUpsetRisk flag.

const assert = require('node:assert/strict');
const test = require('node:test');

const { BiddingSimulator } = require('../../server/ai/bidding-simulator');

const { calculateMAO, calculateHoldingCosts, simulateClearingProbability } = BiddingSimulator;

// --- calculateMAO ------------------------------------------------------

test('calculateMAO: returns 0 when ARV is missing or non-positive', () => {
  assert.equal(calculateMAO({}), 0);
  assert.equal(calculateMAO({ arv: 0 }), 0);
  assert.equal(calculateMAO({ arv: -100 }), 0);
});

test('calculateMAO: at 70% with no costs, MAO is 70% of ARV floored to int', () => {
  assert.equal(calculateMAO({ arv: 100000 }), 70000);
  assert.equal(calculateMAO({ arv: 123456 }), 86419);
});

test('calculateMAO: subtracts rehab, cash-to-close, profit, holding', () => {
  const out = calculateMAO({
    arv: 200000,
    rehabBudget: 30000,
    cashToClose: 5000,
    targetProfit: 20000,
    holdingCosts: 10000,
  });
  // 200000 * 0.7 = 140000; minus 30000 + 5000 + 20000 + 10000 = 65000.
  assert.equal(out, 75000);
});

test('calculateMAO: honors a custom targetPercentage', () => {
  // 75% of 100k = 75000, no costs.
  assert.equal(calculateMAO({ arv: 100000, targetPercentage: 0.75 }), 75000);
});

test('calculateMAO: floors negative MAO to 0 (cannot recommend a bid that costs the buyer money)', () => {
  // 100000 * 0.7 = 70000; minus 80000 of costs = -10000, must clamp to 0.
  const out = calculateMAO({ arv: 100000, rehabBudget: 80000 });
  assert.equal(out, 0);
});

test('calculateMAO: coerces non-numeric inputs to 0 rather than NaN', () => {
  assert.equal(calculateMAO({ arv: '100000', rehabBudget: 'bad' }), 70000);
  assert.equal(calculateMAO({ arv: null }), 0);
});

test('calculateMAO: defaults targetPercentage to 0.7 when explicitly null', () => {
  assert.equal(calculateMAO({ arv: 100000, targetPercentage: null }), 70000);
});

// --- calculateHoldingCosts ---------------------------------------------

test('calculateHoldingCosts: zero purchase price produces 0 cost (no loan to carry)', () => {
  assert.equal(calculateHoldingCosts({ purchasePrice: 0 }), 0);
});

test('calculateHoldingCosts: includes loan points + interest + transfer tax + insurance', () => {
  // purchasePrice=100000, rehab=0, loanPoints=2%, interest=12%/yr, 6 months,
  // transfer tax 1%, insurance ~2%/yr.
  //   pointsCost = 100000 * 0.02 = 2000
  //   interestCost = 100000 * (0.12/12) * 6 = 6000
  //   transferTax = 100000 * 0.01 = 1000
  //   insuranceTaxes = 100000 * 0.02 / 12 * 6 = 1000
  //   total = 10000, floored to 10000
  assert.equal(calculateHoldingCosts({ purchasePrice: 100000 }), 10000);
});

test('calculateHoldingCosts: loan amount is purchasePrice + rehabBudget', () => {
  // pointsCost = (100000 + 50000) * 0.02 = 3000
  // interestCost = (100000 + 50000) * (0.12/12) * 6 = 9000
  // transferTax = 100000 * 0.01 = 1000
  // insuranceTaxes = 100000 * 0.02 / 12 * 6 = 1000
  // total = 14000
  assert.equal(calculateHoldingCosts({ purchasePrice: 100000, rehabBudget: 50000 }), 14000);
});

test('calculateHoldingCosts: 0% rate and 0 points reduce cost to transfer tax + insurance', () => {
  // pointsCost = 0, interestCost = 0, transferTax = 1000, insuranceTaxes = 1000 = 2000
  assert.equal(calculateHoldingCosts({ purchasePrice: 100000, loanPoints: 0, interestRate: 0 }), 2000);
});

test('calculateHoldingCosts: never returns a negative number even with bad inputs', () => {
  // Negative months would underflow; the floor + max(0, ...) gate clamps to 0.
  assert.equal(calculateHoldingCosts({ purchasePrice: 100000, holdMonths: -1 }) >= 0, true);
});

// --- simulateClearingProbability ---------------------------------------

test('simulateClearingProbability: returns 0 win probability when target bid is below opening bid', () => {
  const out = simulateClearingProbability({ openingBid: 100000, judgment: 150000 }, 50000);
  assert.equal(out.winProbability, 0);
  assert.equal(out.plaintiffUpsetRisk, true);
});

test('simulateClearingProbability: 99% win probability at >= 1.2x expected clearing price', () => {
  // debt 100k, no assessed => upsetBidCeiling = 100k, marketClearingFloor = 0,
  // expectedClearingPrice = 100k. target bid 120k (>= 120k) => 99%.
  const out = simulateClearingProbability({ openingBid: 50000, judgment: 100000 }, 120000);
  assert.equal(out.winProbability, 99);
  assert.equal(out.plaintiffUpsetRisk, false);
});

test('simulateClearingProbability: 50% win probability at expected clearing price (boundary)', () => {
  const out = simulateClearingProbability({ openingBid: 50000, judgment: 100000 }, 100000);
  assert.equal(out.winProbability, 50);
});

test('simulateClearingProbability: 10% win probability at the upset bid ceiling', () => {
  // upsetBidCeiling = min(100k, 80% of 200k) = 100k; bid at 100k is exactly
  // at the upset bid ceiling => 10%.
  const out = simulateClearingProbability({ openingBid: 50000, judgment: 100000, assessed: 200000 }, 100000);
  assert.equal(out.winProbability, 10);
});

test('simulateClearingProbability: clamps probability to [0, 100]', () => {
  const out = simulateClearingProbability({ openingBid: 0, judgment: 0, assessed: 0 }, 9999999);
  assert.ok(out.winProbability >= 0);
  assert.ok(out.winProbability <= 100);
});

test('simulateClearingProbability: uses assessedValue fallback when assessed is missing', () => {
  // The helper accepts both canonical `assessed` and raw `assessedValue`
  // shapes. Pin both.
  const a = simulateClearingProbability({ openingBid: 50000, judgment: 100000, assessed: 200000 }, 100000);
  const b = simulateClearingProbability({ openingBid: 50000, judgment: 100000, assessedValue: 200000 }, 100000);
  assert.equal(a.winProbability, b.winProbability);
  assert.equal(a.upsetBidCeiling, b.upsetBidCeiling);
});

test('simulateClearingProbability: uses debt fallback when judgment is missing', () => {
  const a = simulateClearingProbability({ openingBid: 50000, judgment: 100000 }, 100000);
  const b = simulateClearingProbability({ openingBid: 50000, debt: 100000 }, 100000);
  assert.equal(a.upsetBidCeiling, b.upsetBidCeiling);
});

test('simulateClearingProbability: handles a listing with no debt and no assessed (openBid=0 branch)', () => {
  // openBid=0 means no opening-bid-based upset ceiling; debt and assessed
  // are also missing, so expectedClearingPrice=0. With bid >= openBid, the
  // "<= 0" branch returns 70.
  const out = simulateClearingProbability({ openingBid: 0 }, 0);
  assert.equal(out.winProbability, 70);
  assert.equal(out.plaintiffUpsetRisk, false);
});

test('simulateClearingProbability: bid below opening bid yields 0% win probability', () => {
  // The under-upset branch (5%) only fires when expectedClearingPrice > 0
  // AND bid >= openBid AND bid < upsetBidCeiling. With both expected and
  // upset at 0, the early branch returns 70. The 0% case is the documented
  // "you can't win at all" floor for any bid strictly below the open bid.
  const out = simulateClearingProbability({ openingBid: 100000, judgment: 100000 }, 50000);
  assert.equal(out.winProbability, 0);
  assert.equal(out.plaintiffUpsetRisk, true);
});

test('simulateClearingProbability: returns integer values for downstream display', () => {
  const out = simulateClearingProbability({ openingBid: 50000, judgment: 100000, assessed: 200000 }, 95000);
  assert.equal(Number.isInteger(out.winProbability), true);
  assert.equal(Number.isInteger(out.expectedClearingPrice), true);
  assert.equal(Number.isInteger(out.upsetBidCeiling), true);
});

test('simulateClearingProbability: plaintiffUpsetRisk flag is true when bid < upsetBidCeiling', () => {
  const out = simulateClearingProbability({ openingBid: 50000, judgment: 100000, assessed: 200000 }, 60000);
  assert.equal(out.plaintiffUpsetRisk, true);
});
