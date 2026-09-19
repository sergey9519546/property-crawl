'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { presentListing, applyIntelligenceView } = require('../server/routes/listings');
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
