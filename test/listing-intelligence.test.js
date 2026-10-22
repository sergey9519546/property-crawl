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

// This object is computed over the page the response carries, and it ships with
// its own `total` and a `bySource` breakdown - both page-sized - while calling
// itself an "Inventory quality summary". docs/SCRAPER_LISTING_10X.md documents
// the consumer as `curl "/api/listings?limit=5" | jq .pipeline`, so the natural
// reading of `bySource: {"servicelink": 2}` is "ServiceLink holds 2 listings".
// Live against a store of 9,798: limit=2 reported total 2 and only the sources
// that happened to sort first. The scope has to be stated in the payload, not
// left to whoever curls it.
test('the inventory summary declares that it describes the returned page', () => {
  const summary = summarizeInventory([
    { id: 'A', source: 'servicelink', state: 'OH', address: '1 A St', provenance: { origin: 'live', observed: true } },
    { id: 'B', source: 'servicelink', state: 'OH', address: '2 B St', provenance: { origin: 'live', observed: true } },
  ]);
  assert.equal(summary.scope, 'returned-page');
  assert.match(summary.note, /returned page/);
  assert.doesNotMatch(summary.note, /Inventory quality summary/);
});

test('annotateListing derives opportunity dealScore and rank from enrolled county assessor roll without mutating top-level valuation fields', () => {
  const withAssessor = annotateListing({
    id: 'SHERIFF-OH-CUY-1',
    source: 'sheriff',
    state: 'OH',
    county: 'Cuyahoga',
    address: '100 Main St, Cleveland, OH 44113',
    openingBid: 70000,
    saleDate: new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10),
    provenance: {
      origin: 'live',
      observed: true,
      derivedFields: {
        assessorRoll: {
          parcel: {
            canonicalApn: '101-23-001',
            countyFips: '39035',
            assessedValue: { total: 70000 },
          },
        },
      },
    },
  });
  // Top-level valuation fields remain untouched (undefined)
  assert.equal(withAssessor.estLow, undefined);
  assert.equal(withAssessor.estHigh, undefined);
  assert.equal(withAssessor.dealScore, undefined);
  // Opportunity model reads Cuyahoga 35% taxable fraction -> $200,000 marketComparison
  assert.equal(withAssessor.opportunity.valuationBasis, 'enrolled_assessor_registry');
  assert.equal(withAssessor.opportunity.bidSpread, 130000);
  assert.equal(withAssessor.opportunity.bidToMidRatio, 0.35);
  assert.equal(withAssessor.opportunity.dealScore, 85);
  assert.equal(withAssessor.opportunity.shape, 'deep_discount_model');
  assert.ok(withAssessor.opportunity.rank >= 70);
  assert.ok(withAssessor.researchQuality.factors.some((f) => f.factor === 'cadastral_parcel_verified' && f.weight === 5));

  // Negative control: un-enrolled or withheld county (IL-COOK) does not fabricate marketComparison
  const withheld = annotateListing({
    id: 'SHERIFF-IL-COOK-1',
    source: 'sheriff',
    state: 'IL',
    county: 'Cook',
    address: '200 State St, Chicago, IL 60601',
    openingBid: 70000,
    assessorParcel: {
      canonicalApn: '14-28-100-001-0000',
      assessedValue: { total: 70000 },
    },
  });
  assert.equal(withheld.opportunity.valuationBasis, null);
  assert.equal(withheld.opportunity.dealScore, null);
  assert.equal(withheld.opportunity.bidSpread, null);
});
