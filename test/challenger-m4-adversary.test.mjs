import test from 'node:test';
import assert from 'node:assert/strict';

import {
  computeCashToClose,
  computeCreMetrics,
  computeTargetPriceScenario,
  generateInvestmentCommitteeMemo,
  generateLetterOfIntent,
  parseRentRollSchedule,
  redemptionLabel,
  computeStatutoryFeePreset,
  computeStatutoryDeadlinesAndCarry,
} from '../src/lib/underwriting.ts';

import {
  HOA_SUPER_PRIORITY_STATES,
  classifyForeclosingParty,
  detectIrsFederalTaxLien,
  extractInstrumentPrioritySignals,
  arbitrateTitleRisk,
} from '../server/intelligence/title-risk-engine.js';

import {
  JURISDICTION_FEE_SCHEDULES,
  calculateCompleteCashToClose,
} from '../server/intelligence/cash-to-close.js';

// ============================================================================
// SUITE 1: ZERO-FABRICATION UNDERWRITING & UNRESOLVED INPUTS
// ============================================================================

test('Zero-Fabrication: computeTargetPriceScenario fails closed on absent or invalid valuation', () => {
  const invalidValuations = [null, undefined, 0, -10000, NaN, 'unpriced', '', false];
  for (const val of invalidValuations) {
    const result = computeTargetPriceScenario({
      estimatedValue: val,
      targetMarginPct: 25,
      rehabBudget: 30000,
      currentPrice: 120000,
      otherAcquisitionCosts: 8000,
    });
    assert.equal(
      result,
      null,
      `Expected computeTargetPriceScenario to return null when estimatedValue is ${val}`
    );
  }
});

test('Zero-Fabrication: computeTargetPriceScenario fails closed when target margin is impossible (>= 100%)', () => {
  const impossibleMargins = [100, 105, 200];
  for (const margin of impossibleMargins) {
    const result = computeTargetPriceScenario({
      estimatedValue: 200000,
      targetMarginPct: margin,
      rehabBudget: 20000,
      currentPrice: 100000,
      otherAcquisitionCosts: 5000,
    });
    assert.equal(result, null, `Target margin of ${margin}% must return null`);
  }
});

test('Zero-Fabrication: computeTargetPriceScenario fails closed when costs or budget are missing', () => {
  assert.equal(
    computeTargetPriceScenario({
      estimatedValue: 200000,
      targetMarginPct: 25,
      rehabBudget: null, // missing
      currentPrice: 100000,
      otherAcquisitionCosts: 5000,
    }),
    null
  );

  assert.equal(
    computeTargetPriceScenario({
      estimatedValue: 200000,
      targetMarginPct: 25,
      rehabBudget: 20000,
      currentPrice: null, // missing
      otherAcquisitionCosts: 5000,
    }),
    null
  );

  assert.equal(
    computeTargetPriceScenario({
      estimatedValue: 200000,
      targetMarginPct: 25,
      rehabBudget: 20000,
      currentPrice: 100000,
      otherAcquisitionCosts: null, // missing
    }),
    null
  );
});

test('Zero-Fabrication: MAO unlocks strictly when explicit buyer assumption is supplied', () => {
  const buyerAssumption = 250000;
  const result = computeTargetPriceScenario({
    estimatedValue: buyerAssumption,
    targetMarginPct: 20, // 50k target profit
    rehabBudget: 40000,
    currentPrice: 140000,
    otherAcquisitionCosts: 10000,
  });

  assert.ok(result !== null);
  // Available budget = 250k - 50k profit - 40k rehab = 160k
  // Max purchase price = 160k - 10k other costs = 150k
  assert.equal(result.maxPurchasePrice, 150000);
  assert.equal(result.targetProfit, 50000);
  assert.equal(result.targetAchievableAtCurrentPrice, true);
  assert.equal(result.priceReductionNeeded, 0); // 140k currentPrice <= 150k maxPurchasePrice
});

