'use strict';

// test/ai/address-normalizer.test.js
//
// Tests for server/ai/address-normalizer.js — the pure function that
// normalizes irregular courthouse addresses and extracts parcel IDs.
// This function sits between the notice parser and the listing
// ingestion gatekeeper, so a regression here would surface as
// "listings silently land on the wrong street" without a clear
// failure mode. Pure-function coverage makes those regressions loud.

const assert = require('node:assert/strict');
const test = require('node:test');

const { normalizeAddressAndParcel, CITY_NORMALIZATION } = require('../../server/ai/address-normalizer');

// --- empty / nullish input -------------------------------------------------

test('normalizeAddressAndParcel: empty string returns empty result with parcelId=null', () => {
  const result = normalizeAddressAndParcel('');
  assert.deepEqual(result, {
    standardizedAddress: '',
    parcelId: null,
    city: '',
    state: ''
  });
});

test('normalizeAddressAndParcel: undefined input returns the empty result', () => {
  const result = normalizeAddressAndParcel(undefined);
  assert.equal(result.standardizedAddress, '');
  assert.equal(result.parcelId, null);
});

test('normalizeAddressAndParcel: null input returns the empty result', () => {
  const result = normalizeAddressAndParcel(null);
  assert.equal(result.standardizedAddress, '');
  assert.equal(result.parcelId, null);
});

// --- full address normalization --------------------------------------------

test('normalizeAddressAndParcel: full address with city + state', () => {
  const result = normalizeAddressAndParcel('1420 E 112TH ST, CLEV OH');
  assert.equal(result.city, 'Cleveland');
  assert.equal(result.state, 'OH');
  assert.match(result.standardizedAddress, /112/);
  assert.match(result.standardizedAddress, /Cleveland/);
  assert.match(result.standardizedAddress, /OH/);
});

test('normalizeAddressAndParcel: street suffix is normalized (STREET -> St)', () => {
  const result = normalizeAddressAndParcel('500 Main Street, MIA FL');
  assert.match(result.standardizedAddress, /Main St/);
});

test('normalizeAddressAndParcel: AVE/AVENUE -> Ave', () => {
  const r1 = normalizeAddressAndParcel('100 Pine AVE, ORL FL');
  const r2 = normalizeAddressAndParcel('100 Pine AVENUE, ORL FL');
  assert.match(r1.standardizedAddress, /Pine Ave/);
  assert.match(r2.standardizedAddress, /Pine Ave/);
});

test('normalizeAddressAndParcel: BLVD/BOULEVARD -> Blvd', () => {
  const r1 = normalizeAddressAndParcel('5 Ocean BLVD, TPA FL');
  const r2 = normalizeAddressAndParcel('5 Ocean BOULEVARD, TPA FL');
  assert.match(r1.standardizedAddress, /Ocean Blvd/);
  assert.match(r2.standardizedAddress, /Ocean Blvd/);
});

test('normalizeAddressAndParcel: ordinal suffix in street name is preserved', () => {
  const result = normalizeAddressAndParcel('100 E 112TH ST, MIA FL');
  assert.match(result.standardizedAddress, /112th/);
});

// --- parcel ID extraction --------------------------------------------------

test('normalizeAddressAndParcel: extracts PARCEL 108-12-044', () => {
  const result = normalizeAddressAndParcel('1420 E 112TH ST, CLEV OH / PARCEL 108-12-044');
  assert.equal(result.parcelId, '108-12-044');
  assert.match(result.standardizedAddress, /Cleveland/);
});

test('normalizeAddressAndParcel: extracts PIN # 12-34-567', () => {
  const result = normalizeAddressAndParcel('500 Pine Ave, COL OH PIN # 12-34-567');
  assert.equal(result.parcelId, '12-34-567');
});

