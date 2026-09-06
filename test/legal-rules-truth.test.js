const assert = require('node:assert/strict');
const test = require('node:test');

const serverRules = require('../server/ai/legal-rules');
const nextRules = require('../src/lib/ai/legal-rules');

test('unknown legal inputs remain unknown instead of becoming safe defaults', () => {
  assert.equal(serverRules.parseCurrency(undefined), null);
  const redemption = serverRules.getRedemptionRule('');
  assert.equal(redemption.days, null);
  assert.match(redemption.warning, /unknown|do not infer/i);

  const lienSignal = serverRules.detectSeniorLienSurvival('', 'Routine notice text without priority evidence.');
  assert.equal(lienSignal.riskLevel, 'unknown');
  assert.equal(lienSignal.survivingSeniorLiens, null);
  assert.match(lienSignal.warning, /not evidence|no title conclusion/i);
});

test('cash-to-close never guesses fees from source or state and keeps funding stages separate', () => {
  const incomplete = serverRules.computeCashToClose({ state: 'OH', source: 'sheriff' });
  assert.equal(incomplete.total, null);
  assert.equal(incomplete.modelStatus, 'insufficient_inputs');
  assert.ok(incomplete.missingInputs.includes('purchasePrice'));
  assert.ok(incomplete.missingInputs.includes('buyersPremium'));

  const stillIncomplete = serverRules.computeCashToClose({ openingBid: 50_000, state: 'OH', source: 'sheriff' });
  assert.equal(stillIncomplete.total, null);
  assert.equal(stillIncomplete.buyersPremium, null);
  assert.equal(stillIncomplete.transferTax, null);

  const scenario = serverRules.computeCashToClose({
    openingBid: 50_000,
    registrationFunds: 2_000,
    creditedDeposit: 5_000,
    buyersPremium: 1_000,
    sheriffPoundage: 200,
    transferTax: 100,
    delinquentTaxes: 0,
    settlementCosts: 300,
  });
  assert.equal(scenario.totalAcquisitionCost, 51_600);
  assert.equal(scenario.cashDueAtSettlement, 46_600);
  assert.equal(scenario.registrationFunds, 2_000);
  assert.equal(scenario.modelStatus, 'complete_scenario');
  assert.equal(scenario.verified, false);
  assert.ok(scenario.assumptions.every((item) => /explicit scenario assumption/i.test(item)));
});

test('rent-roll parsing does not invent occupancy, expenses, or NOI', () => {
  const result = serverRules.parseRentRollSchedule('Unit 2A: tenant not stated');
  assert.equal(result.unitCount, 1);
  assert.equal(result.units[0].status, 'Unknown');
  assert.equal(result.units[0].monthlyRent, null);
  assert.equal(result.occupancyRate, null);
  assert.equal(result.inPlaceNoi, null);
});

test('legacy LOI and committee memo are evidence-review drafts, never fabricated bid authority', () => {
  const listing = { id: 'EVIDENCE-1', address: '10 Evidence Ave', state: 'OH', source: 'sheriff' };
  const loi = serverRules.generateLetterOfIntent(listing);
  assert.match(loi, /not ready for submission/i);
  assert.match(loi, /buyer input required/i);
  assert.doesNotMatch(loi, /Institutional Acquisition Partner|free and clear/i);
  assert.doesNotMatch(loi, /\$100,000|10% earnest/i);

  const memo = serverRules.generateInvestmentCommitteeMemo(listing);
  assert.match(memo, /not bid authority/i);
  assert.match(memo, /no bid recommendation/i);
  assert.doesNotMatch(memo, /free and clear|deal score.*85/i);
});

test('server and Next legal-rule mirrors preserve the same truth contract', () => {
  const input = { openingBid: 42_000, registrationFunds: 1_000, creditedDeposit: 4_000, buyersPremium: 0, sheriffPoundage: 0, transferTax: 0, delinquentTaxes: 0, settlementCosts: 0 };
  assert.deepEqual(nextRules.computeCashToClose(input), serverRules.computeCashToClose(input));
  assert.deepEqual(nextRules.getRedemptionRule(''), serverRules.getRedemptionRule(''));
  assert.equal(
    nextRules.generateInvestmentCommitteeMemo({ address: 'No Defaults' }),
    serverRules.generateInvestmentCommitteeMemo({ address: 'No Defaults' }),
  );
});