test('Zero-Fabrication: computeCashToClose requires all acquisition cost components before totaling', () => {
  const unresolved = computeCashToClose({
    openingBid: 150000,
    buyersPremium: 7500,
    sheriffPoundage: 3000,
    // transferTax is missing
    delinquentTaxes: 1200,
    settlementCosts: 800,
  });

  assert.equal(unresolved.totalAcquisitionCost, null);
  assert.equal(unresolved.cashDueAtSettlement, null);
  assert.equal(unresolved.modelStatus, 'insufficient_inputs');
  assert.ok(unresolved.missingAcquisitionInputs.includes('transferTax'));

  // Complete scenario
  const complete = computeCashToClose({
    openingBid: 150000,
    registrationFunds: 15000,
    creditedDeposit: 15000,
    buyersPremium: 7500,
    sheriffPoundage: 3000,
    transferTax: 1500,
    delinquentTaxes: 1200,
    settlementCosts: 800,
  });

  assert.equal(complete.totalAcquisitionCost, 164000);
  assert.equal(complete.cashDueAtSettlement, 149000);
  assert.equal(complete.modelStatus, 'complete_scenario');
  assert.equal(complete.missingInputs.length, 0);
});

test('Zero-Fabrication: IC Memo strictly withholds valuation, deal score, and recommendations when data absent', () => {
  const rawListing = {
    id: 'test-austere-listing',
    address: '100 Main Street',
    city: 'Akron',
    state: 'OH',
    openingBid: 75000,
    // estLow, estHigh, dealScore, redemptionDays absent
  };

  const memo = generateInvestmentCommitteeMemo(rawListing);
  assert.match(memo, /STATUS: EVIDENCE REVIEW DRAFT — NOT BID AUTHORITY/);
  assert.match(memo, /Deal Score\*\*: Unavailable — published bid and supported valuation inputs are required/);
  assert.match(memo, /Supported Valuation-Range Midpoint\*\*: Unavailable — supporting evidence or an explicit buyer assumption is required/);
  assert.match(memo, /Redemption \/ Objection Period\*\*: Unknown — official sale terms and current law review required/);
  assert.match(memo, /Senior Lien Signal\*\*: Unknown — current title and docket evidence required/);
  assert.match(memo, /Net Operating Income \(NOI\)\*\*: Unavailable/);
  assert.match(memo, /Max Allowable Offer \(MAO\)\*\*: Unavailable — explicit target-yield assumptions required/);
  assert.match(memo, /NO BID RECOMMENDATION/);

  // Assert no hallucinated percentages or metrics
  assert.doesNotMatch(memo, /85\/100|8\.50%|1\.45x|Proceed with/i);
});

// ============================================================================
// SUITE 2: TITLE DEFECT TRIPPING — JUNIOR MORTGAGE & SURVIVING SENIOR LIEN
// ============================================================================

