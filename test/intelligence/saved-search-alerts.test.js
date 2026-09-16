'use strict';

// test/intelligence/saved-search-alerts.test.js
//
// Tests for the saved-search match engine at
// server/intelligence/saved-search-alerts.js. This module decides
// whether a listing satisfies a saved search; it's pure-function, no DB.

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  matchListingAgainstSearch,
  matchAllSearches,
  hasAnyFilter
} = require('../../server/intelligence/saved-search-alerts');

function listing(overrides = {}) {
  return {
    id: 'L1',
    source: 'treasury',
    state: 'TX',
    city: 'Bruni',
    address: '112 North Avenue E, Bruni, TX',
    county: 'Webb',
    propType: 'Single Family',
    openingBid: 50000,
    estLow: 90000,
    estHigh: 110000,
    mid: 100000,
    equity: 50000,
    dealScore: 75,
    occupancy: 'Vacant',
    seniorLienRisk: 'low',
    redemptionWarning: 'standard',
    plaintiff: 'Bank',
    defendant: 'Smith',
    attorney: 'Doe',
    raw: 'SHERIFF SALE...',
    ...overrides
  };
}

function search(overrides = {}) {
  return {
    id: 'S1',
    label: 'Texas single family under 100k',
    states: ['TX'],
    sources: ['treasury', 'hud'],
    propTypes: ['Single Family'],
    minScore: 60,
    maxBid: 100000,
    minEquity: 20000,
    keywords: [],
    ...overrides
  };
}

// --- hasAnyFilter ---------------------------------------------------------

test('hasAnyFilter: a fully-empty search is rejected (would match everything)', () => {
  assert.equal(hasAnyFilter({}), false);
});

test('hasAnyFilter: a single non-empty dimension qualifies', () => {
  assert.equal(hasAnyFilter({ states: ['TX'] }), true);
  assert.equal(hasAnyFilter({ maxBid: 100000 }), true);
  assert.equal(hasAnyFilter({ occupancy: 'Vacant' }), true);
  assert.equal(hasAnyFilter({ keywords: ['Austin'] }), true);
});

test('hasAnyFilter: empty arrays do not count as filters', () => {
  assert.equal(hasAnyFilter({ states: [] }), false);
  assert.equal(hasAnyFilter({ keywords: [''] }), false);
});

// --- matchListingAgainstSearch --------------------------------------------

test('matchListingAgainstSearch: a fully-matching listing matches', () => {
  const result = matchListingAgainstSearch(listing(), search());
  assert.deepEqual(result, { match: true });
});

test('matchListingAgainstSearch: state mismatch returns reason=state_mismatch', () => {
  const result = matchListingAgainstSearch(listing({ state: 'CA' }), search());
  assert.equal(result.match, false);
  assert.equal(result.reason, 'state_mismatch');
});

test('matchListingAgainstSearch: source mismatch returns reason=source_mismatch', () => {
  const result = matchListingAgainstSearch(listing({ source: 'irs' }), search());
  assert.equal(result.match, false);
  assert.equal(result.reason, 'source_mismatch');
});

test('matchListingAgainstSearch: propType mismatch returns reason=propType_mismatch', () => {
  const result = matchListingAgainstSearch(listing({ propType: 'Land' }), search());
  assert.equal(result.match, false);
  assert.equal(result.reason, 'propType_mismatch');
});

test('matchListingAgainstSearch: minScore not met returns reason=minScore_not_met', () => {
  const result = matchListingAgainstSearch(listing({ dealScore: 50 }), search());
  assert.equal(result.match, false);
  assert.equal(result.reason, 'minScore_not_met');
});

test('matchListingAgainstSearch: missing dealScore fails closed when minScore is set', () => {
  // A listing with no deal score can't prove it meets the threshold,
  // so it's filtered out — the alert engine never invents a score.
  const result = matchListingAgainstSearch(listing({ dealScore: null }), search());
  assert.equal(result.match, false);
  assert.equal(result.reason, 'minScore_not_met');
});

test('matchListingAgainstSearch: maxBid exceeded returns reason=maxBid_exceeded', () => {
  const result = matchListingAgainstSearch(listing({ openingBid: 200000 }), search());
  assert.equal(result.match, false);
  assert.equal(result.reason, 'maxBid_exceeded');
});

test('matchListingAgainstSearch: openingBid missing is allowed (we don\'t penalize unknowns)', () => {
  // maxBid filters out known-too-expensive; it does NOT require a value.
  // A listing without an opening bid is still eligible to alert — the
  // search constraint is a ceiling, not a presence check.
  const result = matchListingAgainstSearch(listing({ openingBid: null }), search());
  assert.equal(result.match, true);
});

