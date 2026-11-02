'use strict';

/**
 * test/intelligence/hoa_and_bankruptcy_forensics.test.js
 *
 * Track 7 Comprehensive Test Suite:
 * 1. 50-State HOA/COA Super-Lien Priority Engine (NV, CO, FL, DC, MD, CT, PA, and non-super-priority states).
 * 2. Bankruptcy Serial-Filer Automatic Stay Analyzer under 11 U.S.C. § 362 (§ 362(c)(3), § 362(c)(4), § 362(d)(4)).
 * 3. IRS Federal Tax Lien 25-Day Rule and 120-Day Redemption under 26 U.S.C. § 7425.
 * 4. Full title-risk-engine arbitration and edge-case integration.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  evaluateHoaSuperLien,
  HOA_SUPER_PRIORITY_RULES,
} = require('../../server/intelligence/hoa-super-lien');

const {
  analyzeBankruptcyStay,
  detectBankruptcySignals,
} = require('../../server/intelligence/bankruptcy-stay');

const {
  evaluateIrsNoticeRule,
  detectIrsNoticeSignals,
} = require('../../server/intelligence/irs-notice');

const {
  arbitrateTitleRisk,
  classifyForeclosingParty,
  detectIrsFederalTaxLien,
} = require('../../server/intelligence/title-risk-engine');

// ============================================================================
// SUITE 1: 50-STATE HOA / COA SUPER-LIEN PRIORITY ENGINE
// ============================================================================

test('Nevada (NRS 116.3116): 9-month super-priority and extinguishes first mortgage under SFR Investments Pool 1', () => {
  const result = evaluateHoaSuperLien({
    state: 'NV',
    isHoaForeclosing: true,
    monthlyDues: 350,
  });

  assert.equal(result.isSuperPriorityState, true);
  assert.equal(result.statutoryCapMonths, 9);
  assert.equal(result.seniorMortgageExtinguished, true);
  assert.equal(result.riskRating, 'EXTINGUISHES_FIRST_MORTGAGE');
  assert.equal(result.statute, 'NRS 116.3116');
  assert.equal(result.estimatedSuperLienAmount, 3150); // 350 * 9
  assert.ok(result.warningDetails.some((w) => w.includes('Nevada 9-month HOA super-priority')));
  assert.ok(result.warningDetails.some((w) => w.includes('SFR Investments Pool 1 v. U.S. Bank')));
  assert.ok(result.warningDetails.some((w) => w.includes('EXTINGUISHES prior first mortgage')));
});

test('Colorado (C.R.S. § 38-33.3-316): 6 months common expense super-priority', () => {
  const result = evaluateHoaSuperLien({
    state: 'CO',
    isHoaForeclosing: true,
    monthlyDues: 250,
  });

  assert.equal(result.isSuperPriorityState, true);
  assert.equal(result.statutoryCapMonths, 6);
  assert.equal(result.seniorMortgageExtinguished, false);
  assert.equal(result.statute, 'C.R.S. § 38-33.3-316');
  assert.equal(result.estimatedSuperLienAmount, 1500); // 250 * 6
  assert.ok(result.warningDetails.some((w) => w.includes('C.R.S. § 38-33.3-316')));
  assert.ok(result.warningDetails.some((w) => w.includes('6-month super-priority')));
});

test('Florida (Fla. Stat. § 718.116 / § 720.3085): Safe harbor lesser of 12 months or 1% of mortgage debt', () => {
  // Scenario A: 1% of mortgage debt ($2,000) is less than 12 months assessments ($4,800)
  const safeHarborDebtWins = evaluateHoaSuperLien({
    state: 'FL',
    monthlyDues: 400,
    originalMortgageDebt: 200000,
  });

  assert.equal(safeHarborDebtWins.isSuperPriorityState, true);
  assert.equal(safeHarborDebtWins.statutoryCapMonths, 12);
  assert.equal(safeHarborDebtWins.safeHarborApplicable, true);
  assert.equal(safeHarborDebtWins.estimatedSuperLienAmount, 2000); // 200,000 * 0.01 = 2000 < 4800
  assert.ok(safeHarborDebtWins.warningDetails.some((w) => w.includes('Fla. Stat. § 718.116')));

  // Scenario B: 12 months assessments ($1,800) is less than 1% of mortgage debt ($3,500)
  const safeHarborDuesWin = evaluateHoaSuperLien({
    state: 'FL',
    monthlyDues: 150,
    originalMortgageDebt: 350000,
  });

  assert.equal(safeHarborDuesWin.estimatedSuperLienAmount, 1800); // 150 * 12 = 1800 < 3500

  // Scenario C: No mortgage debt provided - defaults to 12 months dues without inventing mortgage balance
  const noDebtProvided = evaluateHoaSuperLien({
    state: 'FL',
    monthlyDues: 250,
  });
  assert.equal(noDebtProvided.estimatedSuperLienAmount, 3000); // 250 * 12
});

test('Maryland (Md. Code Ann., Real Prop. § 11B-117 / § 11-110): 4 months or $1,200 statutory cap', () => {
  // Scenario A: 4 months dues ($1,600) exceeds $1,200 cap -> capped at $1,200
  const cappedAtDollarMax = evaluateHoaSuperLien({
    state: 'MD',
    monthlyDues: 400,
  });

  assert.equal(cappedAtDollarMax.isSuperPriorityState, true);
  assert.equal(cappedAtDollarMax.statutoryCapMonths, 4);
  assert.equal(cappedAtDollarMax.statutoryDollarCap, 1200);
  assert.equal(cappedAtDollarMax.estimatedSuperLienAmount, 1200);
  assert.ok(cappedAtDollarMax.warningDetails.some((w) => w.includes('$1,200, whichever is less')));

  // Scenario B: 4 months dues ($600) is under $1,200 cap -> capped at $600
  const underDollarMax = evaluateHoaSuperLien({
    state: 'MD',
    monthlyDues: 150,
  });

  assert.equal(underDollarMax.estimatedSuperLienAmount, 600); // 150 * 4 = 600
});

test('Washington DC (D.C. Code § 42-1903.13): 6 months condominium super-priority', () => {
  const result = evaluateHoaSuperLien({
    state: 'DC',
    monthlyDues: 500,
  });

  assert.equal(result.isSuperPriorityState, true);
  assert.equal(result.statutoryCapMonths, 6);
  assert.equal(result.statute, 'D.C. Code § 42-1903.13');
  assert.equal(result.estimatedSuperLienAmount, 3000); // 500 * 6
  assert.ok(result.warningDetails.some((w) => w.includes('D.C. Code § 42-1903.13')));
});

test('Connecticut (Conn. Gen. Stat. § 47-258): 9 months super-priority', () => {
  const result = evaluateHoaSuperLien({
    state: 'CT',
    monthlyDues: 300,
  });

  assert.equal(result.isSuperPriorityState, true);
  assert.equal(result.statutoryCapMonths, 9);
  assert.equal(result.statute, 'Conn. Gen. Stat. § 47-258');
  assert.equal(result.estimatedSuperLienAmount, 2700); // 300 * 9
  assert.ok(result.warningDetails.some((w) => w.includes('Conn. Gen. Stat. § 47-258')));
});

test('Pennsylvania (68 Pa.C.S. § 3315): 6 months super-priority', () => {
  const result = evaluateHoaSuperLien({
    state: 'PA',
    monthlyDues: 220,
  });

  assert.equal(result.isSuperPriorityState, true);
  assert.equal(result.statutoryCapMonths, 6);
  assert.equal(result.statute, '68 Pa.C.S. § 3315');
  assert.equal(result.estimatedSuperLienAmount, 1320); // 220 * 6
  assert.ok(result.warningDetails.some((w) => w.includes('68 Pa.C.S. § 3315')));
});

test('Non-super-priority states (TX, OH, CA): HOA liens are strictly subordinate to 1st mortgage', () => {
  for (const st of ['TX', 'OH', 'CA', 'AZ', 'GA', 'NC', 'SC', 'VA']) {
    const result = evaluateHoaSuperLien({
      state: st,
      isHoaForeclosing: true,
      monthlyDues: 300,
    });

    assert.equal(result.isSuperPriorityState, false, `${st} must be non-super-priority`);
    assert.equal(result.statutoryCapMonths, 0);
    assert.equal(result.seniorMortgageExtinguished, false);
    assert.equal(result.riskRating, 'CRITICAL_SENIOR_MORTGAGE_SURVIVES');
    assert.equal(result.estimatedSuperLienAmount, 0);
    assert.ok(result.warningDetails.some((w) => w.includes('CRITICAL TITLE DEFECT: HOA foreclosing in a non-super-priority state')));
  }
});

test('Zero-Fabrication Invariant: Missing monthly dues outputs null amount without guessing', () => {
  const missingDues = evaluateHoaSuperLien({
    state: 'NV',
    isHoaForeclosing: true,
    monthlyDues: null,
  });

  assert.equal(missingDues.estimatedSuperLienAmount, null);
  assert.equal(missingDues.statutoryCapMonths, 9);
  assert.equal(missingDues.riskRating, 'EXTINGUISHES_FIRST_MORTGAGE');

  const undefinedDues = evaluateHoaSuperLien({
    state: 'FL',
    monthlyDues: undefined,
  });
  assert.equal(undefinedDues.estimatedSuperLienAmount, null);
  assert.equal(undefinedDues.statutoryCapMonths, 12);
});

// ============================================================================
// SUITE 2: BANKRUPTCY SERIAL-FILER AUTOMATIC STAY ANALYZER (11 U.S.C. § 362)
// ============================================================================

test('Single prior case dismissed within 1 year (§ 362(c)(3)): Stay terminates on day 30', () => {
  const petitionDate = '2026-10-01';

  // Day 14 post-petition: stay temporarily active
  const day14 = analyzeBankruptcyStay({
    hasBankruptcyFiling: true,
    petitionDate,
    saleDate: '2026-10-15',
    priorDismissalsWithin1Year: 1,
  });

  assert.equal(day14.stayEffective, true);
  assert.equal(day14.canProceedWithAuction, false);
  assert.equal(day14.stayExpiresAt, '2026-10-31');
  assert.equal(day14.serialFilerFlag, 'SINGLE_PRIOR_DISMISSAL_30_DAY_EXPIRATION');
  assert.equal(day14.statutoryRuleCited, '11 U.S.C. § 362(c)(3)');
  assert.match(day14.bidderRecommendation, /AUTOMATIC STAY TEMPORARILY ACTIVE/);

  // Day 35 post-petition: stay automatically terminated without extension
  const day35 = analyzeBankruptcyStay({
    hasBankruptcyFiling: true,
    petitionDate,
    saleDate: '2026-11-05',
    priorDismissalsWithin1Year: 1,
  });

  assert.equal(day35.stayEffective, false);
  assert.equal(day35.canProceedWithAuction, true);
  assert.equal(day35.stayExpiresAt, '2026-10-31');
  assert.equal(day35.serialFilerFlag, 'SINGLE_PRIOR_DISMISSAL_30_DAY_EXPIRATION');
  assert.equal(day35.statutoryRuleCited, '11 U.S.C. § 362(c)(3)');
  assert.match(day35.bidderRecommendation, /AUTOMATIC STAY TERMINATED/);

  // Day 35 post-petition with affirmative court extension: stay remains active
  const day35WithExtension = analyzeBankruptcyStay({
    hasBankruptcyFiling: true,
    petitionDate,
    saleDate: '2026-11-05',
    priorDismissalsWithin1Year: 1,
    hasCourtExtension: true,
  });

  assert.equal(day35WithExtension.stayEffective, true);
  assert.equal(day35WithExtension.canProceedWithAuction, false);
  assert.equal(day35WithExtension.statutoryRuleCited, '11 U.S.C. § 362(c)(3)(B)');
  assert.match(day35WithExtension.bidderRecommendation, /STAY EXTENDED BY COURT ORDER/);
});

test('Two or more prior cases dismissed within 1 year (§ 362(c)(4)): Zero automatic stay takes effect upon filing', () => {
  const result = analyzeBankruptcyStay({
    hasBankruptcyFiling: true,
    petitionDate: '2026-10-10',
    saleDate: '2026-10-12', // 2 days post-petition
    priorDismissalsWithin1Year: 2,
  });

  assert.equal(result.stayEffective, false);
  assert.equal(result.canProceedWithAuction, true);
  assert.equal(result.stayExpiresAt, null);
  assert.equal(result.serialFilerFlag, 'TWO_OR_MORE_PRIOR_DISMISSALS_ZERO_STAY');
  assert.equal(result.statutoryRuleCited, '11 U.S.C. § 362(c)(4)');
  assert.match(result.bidderRecommendation, /ZERO AUTOMATIC STAY/);
  assert.match(result.bidderRecommendation, /NO automatic stay took effect upon filing/);
});

test('In Rem Bankruptcy Relief (§ 362(d)(4)): 2-year binding property-specific stay exclusion', () => {
  // In rem order entered 6 months ago (< 730 days)
  const activeInRem = analyzeBankruptcyStay({
    hasBankruptcyFiling: true,
    petitionDate: '2026-10-01',
    hasInRemReliefOrder: true,
    inRemOrderDate: '2026-04-01',
    saleDate: '2026-10-15',
  });

  assert.equal(activeInRem.stayEffective, false);
  assert.equal(activeInRem.canProceedWithAuction, true);
  assert.equal(activeInRem.inRemReliefActive, true);
  assert.equal(activeInRem.serialFilerFlag, 'IN_REM_RELIEF_RECORDED_2_YEAR_BAR');
  assert.equal(activeInRem.statutoryRuleCited, '11 U.S.C. § 362(d)(4)');
  assert.match(activeInRem.bidderRecommendation, /IN REM RELIEF ACTIVE/);

  // In rem order entered 3 years ago (> 730 days) -> expired, normal stay governs
  const expiredInRem = analyzeBankruptcyStay({
    hasBankruptcyFiling: true,
    petitionDate: '2026-10-01',
    hasInRemReliefOrder: true,
    inRemOrderDate: '2023-01-01',
    saleDate: '2026-10-15',
  });

  assert.equal(expiredInRem.stayEffective, true);
  assert.equal(expiredInRem.canProceedWithAuction, false);
  assert.equal(expiredInRem.statutoryRuleCited, '11 U.S.C. § 362(a)');
});

test('Standard initial bankruptcy filing without dismissals: § 362(a) stay halts auction completely', () => {
  const result = analyzeBankruptcyStay({
    hasBankruptcyFiling: true,
    petitionDate: '2026-10-01',
    saleDate: '2026-10-15',
    priorDismissalsWithin1Year: 0,
  });

  assert.equal(result.stayEffective, true);
  assert.equal(result.canProceedWithAuction, false);
  assert.equal(result.statutoryRuleCited, '11 U.S.C. § 362(a)');
  assert.match(result.bidderRecommendation, /AUTOMATIC STAY IN EFFECT/);
  assert.match(result.bidderRecommendation, /void ab initio/i);
});

test('detectBankruptcySignals: extracts docket case number, chapter, and serial dismissal counts', () => {
  const text = 'Debtor filed Chapter 13 Bankruptcy Petition Case No. 26-10984. Prior 2 cases dismissed within past year under 362(c)(4).';
  const detected = detectBankruptcySignals(text);

  assert.equal(detected.hasBankruptcyFiling, true);
  assert.equal(detected.chapter, '13');
  assert.equal(detected.caseNumber, '26-10984');
  assert.equal(detected.priorDismissalsCount, 2);

  const stayAnalysis = analyzeBankruptcyStay({ noticeText: text, saleDate: '2026-10-15' });
  assert.equal(stayAnalysis.stayEffective, false);
  assert.equal(stayAnalysis.serialFilerFlag, 'TWO_OR_MORE_PRIOR_DISMISSALS_ZERO_STAY');
});

// ============================================================================
// SUITE 3: IRS FEDERAL TAX LIEN 25-DAY NOTICE RULE (26 U.S.C. § 7425)
// ============================================================================

test('IRS 25-Day Rule: Timely notice (>= 25 days) discharges lien subject to 120-day IRS redemption', () => {
  const result = evaluateIrsNoticeRule({
    hasFederalTaxLien: true,
    saleDate: '2026-10-30',
    irsNoticeDate: '2026-09-30', // 30 days prior
  });

  assert.equal(result.hasFederalTaxLien, true);
  assert.equal(result.noticeProvided, true);
  assert.equal(result.noticeTimely, true);
  assert.equal(result.noticeDaysBeforeSale, 30);
  assert.equal(result.lienSurvivesForeclosure, false);
  assert.equal(result.taxLienDischarged, true);
  assert.equal(result.irsRedemptionRightApplies, true);
  assert.equal(result.redemptionDays, 120);
  assert.equal(result.riskLevel, 'HIGH');
  assert.equal(result.statutoryCitation, '26 U.S.C. § 7425(d)');
  assert.match(result.warning, /120-DAY IRS REDEMPTION/);
});

test('IRS 25-Day Rule: Failure to give notice causes federal tax lien to survive foreclosure intact', () => {
  // Notice completely omitted
  const noNotice = evaluateIrsNoticeRule({
    hasFederalTaxLien: true,
    noticeProvided: false,
  });

  assert.equal(noNotice.hasFederalTaxLien, true);
  assert.equal(noNotice.noticeProvided, false);
  assert.equal(noNotice.noticeTimely, false);
  assert.equal(noNotice.lienSurvivesForeclosure, true);
  assert.equal(noNotice.taxLienDischarged, false);
  assert.equal(noNotice.irsRedemptionRightApplies, false);
  assert.equal(noNotice.redemptionDays, 0);
  assert.equal(noNotice.riskLevel, 'CRITICAL');
  assert.equal(noNotice.statutoryCitation, '26 U.S.C. § 7425(b)(1)');
  assert.match(noNotice.warning, /Federal Tax Lien survives foreclosure/i);
  assert.match(noNotice.bidderRecommendation, /DO NOT BID/);

  // Notice served only 10 days before sale (< 25 days)
  const lateNotice = evaluateIrsNoticeRule({
    hasFederalTaxLien: true,
    saleDate: '2026-10-20',
    irsNoticeDate: '2026-10-10', // 10 days prior
  });

  assert.equal(lateNotice.noticeTimely, false);
  assert.equal(lateNotice.noticeDaysBeforeSale, 10);
  assert.equal(lateNotice.lienSurvivesForeclosure, true);
  assert.equal(lateNotice.riskLevel, 'CRITICAL');
});

test('detectIrsNoticeSignals: parses certified mail proof of service vs notice failure from text', () => {
  const timelyText = 'Defendant Internal Revenue Service served via certified mail on 2026-09-01. Notice of sale provided pursuant to 26 U.S.C. § 7425.';
  const timelySignals = detectIrsNoticeSignals(timelyText);
  assert.equal(timelySignals.hasFederalTaxLien, true);
  assert.equal(timelySignals.noticeProvided, true);
  assert.equal(timelySignals.noticeMethod, 'CERTIFIED_MAIL');

  const failureText = 'Federal tax lien recorded in Book 102 Page 45. Notice of sale not served on IRS District Director; no notice provided to IRS.';
  const failureSignals = detectIrsNoticeSignals(failureText);
  assert.equal(failureSignals.hasFederalTaxLien, true);
  assert.equal(failureSignals.explicitNoticeFailure, true);
  assert.equal(failureSignals.noticeProvided, false);
});

// ============================================================================
// SUITE 4: FULL TITLE RISK ARBITRATION INTEGRATION (title-risk-engine.js)
// ============================================================================

test('arbitrateTitleRisk: Nevada HOA foreclosure extinguishes senior mortgage and marks bid permissible', () => {
  const listing = {
    id: 'nv-hoa-001',
    plaintiff: 'Red Rock Country Club Homeowners Association',
    state: 'NV',
    openingBid: 14500,
    monthlyHoa: 380,
  };

  const risk = arbitrateTitleRisk(listing);
  assert.equal(risk.riskLevel, 'HIGH');
  assert.equal(risk.firstMortgageSurvives, false); // Extinguished by HOA foreclosure!
  assert.equal(risk.canProceedWithBid, true);
  assert.equal(risk.hoaSuperPriority.isSuperPriorityState, true);
  assert.equal(risk.hoaSuperPriority.seniorMortgageExtinguished, true);
  assert.equal(risk.hoaSuperPriority.riskRating, 'EXTINGUISHES_FIRST_MORTGAGE');
  assert.equal(risk.hoaSuperPriority.estimatedSuperLienAmount, 3420); // 380 * 9
  assert.ok(risk.titleWarnings.some((w) => w.includes('Nevada 9-month HOA super-priority')));
  assert.ok(risk.titleWarnings.some((w) => w.includes('SFR Investments Pool 1')));
});

test('arbitrateTitleRisk: Texas HOA foreclosure trips CRITICAL defect that first mortgage survives', () => {
  const listing = {
    id: 'tx-hoa-001',
    plaintiff: 'Woodlands Community Association Inc',
    state: 'TX',
    openingBid: 9200,
  };

  const risk = arbitrateTitleRisk(listing);
  assert.equal(risk.riskLevel, 'CRITICAL');
  assert.equal(risk.firstMortgageSurvives, true);
  assert.equal(risk.canProceedWithBid, false);
  assert.match(risk.titleActionAdvice, /DO NOT BID/);
  assert.ok(risk.titleWarnings.some((w) => w.includes('non-super-priority state')));
});

test('arbitrateTitleRisk: Florida and Colorado HOA foreclosure preserves first mortgage survival and trips CRITICAL defect', () => {
  const listingFL = {
    id: 'fl-hoa-001',
    plaintiff: 'Palm Beach Point Property Owners Association',
    state: 'FL',
    openingBid: 8500,
    monthlyHoa: 250,
  };

  const riskFL = arbitrateTitleRisk(listingFL);
  assert.equal(riskFL.riskLevel, 'HIGH');
  assert.equal(riskFL.firstMortgageSurvives, true);
  assert.ok(riskFL.titleWarnings.some((w) => w.includes('does NOT extinguish prior recorded 1st mortgage')));

  const listingCO = {
    id: 'co-hoa-001',
    plaintiff: 'Cherry Creek Condominium Association',
    state: 'CO',
    openingBid: 6200,
    monthlyHoa: 300,
  };

  const riskCO = arbitrateTitleRisk(listingCO);
  assert.equal(riskCO.riskLevel, 'HIGH');
  assert.equal(riskCO.firstMortgageSurvives, true);
  assert.ok(riskCO.titleWarnings.some((w) => w.includes('does NOT extinguish prior recorded 1st mortgage')));
});

test('arbitrateTitleRisk: Active bankruptcy stay elevates risk to CRITICAL and halts bidding', () => {
  const listing = {
    id: 'oh-bk-001',
    plaintiff: 'Huntington National Bank',
    state: 'OH',
    openingBid: 85000,
    bankruptcy: {
      active: true,
      petitionDate: '2026-10-01',
      priorDismissalsWithin1Year: 0,
    },
    saleDate: '2026-10-15',
  };

  const risk = arbitrateTitleRisk(listing);
  assert.equal(risk.riskLevel, 'CRITICAL');
  assert.equal(risk.canProceedWithBid, false);
  assert.equal(risk.bankruptcyStay.stayEffective, true);
  assert.ok(risk.titleWarnings.some((w) => w.includes('BANKRUPTCY AUTOMATIC STAY ACTIVE (11 U.S.C. § 362(a))')));
  assert.match(risk.titleActionAdvice, /Sale stayed by federal bankruptcy court/);
});

test('arbitrateTitleRisk: Bankruptcy serial filer with 2 prior dismissals allows auction to proceed', () => {
  const listing = {
    id: 'oh-bk-002',
    plaintiff: 'PNC Bank, N.A.',
    state: 'OH',
    openingBid: 120000,
    bankruptcy: {
      active: true,
      petitionDate: '2026-10-10',
      priorDismissalsWithin1Year: 2,
    },
    saleDate: '2026-10-14',
  };

  const risk = arbitrateTitleRisk(listing);
  assert.equal(risk.riskLevel, 'LOW'); // Senior 1st mortgage foreclosing, stay ineffective
  assert.equal(risk.canProceedWithBid, true);
  assert.equal(risk.bankruptcyStay.stayEffective, false);
  assert.equal(risk.bankruptcyStay.serialFilerFlag, 'TWO_OR_MORE_PRIOR_DISMISSALS_ZERO_STAY');
  assert.ok(risk.titleWarnings.some((w) => w.includes('BANKRUPTCY SERIAL FILER (11 U.S.C. § 362(c)(4))')));
  assert.ok(risk.titleWarnings.some((w) => w.includes('ZERO automatic stay took effect upon filing')));
});

test('arbitrateTitleRisk: IRS 25-day notice failure trips CRITICAL defect and surviving tax lien', () => {
  const listing = {
    id: 'fl-irs-001',
    plaintiff: 'Wells Fargo Bank, N.A.',
    state: 'FL',
    openingBid: 160000,
    hasIrsLien: true,
    saleDate: '2026-10-25',
    irsNoticeDate: '2026-10-15', // only 10 days notice (< 25 days)
  };

  const risk = arbitrateTitleRisk(listing);
  assert.equal(risk.riskLevel, 'CRITICAL');
  assert.equal(risk.canProceedWithBid, false);
  assert.equal(risk.irsNoticeEvaluation.lienSurvivesForeclosure, true);
  assert.ok(risk.titleWarnings.some((w) => w.includes('Federal Tax Lien survives foreclosure under 26 U.S.C. § 7425(b)(1)')));
  assert.match(risk.titleActionAdvice, /Federal tax lien survives sale due to 26 U.S.C. § 7425 25-day notice failure/);
});
