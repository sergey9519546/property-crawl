import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  computeCashToClose,
  computeTargetPriceScenario,
  computeCreMetrics,
  parseRentRollSchedule,
  computeStatutoryFeePreset,
  computeStatutoryDeadlinesAndCarry,
  computeLienWaterfall,
  computeConstitutionalSurplus,
  computeReassessmentShock,
  computeDscrCoverage,
  classifyInvestmentStrategies,
  computeRedemptionYield,
} from '../src/lib/underwriting.ts';

import { evaluateAdversarialDocket } from '../src/lib/adversarial-docket.ts';
import { calculateSurplusEquityWaterfall } from '../server/intelligence/surplus-waterfall.js';
import { computeRedemptionExpectedValue } from '../src/lib/redemption-ev.ts';

test('1. Zero-Fabrication: openingBid null vs 0 edge cases', () => {
  // Case A: openingBid is null
  const cashNull = computeCashToClose({ openingBid: null });
  assert.equal(cashNull.openingBid, null);
  assert.equal(cashNull.purchasePrice, null);
  assert.equal(cashNull.totalAcquisitionCost, null);
  assert.ok(cashNull.missingAcquisitionInputs.includes('purchasePrice'));
  assert.equal(cashNull.modelStatus, 'insufficient_inputs');

  // Case B: openingBid is 0
  const cashZero = computeCashToClose({ openingBid: 0 });
  assert.equal(cashZero.openingBid, null, 'openingBid 0 must not be treated as a positive bid amount');
  assert.equal(cashZero.purchasePrice, null);
  assert.equal(cashZero.totalAcquisitionCost, null);
  assert.ok(cashZero.missingAcquisitionInputs.includes('purchasePrice'));

  // Case C: openingBid is negative
  const cashNeg = computeCashToClose({ openingBid: -5000 });
  assert.equal(cashNeg.openingBid, null);
  assert.equal(cashNeg.purchasePrice, null);

  // Case D: string openingBid '$0' and '$125,000'
  const cashStrZero = computeCashToClose({ openingBid: '$0' });
  assert.equal(cashStrZero.openingBid, null);
  const cashStrVal = computeCashToClose({ openingBid: '$125,000' });
  assert.equal(cashStrVal.openingBid, 125000);
  assert.equal(cashStrVal.purchasePrice, 125000);

  // Case E: target price scenario with openingBid 0
  const targetZero = computeTargetPriceScenario({
    estimatedValue: 200000,
    targetMarginPct: 30,
    rehabBudget: 25000,
    currentPrice: 0,
    otherAcquisitionCosts: 0,
  });
  assert.equal(targetZero, null, 'Target price scenario with currentPrice 0 must return null');

  // Case F: target price scenario with openingBid null
  const targetNull = computeTargetPriceScenario({
    estimatedValue: 200000,
    targetMarginPct: 30,
    rehabBudget: 25000,
    currentPrice: null,
    otherAcquisitionCosts: 0,
  });
  assert.equal(targetNull, null);
});

