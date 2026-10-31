'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  STATE_REASSESSMENT_RULES,
  computeReassessmentShock,
} = require('../src/lib/underwriting.ts');

test('OH: verifies 35% statutory assessment ratio, ~1.52% effective rate and Ohio Rev. Code § 5713.03', () => {
  const rule = STATE_REASSESSMENT_RULES.OH;
  assert.ok(rule, 'OH reassessment rule must be defined');
  assert.equal(rule.state, 'OH');
  assert.equal(rule.effectiveTaxRatePct, 1.52);
  assert.equal(rule.assessmentRatioPct, 35);
  assert.equal(rule.supplementalBillExpected, false);
  assert.match(rule.statutoryReference, /Ohio Rev\. Code § 5713\.03/);
  assert.match(rule.statutoryReference, /35%/);
  assert.match(rule.statutoryReference, /triennial update/);

  const shock = computeReassessmentShock({
    purchasePrice: 300000,
    state: 'OH',
    priorAnnualTax: 2500,
  });
  assert.equal(shock.reassessedAnnualTax, 4560); // 300,000 * 1.52% = 4,560
  assert.equal(shock.annualTaxShock, 2060); // 4,560 - 2,500
  assert.equal(shock.monthlyTaxShock, 172); // round(2060 / 12)
  assert.equal(shock.supplementalBillEstimate, null);
  assert.match(shock.explanation, /OH_TRIENNIAL_UPDATE/);
  assert.match(shock.explanation, /\$4,560\/year/);
  assert.match(shock.explanation, /\+\$2,060\/year/);
});

test('PA: verifies Common Level Ratio (CLR) applies, ~1.49% effective rate and 72 P.S. § 5452.1a', () => {
  const rule = STATE_REASSESSMENT_RULES.PA;
  assert.ok(rule, 'PA reassessment rule must be defined');
  assert.equal(rule.state, 'PA');
  assert.equal(rule.effectiveTaxRatePct, 1.49);
  assert.equal(rule.supplementalBillExpected, false);
  assert.match(rule.statutoryReference, /72 P\.S\. § 5452\.1a/);
  assert.match(rule.statutoryReference, /Common Level Ratio/);
  assert.match(rule.statutoryReference, /STEB/);

  const shock = computeReassessmentShock({
    purchasePrice: 250000,
    state: 'PA',
    priorAnnualTax: 2000,
  });
  assert.equal(shock.reassessedAnnualTax, 3725); // 250,000 * 1.49% = 3,725
  assert.equal(shock.annualTaxShock, 1725);
  assert.equal(shock.monthlyTaxShock, 144);
  assert.equal(shock.supplementalBillEstimate, null);
  assert.match(shock.explanation, /PA_COMMON_LEVEL_RATIO/);
});

test('GA: verifies 40% statutory assessment ratio, ~0.92% effective rate and O.C.G.A. § 48-5-7', () => {
  const rule = STATE_REASSESSMENT_RULES.GA;
  assert.ok(rule, 'GA reassessment rule must be defined');
  assert.equal(rule.state, 'GA');
  assert.equal(rule.effectiveTaxRatePct, 0.92);
  assert.equal(rule.assessmentRatioPct, 40);
  assert.equal(rule.supplementalBillExpected, false);
  assert.match(rule.statutoryReference, /O\.C\.G\.A\. § 48-5-7/);
  assert.match(rule.statutoryReference, /O\.C\.G\.A\. § 48-5-2/);
  assert.match(rule.statutoryReference, /40%/);

  const shock = computeReassessmentShock({
    purchasePrice: 400000,
    state: 'GA',
    priorAnnualTax: 1800,
  });
  assert.equal(shock.reassessedAnnualTax, 3680); // 400,000 * 0.92% = 3,680
  assert.equal(shock.annualTaxShock, 1880);
  assert.equal(shock.monthlyTaxShock, 157);
  assert.equal(shock.supplementalBillEstimate, null);
  assert.match(shock.explanation, /GA_TRANSFER_REASSESSMENT/);
});

