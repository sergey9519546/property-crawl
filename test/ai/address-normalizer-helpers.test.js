'use strict';

// test/ai/address-normalizer-helpers.test.js
//
// Direct unit coverage for server/ai/address-normalizer.js. The
// normalizeAddressAndParcel helper is what the parcel boundary route
// uses to split courthouse raw address strings into street / city /
// state / parcel-id components. Silent drift in any of these would
// silently strip the parcel ID from real-world inputs, or fail to
// normalize a courthouse abbreviation.
//
//   - CITY_NORMALIZATION map contract
//   - normalizeAddressAndParcel: parcel-id extraction from
//     parcel/pin/tax-id/apn spellings
//   - range-number normalization ("1420-1422" -> "1420")
//   - city / state parsing and case normalization
//   - street suffix and directional preservation

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  normalizeAddressAndParcel,
  CITY_NORMALIZATION,
} = require('../../server/ai/address-normalizer');

// --- CITY_NORMALIZATION ------------------------------------------------

test('CITY_NORMALIZATION: canonical abbreviation -> spelled-out name', () => {
  assert.equal(CITY_NORMALIZATION.CLEV, 'Cleveland');
  assert.equal(CITY_NORMALIZATION.CINCY, 'Cincinnati');
  assert.equal(CITY_NORMALIZATION.PHILLY, 'Philadelphia');
});

test('CITY_NORMALIZATION: spelled-out keys are identity mappings', () => {
  assert.equal(CITY_NORMALIZATION.CLEVELAND, 'Cleveland');
  assert.equal(CITY_NORMALIZATION.MIAMI, 'Miami');
});

// --- normalizeAddressAndParcel: empty / null --------------------------

test('normalizeAddressAndParcel: empty / null / undefined -> empty result', () => {
  assert.deepEqual(normalizeAddressAndParcel(''),
    { standardizedAddress: '', parcelId: null, city: '', state: '' });
  assert.deepEqual(normalizeAddressAndParcel(null),
    { standardizedAddress: '', parcelId: null, city: '', state: '' });
  assert.deepEqual(normalizeAddressAndParcel(undefined),
    { standardizedAddress: '', parcelId: null, city: '', state: '' });
});

// --- parcelId extraction -----------------------------------------------

test('normalizeAddressAndParcel: extracts parcel id from "PARCEL ###"', () => {
  const out = normalizeAddressAndParcel('1420 E 112TH ST, Cleveland OH / PARCEL 108-12-044');
  assert.equal(out.parcelId, '108-12-044');
});

test('normalizeAddressAndParcel: extracts parcel id from "PIN #"', () => {
  const out = normalizeAddressAndParcel('100 Main St, Akron OH PIN # 12-34-567');
  assert.equal(out.parcelId, '12-34-567');
});

test('normalizeAddressAndParcel: extracts parcel id from "TAX ID"', () => {
  const out = normalizeAddressAndParcel('100 Main St, Tampa FL TAX ID 99-88-77');
  assert.equal(out.parcelId, '99-88-77');
});

test('normalizeAddressAndParcel: extracts parcel id from "tax-id" (FL county recorder spelling)', () => {
  const out = normalizeAddressAndParcel('100 Main St, Tampa FL tax-id 99-88-77');
  assert.equal(out.parcelId, '99-88-77');
});

test('normalizeAddressAndParcel: extracts parcel id from "APN"', () => {
  const out = normalizeAddressAndParcel('100 Main St, Tampa FL APN 12345');
  assert.equal(out.parcelId, '12345');
});

test('normalizeAddressAndParcel: missing parcel -> null', () => {
  const out = normalizeAddressAndParcel('100 Main St, Cleveland OH');
  assert.equal(out.parcelId, null);
});

// --- city / state extraction ------------------------------------------

test('normalizeAddressAndParcel: expands courthouse abbreviation CLEV -> Cleveland', () => {
  const out = normalizeAddressAndParcel('1420 E 112TH ST, CLEV OH');
  assert.equal(out.city, 'Cleveland');
  assert.equal(out.state, 'OH');
});

test('normalizeAddressAndParcel: leaves non-courthouse city as-is', () => {
  const out = normalizeAddressAndParcel('100 Main St, Cleveland OH');
  assert.equal(out.city, 'Cleveland');
  assert.equal(out.state, 'OH');
});

test('normalizeAddressAndParcel: state is uppercased', () => {
  const out = normalizeAddressAndParcel('100 Main St, Cleveland oh');
  assert.equal(out.state, 'OH');
});

// --- range-number normalization ----------------------------------------

test('normalizeAddressAndParcel: range "1420-1422" normalizes to leading "1420"', () => {
  const out = normalizeAddressAndParcel('1420-1422 E 112TH ST, CLEV OH');
  assert.equal(out.standardizedAddress.startsWith('1420 E 112th'), true);
});

test('normalizeAddressAndParcel: slash-separated range also normalized', () => {
  const out = normalizeAddressAndParcel('1420/1422 E 112TH ST, Cleveland OH');
  assert.equal(out.standardizedAddress.startsWith('1420'), true);
});

// --- street suffix and directional preservation -----------------------

test('normalizeAddressAndParcel: street suffix "ST" -> "St"', () => {
  const out = normalizeAddressAndParcel('100 Main ST, Cleveland OH');
  assert.match(out.standardizedAddress, /\bSt\b/);
});

test('normalizeAddressAndParcel: ordinal suffixes lowercased', () => {
  const out = normalizeAddressAndParcel('1420 E 112TH ST, Cleveland OH');
  assert.match(out.standardizedAddress, /112th/);
});

test('normalizeAddressAndParcel: directional preserved as uppercase', () => {
  const out = normalizeAddressAndParcel('1420 E 112TH ST, Cleveland OH');
  assert.match(out.standardizedAddress, /\bE\b/);
});

// --- standardizedAddress composition ---------------------------------

test('normalizeAddressAndParcel: full address with city+state', () => {
  const out = normalizeAddressAndParcel('1420 E 112TH ST, Cleveland OH');
  assert.equal(out.standardizedAddress, '1420 E 112th St, Cleveland, OH');
});

test('normalizeAddressAndParcel: address without city/state skips the suffix', () => {
  const out = normalizeAddressAndParcel('1420 Main St');
  assert.equal(out.standardizedAddress, '1420 Main St');
  assert.equal(out.city, '');
  assert.equal(out.state, '');
});