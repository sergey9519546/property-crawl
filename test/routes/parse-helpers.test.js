'use strict';

// test/routes/parse-helpers.test.js
//
// Direct unit coverage for the pure helpers exported from
// server/routes/parse.js. These drive the legal-notice parser that
// extracts sale date, opening bid, deposit terms, statutory fraction,
// and confidence score from raw notice text. Silent drift in any of
// these would silently strip fields from every parsed notice.
//
//   - cleanString: null / empty / whitespace handling
//   - money: $/comma/whitespace stripping + positive-int enforcement
//   - evidenceMatch / moneyMatch: regex extraction with evidence
//   - parseFraction: word ("two-thirds") and digit ("2/3") spellings
//   - explicitStatutoryFraction: "minimum bid ... X of appraisal"
//   - calculateConfidence: weighted completeness score
//   - sanitizeLlmCandidates: only allowlisted fields with verifiable evidence

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  calculateConfidence,
  explicitStatutoryFraction,
  sanitizeLlmCandidates,
} = require('../../server/routes/parse');

const {
  extractObservedNotice,
  extractTextFromPdf,
} = require('../../server/routes/parse');

// --- cleanString / money (tested indirectly through extractObservedNotice) ----

test('extractObservedNotice: empty notice -> null values for every field', () => {
  const r = extractObservedNotice('');
  assert.equal(r.property_address, null);
  assert.equal(r.case_number, null);
  assert.equal(r.opening_bid, null);
  assert.equal(r.sale_date, null);
});

// --- parseFraction ------------------------------------------------------

// parseFraction is private; exercise through explicitStatutoryFraction.

test('explicitStatutoryFraction: two-thirds word form', () => {
  const r = explicitStatutoryFraction('The minimum opening bid shall be two-thirds of the appraised value.');
  assert.equal(r.value, 2 / 3);
  assert.match(r.label, /two-thirds/);
});

test('explicitStatutoryFraction: 2/3 digit form (minimum bid → fraction → appraisal)', () => {
  const r = explicitStatutoryFraction('The minimum bid shall be 2/3 of the appraised value.');
  assert.equal(r.value, 2 / 3);
});

test('explicitStatutoryFraction: one-half (1/2)', () => {
  const r = explicitStatutoryFraction('Minimum bid shall be one-half of the appraisal.');
  assert.equal(r.value, 1 / 2);
});

test('explicitStatutoryFraction: three-fourths (3/4)', () => {
  const r = explicitStatutoryFraction('Property shall not be sold for less than 3/4 of the appraised value.');
  assert.equal(r.value, 3 / 4);
});

test('explicitStatutoryFraction: reverse ordering (appraisal before minimum bid)', () => {
  const r = explicitStatutoryFraction('The appraised value is $300,000; minimum bid 2/3 of appraisal.');
  assert.equal(r.value, 2 / 3);
});

test('explicitStatutoryFraction: no fraction -> null result', () => {
  const r = explicitStatutoryFraction('The sale will be held at the courthouse.');
  assert.equal(r.value, null);
  assert.equal(r.label, null);
  assert.equal(r.evidence, null);
});

test('explicitStatutoryFraction: out-of-range fractions rejected', () => {
  // 5/2 (>1) is not a valid opening-bid fraction — parseFraction rejects
  const r = explicitStatutoryFraction('Minimum bid shall be 5/2 of the appraised value.');
  assert.equal(r.value, null);
});

// --- extractObservedNotice ----------------------------------------------

test('extractObservedNotice: pulls property address from "Property Address:" prefix', () => {
  const notice = `
    NOTICE OF SHERIFF SALE
    Case No.: 2024-CV-001
    Property Address: 123 Main St, Cleveland, OH 44113
    Opening Bid: $50,000
    Sale Date: December 15, 2026
  `;
  const r = extractObservedNotice(notice);
  assert.match(r.property_address, /123 Main St/);
  assert.match(r.case_number, /2024-CV-001/);
  assert.equal(r.opening_bid, 50000);
});

test('extractObservedNotice: opening bid requires dollar sign (no false positives)', () => {
  const notice = 'Sale Date: December 15, 2026. The case number is 2024-CV-001.';
  const r = extractObservedNotice(notice);
  // Without "$" the opening-bid regex should not match
  assert.equal(r.opening_bid, null);
});

test('extractObservedNotice: deposit colon-prefixed form is captured', () => {
  const notice = `
    Deposit: $5,000 cashier's check
    Sale Date: December 15, 2026
    Opening Bid: $50,000
  `;
  const r = extractObservedNotice(notice);
  assert.match(r.deposit_terms, /5,000/);
});

test('extractObservedNotice: plaintiff / defendant extracted when present', () => {
  const notice = `
    Wells Fargo Bank v. John Smith
    Case No.: 2024-CV-001
    Sale Date: December 15, 2026
    Opening Bid: $50,000
  `;
  const r = extractObservedNotice(notice);
  assert.match(r.plaintiff_or_seller, /Wells Fargo Bank/);
  assert.match(r.defendant, /John Smith/);
});

test('extractObservedNotice: city / state / zip extracted', () => {
  const notice = `
    Property Address: 123 Main St, Cleveland, OH 44113
    Sale Date: December 15, 2026
    Opening Bid: $50,000
  `;
  const r = extractObservedNotice(notice);
  assert.equal(r.city, 'Cleveland');
  assert.equal(r.state, 'OH');
  assert.equal(r.zip, '44113');
});

