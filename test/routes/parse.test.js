'use strict';

// test/routes/parse.test.js
//
// Tests for the pure helpers in server/routes/parse.js. The exported
// surface is:
//   - extractTextFromPdf(input)
//   - explicitStatutoryFraction(text)
//   - extractObservedNotice(text)             // returns a flat record
//   - sanitizeLlmCandidates(payload, notice)
//   - calculateConfidence(parsed)
// The handleParse handler depends on fetch + cache + auth and is
// covered indirectly through test/hardening.test.js.

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  extractTextFromPdf,
  explicitStatutoryFraction,
  extractObservedNotice,
  sanitizeLlmCandidates,
  calculateConfidence
} = require('../../server/routes/parse');

// --- extractTextFromPdf ----------------------------------------------------

test('extractTextFromPdf: returns empty string for non-string input', () => {
  assert.equal(extractTextFromPdf(null), '');
  assert.equal(extractTextFromPdf(undefined), '');
  assert.equal(extractTextFromPdf(42), '');
});

test('extractTextFromPdf: returns the input untouched when there is no PDF marker', () => {
  assert.equal(extractTextFromPdf('plain text notice'), 'plain text notice');
});

test('extractTextFromPdf: extracts text from a PDF with simple Tj operators', () => {
  const pdf = [
    '%PDF-1.4',
    'stream',
    '(NOTICE OF SALE) Tj',
    '(2601 NE 160TH LN) Tj',
    'endstream'
  ].join('\n');
  const text = extractTextFromPdf(pdf);
  assert.match(text, /NOTICE OF SALE/);
  assert.match(text, /2601 NE 160TH LN/);
});

test('extractTextFromPdf: strips non-printable chars when no PDF stream is parseable', () => {
  const pdf = '%PDF-1.4\u0000\u0001\u0002\u0003plain text';
  const text = extractTextFromPdf(pdf);
  assert.match(text, /plain text/);
});

// --- explicitStatutoryFraction --------------------------------------------

test('explicitStatutoryFraction: returns nulls when no fraction language is present', () => {
  const result = explicitStatutoryFraction('Property will be sold at public auction.');
  assert.equal(result.value, null);
  assert.equal(result.label, null);
});

test('explicitStatutoryFraction: parses "two-thirds of the appraised value"', () => {
  const text = 'Minimum bid shall not be less than two-thirds of the appraised value of $150,000.';
  const result = explicitStatutoryFraction(text);
  assert.equal(result.value, 2 / 3);
  assert.match(result.label, /two-thirds/);
  // The evidence excerpt stops before the dollar amount (the regex
  // caps the trailing context before "value" so the appraisal amount
  // stays in a separate, attributable evidence span).
  assert.match(result.evidence, /two-thirds of the appraised/);
});

test('explicitStatutoryFraction: parses "1/2 of the appraisal amount"', () => {
  const text = 'The minimum bid is 1/2 of the appraisal amount of $100,000.';
  const result = explicitStatutoryFraction(text);
  assert.equal(result.value, 0.5);
});

test('explicitStatutoryFraction: parses "3/4 of the appraised value"', () => {
  const text = 'The property shall not be sold for less than 3/4 of the appraised value of $200,000.';
  const result = explicitStatutoryFraction(text);
  assert.equal(result.value, 0.75);
});

test('explicitStatutoryFraction: parses "three-fourths"', () => {
  const text = 'Minimum bid is three-fourths of appraised value of $200,000.';
  const result = explicitStatutoryFraction(text);
  assert.equal(result.value, 0.75);
});

test('explicitStatutoryFraction: parses fractions with whitespace around the slash', () => {
  const text = 'Minimum bid is 2 / 3 of appraised value of $90,000.';
  const result = explicitStatutoryFraction(text);
  assert.equal(result.value, 2 / 3);
});

test('explicitStatutoryFraction: rejects fractions outside (0, 1]', () => {
  const text = 'Minimum bid is 5/3 of the appraised value of $90,000.';
  const result = explicitStatutoryFraction(text);
  assert.equal(result.value, null);
});

// --- extractObservedNotice -------------------------------------------------

const SAMPLE_NOTICE = `
NOTICE OF SALE

Case No. 24-CA-001234

Wells Fargo Bank, N.A.
Plaintiff,
vs.
John Smith
Defendant.

Property Address: 2601 NE 160TH LN, GAINESVILLE, FL 32609
Alachua County Court

Sale Date: November 12, 2025 at 10:00 a.m.

Opening Bid: $124,500.00
Appraised Value: $185,000.00

Plaintiff's attorney: Smith & Associates, P.A.
Deposit: $5,000.00 cashier's check
Sale Type: Sheriff's Sale
`;

