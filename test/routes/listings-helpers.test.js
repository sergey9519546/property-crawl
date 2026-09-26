'use strict';

// test/routes/listings-helpers.test.js
//
// Pure-function coverage for the presentation-layer helpers exported by
// server/routes/listings.js. These wrap every listing the public API
// returns, so silent drift in either direction is a real risk:
//
//   - presentListing: stamps sourceFreshness, evidenceCompleteness, triage,
//     parcelKey; neutralises the publisher name in customer-facing strings
//     (replaces "servicelink"/"servicelink auction" with
//     "Public Auction Network")
//   - applyIntelligenceView: filters by minQuality + sorts by quality or
//     opportunity rank
//
// Pins:
//   - sourceFreshness.status: archive vs live+stale vs unknown
//   - evidenceCompleteness.missing: missing sourceUrl/sourceObservedAt/etc.
//   - neutralCustomerText: case-insensitive, suffix-tolerant
//     replacement; non-string passthrough
//   - applyIntelligenceView: minQuality filter, INTELLIGENCE_SORTS branch,
//     stable id-based tie-break when scores tie

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  presentListing,
  applyIntelligenceView,
} = require('../../server/routes/listings');

// --- presentListing ----------------------------------------------------

function makeListing(overrides = {}) {
  return {
    id: 'L1',
    address: '500 Oak St',
    city: 'Cleveland',
    state: 'OH',
    zip: '44115',
    source: 'sheriff',
    sourceUrl: 'https://sheriff.example.com/x',
    sourceObservedAt: new Date().toISOString(),
    openingBid: 100000,
    saleDate: '2027-01-15',
    provenance: { publisher: 'ServiceLink Auction', observedAt: new Date().toISOString(), origin: 'live' },
    ...overrides,
  };
}

test('presentListing: returns the input unchanged when it is null or non-object', () => {
  assert.equal(presentListing(null), null);
  assert.equal(presentListing(undefined), undefined);
  assert.equal(presentListing('not an object'), 'not an object');
  assert.equal(presentListing(42), 42);
});

test('presentListing: stamps sourceFreshness from sourceObservedAt + provenance', () => {
  const out = presentListing(makeListing());
  assert.ok(out.sourceFreshness);
  assert.ok(typeof out.sourceFreshness.ageHours === 'number');
  assert.ok(out.sourceFreshness.ageHours >= 0);
  assert.ok(out.sourceFreshness.cadenceHours > 0);
  assert.ok(['current', 'stale', 'unknown', 'archive'].includes(out.sourceFreshness.status));
});

test('presentListing: marks an archive-origin listing with archive status', () => {
  const out = presentListing(makeListing({
    provenance: { publisher: 'X', origin: 'archive' },
  }));
  assert.equal(out.sourceFreshness.status, 'archive');
  assert.equal(out.discoveryStatus, 'Dated archive snapshot');
});

test('presentListing: marks an unparseable observedAt as unknown', () => {
  const out = presentListing(makeListing({
    sourceObservedAt: 'not-a-date',
    provenance: { publisher: 'X', origin: 'live' },
  }));
  assert.equal(out.sourceFreshness.status, 'unknown');
  assert.equal(out.discoveryStatus, 'Observation unresolved');
});

test('presentListing: marks a live listing older than cadenceHours as stale', () => {
  const longAgo = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
  const out = presentListing(makeListing({
    sourceObservedAt: longAgo,
    provenance: { publisher: 'X', origin: 'live' },
  }));
  assert.equal(out.sourceFreshness.status, 'stale');
  assert.equal(out.discoveryStatus, 'Source refresh due');
});

test('presentListing: marks a recent live listing as current', () => {
  const out = presentListing(makeListing({
    sourceObservedAt: new Date().toISOString(),
    provenance: { publisher: 'X', origin: 'live' },
  }));
  assert.equal(out.sourceFreshness.status, 'current');
  assert.equal(out.discoveryStatus, 'Within source refresh window');
});

test('presentListing: stamps evidenceCompleteness with known/total/missing', () => {
  const out = presentListing(makeListing({ hasDocuments: null }));
  assert.equal(out.evidenceCompleteness.total, 8);
  assert.ok(out.evidenceCompleteness.missing.includes('hasDocuments'));
});

test('presentListing: computed triage is always present', () => {
  const out = presentListing(makeListing());
  assert.ok(out.triage, 'triage object should be set by the presentation layer');
});

test('presentListing: published.parcelKey is set when the listing has apn + countyFips', () => {
  const out = presentListing(makeListing({
    apn: '123-456-789',
    countyFips: '39035',
  }));
  assert.ok(out.parcelKey, 'expected parcelKey to be derived from apn + countyFips');
});