test('Title Defect Tripping: baseline junior mortgage / HELOC plaintiffs trip CRITICAL title defect', () => {
  const baselineJuniorFixtures = [
    'Second Mortgage Loan Trust 2021-HE1',
    'Springleaf Financial Services 2nd Mortgage LLC',
    'Discover Home Equity Line of Credit, LLC',
    'Bank of America, N.A. (HELOC Servicing Dept)',
    'Wells Fargo Bank, N.A. 2nd Mortgage Loan Trust',
    'JPMorgan Chase Bank, Subordinate Deed of Trust Holder',
    'CitiFinancial Subordinate Mortgage Trust',
    'PNC Bank Consumer Junior Mortgage Services',
    'U.S. Bank National Association, as Trustee for Junior Mortgage Series 2019-B',
    'TD Bank, N.A. HELOC Collections Group',
    'Citizens Bank Subordinate Mortgage Portfolio LLC',
    'Truist Bank Junior Mortgage Department',
    'Rocket Mortgage LLC - Second Mortgage Program',
    'LoanDepot.com LLC Subordinate Mortgage Division',
    'Fifth Third Bank HELOC Portfolio Recovery',
  ];

  for (const plaintiff of baselineJuniorFixtures) {
    const party = classifyForeclosingParty(plaintiff);
    assert.equal(
      party,
      'SECOND_MORTGAGE_HELOC',
      `Plaintiff "${plaintiff}" must be classified as SECOND_MORTGAGE_HELOC`
    );

    const risk = arbitrateTitleRisk({ plaintiff, state: 'OH', openingBid: 25000 });
    assert.equal(
      risk.riskLevel,
      'CRITICAL',
      `Plaintiff "${plaintiff}" must trip CRITICAL risk`
    );
    assert.equal(
      risk.firstMortgageSurvives,
      true,
      `Plaintiff "${plaintiff}" must have firstMortgageSurvives: true`
    );
    assert.equal(
      risk.canProceedWithBid,
      false,
      `Plaintiff "${plaintiff}" must have canProceedWithBid: false`
    );
    assert.match(
      risk.titleActionAdvice,
      /DO NOT BID\. Senior mortgage survives sale/,
      `Plaintiff "${plaintiff}" must advise DO NOT BID`
    );
    assert.ok(
      risk.titleWarnings.some((w) =>
        w.includes('CRITICAL TITLE DEFECT: Foreclosing party is a junior lienholder (2nd Mortgage/HELOC)')
        && w.includes('Senior 1st mortgage survives sale in full!')
      ),
      `Plaintiff "${plaintiff}" must include explicit senior 1st mortgage survival warning`
    );
  }
});

test('Title Defect Tripping: Explicit "subject to senior mortgage" notice trips CRITICAL even with generic plaintiff', () => {
  const noticeTexts = [
    'Sale is explicitly subject to prior senior mortgage recorded 03/12/2018 in Book 412 Page 88.',
    'Foreclosure of subordinate deed. Subject to a senior deed of trust held by First National Bank.',
    'Notice of execution sale: subject to any prior first mortgage of record.',
    'Junior judgment foreclosure; senior lien remains in full force and effect.',
  ];

  for (const text of noticeTexts) {
    const risk = arbitrateTitleRisk(
      { plaintiff: 'Apex Holdings LLC', state: 'OH' },
      text
    );
    assert.equal(
      risk.riskLevel,
      'CRITICAL',
      `Notice text containing senior survival must trip CRITICAL: "${text}"`
    );
    assert.equal(
      risk.firstMortgageSurvives,
      true,
      `Notice text containing senior survival must set firstMortgageSurvives: true`
    );
    assert.equal(
      risk.canProceedWithBid,
      false,
      `Notice text containing senior survival must set canProceedWithBid: false`
    );
    assert.match(
      risk.titleActionAdvice,
      /DO NOT BID\. Senior mortgage survives sale/
    );
  }
});

test('Title Defect Tripping: Non-super-priority HOA foreclosure trips CRITICAL first mortgage survival', () => {
  const nonSuperPriorityStates = ['TX', 'CA', 'NC', 'AZ', 'GA', 'OH', 'VA', 'SC'];
  for (const st of nonSuperPriorityStates) {
    const risk = arbitrateTitleRisk({
      plaintiff: 'Highland Ridge Homeowners Association, Inc.',
      state: st,
    });
    assert.equal(
      risk.riskLevel,
      'CRITICAL',
      `HOA foreclosure in non-super-priority state ${st} must trip CRITICAL`
    );
    assert.equal(
      risk.firstMortgageSurvives,
      true,
      `HOA foreclosure in non-super-priority state ${st} must flag firstMortgageSurvives: true`
    );
    assert.equal(
      risk.canProceedWithBid,
      false,
      `HOA foreclosure in non-super-priority state ${st} must set canProceedWithBid: false`
    );
    assert.ok(
      risk.titleWarnings.some((w) =>
        w.includes('CRITICAL TITLE DEFECT: HOA foreclosing in a non-super-priority state')
      )
    );
  }
});

