'use strict';

// test/intelligence/saved-search-alerts-helpers.test.js
//
// Direct unit coverage for server/intelligence/saved-search-alerts.js.
// The saved-search matcher decides which listings trigger a user alert
// on ingestion. Silent drift in the match reasons or the empty-search
// guard would silently spam alerts for every listing or silently drop
// real matches.
//
//   - normalizedStates: trim + uppercase + dedupe
//   - normalizedSources: trim + lowercase + dedupe
//   - normalizedKeywords: trim + lowercase, no dedupe (order preserved)
//   - hasAnyFilter: true iff at least one filter is non-empty
//   - matchListingAgainstSearch: machine-readable reasons for every
//     filter dimension
//   - matchAllSearches: matches + skipped arrays, non-array -> empty

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  matchListingAgainstSearch,
  matchAllSearches,
  hasAnyFilter,
  _internals: { normalizedStates, normalizedSources, normalizedKeywords },
} = require('../../server/intelligence/saved-search-alerts');

// --- normalizedStates --------------------------------------------------

test('normalizedStates: trim + uppercase + dedupe', () => {
  assert.deepEqual(normalizedStates({ states: [' oh ', 'OH', 'tx', 'TX'] }),
    ['OH', 'TX']);
});

test('normalizedStates: missing / empty / non-array -> null', () => {
  assert.equal(normalizedStates({}), null);
  assert.equal(normalizedStates({ states: [] }), null);
  assert.equal(normalizedStates({ states: 'OH' }), null);
  assert.equal(normalizedStates({ states: ['', '   '] }), null);
});

test('normalizedStates: flat vs nested filters (filters.states wins when flat is missing)', () => {
  assert.deepEqual(normalizedStates({ filters: { states: ['CA'] } }), ['CA']);
  // top-level wins when both are present
  assert.deepEqual(normalizedStates({ states: ['OH'], filters: { states: ['CA'] } }),
    ['OH']);
});

// --- normalizedSources -------------------------------------------------

test('normalizedSources: trim + lowercase + dedupe', () => {
  assert.deepEqual(normalizedSources({ sources: ['Sheriff', 'sheriff', 'TREASURY'] }),
    ['sheriff', 'treasury']);
});

// --- normalizedKeywords -----------------------------------------------

test('normalizedKeywords: trim + lowercase, order preserved', () => {
  assert.deepEqual(normalizedKeywords({ keywords: ['POOL', 'pool', ' Garage'] }),
    ['pool', 'pool', 'garage']);
});

test('normalizedKeywords: empty / whitespace-only entries disqualify the array', () => {
  // isStringArray requires every element to be non-empty after trim,
  // so any array with empties is rejected outright (-> null).
  assert.equal(normalizedKeywords({ keywords: ['a', '', '   ', 'b'] }), null);
});

// --- hasAnyFilter -----------------------------------------------------

test('hasAnyFilter: false for empty search', () => {
  assert.equal(hasAnyFilter({}), false);
  assert.equal(hasAnyFilter(null), false);
  assert.equal(hasAnyFilter({ states: [], sources: [], propTypes: [], keywords: [] }), false);
});

test('hasAnyFilter: true when any single filter is present', () => {
  assert.equal(hasAnyFilter({ states: ['OH'] }), true);
  assert.equal(hasAnyFilter({ minScore: 50 }), true);
  assert.equal(hasAnyFilter({ maxBid: 100000 }), true);
  assert.equal(hasAnyFilter({ minEquity: 50000 }), true);
  assert.equal(hasAnyFilter({ occupancy: 'vacant' }), true);
  assert.equal(hasAnyFilter({ keywords: ['pool'] }), true);
});

// --- matchListingAgainstSearch ---------------------------------------

test('matchListingAgainstSearch: missing listing -> listing_missing', () => {
  const r = matchListingAgainstSearch(null, { states: ['OH'] });
  assert.equal(r.match, false);
  assert.equal(r.reason, 'listing_missing');
});

test('matchListingAgainstSearch: missing search -> search_missing', () => {
  const r = matchListingAgainstSearch({ state: 'OH' }, null);
  assert.equal(r.match, false);
  assert.equal(r.reason, 'search_missing');
});

