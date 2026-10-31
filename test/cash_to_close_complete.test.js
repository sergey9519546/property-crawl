'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  JURISDICTION_FEE_SCHEDULES,
  calculateCompleteCashToClose,
} = require('../server/intelligence/cash-to-close');
const { computeStatutoryDeadlinesAndCarry, computeStatutoryFeePreset } = require('../src/lib/underwriting.ts');

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

test('calculates complete Texas non-judicial foreclosure cash-to-close schedule ($0 transfer tax)', () => {
  const result = calculateCompleteCashToClose({
    winningBid: 150000,
    state: 'TX',
    creditedDeposit: 15000,
  });

  assert.equal(result.state, 'TX');
  assert.equal(result.transferTax, 0); // $0 transfer tax in Texas
  assert.equal(result.sheriffPoundage, 0);
  assert.equal(result.recordingFees, 50);
  assert.equal(result.totalAcquisitionCost, 150050);
  assert.equal(result.netCashDueAtSettlement, 135050);
  assert.equal(result.settlementWindowHours, 4);
});

test('calculates complete North Carolina upset bid cash-to-close schedule', () => {
  const result = calculateCompleteCashToClose({
    winningBid: 100000,
    state: 'NC',
    creditedDeposit: 5000,
  });

  assert.equal(result.state, 'NC');
  assert.equal(result.transferTax, 200); // $2.00 per $1,000 (N.C.G.S. § 105-228.30)
  assert.equal(result.sheriffPoundage, 5000); // 5% statutory commission cap
  assert.equal(result.recordingFees, 64);
  assert.equal(result.totalAcquisitionCost, 105264);
  assert.equal(result.netCashDueAtSettlement, 100264);
  assert.equal(result.settlementWindowHours, 240); // 10 days upset bid period
});

test('calculates complete New York referee sale cash-to-close schedule', () => {
  const result = calculateCompleteCashToClose({
    winningBid: 250000,
    state: 'NY',
    creditedDeposit: 25000,
  });

  assert.equal(result.state, 'NY');
  assert.equal(result.transferTax, 1000); // $4.00 per $1,000
  assert.equal(result.sheriffPoundage, 2500); // 1% referee compensation
  assert.equal(result.recordingFees, 150);
  assert.equal(result.totalAcquisitionCost, 253650);
  assert.equal(result.netCashDueAtSettlement, 228650);
});

test('calculates complete Michigan sheriff foreclosure cash-to-close schedule', () => {
  const result = calculateCompleteCashToClose({
    winningBid: 100000,
    state: 'MI',
    creditedDeposit: 10000,
  });

  assert.equal(result.state, 'MI');
  assert.equal(result.transferTax, 430); // $4.30 per $1,000 (MCL § 207.505 & § 207.525)
  assert.equal(result.sheriffPoundage, 500); // 0.5% capped statutory sheriff fee
  assert.equal(result.recordingFees, 30);
  assert.equal(result.totalAcquisitionCost, 100960);
  assert.equal(result.netCashDueAtSettlement, 90960);
});