test('1. Zero-Fabrication: Custom ARV vs blank ARV and MAO withholding', () => {
  // Blank ARV (null)
  const targetBlankArv = computeTargetPriceScenario({
    estimatedValue: null,
    targetMarginPct: 30,
    rehabBudget: 25000,
    currentPrice: 100000,
    otherAcquisitionCosts: 5000,
  });
  assert.equal(targetBlankArv, null, 'MAO scenario must be strictly withheld when ARV is blank');

  // Negative or 0 ARV
  const targetZeroArv = computeTargetPriceScenario({
    estimatedValue: 0,
    targetMarginPct: 30,
    rehabBudget: 25000,
    currentPrice: 100000,
    otherAcquisitionCosts: 5000,
  });
  assert.equal(targetZeroArv, null, 'MAO scenario must be strictly withheld when ARV is 0');

  // Valid Custom ARV
  const targetCustomArv = computeTargetPriceScenario({
    estimatedValue: 200000,
    targetMarginPct: 30,
    rehabBudget: 25000,
    currentPrice: 100000,
    otherAcquisitionCosts: 5000,
  });
  assert.ok(targetCustomArv !== null);
  // targetProfit = 200,000 * 0.30 = 60,000
  // availableAcquisitionBudget = 200,000 - 60,000 - 25,000 = 115,000
  // maxPurchasePrice = 115,000 - 5,000 = 110,000
  // priceReductionNeeded = max(0, 100,000 - 110,000) = 0
  assert.equal(targetCustomArv.targetProfit, 60000);
  assert.equal(targetCustomArv.maxPurchasePrice, 110000);
  assert.equal(targetCustomArv.priceReductionNeeded, 0);
  assert.equal(targetCustomArv.targetAchievableAtCurrentPrice, true);

  // Unresolved acquisition costs with valid ARV
  const targetUnresolvedCosts = computeTargetPriceScenario({
    estimatedValue: 200000,
    targetMarginPct: 30,
    rehabBudget: 25000,
    currentPrice: 100000,
    otherAcquisitionCosts: null,
  });
  assert.equal(targetUnresolvedCosts, null, 'MAO scenario must be withheld when otherAcquisitionCosts is null');
});

test('1. Zero-Fabrication: Commercial NOI & Cap Rate buyer-supplied invariant', () => {
  // If expenseRatio is omitted / undefined
  const noExpense = computeCreMetrics({
    sqft: 10000,
    openingBid: 500000,
    marketRentPerSqftAnnual: 25,
    vacancyRate: 0.05,
    annualDebtService: 35000,
    targetCapitalizationRate: 0.08,
  });
  assert.equal(noExpense, null, 'Must return null when expenseRatio is not supplied');

  // If rent per sqft is omitted
  const noRent = computeCreMetrics({
    sqft: 10000,
    openingBid: 500000,
    expenseRatio: 0.40,
    vacancyRate: 0.05,
    annualDebtService: 35000,
    targetCapitalizationRate: 0.08,
  });
  assert.equal(noRent, null, 'Must return null when rent per sqft is not supplied');

  // If annualDebtService is omitted
  const noDebt = computeCreMetrics({
    sqft: 10000,
    openingBid: 500000,
    marketRentPerSqftAnnual: 25,
    expenseRatio: 0.40,
    vacancyRate: 0.05,
    targetCapitalizationRate: 0.08,
  });
  assert.equal(noDebt, null, 'Must return null when annual debt service is not supplied');

  // Complete explicit scenario
  const completeCre = computeCreMetrics({
    sqft: 10000,
    openingBid: 500000,
    marketRentPerSqftAnnual: 20, // Gross Potential = 200,000
    vacancyRate: 0.10, // EGI = 180,000
    expenseRatio: 0.40, // OpEx = 72,000 -> NOI = 108,000
    annualDebtService: 60000, // DSCR = 108,000 / 60,000 = 1.80x
    targetCapitalizationRate: 0.09, // MAO = 108,000 / 0.09 = 1,200,000
  });
  assert.ok(completeCre !== null);
  assert.equal(completeCre.grossPotentialRent, 200000);
  assert.equal(completeCre.effectiveGrossIncome, 180000);
  assert.equal(completeCre.operatingExpenses, 72000);
  assert.equal(completeCre.netOperatingIncome, 108000);
  assert.equal(completeCre.capitalizationRate, 21.6); // 108,000 / 500,000 * 100
  assert.equal(completeCre.estimatedDscr, 1.8);
  assert.equal(completeCre.maxAllowableOffer, 1200000);
});