test('matchListingAgainstSearch: empty search -> search_empty_filters', () => {
  const r = matchListingAgainstSearch({ state: 'OH' }, {});
  assert.equal(r.match, false);
  assert.equal(r.reason, 'search_empty_filters');
});

test('matchListingAgainstSearch: state match', () => {
  const r = matchListingAgainstSearch({ state: 'OH' }, { states: ['OH', 'FL'] });
  assert.deepEqual(r, { match: true });
});

test('matchListingAgainstSearch: state mismatch -> state_mismatch', () => {
  const r = matchListingAgainstSearch({ state: 'TX' }, { states: ['OH', 'FL'] });
  assert.equal(r.reason, 'state_mismatch');
});

test('matchListingAgainstSearch: source mismatch', () => {
  const r = matchListingAgainstSearch({ source: 'x' }, { sources: ['sheriff'] });
  assert.equal(r.reason, 'source_mismatch');
});

test('matchListingAgainstSearch: propType mismatch', () => {
  const r = matchListingAgainstSearch({ propType: 'condo' }, { propTypes: ['single-family'] });
  assert.equal(r.reason, 'propType_mismatch');
});

test('matchListingAgainstSearch: minScore not met', () => {
  const r = matchListingAgainstSearch({ dealScore: 40 }, { minScore: 50 });
  assert.equal(r.reason, 'minScore_not_met');
});

test('matchListingAgainstSearch: maxBid exceeded', () => {
  const r = matchListingAgainstSearch({ openingBid: 150000 }, { maxBid: 100000 });
  assert.equal(r.reason, 'maxBid_exceeded');
});

test('matchListingAgainstSearch: maxBid null bid does NOT trigger (passes)', () => {
  // When the listing's bid is missing, we don't know if it would exceed — let it through.
  const r = matchListingAgainstSearch({ state: 'OH' }, { states: ['OH'], maxBid: 100000 });
  assert.deepEqual(r, { match: true });
});

test('matchListingAgainstSearch: minEquity not met', () => {
  const r = matchListingAgainstSearch({ equity: 10000 }, { minEquity: 50000 });
  assert.equal(r.reason, 'minEquity_not_met');
});

test('matchListingAgainstSearch: occupancy mismatch', () => {
  const r = matchListingAgainstSearch({ occupancy: 'owner-occupied' }, { occupancy: 'vacant' });
  assert.equal(r.reason, 'occupancy_mismatch');
});

test('matchListingAgainstSearch: keywords no match (against address+city)', () => {
  const r = matchListingAgainstSearch({ address: '123 Main St', city: 'Cleveland' }, { keywords: ['pool'] });
  assert.equal(r.reason, 'keywords_no_match');
});

test('matchListingAgainstSearch: keywords match in city', () => {
  const r = matchListingAgainstSearch({ city: 'Pool City', state: 'OH' }, { states: ['OH'], keywords: ['pool'] });
  assert.deepEqual(r, { match: true });
});

// --- matchAllSearches -------------------------------------------------

test('matchAllSearches: non-array searches -> empty result', () => {
  assert.deepEqual(matchAllSearches({ state: 'OH' }, null), { matches: [], skipped: [] });
});

test('matchAllSearches: separates matches from skipped (empty-filter)', () => {
  const listing = { state: 'OH' };
  const searches = [
    { id: 'S1', states: ['OH'] },     // matches
    { id: 'S2' },                      // skipped
    { id: 'S3', states: ['TX'] },     // mismatch (not added to either)
  ];
  const r = matchAllSearches(listing, searches);
  assert.equal(r.matches.length, 1);
  assert.equal(r.matches[0].searchId, 'S1');
  assert.equal(r.skipped.length, 1);
  assert.equal(r.skipped[0].searchId, 'S2');
  assert.equal(r.skipped[0].reason, 'search_empty_filters');
});

test('matchAllSearches: includes search label when present', () => {
  const listing = { state: 'OH' };
  const searches = [{ id: 'S1', label: 'Ohio Auctions', states: ['OH'] }];
  const r = matchAllSearches(listing, searches);
  assert.equal(r.matches[0].label, 'Ohio Auctions');
});