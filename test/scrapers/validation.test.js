'use strict';

// test/scrapers/validation.test.js
//
// Tests for the live-ingestion validator at server/scrapers/validation.js.
// This function is the gatekeeper between scraped records and the live
// record store; a bug here lets bad data in or rejects good data, both
// of which surface as downstream failures. The function has 10+ branches
// and was previously untested.

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  sanitizeListingForIngestion,
  validateListingForIngestion,
} = require('../../server/scrapers/validation');

function validListing(overrides = {}) {
  return {
    id: 'LIVE-001',
    source: 'treasury',
    address: '500 Test St, Anytown, TX 75001',
    state: 'TX',
    city: 'Anytown',
    zip: '75001',
    lat: 32.78,
    lng: -96.80,
    openingBid: 100000,
    estLow: 95000,
    estHigh: 105000,
    saleDate: '2026-12-01',
    sourceUrl: 'https://www.treasury.gov/auctions/treasury/rp/test.shtml',
    sourceObservedAt: '2026-09-01T12:00:00.000Z',
    raw: 'Some publisher evidence with at least ten characters',
    provenance: {
      origin: 'live',
      observed: true,
      publisher: 'U.S. Department of the Treasury',
      recordId: '26-66-189',
    },
    ...overrides,
  };
}

// --- sanitizeListingForIngestion ------------------------------------

test('sanitizeListingForIngestion: trims strings and normalizes whitespace in address', () => {
  const out = sanitizeListingForIngestion(validListing({ address: '  500  Test\tSt,,,\nAnytown, TX   75001   ' }));
  assert.equal(out.address, '500 Test St,,, Anytown, TX 75001');
  assert.equal(out.state, 'TX');
  assert.equal(out.source, 'treasury');
});

test('sanitizeListingForIngestion: uppercases state, lowercases source', () => {
  const out = sanitizeListingForIngestion(validListing({ state: 'tx', source: 'TREASURY' }));
  assert.equal(out.state, 'TX');
  assert.equal(out.source, 'treasury');
});

test('sanitizeListingForIngestion: empty id and source round-trip as empty strings (not undefined)', () => {
  const out = sanitizeListingForIngestion({});
  assert.equal(out.id, '');
  assert.equal(out.source, '');
  assert.equal(out.state, '');
  assert.equal(out.address, '');
  assert.equal(out.sourceUrl, null);
});

// --- validateListingForIngestion: pass case --------------------------

test('validateListingForIngestion: a fully valid listing is accepted', () => {
  const result = validateListingForIngestion(validListing());
  assert.equal(result.isValid, true);
  assert.deepEqual(result.errors, []);
  assert.equal(result.listing.id, 'LIVE-001');
});

// --- id ------------------------------------------------------------

test('validateListingForIngestion: empty id is rejected', () => {
  const result = validateListingForIngestion(validListing({ id: '' }));
  assert.equal(result.isValid, false);
  assert.ok(result.errors.includes('invalid_id'));
});

test('validateListingForIngestion: id with unsafe characters is rejected', () => {
  const result = validateListingForIngestion(validListing({ id: 'foo bar baz/qux' }));
  assert.equal(result.isValid, false);
  assert.ok(result.errors.includes('invalid_id'));
});

test('validateListingForIngestion: id with allowed punctuation (colon, slash, dot, dash, underscore) is accepted', () => {
  const result = validateListingForIngestion(validListing({ id: 'IRS-LA-7863:parcel/12-3.4' }));
  assert.equal(result.isValid, true, result.errors.join(','));
});

// --- source --------------------------------------------------------

test('validateListingForIngestion: missing source is rejected', () => {
  const result = validateListingForIngestion(validListing({ source: '' }));
  assert.equal(result.isValid, false);
  assert.ok(result.errors.includes('missing_source'));
});

test('validateListingForIngestion: source mismatch against expectedSource is rejected', () => {
  const result = validateListingForIngestion(validListing({ source: 'hud' }), { expectedSource: 'treasury' });
  assert.equal(result.isValid, false);
  assert.ok(result.errors.includes('source_mismatch'));
});

// --- state ---------------------------------------------------------

test('validateListingForIngestion: invalid state code is rejected', () => {
  const result = validateListingForIngestion(validListing({ state: 'ZZ' }));
  assert.equal(result.isValid, false);
  assert.ok(result.errors.includes('invalid_state'));
});

test('validateListingForIngestion: "US" is rejected as a placeholder state', () => {
  // The scraper uses 'US' as a fallback when a state could not be parsed
  // upstream; ingestion must reject it.
  const result = validateListingForIngestion(validListing({ state: 'US' }));
  assert.equal(result.isValid, false);
  assert.ok(result.errors.includes('invalid_state'));
});

