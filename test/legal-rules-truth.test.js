const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const serverRules = require('../server/ai/legal-rules');

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

// The truth contract these rules must never violate is asserted above, against
// the module production actually loads: server/ai/legal-rules.js, required by
// server/ai/notice-parser.js and server/scrapers/normalization.js.
//
// This file used to end with a "mirror parity" test against
// src/lib/ai/legal-rules.js. That copy was 33KB, differed from the server file
// in exactly one line (its own @file header comment), and was imported by
// nothing but that test - so every assertion in it compared a function to
// itself. It read as coverage of two maintained implementations; it was one
// file compared with a mirror of itself.
//
// The copy is deleted, and no replacement assertions are invented: the
// properties it stood in for are already covered above. See
// test/no-dead-duplicates.test.js.
test('only the server copy of the legal rules exists', () => {
  // Named explicitly so a reintroduction is caught by name.
  assert.equal(
    fs.existsSync(path.join(__dirname, '..', 'src', 'lib', 'ai', 'legal-rules.js')),
    false,
    'src/lib/ai/legal-rules.js is back'
  );
});
