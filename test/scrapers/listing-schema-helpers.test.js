'use strict';

// test/scrapers/listing-schema-helpers.test.js
//
// Direct unit coverage for validateListingShape + assertListingShape
// exported from server/scrapers/listing-schema.js. These are the
// schema-first gate the foolproof-scraping pipeline runs every record
// through before it lands in the database. Silent drift would either
// let malformed records through (lost identity fields) or reject
// legitimate fixtures.
//
//   - validateListingShape: required-field gating, fixture-origin +
//     requireLive=true rejection, multi-error collection, optional
//     passthrough of base.errors
//   - assertListingShape: throws LISTING_SCHEMA_INVALID on invalid,
//     returns the standardized listing on valid
//   - REQUIRED_FIELDS: documents the documented identity-critical fields

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  validateListingShape,
  assertListingShape,
  REQUIRED_FIELDS,
} = require('../../server/scrapers/listing-schema');

// --- validateListingShape --------------------------------------------

function completeListing(overrides = {}) {
  return {
    id: 'L1',
    source: 'sheriff',
    state: 'OH',
    address: '500 Oak Street, Cleveland, OH 44115',
    sourceUrl: 'https://sheriffsaleauction.ohio.gov/case/cv-2024-001234',
    sourceObservedAt: '2026-06-15T10:00:00Z',
    raw: 'a complete legal notice body with sufficient length for the schema validator',
    provenance: {
      origin: 'live',
      observed: true,
      publisher: 'Test Publisher',
      recordId: 'rec-1',
      observedAt: '2026-06-15T10:00:00Z',
    },
    ...overrides,
  };
}

test('validateListingShape: returns valid=true for a complete listing', () => {
  const out = validateListingShape(completeListing());
  assert.equal(out.valid, true);
  assert.deepEqual(out.errors, []);
});

test('validateListingShape: emits missing_<field> for each absent required field', () => {
  const out = validateListingShape({});
  assert.equal(out.valid, false);
  for (const field of REQUIRED_FIELDS) {
    assert.ok(out.errors.includes(`missing_${field}`), `expected missing_${field} in errors`);
  }
});

test('validateListingShape: treats null and empty-string required fields as missing', () => {
  // The schema layer checks the input as-passed. Empty strings trigger
  // missing_<field>; null/undefined trigger the same branch.
  const out = validateListingShape({
    id: '',
    source: '',
    state: '',
    address: '',
  });
  assert.equal(out.valid, false);
  assert.ok(out.errors.includes('missing_id'));
  assert.ok(out.errors.includes('missing_source'));
  assert.ok(out.errors.includes('missing_state'));
  assert.ok(out.errors.includes('missing_address'));
});

test('validateListingShape: rejects fixture origin when requireLive=true', () => {
  const out = validateListingShape(completeListing({
    source: 'sheriff',
    provenance: { origin: 'fixture', observed: true, publisher: 'X', recordId: 'r', observedAt: '2026-06-15T10:00:00Z' },
  }), { requireLive: true });
  assert.equal(out.valid, false);
  assert.ok(out.errors.includes('fixture_not_allowed'));
});

test('validateListingShape: permits a non-fixture origin when requireLive is set', () => {
  const out = validateListingShape(completeListing(), { requireLive: true });
  assert.equal(out.valid, true);
});

test('validateListingShape: returns the standardized listing on the result', () => {
  const out = validateListingShape(completeListing());
  assert.ok(out.listing);
  assert.equal(out.listing.id, 'L1');
});

test('validateListingShape: emits missing_<field> for an empty object', () => {
  // An empty object is the minimum input that survives sanitization.
  // The validateListingShape layer adds the missing_<field> errors for
  // every required field; sanitizeListingForIngestion throws on null.
  const out = validateListingShape({});
  assert.equal(out.valid, false);
  assert.ok(out.errors.includes('missing_id'));
  assert.ok(out.errors.includes('missing_source'));
  assert.ok(out.errors.includes('missing_state'));
  assert.ok(out.errors.includes('missing_address'));
});

test('validateListingShape: REQUIRED_FIELDS contains the documented identity-critical fields', () => {
  assert.deepEqual([...REQUIRED_FIELDS].sort(), ['address', 'id', 'source', 'state']);
});

// --- assertListingShape ----------------------------------------------

test('assertListingShape: returns the standardized listing on success', () => {
  const out = assertListingShape(completeListing());
  assert.equal(out.id, 'L1');
});

test('assertListingShape: throws LISTING_SCHEMA_INVALID with structured errors', () => {
  assert.throws(
    () => assertListingShape({}),
    (err) => err.code === 'LISTING_SCHEMA_INVALID' && Array.isArray(err.errors)
  );
});

test('assertListingShape: thrown error message lists every failed field', () => {
  try {
    assertListingShape({ id: 'L1' });
    assert.fail('expected throw');
  } catch (err) {
    assert.equal(err.code, 'LISTING_SCHEMA_INVALID');
    assert.ok(err.errors.length > 0);
  }
});

test('assertListingShape: fixture origin + requireLive=true throws', () => {
  try {
    assertListingShape(completeListing({
      provenance: { origin: 'fixture', observed: true, publisher: 'X', recordId: 'r', observedAt: '2026-06-15T10:00:00Z' },
    }), { requireLive: true });
    assert.fail('expected throw');
  } catch (err) {
    assert.equal(err.code, 'LISTING_SCHEMA_INVALID');
    assert.ok(err.errors.includes('fixture_not_allowed'));
  }
});
