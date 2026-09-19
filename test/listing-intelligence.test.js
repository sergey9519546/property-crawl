'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildIdentityFallback,
  computeResearchQuality,
  computeOpportunity,
  annotateListing,
  summarizeInventory,
} = require('../server/scrapers/listing-intelligence');

test('identity fallback keys address+state without inventing parcel numbers', () => {
  const key = buildIdentityFallback({
    address: '123 Main Street',
    city: 'Cleveland',
    state: 'OH',
    zip: '44114',
    county: 'Cuyahoga',
  });
  assert.match(key, /^addr:OH\|cleveland\|44114\|cuyahoga\|123 main street$/);
  assert.equal(buildIdentityFallback({ address: 'short', state: 'OH' }), null);
});

test('research quality rewards observed completeness and freshness', () => {
  const strong = computeResearchQuality({
    provenance: { origin: 'live', observed: true },
    evidenceCompleteness: { known: 8, total: 8, missing: [] },
    sourceFreshness: { status: 'current' },
    sourceUrl: 'https://example.test/a',
    hasDocuments: true,
    crossSourceMatches: [{ source: 'hud' }],
  });
  assert.equal(strong.score, 100);
  assert.equal(strong.band, 'strong');

  const weak = computeResearchQuality({
    provenance: { origin: 'unknown' },
    evidenceCompleteness: { known: 1, total: 8, missing: ['saleDate'] },
    sourceFreshness: { status: 'unknown' },
  });
  assert.ok(weak.score < 25);
  assert.equal(weak.band, 'weak');
});

test('opportunity rank uses modeled deal score and sale urgency only', () => {
  const rank = computeOpportunity({
    openingBid: 50000,
    estLow: 100000,
    estHigh: 120000,
    mid: 110000,
    dealScore: 80,
    saleDate: new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10),
    evidenceCompleteness: { known: 7, total: 8, missing: [] },
    hasDocuments: true,
  });
  assert.equal(rank.urgency, 'imminent');
  assert.equal(rank.shape, 'deep_discount_model');
  assert.ok(rank.rank >= 70);
  assert.match(rank.note, /Triage only/);
});

test('annotateListing attaches quality and opportunity without mutating raw facts', () => {
  const annotated = annotateListing({
    id: 'X1',
    source: 'hud',
    state: 'OH',
    address: '9 Example Ave',
    openingBid: 10,
    provenance: { origin: 'live', observed: true },
  });
  assert.ok(annotated.researchQuality);
  assert.ok(annotated.opportunity);
  assert.equal(annotated.openingBid, 10);
  assert.match(annotated.identityFallback || '', /^addr:/);
});

test('summarizeInventory buckets bands and urgency', () => {
  const summary = summarizeInventory([
    {
      source: 'hud',
      provenance: { origin: 'live', observed: true },
      evidenceCompleteness: { known: 8, total: 8, missing: [] },
      sourceFreshness: { status: 'current' },
      openingBid: 1,
      dealScore: 90,
      saleDate: new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10),
      address: '1 Complete Way',
      state: 'OH',
    },
    {
      source: 'sheriff',
      provenance: { origin: 'unknown' },
      evidenceCompleteness: { known: 0, total: 8, missing: ['saleDate'] },
      address: '2 Thin Rd',
      state: 'OH',
    },
  ]);
  assert.equal(summary.total, 2);
  assert.equal(summary.observed, 1);
  assert.equal(summary.byQualityBand.strong + summary.byQualityBand.usable + summary.byQualityBand.thin + summary.byQualityBand.weak, 2);
  assert.ok(summary.bySaleUrgency.imminent >= 1);
});