test('presentListing: neutralises the "servicelink" publisher brand in customer-facing strings', () => {
  // The 8 neutralised fields each get rewritten. The provenance publisher
  // field is also neutralised. Pin the documented replacement.
  // The regex is `servicelink(?:[\s_-]*auction)?` — "service link" with a
  // space inside does NOT match (the regex requires the words to be adjacent
  // or separated only by a separator token that is part of the brand).
  // Use the documented brand spellings only.
  const out = presentListing(makeListing({
    plaintiff: 'Bank of America (servicelink)',
    defendant: 'John Smith',
    attorney: 'ServiceLink_Auction counsel',
    deposit: 'Servicelink $5,000',
    description: 'per servicelink auction notice',
    notes: 'servicelink filing',
    raw: 'servicelink-123',
    photoProvider: 'ServiceLink Media',
    provenance: { publisher: 'ServiceLink Auction', origin: 'live' },
  }));
  for (const field of ['plaintiff', 'attorney', 'deposit', 'description', 'notes', 'raw', 'photoProvider']) {
    assert.ok(!out[field].toLowerCase().includes('servicelink'), `${field} still contains "servicelink": ${out[field]}`);
    assert.match(out[field], /Public Auction Network/);
  }
  assert.equal(out.provenance.publisher, 'Public Auction Network');
});

test('presentListing: leaves non-customer-facing fields alone', () => {
  const out = presentListing(makeListing({
    source: 'servicelink',
    sourceKey: 'servicelink',
  }));
  // The source/sourceKey fields are not on the neutralisation list — they
  // drive catalog lookups and must stay as-is for the catalog to find them.
  assert.equal(out.source, 'servicelink');
});

test('presentListing: non-string field values are passed through unchanged', () => {
  const out = presentListing(makeListing({
    plaintiff: 42,        // not a string
    deposit: { amount: 5000 }, // not a string
  }));
  assert.equal(out.plaintiff, 42);
  assert.deepEqual(out.deposit, { amount: 5000 });
});

// --- applyIntelligenceView --------------------------------------------

test('applyIntelligenceView: filters by minQuality', () => {
  const a = { id: 'A', researchQuality: { score: 80 } };
  const b = { id: 'B', researchQuality: { score: 30 } };
  const c = { id: 'C', researchQuality: { score: 90 } };
  const out = applyIntelligenceView([a, b, c], { minQuality: 50 });
  assert.deepEqual(out.map(x => x.id), ['A', 'C']);
});

test('applyIntelligenceView: filters by minQuality 0 keeps all listings', () => {
  const a = { id: 'A' };
  const b = { id: 'B' };
  const out = applyIntelligenceView([a, b], { minQuality: 0 });
  assert.equal(out.length, 2);
});

test('applyIntelligenceView: sort by quality ranks highest score first', () => {
  const a = { id: 'A', researchQuality: { score: 30 } };
  const b = { id: 'B', researchQuality: { score: 90 } };
  const c = { id: 'C', researchQuality: { score: 60 } };
  const out = applyIntelligenceView([a, b, c], { sort: 'quality' });
  assert.deepEqual(out.map(x => x.id), ['B', 'C', 'A']);
});

test('applyIntelligenceView: sort by opportunity ranks highest rank first', () => {
  const a = { id: 'A', opportunity: { rank: 30 } };
  const b = { id: 'B', opportunity: { rank: 90 } };
  const c = { id: 'C', opportunity: { rank: 60 } };
  const out = applyIntelligenceView([a, b, c], { sort: 'opportunity' });
  assert.deepEqual(out.map(x => x.id), ['B', 'C', 'A']);
});

test('applyIntelligenceView: ties on rank break on id (stable secondary key)', () => {
  const a = { id: 'A', researchQuality: { score: 50 } };
  const b = { id: 'B', researchQuality: { score: 50 } };
  const c = { id: 'C', researchQuality: { score: 50 } };
  const out = applyIntelligenceView([a, b, c], { sort: 'quality' });
  assert.deepEqual(out.map(x => x.id), ['A', 'B', 'C']);
});

test('applyIntelligenceView: unknown sort values pass through unchanged', () => {
  const a = { id: 'A', researchQuality: { score: 30 } };
  const b = { id: 'B', researchQuality: { score: 90 } };
  const out = applyIntelligenceView([a, b], { sort: 'unknown-value' });
  assert.deepEqual(out.map(x => x.id), ['A', 'B']);
});

test('applyIntelligenceView: does not mutate the input array', () => {
  const a = { id: 'A', researchQuality: { score: 30 } };
  const b = { id: 'B', researchQuality: { score: 90 } };
  const input = [a, b];
  applyIntelligenceView(input, { sort: 'quality' });
  assert.deepEqual(input.map(x => x.id), ['A', 'B']);
});