test('matchListingAgainstSearch: minEquity not met returns reason=minEquity_not_met', () => {
  const result = matchListingAgainstSearch(listing({ equity: 10000 }), search());
  assert.equal(result.match, false);
  assert.equal(result.reason, 'minEquity_not_met');
});

test('matchListingAgainstSearch: occupancy mismatch returns reason=occupancy_mismatch', () => {
  const result = matchListingAgainstSearch(listing({ occupancy: 'Occupied' }), search({ occupancy: 'Vacant' }));
  assert.equal(result.match, false);
  assert.equal(result.reason, 'occupancy_mismatch');
});

test('matchListingAgainstSearch: seniorLien mismatch returns reason=seniorLien_mismatch', () => {
  const result = matchListingAgainstSearch(listing({ seniorLienRisk: 'high' }), search({ seniorLien: 'low' }));
  assert.equal(result.match, false);
  assert.equal(result.reason, 'seniorLien_mismatch');
});

test('matchListingAgainstSearch: redemption mismatch returns reason=redemption_mismatch', () => {
  const result = matchListingAgainstSearch(listing({ redemptionWarning: 'extended' }), search({ redemption: 'standard' }));
  assert.equal(result.match, false);
  assert.equal(result.reason, 'redemption_mismatch');
});

test('matchListingAgainstSearch: keyword search requires keyword in any text field', () => {
  const result = matchListingAgainstSearch(listing({ address: '112 North Avenue E, Bruni, TX' }), search({
    keywords: ['austin'],
    states: [],
    sources: [],
    propTypes: [],
    minScore: null,
    maxBid: null,
    minEquity: null
  }));
  assert.equal(result.match, false);
  assert.equal(result.reason, 'keywords_no_match');

  // Now a keyword that appears in the address
  const result2 = matchListingAgainstSearch(listing({ address: '112 North Avenue E, Bruni, TX' }), search({
    keywords: ['bruni'],
    states: [],
    sources: [],
    propTypes: [],
    minScore: null,
    maxBid: null,
    minEquity: null
  }));
  assert.equal(result2.match, true);
});

test('matchListingAgainstSearch: case-insensitive state matching', () => {
  const result = matchListingAgainstSearch(listing({ state: 'tx' }), search({ states: ['TX'] }));
  assert.equal(result.match, true);
});

test('matchListingAgainstSearch: empty search (no filters) returns reason=search_empty_filters', () => {
  const result = matchListingAgainstSearch(listing(), {});
  assert.equal(result.match, false);
  assert.equal(result.reason, 'search_empty_filters');
});

test('matchListingAgainstSearch: missing listing returns reason=listing_missing', () => {
  const result = matchListingAgainstSearch(null, search());
  assert.equal(result.match, false);
  assert.equal(result.reason, 'listing_missing');
});

test('matchListingAgainstSearch: missing search returns reason=search_missing', () => {
  const result = matchListingAgainstSearch(listing(), null);
  assert.equal(result.match, false);
  assert.equal(result.reason, 'search_missing');
});

test('matchListingAgainstSearch: state filter allows null listing state to fail closed', () => {
  const result = matchListingAgainstSearch(listing({ state: null }), search());
  assert.equal(result.match, false);
  assert.equal(result.reason, 'state_mismatch');
});

// --- matchAllSearches -----------------------------------------------------

test('matchAllSearches: returns matching search IDs in input order', () => {
  const searches = [
    search({ id: 'S1', label: 'TX only', states: ['TX'] }),
    search({ id: 'S2', label: 'CA only', states: ['CA'] }),
    search({ id: 'S3', label: 'Under 60k', maxBid: 60000 })
  ];
  const result = matchAllSearches(listing({ openingBid: 50000 }), searches);
  assert.deepEqual(result.matches.map((m) => m.searchId), ['S1', 'S3']);
});

test('matchAllSearches: empty-filter searches are tracked separately as skipped', () => {
  const searches = [
    search({ id: 'S1' }),
    search({ id: 'S2', states: ['CA'] }),
    {}
  ];
  const result = matchAllSearches(listing(), searches);
  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0].searchId, 'S1');
  assert.equal(result.skipped.length, 1);
  assert.equal(result.skipped[0].reason, 'search_empty_filters');
});

test('matchAllSearches: non-array input returns empty results', () => {
  const result = matchAllSearches(listing(), null);
  assert.deepEqual(result.matches, []);
  assert.deepEqual(result.skipped, []);
});

test('matchAllSearches: a fully-matching listing matches every applicable search', () => {
  const searches = [
    search({ id: 'S1', states: ['TX'] }),
    search({ id: 'S2', sources: ['treasury'] }),
    search({ id: 'S3', minScore: 50 })
  ];
  const result = matchAllSearches(listing(), searches);
  assert.equal(result.matches.length, 3);
});