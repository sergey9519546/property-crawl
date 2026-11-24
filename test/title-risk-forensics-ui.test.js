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

test('Lien Waterfall Engine: NV NRS 116.3116 HOA super-priority extinguishes 1st mortgage while sub-priority leaves it surviving', () => {
  const superPriority = computeLienWaterfall({
    winningBid: 80000,
    foreclosingLienType: 'hoa_assessment',
    foreclosingLienAmount: 12000,
    delinquentTaxesAmount: 0,
    seniorMortgageAmount: 220000,
    state: 'NV',
    hoaSuperPriorityForeclosure: true,
  });
  assert.equal(superPriority.complete, true);
  assert.equal(superPriority.totalSurvivingDebtOnProperty, 0);
  assert.equal(superPriority.totalEffectiveAcquisitionCost, 80000);
  assert.equal(superPriority.criticalAlert, null);
  const extinguishedMtg = superPriority.items.find((i) => i.type === 'first_mortgage');
  assert.ok(extinguishedMtg);
  assert.equal(extinguishedMtg.remainingBalanceAgainstProperty, 0);
  assert.equal(extinguishedMtg.status, 'partially_satisfied_from_proceeds');

  // Even when 1st mortgage balance is unknown, NV super-priority acquisition cost is computable
  const superNoSeniorInput = computeLienWaterfall({
    winningBid: 50000,
    foreclosingLienType: 'hoa_assessment',
    foreclosingLienAmount: 50000,
    delinquentTaxesAmount: 0,
    seniorMortgageAmount: null,
    state: 'NV',
  });
  assert.equal(superNoSeniorInput.complete, true);
  assert.equal(superNoSeniorInput.totalSurvivingDebtOnProperty, 0);
  assert.equal(superNoSeniorInput.totalEffectiveAcquisitionCost, 50000);

  // Sub-priority / lender-tendered NV HOA foreclosure: 1st mortgage survives
  const subPriority = computeLienWaterfall({
    winningBid: 40000,
    foreclosingLienType: 'hoa_assessment',
    foreclosingLienAmount: 10000,
    delinquentTaxesAmount: 0,
    seniorMortgageAmount: 200000,
    state: 'NV',
    hoaSuperPriorityForeclosure: false,
  });
  assert.equal(subPriority.complete, true);
  assert.equal(subPriority.totalSurvivingDebtOnProperty, 200000);
  assert.equal(subPriority.totalEffectiveAcquisitionCost, 240000);
  assert.match(subPriority.criticalAlert, /SURVIVES against the purchaser/i);
});

test('TitleRiskForensics UI contract: synced 22 HOA states, unknown default, taxes input, NV parity, empty state & IRS sim label', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const { HOA_SUPER_PRIORITY_RULES } = require('../server/intelligence/hoa-super-lien');
  const trfSrc = fs.readFileSync(path.join(__dirname, '..', 'src/components/terminal/title-risk-forensics.tsx'), 'utf8');

  // 1. Synced HOA_SUPER_PRIORITY_STATES (matches hoa-super-lien.js 22 states: includes VT, excludes DE and NH)
  const setMatch = trfSrc.match(/const HOA_SUPER_PRIORITY_STATES = new Set\(\[([\s\S]*?)\]\);/);
  assert.ok(setMatch, 'HOA_SUPER_PRIORITY_STATES set must exist');
  const uiStates = new Set([...setMatch[1].matchAll(/"([A-Z]{2})"/g)].map((m) => m[1]));
  assert.deepEqual([...uiStates].sort(), Object.keys(HOA_SUPER_PRIORITY_RULES).sort());
  assert.equal(uiStates.has('VT'), true);
  assert.equal(uiStates.has('DE'), false);
  assert.equal(uiStates.has('NH'), false);

  // 2. inferInitialLienType defaults to "unknown", classifies tax sales, never treats IRS as tax_deed
  assert.match(trfSrc, /return "unknown";/);
  assert.match(trfSrc, /tax\[_\\s-\]\*sale/);
  assert.match(trfSrc, /!isIrsContext/);

  // 3. Delinquent taxes input is wired into computeLienWaterfall
  assert.match(trfSrc, /delinquentTaxesInput/);
  assert.match(trfSrc, /delinquentTaxesAmount:\s*validDelinquentTaxes/);

  const enSrc = fs.readFileSync(path.join(__dirname, '..', 'src/lib/i18n/messages/en.ts'), 'utf8');

  // 4. NV HOA super-priority parity and no contradiction with t.trfJuniorTakesSubject
  assert.match(trfSrc, /isNvHoaSuperPriority\s*\?\s*t\.trfNvHoaSuperDesc/);
  assert.match(enSrc, /trfNvHoaSuperDesc:\s*"9-month super-priority HOA foreclosure extinguishes prior 1st mortgage/);

  // 5. Empty state & explicit IRS manual simulation copy (moved to i18n messages)
  assert.match(trfSrc, /!stateCode\s*\?\s*t\.trfStateUnknownBadge/);
  assert.match(trfSrc, /t\.trfIrsSimDesc/);
  assert.match(enSrc, /trfStateUnknownBadge:\s*"State Unknown"/);
  assert.match(enSrc, /trfIrsSimDesc:\s*"Simulated IRS 120-day redemption sensitivity/);

  // 6. Unpublished judgment is never fabricated from currentBid
  assert.doesNotMatch(trfSrc, /currentJudgment\s*=.*\?\s*judgment\s*:\s*currentBid/);
});

test('Lien Waterfall & Title Engine: tax_deed extinguishes senior mortgage and lender plaintiff resists body-text tax/IRS overrides', () => {
  const taxDeedWaterfall = computeLienWaterfall({
    winningBid: 90000,
    foreclosingLienType: 'tax_deed',
    foreclosingLienAmount: 18000,
    delinquentTaxesAmount: 0,
    seniorMortgageAmount: 240000,
    state: 'FL',
  });
  assert.equal(taxDeedWaterfall.complete, true);
  assert.equal(taxDeedWaterfall.totalSurvivingDebtOnProperty, 0);
  const foreclosingTax = taxDeedWaterfall.items.find((i) => i.isForeclosingLien);
  assert.ok(foreclosingTax);
  assert.equal(foreclosingTax.id, 'foreclosing-tax-01');
  const extinguishedPrior = taxDeedWaterfall.items.find((i) => i.type === 'first_mortgage');
  assert.ok(extinguishedPrior);
  assert.equal(extinguishedPrior.isForeclosingLien, false);
  assert.equal(extinguishedPrior.remainingBalanceAgainstProperty, 0);

  assert.equal(
    classifyForeclosingParty('Wells Fargo Bank, N.A.', 'Purchaser responsible for delinquent tax; notice served on IRS.'),
    'FIRST_MORTGAGE',
  );
  const flHoaRisk = arbitrateTitleRisk({
    plaintiff: 'Palm Beach Point Property Owners Association',
    state: 'FL',
    openingBid: 8500,
  });
  assert.equal(flHoaRisk.firstMortgageSurvives, true);
  assert.equal(flHoaRisk.canProceedWithBid, false);
});