test('Title Defect Tripping: 22 UCIOA HOA super-priority states correctly evaluate assessment protection', () => {
  const expectedSuperPriorityStates = [
    'NV', 'CO', 'CT', 'FL', 'WA', 'DC', 'MD', 'MA',
    'MN', 'MO', 'NJ', 'OR', 'PA', 'RI', 'TN', 'VT',
    'WV', 'AL', 'AK', 'HI', 'IL', 'NY'
  ];

  for (const st of expectedSuperPriorityStates) {
    assert.ok(
      Boolean(HOA_SUPER_PRIORITY_STATES[st]),
      `State ${st} must be configured in HOA_SUPER_PRIORITY_STATES`
    );
    const cfg = HOA_SUPER_PRIORITY_STATES[st];
    assert.ok(cfg.months >= 4 && cfg.months <= 12, `${st} months must be between 4 and 12`);
    assert.ok(cfg.statute, `${st} must cite statutory provision`);

    const risk = arbitrateTitleRisk({
      plaintiff: 'Eagle Point Condominium Association',
      state: st,
    });
    assert.equal(risk.riskLevel, 'HIGH', `${st} HOA should be HIGH risk, not unclassified`);
    assert.equal(risk.hoaSuperPriority.isSuperPriorityState, true);
    assert.equal(risk.hoaSuperPriority.monthsProtected, cfg.months);
  }
});

// ============================================================================
// SUITE 3: REMEDIATED INVARIANTS — VERIFICATION OF REGEX BOUNDARIES & DEED PATTERNS
// ============================================================================

test('REMEDIATED #1: "First" in plaintiff name does NOT match TAX_AUTHORITY and correctly trips CRITICAL 2nd mortgage defect', () => {
  const party = classifyForeclosingParty('First Horizon Home Equity Line Corporation');
  assert.equal(party, 'SECOND_MORTGAGE_HELOC', 'First Horizon Home Equity Line must be classified as SECOND_MORTGAGE_HELOC');

  const risk = arbitrateTitleRisk({
    plaintiff: 'First Franklin 2nd Mortgage LLC',
    state: 'OH',
    openingBid: 25000,
  });
  assert.equal(risk.riskLevel, 'CRITICAL', 'First Franklin 2nd Mortgage must trip CRITICAL risk');
  assert.equal(risk.firstMortgageSurvives, true, 'First mortgage must survive sale');
  assert.equal(risk.canProceedWithBid, false, 'canProceedWithBid must be false');
  assert.ok(risk.titleWarnings.some((w) => w.includes('CRITICAL TITLE DEFECT: Foreclosing party is a junior lienholder')));
});

test('REMEDIATED #2: "Second Trust Deed" plaintiffs are classified as SECOND_MORTGAGE_HELOC and trip CRITICAL risk', () => {
  const partyBank = classifyForeclosingParty('KeyBank National Association Second Trust Deed Division');
  assert.equal(partyBank, 'SECOND_MORTGAGE_HELOC', 'Second Trust Deed must be classified as SECOND_MORTGAGE_HELOC');

  const risk = arbitrateTitleRisk({
    plaintiff: 'KeyBank National Association Second Trust Deed Division',
    state: 'CA',
    openingBid: 50000,
  });
  assert.equal(risk.riskLevel, 'CRITICAL', 'Second Trust Deed must trip CRITICAL risk');
  assert.equal(risk.firstMortgageSurvives, true, 'First deed must survive sale');
  assert.equal(risk.canProceedWithBid, false, 'canProceedWithBid must be false');
  assert.ok(risk.titleWarnings.some((w) => w.includes('Senior 1st mortgage survives sale in full')));
});

test('REMEDIATED #3: "Equity Line of Credit" without "home" is classified as SECOND_MORTGAGE_HELOC', () => {
  const party = classifyForeclosingParty('SunTrust Equity Line of Credit Trust');
  assert.equal(party, 'SECOND_MORTGAGE_HELOC', 'Equity Line of Credit must be classified as SECOND_MORTGAGE_HELOC');
});

