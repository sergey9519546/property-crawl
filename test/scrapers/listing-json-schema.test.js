'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  validateListingSchema,
  validateListingForIngestion,
  LISTING_SCHEMA
} = require('../../server/scrapers/validation');

function createSampleListing(overrides = {}) {
  return {
    id: 'TRSY-26-66-189',
    source: 'treasury',
    state: 'TX',
    county: 'Webb',
    city: 'Bruni',
    zip: '78344',
    address: '112 North Avenue E, Bruni, TX 78344',
    saleDate: '2026-07-17',
    openingBid: 10000,
    estLow: 85000,
    estHigh: 115000,
    dealScore: 88,
    propertyType: 'Commercial',
    cashToClose: 5000,
    cashToCloseDetails: { model: 'reported-cash-requirement-v1' },
    lat: 27.42,
    lng: -98.83,
    beds: 0,
    baths: 2,
    sqft: 2800,
    year: 2014,
    sourceUrl: 'https://www.treasury.gov/auctions/treasury/rp/112bruni.shtml',
    raw: 'A full legal description of seized real estate with more than ten characters.',
    provenance: {
      origin: 'live',
      observed: true,
      publisher: 'U.S. Department of the Treasury',
      recordId: '26-66-189',
      observedAt: '2026-06-15T12:00:00Z'
    },
    ...overrides
  };
}

test('validateListingSchema: accepts a fully valid canonical listing', () => {
  const listing = createSampleListing();
  const result = validateListingSchema(listing);
  assert.equal(result.isValid, true);
  assert.deepEqual(result.errors, []);
});

test('validateListingSchema: accepts minimal listing with only required fields and nulls', () => {
  const minimal = {
    id: 'MIN-001',
    source: 'hud',
    state: 'OH',
    address: '100 Main St, Columbus, OH 43215',
    saleDate: null,
    openingBid: null,
    estLow: null,
    estHigh: null,
    dealScore: null,
    propertyType: null,
    cashToClose: null,
    provenance: {
      origin: 'live',
      observed: true,
      publisher: 'HUD Homestore',
      recordId: 'rec-100'
    }
  };
  const result = validateListingSchema(minimal);
  assert.equal(result.isValid, true);
  assert.deepEqual(result.errors, []);
});

test('validateListingSchema: flags missing required fields at root level', () => {
  const emptyResult = validateListingSchema({});
  assert.equal(emptyResult.isValid, false);
  assert.ok(emptyResult.errors.includes('schema_missing_id'));
  assert.ok(emptyResult.errors.includes('schema_missing_source'));
  assert.ok(emptyResult.errors.includes('schema_missing_state'));
  assert.ok(emptyResult.errors.includes('schema_missing_address'));
  assert.ok(emptyResult.errors.includes('schema_missing_provenance'));
});

test('validateListingSchema: flags type mismatches on core numeric and text fields', () => {
  const badTypes = createSampleListing({
    openingBid: 'not-a-number',
    dealScore: 'high',
    state: 1234,
    cashToClose: 'none',
    address: true
  });
  const result = validateListingSchema(badTypes);
  assert.equal(result.isValid, false);
  assert.ok(result.errors.includes('schema_type_mismatch_openingBid'));
  assert.ok(result.errors.includes('schema_type_mismatch_dealScore'));
  assert.ok(result.errors.includes('schema_type_mismatch_state'));
  assert.ok(result.errors.includes('schema_type_mismatch_cashToClose'));
  assert.ok(result.errors.includes('schema_type_mismatch_address'));
});

test('validateListingSchema: flags non-object listing root', () => {
  assert.deepEqual(validateListingSchema(null), {
    isValid: false,
    errors: ['schema_type_mismatch_listing']
  });
  assert.deepEqual(validateListingSchema('invalid'), {
    isValid: false,
    errors: ['schema_type_mismatch_listing']
  });
  assert.deepEqual(validateListingSchema([]), {
    isValid: false,
    errors: ['schema_type_mismatch_listing']
  });
});

test('validateListingSchema: validates provenance required fields and types', () => {
  const badProvenance = createSampleListing({
    provenance: {
      origin: '',
      observed: 'yes-string',
      publisher: null
      // recordId missing
    }
  });
  const result = validateListingSchema(badProvenance);
  assert.equal(result.isValid, false);
  assert.ok(result.errors.includes('schema_missing_provenance_origin'));
  assert.ok(result.errors.includes('schema_type_mismatch_provenance_observed'));
  assert.ok(result.errors.includes('schema_missing_provenance_publisher'));
  assert.ok(result.errors.includes('schema_missing_provenance_recordId'));
});

test('validateListingSchema: flags provenance as non-object when primitive passed', () => {
  const primitiveProvenance = createSampleListing({ provenance: 'bad' });
  const result = validateListingSchema(primitiveProvenance);
  assert.equal(result.isValid, false);
  assert.ok(result.errors.includes('schema_type_mismatch_provenance'));
});

test('validateListingSchema: enforces state pattern and range bounds', () => {
  const outOfRange = createSampleListing({
    state: 'TEXAS', // Must be 2 uppercase chars
    dealScore: 120, // Must be <= 99
    openingBid: -50, // Must be >= 0
    address: 'Short' // minLength 8
  });
  const result = validateListingSchema(outOfRange);
  assert.equal(result.isValid, false);
  assert.ok(result.errors.includes('schema_pattern_mismatch_state'));
  assert.ok(result.errors.includes('schema_range_mismatch_dealScore'));
  assert.ok(result.errors.includes('schema_range_mismatch_openingBid'));
  assert.ok(result.errors.includes('schema_range_mismatch_address'));
});

test('validateListingForIngestion wires schema errors into ingestion gate', () => {
  const invalid = createSampleListing({
    openingBid: 'fifty-thousand',
    provenance: {
      origin: 'live',
      observed: 'not-boolean',
      publisher: 'US Marshals',
      recordId: 'USMS-01'
    }
  });
  const result = validateListingForIngestion(invalid);
  assert.equal(result.isValid, false);
  assert.ok(result.errors.includes('schema_type_mismatch_openingBid'));
  assert.ok(result.errors.includes('schema_type_mismatch_provenance_observed'));
});

test('LISTING_SCHEMA schema object metadata is exported and well-formed', () => {
  assert.equal(LISTING_SCHEMA.type, 'object');
  assert.ok(Array.isArray(LISTING_SCHEMA.required));
  assert.ok(LISTING_SCHEMA.required.includes('id'));
  assert.ok(LISTING_SCHEMA.required.includes('provenance'));
  assert.ok(LISTING_SCHEMA.properties.openingBid);
  assert.ok(LISTING_SCHEMA.properties.cashToClose);
});