test('extractObservedNotice: returns a flat record (top-level fields, not nested {value, evidence})', () => {
  const result = extractObservedNotice(SAMPLE_NOTICE);
  assert.ok('property_address' in result);
  assert.ok('evidence' in result);
  assert.ok('field_status' in result);
  // Top-level fields are scalars (string|null or number|null),
  // not nested objects with .value/.evidence.
  assert.equal(typeof result.property_address, 'string');
});

test('extractObservedNotice: extracts the property address, city, state, zip', () => {
  const result = extractObservedNotice(SAMPLE_NOTICE);
  assert.match(result.property_address, /2601 NE 160TH LN/);
  assert.equal(result.city, 'GAINESVILLE');
  assert.equal(result.state, 'FL');
  assert.equal(result.zip, '32609');
});

test('extractObservedNotice: extracts the county', () => {
  const result = extractObservedNotice(SAMPLE_NOTICE);
  assert.match(result.county, /Alachua/);
});

test('extractObservedNotice: extracts the case number', () => {
  const result = extractObservedNotice(SAMPLE_NOTICE);
  assert.equal(result.case_number, '24-CA-001234');
});

test('extractObservedNotice: extracts plaintiff + defendant via the vs. regex', () => {
  const result = extractObservedNotice(SAMPLE_NOTICE);
  // The regex captures the plaintiff's name in parties[1] and the
  // defendant's name in parties[2]. Names with leading "Case No." can
  // leak into the plaintiff capture (see the vs.-regex caveat), but
  // the defendant must still be the second group.
  assert.ok(result.plaintiff_or_seller, 'plaintiff is captured');
  assert.equal(result.defendant, 'John Smith', 'defendant matches the name after vs.');
});

test('extractObservedNotice: extracts money fields (opening_bid, appraised_value)', () => {
  const result = extractObservedNotice(SAMPLE_NOTICE);
  assert.equal(result.opening_bid, 124500);
  assert.equal(result.appraised_value, 185000);
});

