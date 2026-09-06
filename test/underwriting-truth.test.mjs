import assert from 'node:assert/strict';
import test from 'node:test';

import {
  computeCashToClose,
  computeCreMetrics,
  computeTargetPriceScenario,
  generateInvestmentCommitteeMemo,
  generateLetterOfIntent,
  parseRentRollSchedule,
  redemptionLabel,
} from '../src/lib/underwriting.ts';

test('cash requirements stay unresolved until every cost is explicit', () => {
  const unresolved = computeCashToClose({ openingBid: 100_000, state: 'OH', source: 'sheriff' });
  assert.equal(unresolved.total, null);
  assert.equal(unresolved.buyersPremium, null);
  assert.ok(unresolved.missingInputs.includes('delinquentTaxes'));

  const complete = computeCashToClose({
    openingBid: 100_000,
    registrationFunds: 10_000,
    creditedDeposit: 10_000,
    buyersPremium: 5_000,
    sheriffPoundage: 0,
    transferTax: 400,
    delinquentTaxes: 0,
    settlementCosts: 600,
  });
  assert.equal(complete.totalAcquisitionCost, 106_000);
  assert.equal(complete.cashDueAtSettlement, 96_000);
  assert.equal(complete.registrationFunds, 10_000);
});

test('reverse scenario states the exact price or cost change needed for a target', () => {
  assert.deepEqual(computeTargetPriceScenario({
    estimatedValue: 200_000,
    targetMarginPct: 25,
    rehabBudget: 30_000,
    currentPrice: 125_000,
    otherAcquisitionCosts: 10_000,
  }), {
    maxPurchasePrice: 110_000,
    priceReductionNeeded: 15_000,
    maxOtherAcquisitionCostsAtCurrentPrice: 0,
    costReductionNeeded: 10_000,
    targetProfit: 50_000,
  });
  assert.equal(computeTargetPriceScenario({ estimatedValue: 200_000, targetMarginPct: 25, rehabBudget: 30_000, currentPrice: 125_000, otherAcquisitionCosts: null }), null);
});

test('unknown redemption evidence never becomes a zero-day legal conclusion', () => {
  assert.match(redemptionLabel(undefined), /^Unknown/);
  assert.match(redemptionLabel(null), /^Unknown/);
  assert.match(redemptionLabel(Number.NaN), /^Unknown/);
  assert.equal(redemptionLabel(0), '0 days reported — verify official sale terms');
});

test('CRE metrics require every operating, financing, and target-yield assumption', () => {
  assert.equal(computeCreMetrics({ sqft: 10_000, openingBid: 500_000 }), null);
  assert.equal(computeCreMetrics({
    sqft: 10_000,
    openingBid: 500_000,
    marketRentPerSqftAnnual: 15,
    expenseRatio: 0.4,
    vacancyRate: 0.05,
    annualDebtService: 50_000,
  }), null, 'missing target cap rate must disable MAO and the combined metric result');

  assert.deepEqual(computeCreMetrics({
    sqft: 10_000,
    openingBid: 500_000,
    marketRentPerSqftAnnual: 15,
    expenseRatio: 0.4,
    vacancyRate: 0.05,
    annualDebtService: 50_000,
    targetCapitalizationRate: 0.08,
  }), {
    grossPotentialRent: 150_000,
    effectiveGrossIncome: 142_500,
    operatingExpenses: 57_000,
    netOperatingIncome: 85_500,
    capitalizationRate: 17.1,
    estimatedDscr: 1.71,
    maxAllowableOffer: 1_068_750,
  });
});

test('rent-roll parsing leaves NOI unknown until an expense assumption is supplied', () => {
  const notice = `
Unit 101: Starbucks Coffee, 1,800 sqft, rent $4,500/mo, exp 2028-12-31
Unit 102: Apex Dental Care, 2,200 sf, rent $5,200/month, expires 2027-06-30
Unit 103: Vacant Retail Suite, 1,000 sqft
`;
  const evidenceOnly = parseRentRollSchedule(notice);
  assert.equal(evidenceOnly.totalSqft, 5_000);
  assert.equal(evidenceOnly.totalAnnualRent, 116_400);
  assert.equal(evidenceOnly.occupancyRate, 80);
  assert.equal(evidenceOnly.inPlaceNoi, null);
  assert.ok(evidenceOnly.evidenceGaps.some(gap => gap.includes('expense')));

  const modeled = parseRentRollSchedule(notice, { expenseRatio: 0.4 });
  assert.equal(modeled.inPlaceNoi, 69_840);
});

