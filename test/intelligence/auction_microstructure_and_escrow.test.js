'use strict';

/**
 * test/intelligence/auction_microstructure_and_escrow.test.js
 *
 * Comprehensive Test Suite for Track 9 Master Blueprint:
 * 1. Docket Clearing-Rate Microstructure & Proceed Probability (server/intelligence/auction-microstructure.js)
 * 2. Multi-Auction Escrow & Deposit Lockup Optimizer (server/intelligence/escrow-optimizer.js)
 * 3. Dual-Outcome Penalty Redemption vs. Acquisition EV (src/lib/redemption-ev.ts)
 * 4. Excess Proceeds Waterfall under Tyler v. Hennepin County (server/intelligence/surplus-waterfall.js)
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DOCKET_OUTCOMES,
  normalizeDocketOutcome,
  calculateDocketClearingAnalytics,
  evaluateAuctionProceedProbability,
} = require('../../server/intelligence/auction-microstructure');

const {
  PLATFORM_DEPOSIT_RULES,
  getAuctionDepositRules,
  calculateRequiredDeposit,
  optimizeEscrowAllocation,
} = require('../../server/intelligence/escrow-optimizer');

const {
  computeRedemptionExpectedValue,
} = require('../../src/lib/redemption-ev.ts');

const {
  WATERFALL_TIERS,
  classifyLienTier,
  calculateSurplusEquityWaterfall,
} = require('../../server/intelligence/surplus-waterfall');

// ============================================================================
// SUITE 1: DOCKET CLEARING-RATE MICROSTRUCTURE & PROCEED PROBABILITY
// ============================================================================

test('Auction Microstructure: normalizes diverse raw outcome strings into canonical outcomes', () => {
  assert.equal(normalizeDocketOutcome('active'), 'scheduled');
  assert.equal(normalizeDocketOutcome('Postponed by Sheriff'), 'postponed');
  assert.equal(normalizeDocketOutcome('Adjourned to next month'), 'postponed');
  assert.equal(normalizeDocketOutcome('Bankruptcy Stay Active'), 'stayed');
  assert.equal(normalizeDocketOutcome('Chapter 13 Injunction'), 'stayed');
  assert.equal(normalizeDocketOutcome('Sold to Plaintiff for $100'), 'sold_plaintiff');
  assert.equal(normalizeDocketOutcome('Bank Credit Bid REO Buyback'), 'sold_plaintiff');
  assert.equal(normalizeDocketOutcome('Sold to Third-Party Investor'), 'sold_third_party');
  assert.equal(normalizeDocketOutcome('Sold at auction'), 'sold_third_party');
  assert.equal(normalizeDocketOutcome('Cancelled - Debt Satisfied'), 'cancelled');
  assert.equal(normalizeDocketOutcome('Dismissed by Court'), 'cancelled');
  assert.equal(normalizeDocketOutcome(null), 'scheduled');
});

test('Auction Microstructure: calculates docket clearing rates accurately from historical events', () => {
  const sampleEvents = [
    { outcome: 'sold_third_party' },
    { outcome: 'sold_third_party' },
    { outcome: 'sold_third_party' },
    { outcome: 'sold_plaintiff' },
    { outcome: 'postponed' },
    { outcome: 'postponed' },
    { outcome: 'stayed' },
    { outcome: 'cancelled' },
    { outcome: 'scheduled' },
    { outcome: 'scheduled' },
  ];

  const stats = calculateDocketClearingAnalytics(sampleEvents);

  assert.equal(stats.totalDockets, 10);
  assert.equal(stats.outcomeCounts.sold_third_party, 3);
  assert.equal(stats.outcomeCounts.sold_plaintiff, 1);
  assert.equal(stats.outcomeCounts.postponed, 2);
  assert.equal(stats.outcomeCounts.stayed, 1);
  assert.equal(stats.outcomeCounts.cancelled, 1);
  assert.equal(stats.outcomeCounts.scheduled, 2);

  // Clearing rate: 3 third party / (1 plaintiff + 3 third party = 4 total sales) = 0.75
  assert.equal(stats.clearingRate, 0.75);
  // Plaintiff buyback rate: 1 plaintiff / 4 total sales = 0.25
  assert.equal(stats.plaintiffBuybackRate, 0.25);
  assert.equal(Number((stats.clearingRate + stats.plaintiffBuybackRate).toFixed(4)), 1.0);

  // Postponement rate: 2 / 10 = 0.20
  assert.equal(stats.postponementRate, 0.20);
  // Stay rate: 1 / 10 = 0.10
  assert.equal(stats.stayRate, 0.10);
  // Cancellation rate: 1 / 10 = 0.10
  assert.equal(stats.cancellationRate, 0.10);
  // Sale rate: 4 / 10 = 0.40
  assert.equal(stats.saleRate, 0.40);
  assert.equal(stats.sampleSufficient, true);
});

test('Auction Microstructure: filters by county and state when requested', () => {
  const events = [
    { county: 'Camden', state: 'NJ', outcome: 'sold_third_party' },
    { county: 'Camden', state: 'NJ', outcome: 'postponed' },
    { county: 'Essex', state: 'NJ', outcome: 'sold_plaintiff' },
    { county: 'Harris', state: 'TX', outcome: 'sold_third_party' },
  ];

  const camdenStats = calculateDocketClearingAnalytics(events, { county: 'Camden', state: 'NJ' });
  assert.equal(camdenStats.totalDockets, 2);
  assert.equal(camdenStats.outcomeCounts.sold_third_party, 1);
  assert.equal(camdenStats.outcomeCounts.postponed, 1);
});

test('Auction Microstructure: handles empty or invalid event list gracefully', () => {
  const emptyStats = calculateDocketClearingAnalytics([]);
  assert.equal(emptyStats.totalDockets, 0);
  assert.equal(emptyStats.clearingRate, 0);
  assert.equal(emptyStats.sampleSufficient, false);

  const nullStats = calculateDocketClearingAnalytics(null);
  assert.equal(nullStats.totalDockets, 0);
  assert.equal(nullStats.sampleSufficient, false);
});

test('Auction Microstructure: Proceed Probability adheres to Zero-Fabrication Invariant on missing stats', () => {
  const listing = {
    id: 'listing_nj_1',
    state: 'NJ',
    source: 'civilview',
    priorPostponements: 2,
  };

  // Missing stats -> must return null probability with INSUFFICIENT_DOCKET_HISTORY
  const resultNull = evaluateAuctionProceedProbability(listing, null);
  assert.equal(resultNull.probability, null);
  assert.equal(resultNull.confidence, 'INSUFFICIENT_DOCKET_HISTORY');
  assert.deepEqual(resultNull.factors, []);

  // Empty stats -> must return null probability
  const resultEmpty = evaluateAuctionProceedProbability(listing, { totalDockets: 0 });
  assert.equal(resultEmpty.probability, null);
  assert.equal(resultEmpty.confidence, 'INSUFFICIENT_DOCKET_HISTORY');
});

test('Auction Microstructure: NJ statutory adjournments under N.J.S.A. § 2A:17-36 raise proceed probability when exhausted', () => {
  const countyStats = {
    totalDockets: 60,
    saleRate: 0.50,
    clearingRate: 0.70,
    postponementRate: 0.30,
    stayRate: 0.05,
    sampleSufficient: true,
    outcomeCounts: { sold_plaintiff: 9, sold_third_party: 21 },
  };

  // Debtor has 0 prior postponements (both 14-day statutory adjournments still available)
  const listing0 = {
    state: 'NJ',
    source: 'civilview',
    priorPostponements: 0,
  };
  const prob0 = evaluateAuctionProceedProbability(listing0, countyStats);
  assert.equal(prob0.confidence, 'HIGH');
  assert.ok(prob0.probability < 0.50);
  assert.ok(prob0.factors.some((f) => f.factor === 'NJ_TWO_STATUTORY_ADJOURNMENTS_AVAILABLE'));
  assert.equal(prob0.statutoryContext.priorAdjournmentsUsed, 0);
  assert.equal(prob0.statutoryContext.statutoryStayExhausted, false);

  // Debtor has 2 prior postponements (statutory adjournments exhausted under N.J.S.A. § 2A:17-36)
  const listing2 = {
    state: 'NJ',
    source: 'civilview',
    priorPostponements: 2,
  };
  const prob2 = evaluateAuctionProceedProbability(listing2, countyStats);
  assert.ok(prob2.probability > prob0.probability);
  assert.ok(prob2.factors.some((f) => f.factor === 'NJ_STATUTORY_ADJOURNMENTS_EXHAUSTED'));
  assert.equal(prob2.statutoryContext.priorAdjournmentsUsed, 2);
  assert.equal(prob2.statutoryContext.statutoryStayExhausted, true);
  assert.equal(prob2.statutoryContext.statute, 'N.J.S.A. § 2A:17-36');
});

test('Auction Microstructure: factors in active bankruptcy stay under 11 U.S.C. § 362', () => {
  const countyStats = {
    totalDockets: 40,
    saleRate: 0.60,
    postponementRate: 0.20,
    stayRate: 0.10,
    sampleSufficient: true,
    outcomeCounts: { sold_plaintiff: 8, sold_third_party: 16 },
  };

  const bankruptcyListing = {
    state: 'PA',
    source: 'sheriff',
    bankruptcyStayActive: true,
  };

  const evalResult = evaluateAuctionProceedProbability(bankruptcyListing, countyStats);
  assert.ok(evalResult.probability <= 0.20);
  assert.ok(evalResult.factors.some((f) => f.factor === 'ACTIVE_BANKRUPTCY_STAY'));
});

// ============================================================================
// SUITE 2: MULTI-AUCTION ESCROW & DEPOSIT LOCKUP OPTIMIZER
// ============================================================================

test('Escrow Optimizer: platform deposit rules reflect verified statutory and platform parameters', () => {
  const realAuctionRules = getAuctionDepositRules('realauction');
  assert.equal(realAuctionRules.depositPercent, 0.10);
  assert.equal(realAuctionRules.minimumDeposit, 1000);
  assert.equal(realAuctionRules.paymentMethod, 'wire');
  assert.equal(realAuctionRules.refundTurnaroundDays, 3);

  const bid4assetsRules = getAuctionDepositRules('bid4assets');
  assert.equal(bid4assetsRules.depositPercent, 0.10);
  assert.equal(bid4assetsRules.minimumDeposit, 1500);
  assert.equal(bid4assetsRules.refundTurnaroundDays, 5);

  const txRules = getAuctionDepositRules('texas_tax');
  assert.equal(txRules.depositPercent, 1.00); // 100% full cashier's check at gavel
  assert.equal(txRules.paymentMethod, 'cashiers_check');
  assert.equal(txRules.settlementWindowDays, 0);
  assert.equal(txRules.refundTurnaroundDays, 0);

  const civilviewRules = getAuctionDepositRules('civilview');
  assert.equal(civilviewRules.depositPercent, 0.20); // 20% certified funds
  assert.equal(civilviewRules.paymentMethod, 'certified_funds');
  assert.equal(civilviewRules.settlementWindowDays, 30);
  assert.equal(civilviewRules.refundTurnaroundDays, 0);

  const servicelinkRules = getAuctionDepositRules('servicelink');
  assert.equal(servicelinkRules.depositPercent, 0.05);
  assert.equal(servicelinkRules.minimumDeposit, 2500);
});

test('Escrow Optimizer: calculateRequiredDeposit honors minimum deposit floors and Texas 100% requirement', () => {
  // RealAuction: $5,000 bid * 10% = $500, but minimum floor is $1,000
  const smallRealAuction = calculateRequiredDeposit({
    platform: 'realauction',
    openingBid: 5000,
    saleDate: '2026-11-20T14:00:00Z',
  });
  assert.equal(smallRealAuction.requiredDeposit, 1000);
  assert.equal(smallRealAuction.basis, 'minimum_floor');
  assert.ok(smallRealAuction.depositDeadline.includes('2026-11-19')); // 24 hours prior

  // RealAuction: $100,000 bid * 10% = $10,000 (> floor)
  const largeRealAuction = calculateRequiredDeposit({
    platform: 'realauction',
    openingBid: 100000,
  });
  assert.equal(largeRealAuction.requiredDeposit, 10000);
  assert.equal(largeRealAuction.basis, 'percentage');

  // ServiceLink: $20,000 bid * 5% = $1,000, but floor is $2,500
  const slAuction = calculateRequiredDeposit({
    platform: 'servicelink',
    openingBid: 20000,
  });
  assert.equal(slAuction.requiredDeposit, 2500);
  assert.equal(slAuction.basis, 'minimum_floor');

  // Texas Tax Sale: 100% full cashier check required
  const txAuction = calculateRequiredDeposit({
    state: 'TX',
    source: 'texas_tax',
    openingBid: 75000,
  });
  assert.equal(txAuction.requiredDeposit, 75000);
  assert.equal(txAuction.depositPercent, 1.00);
  assert.equal(txAuction.basis, 'full_cash');
});

test('Escrow Optimizer: optimizeEscrowAllocation recycles capital across staggered non-overlapping auctions', () => {
  // Staggered auctions spaced 10 days apart (well beyond refund turnaround of 3-5 days)
  // Total available capital: $15,000
  const staggeredAuctions = [
    {
      id: 'auction_A',
      platform: 'realauction',
      openingBid: 100000, // deposit: $10,000
      saleDate: '2026-11-01T14:00:00Z',
      dealScore: 90,
    },
    {
      id: 'auction_B',
      platform: 'realauction',
      openingBid: 120000, // deposit: $12,000
      saleDate: '2026-11-15T14:00:00Z', // 14 days later: Auction A funds refunded by Nov 4
      dealScore: 85,
    },
  ];

  const plan = optimizeEscrowAllocation(staggeredAuctions, 15000);

  // Both auctions can be funded because deposit from Auction A is recycled before Auction B
  assert.equal(plan.fundedAuctionCount, 2);
  assert.equal(plan.dateConflicts.length, 0);
  assert.equal(plan.totalCommittedCapital, 12000); // peak committed is max(10000, 12000)
  assert.equal(plan.maximumExecutableBiddingPower, 220000); // $100k + $120k bidding power
  assert.ok(plan.capitalEfficiencyRatio > 14); // 220,000 / 15,000 = 14.67x efficiency
});

test('Escrow Optimizer: identifies date conflicts and capital shortfalls on overlapping auction deposit deadlines', () => {
  // Overlapping auctions on the same or adjacent days:
  // Total capital: $15,000
  // Auction 1 requires $10,000 deposit on Nov 10 (refund Nov 15)
  // Auction 2 requires $10,000 deposit on Nov 11 (Auction 1 funds NOT yet returned!)
  // Total simultaneous capital needed: $20,000 > $15,000 capital -> Conflict!
  const overlappingAuctions = [
    {
      id: 'auction_1_bid4assets',
      platform: 'bid4assets',
      openingBid: 100000, // deposit: $10,000
      saleDate: '2026-11-10T14:00:00Z',
      dealScore: 92,
    },
    {
      id: 'auction_2_realauction',
      platform: 'realauction',
      openingBid: 100000, // deposit: $10,000
      saleDate: '2026-11-11T14:00:00Z',
      dealScore: 78,
    },
  ];

  const plan = optimizeEscrowAllocation(overlappingAuctions, 15000);

  assert.equal(plan.fundedAuctionCount, 1);
  assert.equal(plan.excludedAuctionCount, 1);
  assert.equal(plan.dateConflicts.length, 1);

  const conflict = plan.dateConflicts[0];
  assert.equal(conflict.candidateAuction, 'auction_2_realauction');
  assert.ok(conflict.conflictingAuctions.includes('auction_1_bid4assets'));
  assert.equal(conflict.totalNeeded, 20000);
  assert.equal(conflict.shortfall, 5000);

  const excluded = plan.allocatedAuctions.find((a) => a.id === 'auction_2_realauction');
  assert.equal(excluded.status, 'EXCLUDED_DATE_CONFLICT');
});

test('Escrow Optimizer: continuous peak timeline allows non-overlapping sequential auctions to fund within capital limit', () => {
  // Auction 1: Days 1-3 ($10,000 deposit)
  // Auction 2: Days 8-11 ($10,000 deposit)
  // Total capital $15,000. Under continuous peak evaluation, both should be funded because at no point in time does deposit exceed $10,000.
  const auctions = [
    {
      id: 'auction_early',
      platform: 'realauction',
      openingBid: 100000, // deposit: $10,000
      saleDate: '2026-11-02T14:00:00Z',
      dealScore: 90,
    },
    {
      id: 'auction_later',
      platform: 'realauction',
      openingBid: 100000, // deposit: $10,000
      saleDate: '2026-11-12T14:00:00Z',
      dealScore: 85,
    },
  ];

  const plan = optimizeEscrowAllocation(auctions, 15000);
  assert.equal(plan.fundedAuctionCount, 2);
  assert.equal(plan.dateConflicts.length, 0);
  assert.equal(plan.totalCommittedCapital, 10000);
});

// ============================================================================
// SUITE 3: DUAL-OUTCOME PENALTY REDEMPTION VS. ACQUISITION EXPECTED VALUE
// ============================================================================

test('Redemption EV: strictly enforces Zero-Fabrication Invariant when assumedArv is missing', () => {
  const result = computeRedemptionExpectedValue({
    winningBid: 50000,
    stateCode: 'TX',
    redemptionProbability: 0.80,
    // assumedArv omitted
  });

  assert.equal(result.status, 'unbenchmarked_arv');
  assert.equal(result.arvSupplied, false);
  assert.equal(result.assumedArv, null);
  assert.equal(result.acquisitionPayoff, null);
  assert.equal(result.netAcquisitionProfit, null);
  assert.equal(result.expectedNetProfit, null);
  assert.equal(result.expectedEv, null);
  assert.equal(result.blendedIrr, null);
  assert.equal(result.breakEvenRedemptionProbability, null);
  assert.deepEqual(result.missingInputs, ['assumedArv']);

  // Redemption scenario is still calculated accurately from statute
  assert.equal(result.scenarioRedemption.grossProceeds, 62500); // $50k * 1.25
  assert.equal(result.scenarioRedemption.netProfit, 12500);
});

test('Redemption EV: Texas non-homestead 25% flat penalty vs. homestead 2-year 50% penalty', () => {
  // Texas Non-Homestead: 25% flat under Tex. Tax Code § 34.21(e)
  const txNonHomestead = computeRedemptionExpectedValue({
    winningBid: 100000,
    assumedArv: 200000,
    redemptionProbability: 0.70,
    stateCode: 'TX',
    isHomestead: false,
    expectedHoldingMonths: 6,
    quietTitleEstimate: 3000,
    holdingCostsMonthly: 200,
  });

  assert.equal(txNonHomestead.status, 'benchmarked');
  assert.equal(txNonHomestead.statutoryRatePct, 25);
  assert.equal(txNonHomestead.scenarioRedemption.grossProceeds, 125000);
  assert.equal(txNonHomestead.scenarioRedemption.netProfit, 25000);

  // Total holding cost = 6 * 200 = 1200
  // Net acquisition payoff = 200000 - 3000 - 1200 = 195800
  // Net acquisition profit = 195800 - 100000 = 95800
  assert.equal(txNonHomestead.scenarioAcquisition.totalHoldingCosts, 1200);
  assert.equal(txNonHomestead.scenarioAcquisition.netProfit, 95800);

  // Expected net profit = (0.70 * 25000) + (0.30 * 95800) = 17500 + 28740 = 46240
  assert.equal(txNonHomestead.expectedNetProfit, 46240);
  assert.ok(txNonHomestead.statutoryCitation.includes('Tex. Tax Code § 34.21(e)'));

  // Texas Homestead Year 2: 50% penalty under Tex. Tax Code § 34.21(a)
  const txHomesteadYr2 = computeRedemptionExpectedValue({
    winningBid: 100000,
    assumedArv: 250000,
    redemptionProbability: 0.60,
    stateCode: 'TX',
    isHomestead: true,
    expectedHoldingMonths: 24, // 2nd year
  });

  assert.equal(txHomesteadYr2.statutoryRatePct, 50);
  assert.equal(txHomesteadYr2.scenarioRedemption.grossProceeds, 150000);
  assert.equal(txHomesteadYr2.scenarioRedemption.netProfit, 50000);
  assert.ok(txHomesteadYr2.statutoryCitation.includes('Tex. Tax Code § 34.21(a)'));
});

test('Redemption EV: Georgia 20% year 1, South Carolina tiered quarterly, and Iowa 2% monthly', () => {
  // Georgia 20% under O.C.G.A. § 48-4-42
  const gaResult = computeRedemptionExpectedValue({
    winningBid: 40000,
    assumedArv: 90000,
    redemptionProbability: 0.50,
    stateCode: 'GA',
    expectedHoldingMonths: 12,
  });
  assert.equal(gaResult.statutoryRatePct, 20);
  assert.equal(gaResult.scenarioRedemption.netProfit, 8000);
  assert.ok(gaResult.statutoryCitation.includes('O.C.G.A. § 48-4-42'));

  // South Carolina Q2 tiered penalty (6% for 6 months) under S.C. Code Ann. § 12-51-90
  const scResult = computeRedemptionExpectedValue({
    winningBid: 50000,
    assumedArv: 110000,
    redemptionProbability: 0.40,
    stateCode: 'SC',
    expectedHoldingMonths: 6,
  });
  assert.equal(scResult.statutoryRatePct, 6);
  assert.equal(scResult.scenarioRedemption.netProfit, 3000);
  assert.ok(scResult.statutoryCitation.includes('S.C. Code Ann. § 12-51-90'));

  // Iowa 2% per month (24% per year) under Iowa Code § 447.1
  const iaResult = computeRedemptionExpectedValue({
    winningBid: 30000,
    assumedArv: 80000,
    redemptionProbability: 0.85,
    stateCode: 'IA',
    expectedHoldingMonths: 12, // 12 * 2% = 24%
  });
  assert.equal(iaResult.statutoryRatePct, 24);
  assert.equal(iaResult.scenarioRedemption.netProfit, 7200); // 30000 * 0.24
  assert.ok(iaResult.statutoryCitation.includes('Iowa Code § 447.1'));

  // Tennessee 12% per annum simple interest under T.C.A. § 67-5-2701
  const tnResult = computeRedemptionExpectedValue({
    winningBid: 60000,
    assumedArv: 120000,
    redemptionProbability: 0.50,
    stateCode: 'TN',
    expectedHoldingMonths: 12,
  });
  assert.equal(tnResult.statutoryRatePct, 12);
  assert.equal(tnResult.scenarioRedemption.netProfit, 7200);
  assert.ok(tnResult.statutoryCitation.includes('T.C.A. § 67-5-2701'));
});

// ============================================================================
// SUITE 4: EXCESS PROCEEDS WATERFALL UNDER TYLER V. HENNEPIN COUNTY (2023)
// ============================================================================

test('Surplus Waterfall: classifies recorded liens into proper statutory tiers', () => {
  assert.equal(classifyLienTier({ type: 'municipal_water_utility' }), WATERFALL_TIERS.TIER_2_SUPER_PRIORITY_MUNICIPAL);
  assert.equal(classifyLienTier({ type: 'city_demolition_lien' }), WATERFALL_TIERS.TIER_2_SUPER_PRIORITY_MUNICIPAL);
  assert.equal(classifyLienTier({ type: 'first_mortgage' }), WATERFALL_TIERS.TIER_3_JUNIOR_MORTGAGES);
  assert.equal(classifyLienTier({ type: 'deed_of_trust' }), WATERFALL_TIERS.TIER_3_JUNIOR_MORTGAGES);
  assert.equal(classifyLienTier({ type: 'heloc' }), WATERFALL_TIERS.TIER_3_JUNIOR_MORTGAGES);
  assert.equal(classifyLienTier({ type: 'mechanics_lien' }), WATERFALL_TIERS.TIER_4_JUDGMENTS_AND_MECHANICS);
  assert.equal(classifyLienTier({ type: 'judgment_creditor' }), WATERFALL_TIERS.TIER_4_JUDGMENTS_AND_MECHANICS);
  assert.equal(classifyLienTier({ type: 'hoa_assessment_lien' }), WATERFALL_TIERS.TIER_4_JUDGMENTS_AND_MECHANICS);
});

test('Surplus Waterfall: handles deficient auction where winning bid is less than adjudged debt', () => {
  const result = calculateSurplusEquityWaterfall({
    winningBid: 40000,
    totalAdjudgedDebt: 50000,
    recordedLiens: [
      { id: 'lien_1', amount: 15000, type: 'second_mortgage' },
    ],
  });

  assert.equal(result.winningBid, 40000);
  assert.equal(result.totalAdjudgedDebt, 50000);
  assert.equal(result.grossSurplus, 0);
  assert.equal(result.surplusGenerated, false);
  assert.equal(result.adjudgedDebtSatisfied, 40000);
  assert.equal(result.deficiencyAmount, 10000);
  assert.equal(result.allocatedJuniorClaims, 0);
  assert.equal(result.formerOwnerEquity, 0);
  assert.equal(result.uncoveredClaims, 15000);

  const tier1 = result.ledger.find((l) => l.tier === WATERFALL_TIERS.TIER_1_ADJUDGED_DEBT);
  assert.equal(tier1.status, 'PARTIAL');
  assert.equal(tier1.remainingUnpaid, 10000);
});

test('Surplus Waterfall: passes entire gross surplus to former owner when no junior liens exist under Tyler v. Hennepin County', () => {
  const result = calculateSurplusEquityWaterfall({
    winningBid: 140000,
    totalAdjudgedDebt: 25000,
    recordedLiens: [],
  });

  assert.equal(result.grossSurplus, 115000); // 140,000 - 25,000
  assert.equal(result.surplusGenerated, true);
  assert.equal(result.allocatedJuniorClaims, 0);
  assert.equal(result.formerOwnerEquity, 115000);
  assert.equal(result.uncoveredClaims, 0);

  const ownerTier = result.ledger.find((l) => l.tier === WATERFALL_TIERS.TIER_5_FORMER_OWNER_EQUITY);
  assert.equal(ownerTier.status, 'FULL');
  assert.equal(ownerTier.paidAmount, 115000);
  assert.ok(ownerTier.statuteOrBasis.includes('Tyler v. Hennepin County, 598 U.S. 631 (2023)'));
  assert.equal(result.constitutionalBasis.landmarkCase, 'Tyler v. Hennepin County, 598 U.S. 631 (2023)');
});

test('Surplus Waterfall: executes comprehensive 5-tier allocation with partial satisfaction and owner equity', () => {
  // Auction scenario:
  // Winning bid: $200,000
  // Tier 1 Adjudged debt: $30,000
  // Gross Surplus: $170,000
  // Tier 2 Super-priority municipal lien: $10,000 (leaves $160,000)
  // Tier 3 Junior Mortgage A: $70,000 (leaves $90,000)
  // Tier 3 Junior Mortgage B: $50,000 (leaves $40,000)
  // Tier 4 Mechanics Lien: $15,000 (leaves $25,000)
  // Tier 5 Former Owner Equity: $25,000
  const recordedLiens = [
    { id: 'muni_1', claimant: 'City of Newark Water Dept', amount: 10000, type: 'municipal' },
    { id: 'mtg_1', claimant: 'Wells Fargo Bank (Senior Junior Deed)', amount: 70000, type: 'mortgage', priority: 1 },
    { id: 'mtg_2', claimant: 'Discover Home Equity (2nd Deed)', amount: 50000, type: 'heloc', priority: 2 },
    { id: 'mech_1', claimant: 'Jersey Paving Co', amount: 15000, type: 'mechanics_lien' },
  ];

  const result = calculateSurplusEquityWaterfall({
    winningBid: 200000,
    totalAdjudgedDebt: 30000,
    recordedLiens,
    options: {
      formerOwnerName: 'Estate of Geraldine Tyler',
    },
  });

  assert.equal(result.winningBid, 200000);
  assert.equal(result.grossSurplus, 170000);
  assert.equal(result.adjudgedDebtSatisfied, 30000);
  assert.equal(result.allocatedJuniorClaims, 145000); // 10k + 70k + 50k + 15k
  assert.equal(result.formerOwnerEquity, 25000); // 170k - 145k = 25k
  assert.equal(result.uncoveredClaims, 0);
  assert.equal(result.totalClaimsSatisfied, 200000);

  // Verify ledger ordering and payment status
  const ledger = result.ledger;
  assert.equal(ledger.length, 6); // Tier 1 (1) + Tier 2 (1) + Tier 3 (2) + Tier 4 (1) + Tier 5 (1)
  assert.equal(ledger[0].tier, WATERFALL_TIERS.TIER_1_ADJUDGED_DEBT);
  assert.equal(ledger[0].status, 'FULL');
  assert.equal(ledger[1].tier, WATERFALL_TIERS.TIER_2_SUPER_PRIORITY_MUNICIPAL);
  assert.equal(ledger[1].paidAmount, 10000);
  assert.equal(ledger[2].tier, WATERFALL_TIERS.TIER_3_JUNIOR_MORTGAGES);
  assert.equal(ledger[2].paidAmount, 70000);
  assert.equal(ledger[3].tier, WATERFALL_TIERS.TIER_3_JUNIOR_MORTGAGES);
  assert.equal(ledger[3].paidAmount, 50000);
  assert.equal(ledger[4].tier, WATERFALL_TIERS.TIER_4_JUDGMENTS_AND_MECHANICS);
  assert.equal(ledger[4].paidAmount, 15000);
  assert.equal(ledger[5].tier, WATERFALL_TIERS.TIER_5_FORMER_OWNER_EQUITY);
  assert.equal(ledger[5].claimant, 'Estate of Geraldine Tyler');
  assert.equal(ledger[5].paidAmount, 25000);
});

test('Surplus Waterfall: exhausts surplus with partial satisfaction of junior lien and zero former owner equity', () => {
  // Winning bid: $100,000
  // Tier 1 Adjudged debt: $40,000 -> Surplus = $60,000
  // Junior mortgage: $80,000
  // Only $60,000 available -> Junior mortgage partially paid $60k, $20k uncovered, Owner receives $0
  const result = calculateSurplusEquityWaterfall({
    winningBid: 100000,
    totalAdjudgedDebt: 40000,
    recordedLiens: [
      { id: 'mtg_large', claimant: 'Chase Mortgage', amount: 80000, type: 'first_mortgage' },
    ],
  });

  assert.equal(result.grossSurplus, 60000);
  assert.equal(result.allocatedJuniorClaims, 60000);
  assert.equal(result.formerOwnerEquity, 0);
  assert.equal(result.uncoveredClaims, 20000);

  const mtgEntry = result.ledger.find((l) => l.claimant === 'Chase Mortgage');
  assert.equal(mtgEntry.paidAmount, 60000);
  assert.equal(mtgEntry.remainingUnpaid, 20000);
  assert.equal(mtgEntry.status, 'PARTIAL');

  const ownerEntry = result.ledger.find((l) => l.tier === WATERFALL_TIERS.TIER_5_FORMER_OWNER_EQUITY);
  assert.equal(ownerEntry.paidAmount, 0);
  assert.equal(ownerEntry.status, 'UNPAID');
});