test('2. Adversarial Title Trial Docket: HOA super-liens, IRS 7425, PTFA 90-day', () => {
  // A. Nevada NRS 116.3116 True Super-Priority (extinguishes first deed of trust)
  const nvHoaListing = {
    id: 'nv_hoa_001',
    state: 'NV',
    county: 'Clark',
    plaintiff: 'Summerlin North Community Association',
    openingBid: 15000,
  };
  const nvDocket = evaluateAdversarialDocket(nvHoaListing);
  const nvSenior = nvDocket.prosecutionPoints.find(p => p.id === 'prosecution-1-senior-lien');
  assert.ok(nvSenior);
  assert.equal(nvSenior.isFatal, false, 'Nevada HOA super-priority is NOT fatal to buyer because it primes senior mtg');
  assert.equal(nvSenior.status, 'caution');
  assert.ok(nvSenior.statute.includes('NRS 116.3116'));
  assert.ok(nvSenior.statute.includes('SFR Investments Pool 1'));
  assert.ok(nvSenior.finding.includes('EXTINGUISHES prior first mortgage'));

  // B. Florida HOA Foreclosure (Fatal title trap for buyer)
  const flHoaListing = {
    id: 'fl_hoa_002',
    state: 'FL',
    county: 'Orange',
    plaintiff: 'Windermere HOA Inc.',
    openingBid: 12000,
  };
  const flDocket = evaluateAdversarialDocket(flHoaListing);
  const flSenior = flDocket.prosecutionPoints.find(p => p.id === 'prosecution-1-senior-lien');
  assert.ok(flSenior);
  assert.equal(flSenior.isFatal, true, 'Florida HOA foreclosure is fatal deal-killer (1st mortgage survives)');
  assert.equal(flSenior.status, 'disqualified');
  assert.ok(flSenior.statute.includes('Fla. Stat. § 718.116 / § 720.3085'));
  assert.ok(flSenior.finding.includes('FATAL TITLE TRAP'));
  assert.equal(flDocket.verdict, 'fatal');
  assert.equal(flDocket.recommendedDecision, 'pass');

  // C. Colorado HOA Foreclosure (6-month super-priority does NOT extinguish 1st mortgage on HOA sale)
  const coHoaListing = {
    id: 'co_hoa_003',
    state: 'CO',
    county: 'Denver',
    plaintiff: 'Highland Condominium Association',
    openingBid: 8000,
  };
  const coDocket = evaluateAdversarialDocket(coHoaListing);
  const coSenior = coDocket.prosecutionPoints.find(p => p.id === 'prosecution-1-senior-lien');
  assert.equal(coSenior.isFatal, true);
  assert.ok(coSenior.statute.includes('C.R.S. § 38-33.3-316'));

  // D. IRS 120-Day Statutory Redemption under 26 U.S.C. § 7425
  const irsListing = {
    id: 'irs_004',
    state: 'OH',
    county: 'Franklin',
    plaintiff: 'PNC Bank, National Association',
    notes: 'Federal tax lien filed under 26 U.S.C. § 7425',
    openingBid: 140000,
  };
  const irsDocket = evaluateAdversarialDocket(irsListing);
  const irsPoint = irsDocket.prosecutionPoints.find(p => p.id === 'prosecution-2-irs-lien');
  assert.ok(irsPoint);
  assert.equal(irsPoint.status, 'caution');
  assert.ok(irsPoint.statute.includes('26 U.S.C. § 7425(d)'));
  assert.ok(irsPoint.finding.includes('120-day federal redemption'));
  assert.ok(irsDocket.statutoryCarryDays >= 120);

  // E. PTFA Tenant Holdover (12 U.S.C. § 5220)
  const ptfaListing = {
    id: 'ptfa_005',
    state: 'CA',
    county: 'Alameda',
    plaintiff: 'Bank of America',
    occupancy: 'Tenant Occupied',
    openingBid: 450000,
  };
  const ptfaDocket = evaluateAdversarialDocket(ptfaListing);
  const ptfaPoint = ptfaDocket.prosecutionPoints.find(p => p.id === 'prosecution-5-ptfa-occupancy');
  assert.ok(ptfaPoint);
  assert.equal(ptfaPoint.status, 'caution');
  assert.ok(ptfaPoint.statute.includes('12 U.S.C. § 5220 (PTFA)'));
  assert.ok(ptfaPoint.finding.includes('90-day notice'));
  assert.ok(ptfaDocket.statutoryCarryDays >= 60); // CA maxDays is 60
});