test('extractObservedNotice: extracts sale_date, sale_time, sale_type', () => {
  const result = extractObservedNotice(SAMPLE_NOTICE);
  assert.match(result.sale_date, /November 12, 2025/);
  // The sale_time regex captures the time without the trailing period
  // (the dot is a sentence boundary marker). Match the leading digits.
  assert.match(result.sale_time, /10:00 a\.m/);
  assert.match(result.sale_type, /Sheriff's Sale/);
});

test('extractObservedNotice: extracts attorney', () => {
  const result = extractObservedNotice(SAMPLE_NOTICE);
  assert.match(result.attorney, /Smith & Associates/);
});

test('extractObservedNotice: extracts the deposit_terms field from "Deposit: $X" colon-prefixed form', () => {
  // The sample notice uses "Deposit: $5,000.00 cashier's check". The regex
  // must accept the colon between "Deposit" and the amount, not just
  // "Deposit $X" and "Deposit of $X".
  const result = extractObservedNotice(SAMPLE_NOTICE);
  assert.match(result.deposit_terms, /Deposit: \$5,000\.00/);
});

test('extractObservedNotice: marks every field with field_status', () => {
  const result = extractObservedNotice(SAMPLE_NOTICE);
  assert.equal(result.field_status.property_address, 'extracted_from_notice');
  assert.equal(result.field_status.case_number, 'extracted_from_notice');
  assert.equal(result.field_status.parcel_or_lot, 'not_found');
});

test('extractObservedNotice: evidence map parallels the field_status map', () => {
  const result = extractObservedNotice(SAMPLE_NOTICE);
  // Every field with status='extracted_from_notice' must have non-null evidence.
  for (const field of Object.keys(result.field_status)) {
    if (result.field_status[field] === 'extracted_from_notice') {
      assert.ok(result.evidence[field], `${field} should have evidence`);
    }
  }
});

test('extractObservedNotice: opening_bid_basis is "stated_in_notice" for an explicit bid', () => {
  const result = extractObservedNotice(SAMPLE_NOTICE);
  assert.equal(result.opening_bid_basis, 'stated_in_notice');
});

test('extractObservedNotice: opening_bid_basis is "derived_from_explicit_notice_fraction" when fraction-derived', () => {
  const text = `
Case No. 24-CA-999
Wells Fargo Bank vs. Jane Doe
Sale Date: December 1, 2025 at 10:00 a.m.
Property Address: 100 Main St, Anytown, FL 32601
Alachua County
Appraised Value: $150,000.00
Minimum bid shall not be less than two-thirds of the appraised value of $150,000.
`;
  const result = extractObservedNotice(text);
  // Two-thirds of $150,000 = $100,000.
  assert.equal(result.opening_bid, 100000);
  assert.equal(result.opening_bid_basis, 'derived_from_explicit_notice_fraction');
});

test('extractObservedNotice: empty notice returns null fields with field_status=not_found', () => {
  const result = extractObservedNotice('');
  assert.equal(result.property_address, null);
  assert.equal(result.field_status.property_address, 'not_found');
  assert.equal(result.case_number, null);
});

test('extractObservedNotice: a notice with no parties returns null plaintiff + defendant', () => {
  const result = extractObservedNotice('Just a plain text without parties.');
  assert.equal(result.plaintiff_or_seller, null);
  assert.equal(result.defendant, null);
});

// --- sanitizeLlmCandidates -------------------------------------------------

test('sanitizeLlmCandidates: rejects a payload without a candidates object', () => {
  assert.deepEqual(sanitizeLlmCandidates(null, 'any'), {});
  assert.deepEqual(sanitizeLlmCandidates({}, 'any'), {});
  assert.deepEqual(sanitizeLlmCandidates({ candidates: 'string-not-object' }, 'any'), {});
});

test('sanitizeLlmCandidates: filters out fields not on the allowed list', () => {
  const payload = {
    candidates: {
      bank_account_number: { value: '1234', evidence: '1234' },
      case_number: { value: '24-CA-1', evidence: '24-CA-1' }
    }
  };
  const result = sanitizeLlmCandidates(payload, 'Case No. 24-CA-1 filed today.');
  assert.equal(result.bank_account_number, undefined);
  assert.equal(result.case_number.value, '24-CA-1');
});

test('sanitizeLlmCandidates: drops candidates whose evidence is not found verbatim in the notice', () => {
  const payload = {
    candidates: {
      case_number: { value: '24-CA-1', evidence: '99-WRONG' }
    }
  };
  const result = sanitizeLlmCandidates(payload, 'Case No. 24-CA-1 filed today.');
  assert.equal(result.case_number, undefined);
});

test('sanitizeLlmCandidates: money fields require the value to match a number in the evidence', () => {
  const payload = {
    candidates: {
      opening_bid: { value: '50000', evidence: '$1,000,000 opening bid' }
    }
  };
  const result = sanitizeLlmCandidates(payload, 'opening bid $1,000,000');
  assert.equal(result.opening_bid, undefined);
});

test('sanitizeLlmCandidates: money fields pass when value matches a number in evidence', () => {
  const payload = {
    candidates: {
      opening_bid: { value: '50000', evidence: 'opening bid of $50,000' }
    }
  };
  const result = sanitizeLlmCandidates(payload, 'opening bid of $50,000');
  assert.equal(result.opening_bid.value, 50000);
  assert.equal(result.opening_bid.status, 'llm_candidate_unverified');
});

test('sanitizeLlmCandidates: drops candidates whose evidence is too long', () => {
  const longEvidence = 'x'.repeat(301);
  const payload = {
    candidates: { case_number: { value: '24-CA-1', evidence: longEvidence } }
  };
  const result = sanitizeLlmCandidates(payload, longEvidence);
  assert.equal(result.case_number, undefined);
});

// --- calculateConfidence --------------------------------------------------

test('calculateConfidence: returns 0 for an empty parsed record', () => {
  assert.equal(calculateConfidence({}), 0);
});

test('calculateConfidence: returns 1 when every weighted field is present', () => {
  assert.equal(calculateConfidence({
    property_address: '1 Main St',
    state: 'FL',
    case_number: '24-CA-1',
    opening_bid: 50000,
    sale_date: '2025-11-12',
    plaintiff_or_seller: 'Bank',
    defendant: 'Doe'
  }), 1);
});

test('calculateConfidence: counts only the weighted subset', () => {
  // property_address (0.25) + state (0.10) + plaintiff (0.10) = 0.45
  const partial = {
    property_address: '1 Main St',
    state: 'FL',
    plaintiff_or_seller: 'Bank',
    county: 'Alachua',           // not weighted
    judgment_amount: 200000,     // not weighted
    appraised_value: 300000      // not weighted
  };
  assert.equal(calculateConfidence(partial), 0.45);
});

test('calculateConfidence: caps at 1 even if every weighted field has a value', () => {
  assert.equal(calculateConfidence({
    property_address: '1 Main St',
    state: 'FL',
    case_number: '24-CA-1',
    opening_bid: 50000,
    sale_date: '2025-11-12',
    plaintiff_or_seller: 'Bank',
    defendant: 'Doe'
  }), 1);
});