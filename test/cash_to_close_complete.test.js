'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  JURISDICTION_FEE_SCHEDULES,
  calculateCompleteCashToClose,
} = require('../server/intelligence/cash-to-close');

test('calculates complete Florida foreclosure cash-to-close schedule', () => {
  const result = calculateCompleteCashToClose({
    winningBid: 100000,
    state: 'FL',
    creditedDeposit: 5000,
  });

  assert.equal(result.state, 'FL');
  assert.equal(result.winningBid, 100000);
  assert.equal(result.transferTax, 700); // $7 per $1,000 (Fla. Stat. § 201.02)
  assert.equal(result.sheriffPoundage, 0); // Direct clerk electronic auction
  assert.equal(result.recordingFees, 100);
  assert.equal(result.buyersPremium, 0); // Direct county auction
  assert.equal(result.totalAcquisitionCost, 100800);
  assert.equal(result.creditedDeposit, 5000);
  assert.equal(result.netCashDueAtSettlement, 95800);
  assert.equal(result.settlementWindowHours, 24);
});

test('calculates complete Pennsylvania sheriff sale cash-to-close schedule', () => {
  const result = calculateCompleteCashToClose({
    winningBid: 100000,
    state: 'PA',
    creditedDeposit: 10000,
    delinquentTaxes: 1200,
  });

  assert.equal(result.state, 'PA');
  assert.equal(result.transferTax, 2000); // 2% statutory PA transfer tax
  assert.equal(result.sheriffPoundage, 2000); // 2% statutory sheriff poundage
  assert.equal(result.delinquentTaxes, 1200);
  assert.equal(result.recordingFees, 150);
  assert.equal(result.totalAcquisitionCost, 105350);
  assert.equal(result.netCashDueAtSettlement, 95350);
});

test('calculates complete New Jersey sheriff sale cash-to-close schedule', () => {
  const result = calculateCompleteCashToClose({
    winningBid: 200000,
    state: 'NJ',
    creditedDeposit: 40000, // 20% standard NJ sheriff deposit
  });

  assert.equal(result.state, 'NJ');
  assert.equal(result.sheriffPoundage, 5000); // 2.5% statutory poundage under N.J.S.A. 22A:4-8
  assert.equal(result.transferTax, 1700); // $8.50 per $1,000
  assert.equal(result.recordingFees, 120);
  assert.equal(result.totalAcquisitionCost, 206820);
  assert.equal(result.netCashDueAtSettlement, 166820);
});

test('calculates complete Ohio sheriff sale cash-to-close schedule', () => {
  const result = calculateCompleteCashToClose({
    winningBid: 80000,
    state: 'OH',
    creditedDeposit: 5000,
  });

  assert.equal(result.state, 'OH');
  assert.equal(result.transferTax, 320); // $4.00 per $1,000
  assert.equal(result.sheriffPoundage, 1600); // 2% sheriff execution fee
  assert.equal(result.recordingFees, 80);
  assert.equal(result.totalAcquisitionCost, 82000);
  assert.equal(result.netCashDueAtSettlement, 77000);
});

test('adds 5% buyer premium on online marketplace auctions (Bid4Assets / ServiceLink)', () => {
  const marketplaceResult = calculateCompleteCashToClose({
    winningBid: 100000,
    state: 'FL',
    isMarketplace: true,
  });

  assert.equal(marketplaceResult.buyersPremium, 5000); // 5% of $100k
  assert.equal(marketplaceResult.isMarketplace, true);
  assert.equal(marketplaceResult.totalAcquisitionCost, 105800);

  // Minimum $2,500 buyer premium on smaller bids
  const smallBidResult = calculateCompleteCashToClose({
    winningBid: 20000,
    state: 'FL',
    source: 'bid4assets',
  });
  assert.equal(smallBidResult.buyersPremium, 2500); // Enforces minimum $2,500 floor
});

test('deposit crediting never produces negative settlement obligation', () => {
  const overCredited = calculateCompleteCashToClose({
    winningBid: 50000,
    state: 'OH',
    creditedDeposit: 90000, // Deposit exceeds total cost
  });

  assert.ok(overCredited.totalAcquisitionCost < 90000);
  assert.equal(overCredited.netCashDueAtSettlement, 0, 'Net cash due must clamp to zero');
});