test('3. Tyler v. Hennepin County Excess Proceeds Waterfall', () => {
  // Test 1: Zero surplus (winning bid <= adjudged debt)
  const underwater = calculateSurplusEquityWaterfall({
    winningBid: 50000,
    totalAdjudgedDebt: 65000,
    recordedLiens: [
      { id: 'mtg2', type: 'second_mortgage', amount: 20000 },
      { id: 'mun', type: 'municipal_water', amount: 3000 },
    ],
  });
  assert.equal(underwater.grossSurplus, 0);
  assert.equal(underwater.surplusGenerated, false);
  assert.equal(underwater.adjudgedDebtSatisfied, 50000);
  assert.equal(underwater.deficiencyAmount, 15000);
  assert.equal(underwater.formerOwnerEquity, 0);
  assert.equal(underwater.totalClaimsSatisfied, 50000);
  assert.equal(underwater.ledger[0].status, 'PARTIAL');
  assert.equal(underwater.ledger[1].paidAmount, 0);
  assert.equal(underwater.ledger[1].status, 'UNPAID');

  // Test 2: Full 5-tier waterfall with junior mortgage extinguishment and owner residual
  const fullWaterfall = calculateSurplusEquityWaterfall({
    winningBid: 250000,
    totalAdjudgedDebt: 100000,
    recordedLiens: [
      { id: 'lien_hoa', type: 'hoa_assessment', amount: 5000, priority: 10 },
      { id: 'lien_mtg2', type: 'second_mortgage', amount: 60000, priority: 5 },
      { id: 'lien_water', type: 'municipal_water', amount: 4000, priority: 1 },
      { id: 'lien_mech', type: 'mechanics_lien', amount: 15000, priority: 20 },
    ],
    options: { formerOwnerName: 'Geraldine Tyler' },
  });

  // Gavel = 250,000. Debt = 100,000. Gross Surplus = 150,000.
  assert.equal(fullWaterfall.grossSurplus, 150000);
  assert.equal(fullWaterfall.surplusGenerated, true);
  assert.equal(fullWaterfall.adjudgedDebtSatisfied, 100000);
  assert.equal(fullWaterfall.deficiencyAmount, 0);

  // Tier 2: Municipal Water ($4,000) -> Paid $4,000, Surplus left = 146,000
  // Tier 3: Second Mortgage ($60,000) -> Paid $60,000, Surplus left = 86,000
  // Tier 4: HOA ($5,000) + Mechanics ($15,000) = $20,000 -> Paid $20,000, Surplus left = 66,000
  // Tier 5: Former Owner -> Paid $66,000
  assert.equal(fullWaterfall.allocatedJuniorClaims, 84000); // 4000 + 60000 + 5000 + 15000
  assert.equal(fullWaterfall.formerOwnerEquity, 66000);
  assert.equal(fullWaterfall.uncoveredClaims, 0);
  assert.equal(fullWaterfall.totalClaimsSatisfied, 250000, 'Sum of all satisfied claims must exactly equal winning bid');

  // Test 3: Partial junior mortgage satisfaction (junior extinguished without owner surplus)
  const partialJunior = calculateSurplusEquityWaterfall({
    winningBid: 120000,
    totalAdjudgedDebt: 80000, // surplus = 40,000
    recordedLiens: [
      { id: 'lien_mtg2', type: 'second_mortgage', amount: 70000 },
    ],
  });
  assert.equal(partialJunior.grossSurplus, 40000);
  assert.equal(partialJunior.allocatedJuniorClaims, 40000);
  assert.equal(partialJunior.formerOwnerEquity, 0);
  assert.equal(partialJunior.uncoveredClaims, 30000);
  assert.equal(partialJunior.totalClaimsSatisfied, 120000);
  const mtg2Item = partialJunior.ledger.find(i => i.tier === 3);
  assert.equal(mtg2Item.paidAmount, 40000);
  assert.equal(mtg2Item.remainingUnpaid, 30000);
  assert.equal(mtg2Item.status, 'PARTIAL');
});

