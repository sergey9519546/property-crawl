'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { presentListing, applyIntelligenceView, intelligenceScope } = require('../server/routes/listings');
const { annotateListing } = require('../server/scrapers/listing-intelligence');
const { bandForScore } = require('../server/intelligence/score-bands');

test('presentListing attaches researchQuality and opportunity', () => {
  const presented = presentListing({
    id: 'L1',
    source: 'hud',
    state: 'OH',
    address: '1 Test Ave',
    openingBid: 10,
    provenance: { origin: 'live', observed: true },
  });
  assert.ok(presented.researchQuality);
  assert.ok(presented.opportunity);
  assert.ok(bandForScore(80)?.label === 'Elite');
});

test('intelligence view sorts by quality and opportunity ranks', () => {
  const listings = [
    annotateListing({ id: 'weak', source: 'x', state: 'OH', address: '9 Weak Rd', provenance: { origin: 'unknown' } }),
    annotateListing({
      id: 'strong',
      source: 'hud',
      state: 'OH',
      address: '1 Strong Way',
      openingBid: 1,
      dealScore: 90,
      saleDate: new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10),
      provenance: { origin: 'live', observed: true },
      evidenceCompleteness: { known: 8, total: 8, missing: [] },
      sourceFreshness: { status: 'current' },
    }),
  ];
  const byQuality = applyIntelligenceView(listings, { sort: 'quality' });
  assert.equal(byQuality[0].id, 'strong');
  const byOpportunity = applyIntelligenceView(listings, { sort: 'opportunity' });
  assert.equal(byOpportunity[0].id, 'strong');
  const minQ = applyIntelligenceView(listings, { minQuality: 50 });
  assert.ok(minQ.every((l) => (l.researchQuality?.score ?? 0) >= 50));
});

// Once the intelligence view is active the server filters AFTER the database
// page is fetched, so `total` becomes how many survived on that page. Nothing in
// the response said so, and the workbench's empty state went on to render that
// number as a whole-search count. Live, minQuality=95 over 9,798 listings
// answered total: 0 - not because the store has nothing above 95, but because
// none of the 20 rows loaded on that page cleared it. An unproven negative
// presented as a counted one is the same failure this codebase already closed
// once for opening-bid coverage ("N on this page").
test('the response says when its total counts this page rather than the search', () => {
  // minQuality=95 emptied a 20-row page: evaluated 20, matched 0.
  const pageScoped = intelligenceScope(20, 0, { minQuality: 95 });
  assert.equal(pageScoped.totalIsPageScoped, true);
  assert.deepEqual(pageScoped.pageScope, { evaluated: 20, matched: 0 });
  assert.match(pageScoped.note, /counts matches on this page, not in the whole search/);

  // A quality sort reorders without removing, so the count still is the page,
  // but nothing was filtered away and the note should not imply otherwise.
  const sorted = intelligenceScope(20, 20, { sort: 'quality' });
  assert.equal(sorted.totalIsPageScoped, true);
  assert.deepEqual(sorted.pageScope, { evaluated: 20, matched: 20 });

  // An ordinary database sort really did count the whole search.
  const whole = intelligenceScope(20, 20, { sort: 'date' });
  assert.equal(whole.totalIsPageScoped, false);
  assert.equal(whole.sort, null);
});