test('calculates complete Nevada non-judicial trustee sale cash-to-close schedule', () => {
  const result = calculateCompleteCashToClose({
    winningBid: 200000,
    state: 'NV',
    creditedDeposit: 20000,
  });

  assert.equal(result.state, 'NV');
  assert.equal(result.transferTax, 780); // $3.90 per $1,000 (NRS 375.020)
  assert.equal(result.sheriffPoundage, 0); // Non-judicial trustee auction
  assert.equal(result.recordingFees, 75);
  assert.equal(result.totalAcquisitionCost, 200855);
  assert.equal(result.netCashDueAtSettlement, 180855);
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

test('evaluates Texas tax sale statutory deadlines: 180-day non-homestead and 730-day homestead', () => {
  const { computeStatutoryDeadlinesAndCarry, computeStatutoryFeePreset } = require('../src/lib/underwriting.ts');

  // 1. Non-homestead tax sale
  const investorTaxSale = computeStatutoryDeadlinesAndCarry({
    saleDate: '2026-11-03',
    state: 'TX',
    distressType: 'tax_sale',
    isHomestead: false,
    purchasePrice: 100000,
  });
  assert.equal(investorTaxSale.stateRedemptionDays, 180);
  assert.equal(investorTaxSale.objectionOrConfirmationDays, 20);
  assert.equal(investorTaxSale.effectiveLockupDays, 180);
  assert.match(investorTaxSale.objectionLabel, /TX 20-day constable deed processing/);

  // 2. Homestead tax sale (2-year statutory right of redemption)
  const homesteadTaxSale = computeStatutoryDeadlinesAndCarry({
    saleDate: '2026-11-03',
    state: 'TX',
    distressType: 'tax_sale',
    isHomestead: true,
    purchasePrice: 100000,
  });
  assert.equal(homesteadTaxSale.stateRedemptionDays, 730);
  assert.equal(homesteadTaxSale.objectionOrConfirmationDays, 20);
  assert.equal(homesteadTaxSale.effectiveLockupDays, 730);

  // 3. Deed of trust private mortgage sale (0-day post-sale redemption)
  const trusteeSale = computeStatutoryDeadlinesAndCarry({
    saleDate: '2026-11-03',
    state: 'TX',
    distressType: 'foreclosure_auction',
    purchasePrice: 100000,
  });
  assert.equal(trusteeSale.stateRedemptionDays, 0);
  assert.equal(trusteeSale.objectionOrConfirmationDays, 0);
  assert.equal(trusteeSale.effectiveLockupDays, 0);

  // 4. Texas fee preset citations
  const preset = computeStatutoryFeePreset({ purchasePrice: 100000, state: 'TX' });
  assert.ok(preset.supported);
  assert.equal(preset.transferTax, 0);
  assert.equal(preset.sheriffPoundage, 0);
  assert.ok(preset.citations.some(c => c.includes('Tex. Tax Code § 34.015')));
  assert.ok(preset.citations.some(c => c.includes("Tex. Local Gov't Code § 118.011")));
});

test('computes Georgia statutory underwriting deadlines and fee citations', () => {
  // 1. Georgia tax deed sale (1-year statutory redemption under O.C.G.A. § 48-4-40)
  const gaTaxSale = computeStatutoryDeadlinesAndCarry({
    saleDate: '2026-11-03',
    state: 'GA',
    distressType: 'tax_sale',
    purchasePrice: 100000,
  });
  assert.equal(gaTaxSale.stateRedemptionDays, 365);
  assert.equal(gaTaxSale.objectionOrConfirmationDays, 30);
  assert.equal(gaTaxSale.effectiveLockupDays, 365);
  assert.match(gaTaxSale.objectionLabel, /GA 30-day tax deed execution & recording window/);

  // 2. Georgia non-judicial mortgage foreclosure (0-day post-sale redemption under O.C.G.A. § 44-14-162)
  const gaMortgageSale = computeStatutoryDeadlinesAndCarry({
    saleDate: '2026-11-03',
    state: 'GA',
    distressType: 'foreclosure_auction',
    purchasePrice: 100000,
  });
  assert.equal(gaMortgageSale.stateRedemptionDays, 0);
  assert.equal(gaMortgageSale.objectionOrConfirmationDays, 0);
  assert.equal(gaMortgageSale.effectiveLockupDays, 0);
  assert.match(gaMortgageSale.objectionLabel, /GA non-judicial foreclosure under power of sale/);

  // 3. Georgia tax fee preset citations
  const gaTaxPreset = computeStatutoryFeePreset({ purchasePrice: 100000, state: 'GA', distressType: 'tax_sale' });
  assert.ok(gaTaxPreset.supported);
  assert.equal(gaTaxPreset.transferTax, 100); // $1 per $1,000
  assert.equal(gaTaxPreset.sheriffPoundage, 0);
  assert.ok(gaTaxPreset.citations.some(c => c.includes('O.C.G.A. § 48-4-40')));
  assert.ok(gaTaxPreset.citations.some(c => c.includes('20% statutory penalty')));
  assert.ok(gaTaxPreset.citations.some(c => c.includes('O.C.G.A. § 48-6-1')));

  // 4. Georgia mortgage fee preset citations
  const gaMortgagePreset = computeStatutoryFeePreset({ purchasePrice: 100000, state: 'GA' });
  assert.ok(gaMortgagePreset.supported);
  assert.equal(gaMortgagePreset.transferTax, 100);
  assert.ok(gaMortgagePreset.citations.some(c => c.includes('O.C.G.A. § 44-14-162')));
});