// --- address -------------------------------------------------------

test('validateListingForIngestion: too-short address is rejected', () => {
  const result = validateListingForIngestion(validListing({ address: '5 St' }));
  assert.equal(result.isValid, false);
  assert.ok(result.errors.includes('invalid_address'));
});

test('validateListingForIngestion: too-long address is rejected', () => {
  const result = validateListingForIngestion(validListing({ address: 'A'.repeat(501) }));
  assert.equal(result.isValid, false);
  assert.ok(result.errors.includes('invalid_address'));
});

// --- bid / estimates -----------------------------------------------

test('validateListingForIngestion: negative openingBid is rejected when provided', () => {
  const result = validateListingForIngestion(validListing({ openingBid: -100 }));
  assert.equal(result.isValid, false);
  assert.ok(result.errors.includes('invalid_opening_bid'));
});

test('validateListingForIngestion: null openingBid is permitted (not every listing publishes a bid)', () => {
  const result = validateListingForIngestion(validListing({ openingBid: null }));
  assert.equal(result.isValid, true, result.errors.join(','));
});

test('validateListingForIngestion: estimate range with estHigh < estLow is rejected', () => {
  // The estimate-range check is specifically about the high/low ordering —
  // estimates can legitimately sit below the opening bid (the bid is the
  // auction's start price, the estimates are market-value projections).
  const result = validateListingForIngestion(validListing({ openingBid: 100000, estLow: 100000, estHigh: 50000 }));
  assert.equal(result.isValid, false);
  assert.ok(result.errors.includes('invalid_estimate_range'));
});

test('validateListingForIngestion: estimate range BELOW opening bid is permitted (estimates and openingBid are independent)', () => {
  // Estimates may be lower than the opening bid (the publisher's tax-assessed
  // range can differ from the auction's start price). The validator must
  // accept this — the upstream scrape is honest about the spread.
  const result = validateListingForIngestion(validListing({ openingBid: 100000, estLow: 50000, estHigh: 60000 }));
  assert.equal(result.isValid, true, result.errors.join(','));
});

// --- coordinates --------------------------------------------------

test('validateListingForIngestion: partial geocode (lat only) is rejected', () => {
  const result = validateListingForIngestion(validListing({ lat: 32.78, lng: null }));
  assert.equal(result.isValid, false);
  assert.ok(result.errors.includes('partial_geocode'));
});

test('validateListingForIngestion: partial geocode (lng only) is rejected', () => {
  const result = validateListingForIngestion(validListing({ lat: null, lng: -96.80 }));
  assert.equal(result.isValid, false);
  assert.ok(result.errors.includes('partial_geocode'));
});

test('validateListingForIngestion: out-of-range latitude is rejected', () => {
  const result = validateListingForIngestion(validListing({ lat: 95, lng: -96.80 }));
  assert.equal(result.isValid, false);
  assert.ok(result.errors.includes('invalid_latitude'));
});

test('validateListingForIngestion: out-of-range longitude is rejected', () => {
  const result = validateListingForIngestion(validListing({ lat: 32.78, lng: -200 }));
  assert.equal(result.isValid, false);
  assert.ok(result.errors.includes('invalid_longitude'));
});

test('validateListingForIngestion: null coordinates are permitted (route geocodes lazily)', () => {
  const result = validateListingForIngestion(validListing({ lat: null, lng: null }));
  assert.equal(result.isValid, true, result.errors.join(','));
});

// --- sourceUrl ----------------------------------------------------

test('validateListingForIngestion: missing sourceUrl is rejected', () => {
  const result = validateListingForIngestion(validListing({ sourceUrl: null }));
  assert.equal(result.isValid, false);
  assert.ok(result.errors.includes('missing_source_url'));
});

test('validateListingForIngestion: foreign-host sourceUrl is rejected by inspectSourceRecordUrl', () => {
  const result = validateListingForIngestion(validListing({
    sourceUrl: 'https://attacker.example/test.shtml'
  }));
  assert.equal(result.isValid, false);
  // inspectSourceRecordUrl emits one of the source-policy error codes.
  assert.ok(result.errors.some((e) => /^unsafe_source_url|source_host_mismatch|source_url_not_exact_record$/.test(e)), result.errors.join(','));
});

// --- raw / notice text --------------------------------------------

test('validateListingForIngestion: too-short raw text is rejected', () => {
  const result = validateListingForIngestion(validListing({ raw: 'tiny' }));
  assert.equal(result.isValid, false);
  assert.ok(result.errors.includes('invalid_raw_notice'));
});

