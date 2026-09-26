'use strict';

// test/routes/enrich-evidence-summary.test.js
//
// Direct unit coverage for buildEvidenceSummary from server/routes/enrich.js.
// This pure function is called on every evidence-summary request — it is
// the "what does the source actually say vs what we don't know" panel in
// the LOI/Memo flow. Silent drift in either direction is a real risk:
//
//   - too generous: present gaps as observed facts (over-trust the source)
//   - too strict: leave a stale "unknown" line even when the source has
//     a value (over-claim what we still need to verify)
//
// Pins:
//   - Always-on gaps (court, title, tax, condition) are present even when
//     every other field is filled
//   - Field-missing gaps (sourceUrl, saleDate, deposit, occupancy) only
//     appear when the corresponding field is null/empty/whitespace
//   - addObserved XSS-escapes user input via SecuritySanitizer.escapeHtml
//   - amount() formatting uses en-US locale + 2-digit max fraction
//   - Footer disclaimer is the documented "not a title search" sentence

const assert = require('node:assert/strict');
const test = require('node:test');

const { buildEvidenceSummary, SUMMARY_MODEL } = require('../../server/routes/enrich');

// --- SUMMARY_MODEL is "evidence-summary-v1" ---------------------------

test('SUMMARY_MODEL is the pinned evidence-summary-v1 string', () => {
  assert.equal(SUMMARY_MODEL, 'evidence-summary-v1');
});

// --- buildEvidenceSummary: structural shape --------------------------

test('buildEvidenceSummary: always emits the "unverified" header + disclaimer footer', () => {
  const out = buildEvidenceSummary({});
  assert.match(out, /\*\*Evidence summary — unverified\*\*/);
  assert.match(out, /\*\*Observed listing fields\*\*/);
  assert.match(out, /\*\*Unknown or verification required\*\*/);
  assert.match(out, /not a title search/i);
  assert.match(out, /not a .* bid recommendation/);
});

test('buildEvidenceSummary: always emits the four always-on gaps even when listing has no gaps', () => {
  // Court, title, tax, and condition gaps must always appear — they
  // represent what the deterministic summary structurally cannot verify.
  const out = buildEvidenceSummary({
    sourceUrl: 'https://example.com/x',
    saleDate: '2027-01-01',
    deposit: '$5,000',
    occupancy: 'Vacant',
  });
  assert.match(out, /Court evidence/);
  assert.match(out, /Title evidence/);
  assert.match(out, /Tax and municipal evidence/);
  assert.match(out, /Condition evidence/);
});

// --- buildEvidenceSummary: observed fields ----------------------------

test('buildEvidenceSummary: emits address, source, sourceUrl when present', () => {
  const out = buildEvidenceSummary({
    address: '500 Oak St',
    source: 'sheriff',
    sourceUrl: 'https://sheriff.example.com/x',
  });
  assert.match(out, /Address: \*\*500 Oak St\*\*/);
  assert.match(out, /Source: \*\*sheriff\*\*/);
  assert.match(out, /Source record URL: \*\*https:\/\/sheriff\.example\.com\/x\*\*/);
});

test('buildEvidenceSummary: skips observed lines when the field is null/empty/whitespace', () => {
  const out = buildEvidenceSummary({
    address: '',
    source: '   ',
    sourceUrl: null,
  });
  assert.doesNotMatch(out, /Address: \*\*.*\*\*/);
  assert.doesNotMatch(out, /Source: \*\*.*\*\*/);
  assert.doesNotMatch(out, /Source record URL: \*\*.*\*\*/);
});

test('buildEvidenceSummary: formats openingBid as $X,XXX.XX (en-US, max 2 decimals)', () => {
  const out = buildEvidenceSummary({ openingBid: 125000 });
  assert.match(out, /Opening-bid field: \*\*\$125,000\*\*/);
});

test('buildEvidenceSummary: formatting accepts fractional cents and rounds to 2 digits', () => {
  const out = buildEvidenceSummary({ openingBid: 1234.567 });
  // toLocaleString with maximumFractionDigits=2 rounds to "$1,234.57".
  assert.match(out, /Opening-bid field: \*\*\$1,234\.57\*\*/);
});

test('buildEvidenceSummary: openingBid 0 renders as "$0" (amount() only rejects negative)', () => {
  // The amount() helper rejects <0 only. A 0 openingBid is technically
  // a finite non-negative value, so it gets rendered as "$0". Pin that
  // behavior so a future change to "omit zero bids" is visible.
  const out = buildEvidenceSummary({ openingBid: 0 });
  assert.match(out, /Opening-bid field: \*\*\$0\*\*/);
});