test('extractObservedNotice: evidence map pins every field', () => {
  const notice = `
    Case No.: 2024-CV-001
    Sale Date: December 15, 2026
    Opening Bid: $50,000
  `;
  const r = extractObservedNotice(notice);
  assert.ok(r.evidence);
  assert.ok(r.evidence.case_number);
  assert.ok(r.evidence.sale_date);
  assert.ok(r.evidence.opening_bid);
});

test('extractObservedNotice: statutory fraction populates opening_bid when only fraction is given', () => {
  // When the notice states only "two-thirds of appraised value" with
  // no explicit bid, the parser should set opening_bid to the fraction.
  const notice = `
    Appraised Value: $300,000
    Sale Date: December 15, 2026
    Minimum opening bid shall be two-thirds of the appraised value.
  `;
  const r = extractObservedNotice(notice);
  assert.equal(r.opening_bid, 200000);  // 2/3 of 300000
  assert.equal(r.statutory_bid_fraction, 2 / 3);
  assert.ok(r.statutory_bid_fraction_label);
});

// --- calculateConfidence ------------------------------------------------

test('calculateConfidence: empty record -> 0', () => {
  assert.equal(calculateConfidence({}), 0);
});

test('calculateConfidence: full record -> 1.0', () => {
  const r = calculateConfidence({
    property_address: '123 Main St',
    state: 'OH',
    case_number: '2024-CV-001',
    opening_bid: 50000,
    sale_date: '12/15/2026',
    plaintiff_or_seller: 'Wells Fargo',
    defendant: 'John Smith',
  });
  assert.equal(r, 1.0);
});

test('calculateConfidence: partial fields -> proportional score', () => {
  // Only property_address (weight 0.25) and case_number (0.15) present.
  const r = calculateConfidence({ property_address: 'X', case_number: 'Y' });
  assert.equal(r, 0.40);
});

test('calculateConfidence: undefined fields do NOT inflate the score', () => {
  // A fresh {} record should score 0 (not 1). This is the regression
  // that was fixed: the prior `!== null` check passed for undefined.
  const r = calculateConfidence({ property_address: undefined, state: undefined });
  assert.equal(r, 0);
});

test('calculateConfidence: clamped to 1.0 (no over-count)', () => {
  // Extra unexpected fields do not bump the score above 1.
  const r = calculateConfidence({
    property_address: 'X', state: 'OH', case_number: 'Y',
    opening_bid: 1, sale_date: '1', plaintiff_or_seller: 'p', defendant: 'd',
    unknownField: 'foo',
  });
  assert.equal(r, 1.0);
});

// --- sanitizeLlmCandidates ---------------------------------------------

test('sanitizeLlmCandidates: non-object payload -> empty object', () => {
  assert.deepEqual(sanitizeLlmCandidates(null, 'notice text'), {});
  assert.deepEqual(sanitizeLlmCandidates({}, 'notice text'), {});
  assert.deepEqual(sanitizeLlmCandidates({ candidates: 'string' }, 'notice text'), {});
});

test('sanitizeLlmCandidates: only allowlisted fields pass through', () => {
  const notice = 'Property address: 123 Main St';
  const candidates = {
    property_address: { value: '123 Main St', evidence: 'Property address: 123 Main St' },
    NOT_ALLOWED: { value: 'x', evidence: 'Property address: 123 Main St' },
  };
  const r = sanitizeLlmCandidates({ candidates }, notice);
  assert.ok(r.property_address);
  assert.ok(!r.NOT_ALLOWED);
});

test('sanitizeLlmCandidates: candidate evidence must appear in the notice', () => {
  const notice = 'Sale Date: 12/15/2026';
  const candidates = {
    sale_date: { value: '12/15/2026', evidence: 'Sale Date: 12/15/2026' },
    plaintiff_or_seller: { value: 'Bank', evidence: 'Wells Fargo Bank' },  // not in notice
  };
  const r = sanitizeLlmCandidates({ candidates }, notice);
  assert.ok(r.sale_date);
  assert.ok(!r.plaintiff_or_seller);
});

test('sanitizeLlmCandidates: money field requires amount match in evidence', () => {
  const notice = 'Opening Bid: $50,000';
  const candidates = {
    opening_bid: { value: 50000, evidence: 'Opening Bid: $50,000' },
    judgment_amount: { value: 999999, evidence: 'Opening Bid: $50,000' },  // value mismatched
  };
  const r = sanitizeLlmCandidates({ candidates }, notice);
  assert.ok(r.opening_bid);
  assert.ok(!r.judgment_amount);
});

test('sanitizeLlmCandidates: status is "llm_candidate_unverified"', () => {
  const notice = 'Property address: 123 Main St';
  const candidates = { property_address: { value: '123 Main St', evidence: 'Property address: 123 Main St' } };
  const r = sanitizeLlmCandidates({ candidates }, notice);
  assert.equal(r.property_address.status, 'llm_candidate_unverified');
});

// --- extractTextFromPdf -----------------------------------------------

test('extractTextFromPdf: non-string -> empty string', () => {
  assert.equal(extractTextFromPdf(null), '');
  assert.equal(extractTextFromPdf(undefined), '');
  assert.equal(extractTextFromPdf(12345), '');
});

test('extractTextFromPdf: plain non-PDF text passes through', () => {
  // When input doesn't contain %PDF, returns the input as-is
  assert.equal(extractTextFromPdf('just text'), 'just text');
});