test('MI: verifies Proposal A uncapping to 50% SEV, ~1.48% rate and MCL § 211.27a', () => {
  const rule = STATE_REASSESSMENT_RULES.MI;
  assert.ok(rule, 'MI reassessment rule must be defined');
  assert.equal(rule.state, 'MI');
  assert.equal(rule.effectiveTaxRatePct, 1.48);
  assert.equal(rule.assessmentRatioPct, 50);
  assert.equal(rule.annualCapPct, 5);
  assert.equal(rule.supplementalBillExpected, false);
  assert.match(rule.statutoryReference, /MCL § 211\.27a/);
  assert.match(rule.statutoryReference, /Proposal A uncapping/);
  assert.match(rule.statutoryReference, /State Equalized Value/);

  const shock = computeReassessmentShock({
    purchasePrice: 200000,
    state: 'MI',
    priorAnnualTax: 1500,
  });
  assert.equal(shock.reassessedAnnualTax, 2960); // 200,000 * 1.48% = 2,960
  assert.equal(shock.annualTaxShock, 1460);
  assert.equal(shock.monthlyTaxShock, 122);
  assert.equal(shock.supplementalBillEstimate, null);
  assert.match(shock.explanation, /Proposal A uncapping to 50% SEV/);
  assert.match(shock.explanation, /MCL § 211\.27a/);
});

test('WA: verifies annual revaluation cycle, ~0.94% effective rate and RCW 84.41.030', () => {
  const rule = STATE_REASSESSMENT_RULES.WA;
  assert.ok(rule, 'WA reassessment rule must be defined');
  assert.equal(rule.state, 'WA');
  assert.equal(rule.effectiveTaxRatePct, 0.94);
  assert.equal(rule.supplementalBillExpected, false);
  assert.match(rule.statutoryReference, /RCW 84\.41\.030/);
  assert.match(rule.statutoryReference, /annual/i);

  const shock = computeReassessmentShock({
    purchasePrice: 500000,
    state: 'WA',
    priorAnnualTax: 3200,
  });
  assert.equal(shock.reassessedAnnualTax, 4700); // 500,000 * 0.94% = 4,700
  assert.equal(shock.annualTaxShock, 1500);
  assert.equal(shock.monthlyTaxShock, 125);
  assert.equal(shock.supplementalBillEstimate, null);
  assert.match(shock.explanation, /WA_ANNUAL_REVALUATION/);
});

test('TN: verifies 25% statutory assessment ratio, ~0.66% effective rate and T.C.A. § 67-5-801', () => {
  const rule = STATE_REASSESSMENT_RULES.TN;
  assert.ok(rule, 'TN reassessment rule must be defined');
  assert.equal(rule.state, 'TN');
  assert.equal(rule.effectiveTaxRatePct, 0.66);
  assert.equal(rule.assessmentRatioPct, 25);
  assert.equal(rule.supplementalBillExpected, false);
  assert.match(rule.statutoryReference, /T\.C\.A\. § 67-5-801/);
  assert.match(rule.statutoryReference, /25%/);
  assert.match(rule.statutoryReference, /§ 67-5-1601/);

  const shock = computeReassessmentShock({
    purchasePrice: 350000,
    state: 'TN',
    priorAnnualTax: 1200,
  });
  assert.equal(shock.reassessedAnnualTax, 2310); // 350,000 * 0.66% = 2,310
  assert.equal(shock.annualTaxShock, 1110);
  assert.equal(shock.monthlyTaxShock, 93);
  assert.equal(shock.supplementalBillEstimate, null);
  assert.match(shock.explanation, /TN_PERIODIC_REAPPRAISAL/);
});

test('MD: verifies triennial reassessment cycle, ~1.05% effective rate and Md. Code Tax-Prop. § 8-103', () => {
  const rule = STATE_REASSESSMENT_RULES.MD;
  assert.ok(rule, 'MD reassessment rule must be defined');
  assert.equal(rule.state, 'MD');
  assert.equal(rule.effectiveTaxRatePct, 1.05);
  assert.equal(rule.annualCapPct, 10);
  assert.equal(rule.supplementalBillExpected, false);
  assert.match(rule.statutoryReference, /Md\. Code Tax-Prop\. § 8-103/);
  assert.match(rule.statutoryReference, /triennial reassessment/);
  assert.match(rule.statutoryReference, /Homestead Tax Credit/);

  const shock = computeReassessmentShock({
    purchasePrice: 450000,
    state: 'MD',
    priorAnnualTax: 3000,
  });
  assert.equal(shock.reassessedAnnualTax, 4725); // 450,000 * 1.05% = 4,725
  assert.equal(shock.annualTaxShock, 1725);
  assert.equal(shock.monthlyTaxShock, 144);
  assert.equal(shock.supplementalBillEstimate, null);
  assert.match(shock.explanation, /MD_TRIENNIAL_CYCLE/);
});

