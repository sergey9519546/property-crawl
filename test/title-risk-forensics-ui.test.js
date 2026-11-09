'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  computeLienWaterfall,
} = require('../src/lib/underwriting.ts');

const {
  classifyForeclosingParty,
  arbitrateTitleRisk,
  evaluateHoaSuperLien,
  evaluateIrsNoticeRule,
} = require('../server/intelligence/title-risk-engine');

test('Title Forensics: classifies foreclosing party accurately from plaintiff naming and keywords', () => {
  // First mortgage institutional lenders
  assert.equal(classifyForeclosingParty('Wells Fargo Bank, N.A.', ''), 'FIRST_MORTGAGE');
  assert.equal(classifyForeclosingParty('JPMorgan Chase Bank, National Association', ''), 'FIRST_MORTGAGE');
  assert.equal(classifyForeclosingParty('Nationstar Mortgage LLC d/b/a Mr. Cooper', ''), 'FIRST_MORTGAGE');

  // Junior 2nd mortgage and HELOC
  assert.equal(classifyForeclosingParty('Springleaf Financial vs. Debtor (Second Mortgage)', ''), 'SECOND_MORTGAGE_HELOC');
  assert.equal(classifyForeclosingParty('Discover Bank (HELOC Junior Deed)', ''), 'SECOND_MORTGAGE_HELOC');

  // HOA and condo associations
  assert.equal(classifyForeclosingParty('Summerlin Master Community Association', ''), 'HOA_ASSESSMENT');
  assert.equal(classifyForeclosingParty('Turnberry Towers Condominium Association, Inc.', ''), 'HOA_ASSESSMENT');

  // Mechanic's construction liens
  assert.equal(classifyForeclosingParty('ABC Drywall & Construction LLC (Mechanic\'s Lien)', ''), 'MECHANICS_LIEN');

  // Property tax authority
  assert.equal(classifyForeclosingParty('County Treasurer of Cuyahoga County', ''), 'TAX_AUTHORITY');

  // Federal IRS tax lien
  assert.equal(classifyForeclosingParty('United States of America (Internal Revenue Service)', ''), 'IRS_TAX_LIEN');
});

test('Lien Waterfall Engine: Junior foreclosure enforces surviving senior mortgage and zero-fabrication', () => {
  const winningBid = 120000;
  const judgmentDebt = 45000;

  // Case 1: Unknown senior mortgage balance - must withhold total acquisition cost under zero-fabrication
  const unsuppliedWaterfall = computeLienWaterfall({
    winningBid,
    foreclosingLienType: 'second_mortgage',
    foreclosingLienAmount: judgmentDebt,
    seniorMortgageAmount: null,
  });

  assert.equal(unsuppliedWaterfall.totalEffectiveAcquisitionCost, null, 'Must not fabricate $0 senior debt');
  assert.ok(unsuppliedWaterfall.unknownReasons.length > 0);
  assert.match(unsuppliedWaterfall.unknownReasons[0], /surviving senior mortgage balance is unknown/i);

  // Case 2: Supplied senior mortgage ($200,000) and zero tax arrears ($0) - complete scenario
  const suppliedWaterfall = computeLienWaterfall({
    winningBid,
    foreclosingLienType: 'second_mortgage',
    foreclosingLienAmount: judgmentDebt,
    seniorMortgageAmount: 200000,
    delinquentTaxesAmount: 0,
  });

  assert.equal(suppliedWaterfall.complete, true);
  assert.equal(suppliedWaterfall.totalSurvivingDebtOnProperty, 200000);
  assert.equal(suppliedWaterfall.totalEffectiveAcquisitionCost, 320000); // 120k bid + 200k surviving senior debt
  assert.ok(suppliedWaterfall.criticalAlert);
  assert.match(suppliedWaterfall.criticalAlert, /CRITICAL WARNING: Junior SECOND MORTGAGE foreclosure/i);
  assert.match(suppliedWaterfall.criticalAlert, /senior 1st mortgage \(\$200,000\) SURVIVES against the purchaser/i);

  // Verify surviving status on senior mortgage item
  const seniorItem = suppliedWaterfall.items.find(i => i.type === 'first_mortgage');
  assert.ok(seniorItem);
  assert.equal(seniorItem.status, 'survives_against_purchaser');
  assert.equal(seniorItem.remainingBalanceAgainstProperty, 200000);
  assert.equal(seniorItem.amountPaidFromProceeds, 0);
});

test('Title Risk Engine: Nevada true HOA super-priority vs Florida safe harbor', () => {
  // Nevada: NRS 116.3116 extinguishes senior mortgage under SFR Investments Pool 1
  const nvResult = arbitrateTitleRisk({
    plaintiff: 'Shadow Creek Homeowners Association',
    state: 'NV',
    openingBid: 50000,
  });
  assert.equal(nvResult.plaintiffType, 'HOA_ASSESSMENT');
  assert.equal(nvResult.firstMortgageSurvives, false, 'NV HOA super-priority extinguishes 1st mortgage');
  assert.equal(nvResult.hoaSuperPriority.seniorMortgageExtinguished, true);
  assert.equal(nvResult.hoaSuperPriority.statute, 'NRS 116.3116');

  // Florida: Fla. Stat. § 718.116 safe harbor caps lender/buyer exposure at lesser of 1% or 12 months
  const flEval = evaluateHoaSuperLien({
    state: 'FL',
    monthlyDues: 400,
    originalMortgageDebt: 300000,
    foreclosingPartyType: 'FIRST_MORTGAGE',
  });
  assert.equal(flEval.isSuperPriorityState, true);
  assert.equal(flEval.safeHarborApplicable, true);
  // 1% of 300,000 = $3,000; 12 months dues = $4,800 -> statutory cap is $3,000
  assert.equal(flEval.estimatedSuperLienAmount, 3000);
});

test('Federal Tax Lien Forensics: 26 U.S.C. § 7425 25-day notice and 120-day redemption', () => {
  // Notice with IRS tax lien
  const irsEval = evaluateIrsNoticeRule({
    hasFederalTaxLien: true,
    saleDate: '2026-11-20',
    noticeText: 'Subject to Notice of Federal Tax Lien recorded in Official Records.',
  });

  assert.equal(irsEval.hasFederalTaxLien, true);
  assert.equal(irsEval.redemptionDays, 120);
  assert.equal(irsEval.statutoryCitation, '26 U.S.C. § 7425(d)');
  assert.match(irsEval.warning, /120-day right of redemption/i);
});