test('REMEDIATED #4: "Subordinate Lien" is classified as SECOND_MORTGAGE_HELOC', () => {
  const party = classifyForeclosingParty('LoanDepot.com LLC Subordinate Lien Division');
  assert.equal(party, 'SECOND_MORTGAGE_HELOC', 'Subordinate Lien must be classified as SECOND_MORTGAGE_HELOC');
});

test('REMEDIATED #5: "First" in legal notice does NOT trigger false IRS Federal Tax Lien', () => {
  const cleanNotice = 'First National Bank vs. John Smith. Foreclosure of mortgage deed.';
  const det = detectIrsFederalTaxLien(cleanNotice);
  assert.equal(det.hasIrsLien, false, 'First National Bank notice must not have IRS lien');
  assert.equal(det.redemptionDays, 0, 'No IRS redemption lockup on non-IRS notice');
  assert.equal(det.warning, null, 'No IRS warning on non-IRS notice');
});

test('REMEDIATED #6: "Shoal" in plaintiff name is NOT misclassified as HOA_ASSESSMENT', () => {
  const party = classifyForeclosingParty('Shoal Creek Mortgage Partners');
  assert.equal(party, 'FIRST_MORTGAGE', 'Shoal Creek Mortgage Partners must be classified as FIRST_MORTGAGE');
});

// ============================================================================
// SUITE 4: STATUTORY CASH-TO-CLOSE & FEE SCHEDULE RESILIENCE
// ============================================================================

test('Statutory Schedules: computes calibrated schedules across FL, NJ, PA, OH, NC, TX', () => {
  const price = 200000;

  // New Jersey
  const nj = computeStatutoryFeePreset({ purchasePrice: price, state: 'NJ' });
  assert.ok(nj);
  // N.J.S.A. 22A:4-8: 6% on first $5k ($300) + 4% on next $15k ($600) + 2% on remaining $180k ($3600) = $4500
  assert.equal(nj.sheriffPoundage, 4500);
  assert.equal(nj.transferTax, 2000); // ~1.0%
  assert.equal(nj.registrationFunds, 40000); // 20% statutory deposit
  assert.ok(nj.citations.some(c => c.includes('N.J.S.A. 22A:4-8')));

  // Florida
  const fl = computeStatutoryFeePreset({ purchasePrice: price, state: 'FL' });
  assert.ok(fl);
  // Fla. Stat. § 28.24: 3% on first $500 ($15) + 1.5% on remaining $199,500 ($2992.5) = $3008
  assert.equal(fl.sheriffPoundage, 3008);
  // Fla. Stat. § 201.02: $0.70 per $100 = $1,400
  assert.equal(fl.transferTax, 1400);
  assert.equal(fl.registrationFunds, 10000); // 5% statutory deposit

  // Pennsylvania
  const pa = computeStatutoryFeePreset({ purchasePrice: price, state: 'PA' });
  assert.ok(pa);
  // 42 Pa.C.S. § 21107: 2% up to $250k = $4,000
  assert.equal(pa.sheriffPoundage, 4000);
  assert.equal(pa.transferTax, 4000); // 2% transfer tax
  assert.equal(pa.registrationFunds, 20000); // 10% statutory deposit

  // Ohio
  const oh = computeStatutoryFeePreset({ purchasePrice: price, state: 'OH' });
  assert.ok(oh);
  assert.equal(oh.sheriffPoundage, 3000); // 1.5% ORC § 311.17
  assert.equal(oh.transferTax, 800); // $4 per $1k ORC § 319.54
  assert.equal(oh.registrationFunds, 20000); // 10% deposit

  // North Carolina
  const nc = computeStatutoryFeePreset({ purchasePrice: price, state: 'NC' });
  assert.ok(nc);
  assert.equal(nc.sheriffPoundage, 10000); // 5% commissioner fee up to 25k cap
  assert.equal(nc.transferTax, 400); // $2 per $1k ($1 per $500)
  assert.equal(nc.registrationFunds, 10000); // 5% upset deposit

  // Texas
  const tx = computeStatutoryFeePreset({ purchasePrice: price, state: 'TX' });
  assert.ok(tx);
  assert.equal(tx.sheriffPoundage, 0);
  assert.equal(tx.transferTax, 0); // Tex. Const. art. VIII § 29
  assert.equal(tx.registrationFunds, 20000); // 10% default
});

