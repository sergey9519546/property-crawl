'use strict';

// test/state-codes.test.js
//
// Tests for the single-source-of-truth US state/territory set in
// server/state-codes.js. Before this module existed, the closed set was
// duplicated inline across validation.js, audit/property-image-routing.js,
// and a regex in source-policy.js; each could drift independently. This
// module is now the one canonical answer for "is this a real USPS code
// the live-ingestion validator should accept?", and the helpers below
// are the consumers' only entry point.

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  US_STATE_OR_TERRITORY_CODES,
  RESERVED_PLACEHOLDER_CODES,
  US_STATE_OR_TERRITORY_CODE,
  isUsStateOrTerritoryCode,
} = require('../server/state-codes');

// --- shape of the export -----------------------------------------------------

test('US_STATE_OR_TERRITORY_CODES is a Set', () => {
  assert.ok(US_STATE_OR_TERRITORY_CODES instanceof Set);
});

test('US_STATE_OR_TERRITORY_CODES covers every state, DC, and the five USPS territories', () => {
  const expected = [
    'AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA',
    'HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA',
    'MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY',
    'NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX',
    'UT','VT','VA','WA','WV','WI','WY',
    'PR','VI','GU','MP','AS',
  ];
  for (const code of expected) {
    assert.ok(US_STATE_OR_TERRITORY_CODES.has(code), `missing ${code}`);
  }
  // 50 states + DC + 5 territories = 56 codes
  assert.equal(US_STATE_OR_TERRITORY_CODES.size, expected.length);
});

test('RESERVED_PLACEHOLDER_CODES contains the "US" and "XX" placeholders that upstream feeds sometimes leak', () => {
  assert.ok(RESERVED_PLACEHOLDER_CODES.has('US'));
  assert.ok(RESERVED_PLACEHOLDER_CODES.has('XX'));
  // These should NOT be in the accepted set.
  assert.equal(US_STATE_OR_TERRITORY_CODES.has('US'), false);
  assert.equal(US_STATE_OR_TERRITORY_CODES.has('XX'), false);
});

test('US_STATE_OR_TERRITORY_CODE regex matches exactly two uppercase letters', () => {
  assert.equal(US_STATE_OR_TERRITORY_CODE.test('CA'), true);
  assert.equal(US_STATE_OR_TERRITORY_CODE.test('ca'), false, 'lowercase rejected');
  assert.equal(US_STATE_OR_TERRITORY_CODE.test('CAL'), false, 'three letters rejected');
  assert.equal(US_STATE_OR_TERRITORY_CODE.test('C1'), false, 'digit rejected');
  assert.equal(US_STATE_OR_TERRITORY_CODE.test(''), false, 'empty rejected');
});

// --- isUsStateOrTerritoryCode: happy paths -----------------------------------

test('isUsStateOrTerritoryCode: every real state/territory is accepted', () => {
  for (const code of US_STATE_OR_TERRITORY_CODES) {
    assert.equal(isUsStateOrTerritoryCode(code), true, `expected ${code} to be accepted`);
  }
});

test('isUsStateOrTerritoryCode: lowercase input is normalized and accepted', () => {
  assert.equal(isUsStateOrTerritoryCode('tx'), true);
  assert.equal(isUsStateOrTerritoryCode('  pr  '), true, 'whitespace is trimmed');
});

test('isUsStateOrTerritoryCode: real USPS codes that are NOT in the closed set are rejected', () => {
  // 'AA', 'AE', 'AP' are US military codes that USPS does not publish
  // as civilian state/territory abbreviations. They are not valid for
  // for-sale real-estate ingestion, so the validator must reject them.
  // (Note: whitespace is trimmed by the helper, so ' CA ' normalizes to
  // 'CA' and is accepted. Consumers that need stricter shape should
  // trim/normalize upstream before calling.)
  for (const code of ['AA', 'AE', 'AP', 'ZZ', 'AQ', '00', 'CA1']) {
    assert.equal(isUsStateOrTerritoryCode(code), false, `expected ${code} to be rejected`);
  }
});

test('isUsStateOrTerritoryCode: reserved placeholders US and XX are explicitly rejected', () => {
  assert.equal(isUsStateOrTerritoryCode('US'), false, '"US" is a placeholder, not a state');
  assert.equal(isUsStateOrTerritoryCode('us'), false);
  assert.equal(isUsStateOrTerritoryCode('XX'), false, '"XX" is USPS reserved for unknown');
  assert.equal(isUsStateOrTerritoryCode('xx'), false);
});

test('isUsStateOrTerritoryCode: non-string inputs are rejected', () => {
  assert.equal(isUsStateOrTerritoryCode(null), false);
  assert.equal(isUsStateOrTerritoryCode(undefined), false);
  assert.equal(isUsStateOrTerritoryCode(42), false);
  assert.equal(isUsStateOrTerritoryCode({}), false);
  assert.equal(isUsStateOrTerritoryCode(['CA']), false);
  assert.equal(isUsStateOrTerritoryCode(''), false);
});

// --- consumer behavior: validation.js + property-image route -----------------

test('isUsStateOrTerritoryCode matches the closed-set behavior validateListingForIngestion needs', () => {
  // The validator normalizes state to uppercase before consulting the set
  // (sanitizeListingForIngestion: `String(item.state ?? '').trim().toUpperCase()`),
  // so lowercase / whitespace input is the validator's responsibility —
  // the helper itself must accept the same normalized codes the validator
  // would. Real format-only codes ('CAL', 'C1', '00') must be rejected.
  const must = ['AL', 'CA', 'NY', 'TX', 'DC', 'PR', 'VI', 'GU', 'MP', 'AS'];
  const mustNot = ['US', 'XX', 'ZZ', 'AQ', 'CAL', 'C1', '00', '', null, undefined];
  for (const code of must) {
    assert.equal(isUsStateOrTerritoryCode(code), true, `must accept ${code}`);
  }
  for (const code of mustNot) {
    assert.equal(isUsStateOrTerritoryCode(code), false, `must reject ${code}`);
  }
});