test('normalizeAddressAndParcel: extracts TAX ID with various separators', () => {
  const r1 = normalizeAddressAndParcel('100 Main St, COL OH TAX ID 99-88-77');
  const r2 = normalizeAddressAndParcel('100 Main St, COL OH / TAXID 99-88-77');
  const r3 = normalizeAddressAndParcel('100 Main St, COL OH; tax-id 99-88-77');
  assert.equal(r1.parcelId, '99-88-77');
  assert.equal(r2.parcelId, '99-88-77');
  assert.equal(r3.parcelId, '99-88-77');
});

test('normalizeAddressAndParcel: extracts APN (Assessor Parcel Number)', () => {
  const result = normalizeAddressAndParcel('500 Pine Ave, MIA FL APN 12-3456');
  assert.equal(result.parcelId, '12-3456');
});

test('normalizeAddressAndParcel: parcelId is null when no parcel clause is present', () => {
  const result = normalizeAddressAndParcel('100 Main St, COL OH');
  assert.equal(result.parcelId, null);
});

// --- city normalization ---------------------------------------------------

test('normalizeAddressAndParcel: every documented city abbreviation resolves to its full name', () => {
  const cases = [
    ['CLEV', 'Cleveland'],
    ['CINCY', 'Cincinnati'],
    ['HACK', 'Hackensack'],
    ['PHILLY', 'Philadelphia'],
    ['MIA', 'Miami'],
    ['TPA', 'Tampa'],
    ['ORL', 'Orlando'],
    ['COL', 'Columbus'],
    ['NWK', 'Newark']
  ];
  for (const [abbr, full] of cases) {
    const result = normalizeAddressAndParcel(`100 Main St, ${abbr} OH`);
    assert.equal(result.city, full, `${abbr} should normalize to ${full}`);
  }
});

test('normalizeAddressAndParcel: unknown city abbreviation is preserved as-is', () => {
  const result = normalizeAddressAndParcel('100 Main St, Springfield IL');
  assert.equal(result.city, 'Springfield');
});

// --- range numbers ---------------------------------------------------------

test('normalizeAddressAndParcel: range number is collapsed to the first', () => {
  const result = normalizeAddressAndParcel('1420-1422 E 112TH ST, CLEV OH');
  assert.match(result.standardizedAddress, /^1420\b/);
  assert.equal(result.standardizedAddress.includes('1422'), false);
});

test('normalizeAddressAndParcel: range with slash separator is also collapsed', () => {
  const result = normalizeAddressAndParcel('1420/1422 E 112TH ST, CLEV OH');
  assert.match(result.standardizedAddress, /^1420\b/);
});

// --- edge cases -----------------------------------------------------------

test('normalizeAddressAndParcel: address without city/state returns just the cleaned street', () => {
  const result = normalizeAddressAndParcel('500 Main Street');
  assert.equal(result.city, '');
  assert.equal(result.state, '');
  assert.equal(result.standardizedAddress, '500 Main St');
});

test('normalizeAddressAndParcel: directional prefix is preserved as-is (N, S, E, W, NE, etc.)', () => {
  const result = normalizeAddressAndParcel('100 NW Main St, MIA FL');
  assert.match(result.standardizedAddress, /\bNW\b/);
});

test('normalizeAddressAndParcel: a non-string numeric input is coerced to a string', () => {
  // The function accepts a string. A number is treated as raw text,
  // not a real address — but it should not throw.
  const result = normalizeAddressAndParcel(12345);
  assert.equal(result.parcelId, null);
  assert.equal(result.city, '');
});

// --- exports shape --------------------------------------------------------

test('CITY_NORMALIZATION is exported and contains every documented abbreviation', () => {
  for (const abbr of ['CLEV', 'CLEVELAND', 'CINCY', 'HACK', 'PHILLY', 'MIA', 'TPA', 'ORL', 'COL', 'NWK']) {
    assert.ok(CITY_NORMALIZATION[abbr], `CITY_NORMALIZATION should have ${abbr}`);
  }
});