test('buildEvidenceSummary: openingBid -1 is omitted (negative rejected)', () => {
  const out = buildEvidenceSummary({ openingBid: -1 });
  assert.doesNotMatch(out, /Opening-bid field:/);
});

test('buildEvidenceSummary: valuation range renders as estLow-estHigh when both present', () => {
  const out = buildEvidenceSummary({ estLow: 100000, estHigh: 150000 });
  // The range separator is the en-dash character (–, U+2013).
  assert.match(out, /Valuation-range fields: \*\*\$100,000–\$150,000\*\*/);
});

test('buildEvidenceSummary: missing valuation range emits a gap', () => {
  const out = buildEvidenceSummary({});
  assert.match(out, /Valuation evidence: a complete estimate range is not present/);
});

test('buildEvidenceSummary: emits assessment, saleDate, occupancy, deposit, plaintiff, defendant', () => {
  const out = buildEvidenceSummary({
    assessed: 200000,
    saleDate: '2027-01-15',
    occupancy: 'Vacant',
    deposit: '$5,000',
    plaintiff: 'Bank A',
    defendant: 'John Smith',
  });
  assert.match(out, /Assessed-value field: \*\*\$200,000\*\*/);
  assert.match(out, /Sale date field: \*\*2027-01-15\*\*/);
  assert.match(out, /Occupancy field: \*\*Vacant\*\*/);
  assert.match(out, /Deposit-terms field: \*\*\$5,000\*\*/);
  assert.match(out, /Plaintiff field: \*\*Bank A\*\*/);
  assert.match(out, /Defendant field: \*\*John Smith\*\*/);
});

// --- buildEvidenceSummary: gaps when fields are missing ----------------

test('buildEvidenceSummary: missing sourceUrl emits the exact-record gap', () => {
  const out = buildEvidenceSummary({ sourceUrl: null });
  assert.match(out, /Exact source record: no direct record URL is attached/);
});

test('buildEvidenceSummary: missing saleDate emits the sale-schedule gap', () => {
  const out = buildEvidenceSummary({});
  assert.match(out, /Sale schedule: not present/);
});

test('buildEvidenceSummary: missing deposit emits the deposit-terms gap', () => {
  const out = buildEvidenceSummary({});
  assert.match(out, /Deposit and payment terms: not present/);
});

test('buildEvidenceSummary: missing occupancy emits the occupancy gap', () => {
  const out = buildEvidenceSummary({});
  assert.match(out, /Occupancy and access: not present/);
});

test('buildEvidenceSummary: missing openingBid emits the opening-bid gap', () => {
  const out = buildEvidenceSummary({});
  assert.match(out, /Opening bid: not present in the listing record/);
});

// --- buildEvidenceSummary: provenance fields ----------------------------

test('buildEvidenceSummary: emits provenance fields when present', () => {
  const out = buildEvidenceSummary({
    provenance: {
      propertyId: 'P-1',
      sheriffNumber: 'S-1',
      courtCaseNumber: 'CV-2024-1',
      parcelNumber: '012-345678',
      openingBidSource: 'plaintiff',
    },
  });
  assert.match(out, /Source property ID: \*\*P-1\*\*/);
  assert.match(out, /Source sheriff number: \*\*S-1\*\*/);
  assert.match(out, /Source-reported court case number: \*\*CV-2024-1\*\*/);
  assert.match(out, /Source parcel number: \*\*012-345678\*\*/);
  assert.match(out, /Opening-bid source: \*\*plaintiff\*\*/);
});

test('buildEvidenceSummary: handles missing provenance gracefully', () => {
  const out = buildEvidenceSummary({});
  // Should not throw; the four always-on gaps must still appear.
  assert.match(out, /Court evidence/);
  assert.match(out, /Title evidence/);
});

// --- buildEvidenceSummary: safety -------------------------------------

test('buildEvidenceSummary: escapes HTML in observed field values', () => {
  // The underlying safeText() escapes HTML. Pin that the user-provided
  // address doesn't end up as raw HTML in the markdown output.
  const out = buildEvidenceSummary({
    address: '<script>alert(1)</script>500 Oak',
  });
  assert.doesNotMatch(out, /<script>/);
  assert.match(out, /&lt;script&gt;/);
});

test('buildEvidenceSummary: collapses multi-whitespace fields to single spaces', () => {
  const out = buildEvidenceSummary({
    address: '500    Oak\n\nSt',
  });
  assert.match(out, /500 Oak St/);
});