test('AZ: verifies 10% statutory assessment ratio, ~0.63% rate, 5% LPV cap and A.R.S. § 42-12003', () => {
  const rule = STATE_REASSESSMENT_RULES.AZ;
  assert.ok(rule, 'AZ reassessment rule must be defined');
  assert.equal(rule.state, 'AZ');
  assert.equal(rule.effectiveTaxRatePct, 0.63);
  assert.equal(rule.assessmentRatioPct, 10);
  assert.equal(rule.annualCapPct, 5);
  assert.equal(rule.supplementalBillExpected, false);
  assert.match(rule.statutoryReference, /A\.R\.S\. § 42-12003/);
  assert.match(rule.statutoryReference, /A\.R\.S\. § 42-13301/);
  assert.match(rule.statutoryReference, /10%/);

  const shock = computeReassessmentShock({
    purchasePrice: 400000,
    state: 'AZ',
    priorAnnualTax: 1500,
  });
  assert.equal(shock.reassessedAnnualTax, 2520); // 400,000 * 0.63% = 2,520
  assert.equal(shock.annualTaxShock, 1020);
  assert.equal(shock.monthlyTaxShock, 85);
  assert.equal(shock.supplementalBillEstimate, null);
  assert.match(shock.explanation, /AZ_CLASS_3_RESIDENTIAL/);
});

test('NC: verifies octennial revaluation schedule, ~0.78% effective rate and N.C.G.S. § 105-286', () => {
  const rule = STATE_REASSESSMENT_RULES.NC;
  assert.ok(rule, 'NC reassessment rule must be defined');
  assert.equal(rule.state, 'NC');
  assert.equal(rule.effectiveTaxRatePct, 0.78);
  assert.equal(rule.supplementalBillExpected, false);
  assert.match(rule.statutoryReference, /N\.C\.G\.S\. § 105-286/);
  assert.match(rule.statutoryReference, /octennial/);

  const shock = computeReassessmentShock({
    purchasePrice: 280000,
    state: 'NC',
    priorAnnualTax: 1400,
  });
  assert.equal(shock.reassessedAnnualTax, 2184); // 280,000 * 0.78% = 2,184
  assert.equal(shock.annualTaxShock, 784);
  assert.equal(shock.monthlyTaxShock, 65);
  assert.equal(shock.supplementalBillEstimate, null);
  assert.match(shock.explanation, /NC_OCTENNIAL_REVALUATION/);
});

test('SC: verifies legal residence 4% vs investor 6% assessment ratio under S.C. Code Ann. § 12-43-220', () => {
  const rule = STATE_REASSESSMENT_RULES.SC;
  assert.ok(rule, 'SC reassessment rule must be defined');
  assert.equal(rule.state, 'SC');
  assert.equal(rule.effectiveTaxRatePct, 0.57);
  assert.equal(rule.assessmentRatioPct, 4);
  assert.equal(rule.investorAssessmentRatioPct, 6);
  assert.equal(rule.investorEffectiveTaxRatePct, 0.85);
  assert.equal(rule.supplementalBillExpected, false);
  assert.match(rule.statutoryReference, /S\.C\. Code Ann\. § 12-43-220/);
  assert.match(rule.statutoryReference, /4% legal residence vs 6% investor/);

  // Legal residence baseline (isInvestor = false / omitted)
  const home = computeReassessmentShock({
    purchasePrice: 200000,
    state: 'SC',
    priorAnnualTax: 800,
  });
  assert.equal(home.reassessedAnnualTax, 1140); // 200,000 * 0.57% = 1,140
  assert.equal(home.annualTaxShock, 340);
  assert.equal(home.monthlyTaxShock, 28);
  assert.equal(home.supplementalBillEstimate, null);
  assert.match(home.explanation, /4% legal residence/);
  assert.match(home.explanation, /§ 12-43-220/);

  // Investor purchase (isInvestor = true): 50% ratio surge from 4% to 6%, effective rate ~0.85%
  const investor = computeReassessmentShock({
    purchasePrice: 200000,
    state: 'SC',
    priorAnnualTax: 800,
    isInvestor: true,
  });
  assert.equal(investor.reassessedAnnualTax, 1700); // 200,000 * 0.85% = 1,700
  assert.equal(investor.annualTaxShock, 900);
  assert.equal(investor.monthlyTaxShock, 75);
  assert.equal(investor.supplementalBillEstimate, null);
  assert.match(investor.explanation, /4% to 6% investor ratio adjustment/);
  assert.match(investor.explanation, /§ 12-43-220/);
});