test('validateListingForIngestion: too-large raw text is rejected', () => {
  const result = validateListingForIngestion(validListing({ raw: 'A'.repeat(100_001) }));
  assert.equal(result.isValid, false);
  assert.ok(result.errors.includes('invalid_raw_notice'));
});

test('validateListingForIngestion: bot-challenge signature in payload is rejected', () => {
  // The challenge detector looks for known CAPTCHA / Turnstile markers.
  const result = validateListingForIngestion(validListing({
    raw: 'Real publisher content. cf-challenge-widget detected.'
  }));
  assert.equal(result.isValid, false);
  assert.ok(result.errors.includes('challenge_payload'));
});

// --- provenance ---------------------------------------------------

test('validateListingForIngestion: missing provenance.observed is rejected', () => {
  const result = validateListingForIngestion(validListing({
    provenance: { origin: 'live', publisher: 'X', recordId: 'Y' }
  }));
  assert.equal(result.isValid, false);
  assert.ok(result.errors.includes('missing_observed_provenance'));
});

test('validateListingForIngestion: fixture origin is rejected as fixture_record_not_ingestible', () => {
  const result = validateListingForIngestion(validListing({
    provenance: { origin: 'fixture', observed: true, publisher: 'X', recordId: 'Y' }
  }));
  assert.equal(result.isValid, false);
  assert.ok(result.errors.includes('fixture_record_not_ingestible'));
});

test('validateListingForIngestion: provenance.fixture=true is rejected', () => {
  const result = validateListingForIngestion(validListing({
    provenance: { origin: 'live', observed: true, fixture: true, publisher: 'X', recordId: 'Y' }
  }));
  assert.equal(result.isValid, false);
  assert.ok(result.errors.includes('fixture_record_not_ingestible'));
});

test('validateListingForIngestion: provenance.observed=false is rejected', () => {
  const result = validateListingForIngestion(validListing({
    provenance: { origin: 'live', observed: false, publisher: 'X', recordId: 'Y' }
  }));
  assert.equal(result.isValid, false);
  assert.ok(result.errors.includes('fixture_record_not_ingestible'));
});

test('validateListingForIngestion: missing publisher is rejected', () => {
  const result = validateListingForIngestion(validListing({
    provenance: { origin: 'live', observed: true, recordId: 'Y' }
  }));
  assert.equal(result.isValid, false);
  assert.ok(result.errors.includes('missing_provenance_publisher'));
});

test('validateListingForIngestion: missing recordId is rejected', () => {
  const result = validateListingForIngestion(validListing({
    provenance: { origin: 'live', observed: true, publisher: 'X' }
  }));
  assert.equal(result.isValid, false);
  assert.ok(result.errors.includes('missing_provenance_record_id'));
});

test('validateListingForIngestion: missing sourceObservedAt is rejected', () => {
  // sourceObservedAt at the top level is preferred; fall back to provenance.observedAt.
  const result = validateListingForIngestion(validListing({ sourceObservedAt: null, provenance: { origin: 'live', observed: true, publisher: 'X', recordId: 'Y' } }));
  assert.equal(result.isValid, false);
  assert.ok(result.errors.includes('missing_source_observation_time'));
});

test('validateListingForIngestion: unparseable sourceObservedAt is rejected', () => {
  const result = validateListingForIngestion(validListing({ sourceObservedAt: 'not-a-date' }));
  assert.equal(result.isValid, false);
  assert.ok(result.errors.includes('missing_source_observation_time'));
});

test('validateListingForIngestion: provenance.observedAt is honored when sourceObservedAt is missing', () => {
  const result = validateListingForIngestion(validListing({
    sourceObservedAt: null,
    provenance: { origin: 'live', observed: true, publisher: 'X', recordId: 'Y', observedAt: '2026-09-01T12:00:00Z' }
  }));
  assert.equal(result.isValid, true, result.errors.join(','));
});

// --- error-shape contract ---------------------------------------

test('validateListingForIngestion: error list never contains duplicates', () => {
  const result = validateListingForIngestion({
    id: '',
    source: '',
    state: 'ZZ',
    address: '',
    lat: null,
    lng: null,
    sourceUrl: null,
    raw: '',
    provenance: { origin: 'fixture', observed: false }
  });
  const set = new Set(result.errors);
  assert.equal(set.size, result.errors.length, `duplicate errors: ${result.errors.join(',')}`);
});

test('validateListingForIngestion: returns the sanitized listing in the result', () => {
  const result = validateListingForIngestion(validListing({ state: 'tx' }));
  assert.equal(result.listing.state, 'TX');
  assert.equal(result.listing.source, 'treasury');
});