test('4. Dual-Outcome Redemption EV: Texas 25%/50% penalty vs deed acquisition EV', () => {
  // Case A: Texas Non-Homestead (180 days / 6 months, 25% flat statutory penalty)
  const txNonHomestead = computeRedemptionExpectedValue({
    winningBid: 100000,
    assumedArv: 180000,
    redemptionProbability: 0.70,
    stateCode: 'TX',
    isHomestead: false,
    quietTitleEstimate: 3500,
    holdingCostsMonthly: 500,
  });
  assert.equal(txNonHomestead.status, 'benchmarked');
  assert.equal(txNonHomestead.statutoryRatePct, 25);
  assert.equal(txNonHomestead.expectedHoldingMonths, 6);
  // Scenario A (Redeem):
  // Penalty = 100,000 * 25% = 25,000
  // Net Redeem Profit = 25,000
  assert.equal(txNonHomestead.scenarioRedemption.penaltyOrInterestAmount, 25000);
  assert.equal(txNonHomestead.scenarioRedemption.netProfit, 25000);
  assert.equal(txNonHomestead.scenarioRedemption.roiPct, 25);
  // Scenario B (Acquire):
  // Holding cost = 500 * 6 = 3,000
  // Quiet title = 3,500
  // Acquisition cost = 100,000 + 3,500 + 3,000 = 106,500
  // Net acquire profit = 180,000 - 106,500 = 73,500
  assert.equal(txNonHomestead.scenarioAcquisition.totalHoldingCosts, 3000);
  assert.equal(txNonHomestead.scenarioAcquisition.netAcquisitionCost, 106500);
  assert.equal(txNonHomestead.scenarioAcquisition.netProfit, 73500);
  // Expected Net Profit = 0.70 * 25,000 + 0.30 * 73,500 = 17,500 + 22,050 = 39,550
  assert.equal(txNonHomestead.expectedNetProfit, 39550);
  assert.ok(txNonHomestead.blendedIrr !== null && txNonHomestead.blendedIrr > 0);

  // Case B: Texas Homestead Year 1 (holdingMonths <= 12, 25% penalty)
  const txHomesteadYr1 = computeRedemptionExpectedValue({
    winningBid: 100000,
    assumedArv: 200000,
    redemptionProbability: 0.80,
    stateCode: 'TX',
    isHomestead: true,
    expectedHoldingMonths: 10,
  });
  assert.equal(txHomesteadYr1.statutoryRatePct, 25);
  assert.equal(txHomesteadYr1.scenarioRedemption.penaltyOrInterestAmount, 25000);

  // Case C: Texas Homestead Year 2 (holdingMonths > 12, 50% penalty!)
  const txHomesteadYr2 = computeRedemptionExpectedValue({
    winningBid: 100000,
    assumedArv: 200000,
    redemptionProbability: 0.80,
    stateCode: 'TX',
    isHomestead: true,
    expectedHoldingMonths: 18,
  });
  assert.equal(txHomesteadYr2.statutoryRatePct, 50);
  assert.equal(txHomesteadYr2.scenarioRedemption.penaltyOrInterestAmount, 50000);
  assert.ok(txHomesteadYr2.statutoryCitation.includes('50% statutory penalty in year two'));

  // Case D: Zero-Fabrication Invariant: ARV missing / unbenchmarked
  const txNoArv = computeRedemptionExpectedValue({
    winningBid: 100000,
    assumedArv: null,
    redemptionProbability: 0.75,
    stateCode: 'TX',
    isHomestead: false,
  });
  assert.equal(txNoArv.status, 'unbenchmarked_arv');
  assert.equal(txNoArv.arvSupplied, false);
  assert.equal(txNoArv.scenarioAcquisition.netProfit, null);
  assert.equal(txNoArv.expectedNetProfit, null);
  assert.equal(txNoArv.expectedEv, null);
  assert.equal(txNoArv.blendedIrr, null);
  assert.ok(txNoArv.missingInputs.includes('assumedArv'));
});
