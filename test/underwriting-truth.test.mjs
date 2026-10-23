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
  computeStatutoryFeePreset,
  computeStatutoryDeadlinesAndCarry,
  computeLienWaterfall,
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
    costReductionNeeded: 0,
    targetAchievableAtCurrentPrice: false,
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

test('rent-roll parsing requires an explicit period and preserves annual rent', () => {
  const annual = parseRentRollSchedule('Unit 201: Tenant, 1,000 sqft, rent $24,000/year');
  assert.equal(annual.units[0].monthlyRent, 2_000);
  assert.equal(annual.units[0].annualRent, 24_000);
  const missingPeriod = parseRentRollSchedule('Unit 202: Tenant, 1,000 sqft, rent $2,000');
  assert.equal(missingPeriod.units[0].monthlyRent, null);
  assert.equal(missingPeriod.totalAnnualRent, null);
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

  const patternFlag = generateInvestmentCommitteeMemo({
    address: '84 Raven Rock Rd',
    state: 'NC',
    seniorLienRisk: 'high',
    seniorLienWarning: 'Junior lien phrase detected in the notice text.',
    provenance: {
      derivedFields: {
        seniorLienRisk: { model: 'legal-text-pattern-v1', inputs: ['plaintiff', 'raw'], note: 'Pattern flag only; not a title opinion.' },
      },
    },
  });
  assert.match(patternFlag, /HIGH is a text-pattern flag, not a title opinion/);
  assert.match(patternFlag, /current title and lien-priority evidence/);
  assert.doesNotMatch(patternFlag, /record note:/);
  assert.doesNotMatch(patternFlag, /unverified risk signal/);

  const noPhrase = generateInvestmentCommitteeMemo({
    address: '84 Raven Rock Rd',
    seniorLienRisk: 'unknown',
    provenance: { derivedFields: { seniorLienRisk: { model: 'legal-text-pattern-v1', inputs: ['raw'] } } },
  });
  assert.match(noPhrase, /No junior-lien phrase was stored, not a title opinion/);
  assert.match(noPhrase, /current title and lien-priority evidence/);
  assert.match(supplied, /13\.6% \(modeled\)/);
  assert.match(supplied, /1\.85x \(modeled\)/);
  assert.match(supplied, /\$360,000 USD \(buyer-supplied model output/);
});

test('custom valuation assumption unlocks MAO calculation when publisher estimate is absent', () => {
  const unmodeled = computeTargetPriceScenario({
    estimatedValue: null,
    targetMarginPct: 30,
    rehabBudget: 25_000,
    currentPrice: 100_000,
    otherAcquisitionCosts: 5_000,
  });
  assert.equal(unmodeled, null, 'missing valuation must fail closed');

  const modeledFromAssumption = computeTargetPriceScenario({
    estimatedValue: 185_000,
    targetMarginPct: 30,
    rehabBudget: 25_000,
    currentPrice: 100_000,
    otherAcquisitionCosts: 5_000,
  });
  assert.ok(modeledFromAssumption !== null);
  assert.equal(modeledFromAssumption.maxPurchasePrice, 99_500);
  assert.equal(modeledFromAssumption.priceReductionNeeded, 500);
  assert.equal(modeledFromAssumption.targetProfit, 55_500);
});

test('UnderwriteScenario persists custom valuation assumption across sessions', async () => {
  const { readUnderwriteScenario, writeUnderwriteScenario } = await import('../src/lib/underwrite-scenario.ts');
  const mockStorage = {};
  globalThis.sessionStorage = {
    getItem: (key) => mockStorage[key] || null,
    setItem: (key, val) => { mockStorage[key] = String(val); },
  };

  writeUnderwriteScenario('TEST-LISTING-001', {
    registrationFunds: '5000',
    creditedDeposit: '5000',
    buyersPremium: '0',
    sheriffPoundage: '0',
    transferTax: '0',
    delinquentTaxes: '0',
    settlementCosts: '0',
    rehabBudget: 25000,
    targetMargin: 30,
    customValuation: '185000',
  });

  const restored = readUnderwriteScenario('TEST-LISTING-001');
  assert.ok(restored !== null);
  assert.equal(restored.customValuation, '185000');
  assert.equal(restored.rehabBudget, 25000);
  delete globalThis.sessionStorage;
});

test('computeLienWaterfall calculates debt extinguishment, surplus distribution, and surviving priority liens', () => {
  // Scenario 1: Senior 1st mortgage foreclosing with sufficient proceeds
  const seniorForeclosure = computeLienWaterfall({
    winningBid: 250_000,
    foreclosingLienType: 'first_mortgage',
    foreclosingLienAmount: 180_000,
    delinquentTaxesAmount: 10_000,
    subordinateLiens: [
      { name: 'Second Mortgage', amount: 30_000, type: 'second_mortgage' },
      { name: 'HELOC', amount: 15_000, type: 'heloc' },
    ],
  });
  assert.equal(seniorForeclosure.totalSurvivingDebtOnProperty, 0);
  assert.equal(seniorForeclosure.totalEffectiveAcquisitionCost, 250_000);
  assert.equal(seniorForeclosure.surplusProceedsToBorrower, 15_000);
  assert.equal(seniorForeclosure.criticalAlert, null);
  assert.equal(seniorForeclosure.items[0].status, 'satisfied_from_proceeds');
  assert.equal(seniorForeclosure.items[1].status, 'satisfied_from_proceeds');
  assert.equal(seniorForeclosure.items[2].status, 'satisfied_from_proceeds');
  assert.equal(seniorForeclosure.items[3].status, 'satisfied_from_proceeds');

  // Scenario 2: CRITICAL FORECLOSURE TRAP - Junior 2nd mortgage foreclosing
  // Senior 1st mortgage ($200k) SURVIVES in full against the buyer!
  const juniorForeclosure = computeLienWaterfall({
    winningBid: 50_000,
    foreclosingLienType: 'second_mortgage',
    foreclosingLienAmount: 40_000,
    seniorMortgageAmount: 200_000,
    delinquentTaxesAmount: 5_000,
  });
  assert.equal(juniorForeclosure.totalSurvivingDebtOnProperty, 200_000);
  assert.equal(juniorForeclosure.totalEffectiveAcquisitionCost, 250_000);
  assert.ok(juniorForeclosure.criticalAlert !== null);
  assert.match(juniorForeclosure.criticalAlert, /CRITICAL WARNING: Junior SECOND MORTGAGE foreclosure/);
  assert.equal(juniorForeclosure.items.find(x => x.type === 'first_mortgage').status, 'survives_against_purchaser');
  assert.equal(juniorForeclosure.surplusProceedsToBorrower, 5_000);
});

test('computeStatutoryFeePreset models state statutory poundage, transfer tax, and deposit terms as explicit presets', () => {
  const nj = computeStatutoryFeePreset({ purchasePrice: 120_000, state: 'NJ', source: 'civilview', depositText: '20% at gavel' });
  assert.ok(nj !== null);
  assert.equal(nj.sheriffPoundage, 2900);
  assert.equal(nj.registrationFunds, 24_000);
  assert.match(nj.citations.join(' '), /N\.J\.S\.A\. 22A:4-8/);

  const fl = computeStatutoryFeePreset({ purchasePrice: 100_000, state: 'FL', source: 'sheriff', depositText: '$5,000 wire' });
  assert.ok(fl !== null);
  assert.equal(fl.sheriffPoundage, Math.round(500 * 0.03 + 99_500 * 0.015));
  assert.equal(fl.transferTax, 700);
  assert.equal(fl.registrationFunds, 5000);

  const oh = computeStatutoryFeePreset({ purchasePrice: 100_000, state: 'OH', source: 'sheriff' });
  assert.ok(oh !== null);
  assert.equal(oh.sheriffPoundage, 1500);
  assert.equal(oh.transferTax, 400);

  const ca = computeStatutoryFeePreset({ purchasePrice: 500_000, state: 'CA', source: 'trustee' });
  assert.ok(ca !== null);
  assert.equal(ca.sheriffPoundage, 1500);
  assert.equal(ca.transferTax, 550);
  assert.match(ca.citations.join(' '), /Cal\. Civ\. Code § 2924h/);

  const ga = computeStatutoryFeePreset({ purchasePrice: 200_000, state: 'GA', source: 'sheriff' });
  assert.ok(ga !== null);
  assert.equal(ga.transferTax, 200);
  assert.match(ga.citations.join(' '), /O\.C\.G\.A\. § 48-6-1/);

  const il = computeStatutoryFeePreset({ purchasePrice: 150_000, state: 'IL', source: 'sheriff' });
  assert.ok(il !== null);
  assert.equal(il.transferTax, 225);
  assert.match(il.citations.join(' '), /735 ILCS 5\/15-1507/);

  const ny = computeStatutoryFeePreset({ purchasePrice: 400_000, state: 'NY', source: 'sheriff' });
  assert.ok(ny !== null);
  assert.equal(ny.transferTax, 1600);
  assert.match(ny.citations.join(' '), /RPAPL § 1354/);
});

test('computeStatutoryDeadlinesAndCarry models post-sale statutory windows and IRS 120-day lockup carry', async () => {
  const nc = computeStatutoryDeadlinesAndCarry({ saleDate: '2026-10-01', state: 'NC', purchasePrice: 200_000, annualCostOfCapitalPct: 12 });
  assert.equal(nc.objectionDeadline, '2026-10-11');
  assert.match(nc.objectionLabel, /N\.C\.G\.S\. § 45-21\.27/);
  assert.equal(nc.effectiveLockupDays, 10);
  assert.ok(nc.estimatedCarryCost > 0);

  const irs = computeStatutoryDeadlinesAndCarry({ saleDate: '2026-10-01', state: 'OH', hasIrsLien: true, purchasePrice: 150_000 });
  assert.equal(irs.irsRedemptionDays, 120);
  assert.equal(irs.irsRedemptionDeadline, '2027-01-29');
  assert.equal(irs.effectiveLockupDays, 120);

  const caCarry = computeStatutoryDeadlinesAndCarry({ saleDate: '2026-10-01', state: 'CA', purchasePrice: 400_000 });
  assert.equal(caCarry.objectionOrConfirmationDays, 45);
  assert.match(caCarry.objectionLabel, /SB 1079/);

  const ilCarry = computeStatutoryDeadlinesAndCarry({ saleDate: '2026-10-01', state: 'IL', purchasePrice: 200_000 });
  assert.equal(ilCarry.objectionOrConfirmationDays, 30);
  assert.match(ilCarry.objectionLabel, /735 ILCS 5\/15-1508/);

  const titleEngine = await import('../server/intelligence/title-risk-engine.js');
  const priority = titleEngine.extractInstrumentPrioritySignals('Foreclosing Mortgage Recorded 04/12/2019 in Book 4812 Page 309, Instrument # 20190048192. Sale is subject to prior senior mortgage.');
  assert.equal(priority.instrumentNumber, '20190048192');
  assert.deepEqual(priority.bookPage, { book: '4812', page: '309' });
  assert.equal(priority.recordedDate, '04/12/2019');
  assert.equal(priority.explicitlySubjectToSeniorMortgage, true);
  delete globalThis.sessionStorage;
});