test('CO: verifies 6.7% residential assessment rate, ~0.51% rate and Colo. Rev. Stat. § 39-1-104.2', () => {
  const rule = STATE_REASSESSMENT_RULES.CO;
  assert.ok(rule, 'CO reassessment rule must be defined');
  assert.equal(rule.state, 'CO');
  assert.equal(rule.effectiveTaxRatePct, 0.51);
  assert.equal(rule.assessmentRatioPct, 6.7);
  assert.equal(rule.supplementalBillExpected, false);
  assert.match(rule.statutoryReference, /Colo\. Rev\. Stat\. § 39-1-104\.2/);
  assert.match(rule.statutoryReference, /6\.7%/);

  const shock = computeReassessmentShock({
    purchasePrice: 600000,
    state: 'CO',
    priorAnnualTax: 2000,
  });
  assert.equal(shock.reassessedAnnualTax, 3060); // 600,000 * 0.51% = 3,060
  assert.equal(shock.annualTaxShock, 1060);
  assert.equal(shock.monthlyTaxShock, 88);
  assert.equal(shock.supplementalBillEstimate, null);
  assert.match(shock.explanation, /CO_BIENNIAL_REASSESSMENT/);
});

test('VA: verifies 100% fair market value assessment, ~0.82% rate and Va. Code § 58.1-3201', () => {
  const rule = STATE_REASSESSMENT_RULES.VA;
  assert.ok(rule, 'VA reassessment rule must be defined');
  assert.equal(rule.state, 'VA');
  assert.equal(rule.effectiveTaxRatePct, 0.82);
  assert.equal(rule.assessmentRatioPct, 100);
  assert.equal(rule.supplementalBillExpected, false);
  assert.match(rule.statutoryReference, /Va\. Code § 58\.1-3201/);
  assert.match(rule.statutoryReference, /100% fair market value/);

  const shock = computeReassessmentShock({
    purchasePrice: 500000,
    state: 'VA',
    priorAnnualTax: 3000,
  });
  assert.equal(shock.reassessedAnnualTax, 4100); // 500,000 * 0.82% = 4,100
  assert.equal(shock.annualTaxShock, 1100);
  assert.equal(shock.monthlyTaxShock, 92);
  assert.equal(shock.supplementalBillEstimate, null);
  assert.match(shock.explanation, /VA_FAIR_MARKET_VALUE/);
});

test('supplemental bill expectations: only CA and NJ expect supplemental tax bills', () => {
  const ca = computeReassessmentShock({ purchasePrice: 500000, state: 'CA', priorAnnualTax: 2000 });
  assert.equal(ca.rule.supplementalBillExpected, true);
  assert.equal(ca.reassessedAnnualTax, 6250); // 500,000 * 1.25%
  assert.equal(ca.annualTaxShock, 4250);
  assert.equal(ca.supplementalBillEstimate, Math.round((4250 / 12) * 6)); // ~2125

  const nj = computeReassessmentShock({ purchasePrice: 400000, state: 'NJ', priorAnnualTax: 5000 });
  assert.equal(nj.rule.supplementalBillExpected, true);
  assert.equal(nj.reassessedAnnualTax, 8920); // 400,000 * 2.23%
  assert.equal(nj.annualTaxShock, 3920);
  assert.equal(nj.supplementalBillEstimate, Math.round((3920 / 12) * 6)); // ~1960

  const statesWithoutSupplemental = ['OH', 'PA', 'GA', 'MI', 'WA', 'TN', 'MD', 'AZ', 'NC', 'SC', 'CO', 'VA', 'TX', 'FL', 'IL'];
  for (const st of statesWithoutSupplemental) {
    const res = computeReassessmentShock({ purchasePrice: 300000, state: st, priorAnnualTax: 1000 });
    assert.equal(res.rule.supplementalBillExpected, false, `${st} should not expect supplemental bill`);
    assert.equal(res.supplementalBillEstimate, null, `${st} supplemental estimate must be null`);
  }
});

test('edge cases: purchasePrice omitted, rate overrides, and neutral/favorable shock', () => {
  // Missing purchase price
  const empty = computeReassessmentShock({ state: 'OH' });
  assert.equal(empty.reassessedAnnualTax, null);
  assert.equal(empty.annualTaxShock, null);
  assert.match(empty.explanation, /requires an explicit purchase price/);

  // Override tax rate
  const custom = computeReassessmentShock({
    purchasePrice: 300000,
    state: 'OH',
    overrideTaxRatePct: 2.0,
    priorAnnualTax: 3000,
  });
  assert.equal(custom.reassessedAnnualTax, 6000);
  assert.equal(custom.annualTaxShock, 3000);
  assert.equal(custom.monthlyTaxShock, 250);

  // Favorable shock (reassessed bill is lower than prior owner bill)
  const favorable = computeReassessmentShock({
    purchasePrice: 100000,
    state: 'TN',
    priorAnnualTax: 2000,
  });
  assert.equal(favorable.reassessedAnnualTax, 660);
  assert.equal(favorable.annualTaxShock, -1340);
  assert.equal(favorable.supplementalBillEstimate, null);
  assert.match(favorable.explanation, /at or below prior bill/);
});