test('Statutory Schedules: marketplace sources enforce 5% buyer premium with $2,500 floor', () => {
  // Bid4Assets $20,000 bid (5% is $1,000 -> floor $2,500 applies)
  const b4aSmall = computeStatutoryFeePreset({ purchasePrice: 20000, state: 'OH', source: 'bid4assets' });
  assert.equal(b4aSmall.buyersPremium, 2500);

  // ServiceLink $100,000 bid (5% is $5,000 -> exceeds floor)
  const slLarge = computeStatutoryFeePreset({ purchasePrice: 100000, state: 'FL', source: 'servicelink' });
  assert.equal(slLarge.buyersPremium, 5000);

  // Direct sheriff sale -> $0 buyer premium
  const direct = computeStatutoryFeePreset({ purchasePrice: 100000, state: 'FL', source: 'sheriff' });
  assert.equal(direct.buyersPremium, 0);
});

test('Statutory Schedules: handles edge-case price inputs safely without crashing', () => {
  assert.equal(computeStatutoryFeePreset({ purchasePrice: null }), null);
  assert.equal(computeStatutoryFeePreset({ purchasePrice: 0 }), null);
  assert.equal(computeStatutoryFeePreset({ purchasePrice: -5000 }), null);
  assert.equal(computeStatutoryFeePreset({ purchasePrice: 'invalid' }), null);

  // Small bid ($500) in NJ enforces minimum $150 sheriff poundage
  const njSmall = computeStatutoryFeePreset({ purchasePrice: 500, state: 'NJ' });
  assert.equal(njSmall.sheriffPoundage, 150); // $150 minimum floor under N.J.S.A. 22A:4-8
});

// ============================================================================
// SUITE 5: POST-SALE REDEMPTION CARRY & 120-DAY IRS § 7425 REDEMPTION
// ============================================================================

test('IRS Super-Priority: detects legitimate 26 U.S.C. § 7425 federal tax liens', () => {
  const noticeVariants = [
    'United States of America, Internal Revenue Service, by virtue of tax lien.',
    'Subject to Federal Tax Lien recorded under 26 U.S.C. § 7425.',
    'Defendants include IRS regarding recorded notice of federal tax lien.',
    'USA Department of the Treasury Internal Revenue Service lienholder.',
    '26 USC 7425(d) right of redemption reserved to the United States.',
  ];

  for (const notice of noticeVariants) {
    const det = detectIrsFederalTaxLien(notice);
    assert.equal(det.hasIrsLien, true, `Must detect IRS lien in: "${notice}"`);
    assert.equal(det.redemptionDays, 120, 'IRS lien must mandate 120 days redemption');
    assert.equal(det.statute, '26 U.S.C. § 7425(d)');
    assert.match(det.warning, /120-day right of redemption under 26 U\.S\.C\. § 7425\(d\)/);
  }
});