test('LOI draft requires buyer-supplied deal terms and makes no title conclusion', () => {
  const listing = {
    id: 'B4A-1287806',
    address: '321 West Penn Avenue',
    city: 'Robesonia',
    state: 'PA',
    zip: '19551',
    county: 'Berks',
    openingBid: 75_000,
    source: 'bid4assets',
  };
  const incomplete = generateLetterOfIntent(listing);
  assert.match(incomplete, /NOT READY FOR SUBMISSION/);
  assert.match(incomplete, /PURCHASER: \[NOT SUPPLIED/);
  assert.match(incomplete, /PROPOSED PURCHASE PRICE: Unavailable/);
  assert.match(incomplete, /TITLE \/ LEGAL STATUS: NOT DETERMINED/);
  assert.doesNotMatch(incomplete, /Institutional Acquisition Partner LLC/);
  assert.doesNotMatch(incomplete, /\$100,000/);
  assert.doesNotMatch(incomplete, /free and clear/i);

  const supplied = generateLetterOfIntent(listing, {
    buyerEntity: 'Buyer-Supplied Entity LLC',
    recipient: 'Authorized Seller Representative',
    offerPrice: 85_000,
    depositPct: 0.1,
    inspectionDays: 12,
    closingDays: 28,
    closingCosts: {
      buyersPremium: 4_250,
      sheriffPoundage: 1_700,
      transferTax: 340,
      delinquentTaxes: 0,
      deedFees: 500,
    },
  });
  assert.match(supplied, /PROPOSED PURCHASE PRICE: \$85,000 USD/);
  assert.match(supplied, /EARNEST MONEY DEPOSIT: \$8,500 USD/);
  assert.match(supplied, /Total Acquisition Cash .*: \$91,790 USD/);
  assert.match(supplied, /Remaining Cash Due at Settlement: Unavailable/);
});

test('IC memo holds unknowns open instead of inventing favorable metrics or conclusions', () => {
  const incomplete = generateInvestmentCommitteeMemo({ address: 'Subject Property' });
  assert.match(incomplete, /STATUS: EVIDENCE REVIEW DRAFT/);
  assert.match(incomplete, /Deal Score\*\*: Unavailable/);
  assert.match(incomplete, /Redemption \/ Objection Period\*\*: Unknown/);
  assert.match(incomplete, /Senior Lien Signal\*\*: Unknown/);
  assert.match(incomplete, /Net Operating Income \(NOI\)\*\*: Unavailable/);
  assert.match(incomplete, /Max Allowable Offer \(MAO\)\*\*: Unavailable/);
  assert.match(incomplete, /NO BID RECOMMENDATION/);
  assert.doesNotMatch(incomplete, /85\/100|8\.50%|1\.45x|Proceed with/i);

  const supplied = generateInvestmentCommitteeMemo({
    address: '450 Commercial Way',
    city: 'Cleveland',
    state: 'OH',
    zip: '44114',
    propType: 'Commercial',
    source: 'county notice',
    openingBid: 250_000,
    estLow: 380_000,
    estHigh: 420_000,
    dealScore: 92,
    redemptionDays: 0,
    seniorLienRisk: 'low',
    occupancy: 'Reported occupied — unverified',
  }, {
    netOperatingIncome: 34_000,
    capitalizationRate: 13.6,
    estimatedDscr: 1.85,
    maxAllowableOffer: 360_000,
  });
  assert.match(supplied, /92\/99 \(triage indicator only/);
  assert.match(supplied, /0 days recorded in this dataset/);
  assert.match(supplied, /LOW \(unverified risk signal; not a title conclusion\)/);
  assert.match(supplied, /13\.6% \(modeled\)/);
  assert.match(supplied, /1\.85x \(modeled\)/);
  assert.match(supplied, /\$360,000 USD \(buyer-supplied model output/);
});