test('Statutory Carry: IRS 120-day super-priority lockup expands statutory windows and carry cost', () => {
  const baseDate = '2026-10-01';
  const price = 250000;
  const costOfCapital = 12; // 12% annual cost of capital

  // 1. Ohio without IRS: 30-day confirmation window
  const ohStandard = computeStatutoryDeadlinesAndCarry({
    saleDate: baseDate,
    state: 'OH',
    purchasePrice: price,
    annualCostOfCapitalPct: costOfCapital,
    hasIrsLien: false,
  });
  assert.equal(ohStandard.effectiveLockupDays, 30);
  assert.equal(ohStandard.irsRedemptionDays, 0);
  assert.equal(ohStandard.objectionDeadline, '2026-10-31');
  // Carry: 250,000 * 0.12 * (30 / 365) = ~2465.75 -> 2466
  assert.equal(ohStandard.estimatedCarryCost, 2466);

  // 2. Ohio WITH IRS: 120-day super-priority redemption supersedes 30-day confirmation
  const ohWithIrs = computeStatutoryDeadlinesAndCarry({
    saleDate: baseDate,
    state: 'OH',
    purchasePrice: price,
    annualCostOfCapitalPct: costOfCapital,
    hasIrsLien: true,
  });
  assert.equal(ohWithIrs.effectiveLockupDays, 120);
  assert.equal(ohWithIrs.irsRedemptionDays, 120);
  assert.equal(ohWithIrs.irsRedemptionDeadline, '2027-01-29'); // 120 days after 2026-10-01
  // Carry: 250,000 * 0.12 * (120 / 365) = ~9863
  assert.equal(ohWithIrs.estimatedCarryCost, 9863);

  // 3. Alabama with 180-day state statutory redemption + IRS 120-day
  // State redemption (180 days) is longer than IRS (120 days) -> effectiveLockupDays = 180
  const alWithIrs = computeStatutoryDeadlinesAndCarry({
    saleDate: baseDate,
    state: 'AL',
    purchasePrice: price,
    redemptionDays: 180,
    annualCostOfCapitalPct: costOfCapital,
    hasIrsLien: true,
  });
  assert.equal(alWithIrs.effectiveLockupDays, 180);
  assert.equal(alWithIrs.irsRedemptionDays, 120);
  assert.equal(alWithIrs.stateRedemptionDays, 180);
  assert.equal(alWithIrs.irsRedemptionDeadline, '2027-01-29');
  assert.equal(alWithIrs.stateRedemptionDeadline, '2027-03-30');
  // Carry: 250,000 * 0.12 * (180 / 365) = ~14795
  assert.equal(alWithIrs.estimatedCarryCost, 14795);
});

test('Statutory Carry: adversarial date & capital inputs handle gracefully without crashing', () => {
  // Invalid date string
  const invalidDate = computeStatutoryDeadlinesAndCarry({
    saleDate: 'not-a-valid-date',
    state: 'NC',
    purchasePrice: 100000,
    hasIrsLien: true,
  });
  assert.equal(invalidDate.saleDateIso, null);
  assert.equal(invalidDate.objectionDeadline, null);
  assert.equal(invalidDate.irsRedemptionDeadline, null);
  assert.equal(invalidDate.effectiveLockupDays, 120);
  assert.ok(invalidDate.estimatedCarryCost > 0);

  // Missing purchase price
  const missingPrice = computeStatutoryDeadlinesAndCarry({
    saleDate: '2026-10-01',
    state: 'NC',
    purchasePrice: null,
    hasIrsLien: true,
  });
  assert.equal(missingPrice.estimatedCarryCost, null);

  // 0% cost of capital
  const zeroCapital = computeStatutoryDeadlinesAndCarry({
    saleDate: '2026-10-01',
    state: 'NC',
    purchasePrice: 100000,
    annualCostOfCapitalPct: 0,
    hasIrsLien: true,
  });
  assert.equal(zeroCapital.estimatedCarryCost, 0);
});

test('Statutory preset flags unsupported states instead of implying a modeled schedule', () => {
  const un = computeStatutoryFeePreset({ purchasePrice: 100000, state: 'WY' });
  assert.equal(un.supported, false);
  assert.match(un.notice, /unavailable for state WY/);
  assert.equal(computeStatutoryFeePreset({ purchasePrice: 100000, state: 'OH' }).supported, true);

  const ctc = calculateCompleteCashToClose({ winningBid: 100000, state: 'OH', computedAt: '2026-10-28T12:00:00.000Z' });
  assert.equal(ctc.computedAt, '2026-10-28T12:00:00.000Z');
  assert.equal(ctc.supported, true);

  const carry = computeStatutoryDeadlinesAndCarry({ saleDate: '2026-10-01', state: 'OH', purchasePrice: 100000, computedAt: '2026-10-28T12:00:00.000Z' });
  assert.equal(carry.computedAt, '2026-10-28T12:00:00.000Z');
});
