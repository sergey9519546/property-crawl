'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  computeBakeOff,
  applyCrossSourceBakeOff
} = require('../server/db/client');

function listing(overrides = {}) {
  const now = new Date().toISOString();
  return {
    id: 'listing-1',
    source: 'servicelink',
    state: 'CA',
    address: '123 Main St',
    sourceUrl: 'https://www.servicelinkauction.com/property-details/sample-1',
    sourceObservedAt: now,
    provenance: {
      origin: 'live',
      observed: true,
      publisher: 'ServiceLink Auction',
      recordId: 'sample-1',
      observedAt: now
    },
    parcelKey: null,
    openingBid: 100_000,
    ...overrides
  };
}

test('computeBakeOff returns fresher-source preference and confidence', () => {
  const fresh = listing({ source: 'fresh-source', sourceObservedAt: '2026-09-14T13:00:00.000Z' });
  const stale = listing({ source: 'stale-source', sourceObservedAt: '2026-09-14T10:00:00.000Z' });
  const result = computeBakeOff(stale, fresh);
  assert.equal(result.preferredSource, 'fresh-source');
  assert.equal(result.otherSource, 'stale-source');
  assert.equal(result.otherListingId, 'listing-1');
  assert.ok(result.reason.includes('Fresher observation from fresh-source'));
  assert.ok(result.reason.includes('3h'));
  assert.equal(result.confidence, 0.7); // 3h gap -> medium
});

test('computeBakeOff returns high confidence when age gap > 24h', () => {
  const fresh = listing({ source: 'fresh', sourceObservedAt: '2026-09-14T13:00:00.000Z' });
  const stale = listing({ source: 'stale', sourceObservedAt: '2026-09-10T13:00:00.000Z' });
  const result = computeBakeOff(stale, fresh);
  assert.equal(result.confidence, 0.9);
});

test('computeBakeOff returns low confidence when age gap <= 1h', () => {
  const fresh = listing({ source: 'fresh', sourceObservedAt: '2026-09-14T13:00:00.000Z' });
  const stale = listing({ source: 'stale', sourceObservedAt: '2026-09-14T12:30:00.000Z' });
  const result = computeBakeOff(stale, fresh);
  assert.equal(result.confidence, 0.5);
  assert.ok(result.reason.includes('<1h'));
});

test('computeBakeOff prefers incoming when observation times tie', () => {
  const ts = '2026-09-14T13:00:00.000Z';
  const a = listing({ id: 'a', source: 'a-source', sourceObservedAt: ts });
  const b = listing({ id: 'b', source: 'b-source', sourceObservedAt: ts });
  const result = computeBakeOff(a, b);
  assert.equal(result.preferredSource, 'b-source');
  assert.equal(result.otherSource, 'a-source');
});

test('computeBakeOff falls back to provenance.observedAt when sourceObservedAt is missing', () => {
  const provenanceTime = '2026-09-14T13:00:00.000Z';
  const fresh = listing({
    source: 'fresh',
    sourceObservedAt: undefined,
    provenance: { origin: 'live', observed: true, publisher: 'X', recordId: 'a', observedAt: provenanceTime }
  });
  const stale = listing({
    id: 'stale-1',
    source: 'stale',
    sourceObservedAt: undefined,
    provenance: { origin: 'live', observed: true, publisher: 'X', recordId: 'b', observedAt: '2026-09-14T10:00:00.000Z' }
  });
  const result = computeBakeOff(stale, fresh);
  assert.equal(result.preferredSource, 'fresh');
});

test('computeBakeOff produces a human-readable reason with rounded hours', () => {
  const fresh = listing({ source: 'f', sourceObservedAt: '2026-09-14T13:00:00.000Z' });
  const stale = listing({ source: 's', sourceObservedAt: '2026-09-14T08:00:00.000Z' });
  const result = computeBakeOff(stale, fresh);
  assert.match(result.reason, /Fresher observation from f/);
  assert.match(result.reason, /5h/);
});

test('applyCrossSourceBakeOff returns 0 when input is empty', () => {
  assert.equal(applyCrossSourceBakeOff([]), 0);
});

test('applyCrossSourceBakeOff returns 0 when input is not an array', () => {
  assert.equal(applyCrossSourceBakeOff(null), 0);
  assert.equal(applyCrossSourceBakeOff(undefined), 0);
  assert.equal(applyCrossSourceBakeOff('not-array'), 0);
});

test('applyCrossSourceBakeOff returns 0 when only one listing is provided', () => {
  assert.equal(applyCrossSourceBakeOff([listing()]), 0);
});

test('applyCrossSourceBakeOff returns 0 when listings share no parcelKey', () => {
  const a = listing({ id: 'a', parcelKey: null });
  const b = listing({ id: 'b', parcelKey: null });
  assert.equal(applyCrossSourceBakeOff([a, b]), 0);
});

test('applyCrossSourceBakeOff skips same-source matches (no cross-source collision)', () => {
  const a = listing({ id: 'a', source: 'servicelink', parcelKey: 'ST-CA:0001' });
  const b = listing({ id: 'b', source: 'servicelink', parcelKey: 'ST-CA:0001' });
  assert.equal(applyCrossSourceBakeOff([a, b]), 0);
});

test('applyCrossSourceBakeOff annotates cross-source parcelKey collisions', () => {
  const a = listing({
    id: 'a',
    source: 'servicelink',
    parcelKey: 'ST-CA:0001',
    sourceObservedAt: '2026-09-14T10:00:00.000Z'
  });
  const b = listing({
    id: 'b',
    source: 'hud',
    parcelKey: 'ST-CA:0001',
    sourceObservedAt: '2026-09-14T13:00:00.000Z'
  });
  const annotated = applyCrossSourceBakeOff([a, b]);
  assert.equal(annotated, 2);
  assert.ok(Array.isArray(a.crossSourceMatches));
  assert.equal(a.crossSourceMatches.length, 1);
  assert.equal(a.crossSourceMatches[0].source, 'hud');
  assert.equal(a.crossSourceMatches[0].listingId, 'b');
  assert.equal(a.crossSourceMatches[0].observedAt, '2026-09-14T13:00:00.000Z');
  assert.equal(a.crossSourceMatches[0].openingBid, 100_000);
  assert.ok(a.bakeOff);
  assert.equal(a.bakeOff.preferredSource, 'hud');
  assert.equal(b.crossSourceMatches.length, 1);
  assert.equal(b.crossSourceMatches[0].source, 'servicelink');
  assert.equal(b.bakeOff.preferredSource, 'hud');
});

test('applyCrossSourceBakeOff annotates three-way collisions with multiple cross-source matches', () => {
  const a = listing({ id: 'a', source: 'servicelink', parcelKey: 'ST-CA:0001' });
  const b = listing({ id: 'b', source: 'hud', parcelKey: 'ST-CA:0001' });
  const c = listing({ id: 'c', source: 'civilview', parcelKey: 'ST-CA:0001' });
  const annotated = applyCrossSourceBakeOff([a, b, c]);
  assert.equal(annotated, 3);
  assert.equal(a.crossSourceMatches.length, 2);
  assert.ok(a.crossSourceMatches.some((m) => m.source === 'hud'));
  assert.ok(a.crossSourceMatches.some((m) => m.source === 'civilview'));
});

test('applyCrossSourceBakeOff handles listings with no parcelKey without breaking', () => {
  const a = listing({ id: 'a', parcelKey: null });
  const b = listing({ id: 'b', parcelKey: 'ST-CA:0001' });
  const c = listing({ id: 'c', source: 'hud', parcelKey: 'ST-CA:0001' });
  const annotated = applyCrossSourceBakeOff([a, b, c]);
  assert.equal(annotated, 2);
  assert.equal(a.crossSourceMatches, undefined);
  assert.equal(b.crossSourceMatches.length, 1);
  assert.equal(b.crossSourceMatches[0].source, 'hud');
});

test('applyCrossSourceBakeOff produces the right preferred source for the older listing', () => {
  const older = listing({
    id: 'older',
    source: 'servicelink',
    parcelKey: 'ST-CA:0001',
    sourceObservedAt: '2026-09-10T13:00:00.000Z'
  });
  const newer = listing({
    id: 'newer',
    source: 'hud',
    parcelKey: 'ST-CA:0001',
    sourceObservedAt: '2026-09-14T13:00:00.000Z'
  });
  applyCrossSourceBakeOff([older, newer]);
  assert.equal(older.bakeOff.preferredSource, 'hud');
  assert.equal(older.bakeOff.confidence, 0.9);
  assert.equal(newer.bakeOff.preferredSource, 'hud');
});

test('applyCrossSourceBakeOff mutates the input array in place', () => {
  const a = listing({ id: 'a', source: 'servicelink', parcelKey: 'ST-CA:0001' });
  const b = listing({ id: 'b', source: 'hud', parcelKey: 'ST-CA:0001' });
  const input = [a, b];
  applyCrossSourceBakeOff(input);
  // The function mutates the input array's elements; the array itself and
  // its members stay the same object references.
  assert.equal(input.length, 2);
  assert.equal(input[0], a);
  assert.equal(input[1], b);
  assert.ok(a.crossSourceMatches);
  assert.ok(b.crossSourceMatches);
});

test('applyCrossSourceBakeOff overwrites pre-existing crossSourceMatches / bakeOff', () => {
  const a = listing({
    id: 'a',
    source: 'servicelink',
    parcelKey: 'ST-CA:0001',
    sourceObservedAt: '2026-09-10T13:00:00.000Z',
    crossSourceMatches: [{ stale: true, openingBid: 1 }],
    bakeOff: { preferredSource: 'old', reason: 'stale', confidence: 0.1 }
  });
  const b = listing({
    id: 'b',
    source: 'hud',
    parcelKey: 'ST-CA:0001',
    sourceObservedAt: '2026-09-14T13:00:00.000Z'
  });
  applyCrossSourceBakeOff([a, b]);
  // The stale pre-existing data should be replaced.
  assert.notEqual(a.crossSourceMatches[0]?.stale, true);
  assert.equal(a.bakeOff.preferredSource, 'hud');
  assert.match(a.bakeOff.reason, /Fresher/);
  assert.ok(a.bakeOff.confidence >= 0.5);
});

test('applyCrossSourceBakeOff handles listings with missing sourceObservedAt', () => {
  const a = listing({
    id: 'a',
    source: 'servicelink',
    parcelKey: 'ST-CA:0001',
    sourceObservedAt: undefined,
    provenance: { origin: 'live', observed: true, publisher: 'X', recordId: 'a', observedAt: '2026-09-14T13:00:00.000Z' }
  });
  const b = listing({
    id: 'b',
    source: 'hud',
    parcelKey: 'ST-CA:0001',
    sourceObservedAt: undefined,
    provenance: { origin: 'live', observed: true, publisher: 'X', recordId: 'b', observedAt: '2026-09-10T13:00:00.000Z' }
  });
  applyCrossSourceBakeOff([a, b]);
  assert.ok(a.crossSourceMatches);
  assert.equal(a.bakeOff.preferredSource, 'servicelink');
});

test('applyCrossSourceBakeOff emits null openingBid when the other side has none', () => {
  const a = listing({ id: 'a', source: 'servicelink', parcelKey: 'ST-CA:0001', openingBid: 100_000 });
  const b = listing({ id: 'b', source: 'hud', parcelKey: 'ST-CA:0001', openingBid: null });
  applyCrossSourceBakeOff([a, b]);
  assert.equal(a.crossSourceMatches[0].openingBid, null);
  assert.equal(b.crossSourceMatches[0].openingBid, 100_000);
});

test('applyCrossSourceBakeOff reasons are concise and machine-parseable', () => {
  const a = listing({ id: 'a', source: 'servicelink', parcelKey: 'ST-CA:0001' });
  const b = listing({ id: 'b', source: 'hud', parcelKey: 'ST-CA:0001' });
  applyCrossSourceBakeOff([a, b]);
  assert.ok(a.bakeOff.reason.length > 10);
  assert.ok(a.bakeOff.reason.length < 200);
  assert.match(a.bakeOff.reason, /^Fresher observation from /);
});

test('applyCrossSourceBakeOff picks the freshest cross-source peer to compare against', () => {
  // When the listing is older than every cross-source peer, the freshest
  // cross-source peer becomes the preferredSource in the bake-off.
  const oldListing = listing({
    id: 'old',
    source: 'servicelink',
    parcelKey: 'ST-CA:0001',
    sourceObservedAt: '2026-09-10T13:00:00.000Z'
  });
  const hudPeer = listing({
    id: 'hud-peer',
    source: 'hud',
    parcelKey: 'ST-CA:0001',
    sourceObservedAt: '2026-09-13T13:00:00.000Z'
  });
  const civilviewPeer = listing({
    id: 'cv-peer',
    source: 'civilview',
    parcelKey: 'ST-CA:0001',
    sourceObservedAt: '2026-09-14T13:00:00.000Z'
  });
  applyCrossSourceBakeOff([oldListing, hudPeer, civilviewPeer]);
  assert.equal(oldListing.bakeOff.preferredSource, 'civilview');
});

test('applyCrossSourceBakeOff prefers the listing itself when it is fresher than all cross-source peers', () => {
  const freshListing = listing({
    id: 'fresh',
    source: 'servicelink',
    parcelKey: 'ST-CA:0001',
    sourceObservedAt: '2026-09-14T13:00:00.000Z'
  });
  const hudPeer = listing({
    id: 'hud-peer',
    source: 'hud',
    parcelKey: 'ST-CA:0001',
    sourceObservedAt: '2026-09-10T13:00:00.000Z'
  });
  const civilviewPeer = listing({
    id: 'cv-peer',
    source: 'civilview',
    parcelKey: 'ST-CA:0001',
    sourceObservedAt: '2026-09-12T13:00:00.000Z'
  });
  applyCrossSourceBakeOff([freshListing, hudPeer, civilviewPeer]);
  assert.equal(freshListing.bakeOff.preferredSource, 'servicelink');
});

test('applyCrossSourceBakeOff returns the count of annotated listings (not groups)', () => {
  const a = listing({ id: 'a', source: 'servicelink', parcelKey: 'ST-CA:0001' });
  const b = listing({ id: 'b', source: 'hud', parcelKey: 'ST-CA:0001' });
  const c = listing({ id: 'c', source: 'servicelink', parcelKey: 'ST-CA:0002' });
  const d = listing({ id: 'd', source: 'hud', parcelKey: 'ST-CA:0002' });
  assert.equal(applyCrossSourceBakeOff([a, b, c, d]), 4);
});

test('applyCrossSourceBakeOff is idempotent - same listings pass through produce equal annotations', () => {
  const a = listing({ id: 'a', source: 'servicelink', parcelKey: 'ST-CA:0001' });
  const b = listing({ id: 'b', source: 'hud', parcelKey: 'ST-CA:0001' });
  applyCrossSourceBakeOff([a, b]);
  const firstA = JSON.parse(JSON.stringify({ bakeOff: a.bakeOff, matches: a.crossSourceMatches }));
  const firstB = JSON.parse(JSON.stringify({ bakeOff: b.bakeOff, matches: b.crossSourceMatches }));
  applyCrossSourceBakeOff([a, b]);
  assert.deepEqual(a.bakeOff, firstA.bakeOff);
  assert.deepEqual(a.crossSourceMatches, firstA.matches);
  assert.deepEqual(b.bakeOff, firstB.bakeOff);
  assert.deepEqual(b.crossSourceMatches, firstB.matches);
});

test('applyCrossSourceBakeOff handles listings with non-string parcelKey gracefully', () => {
  const a = listing({ id: 'a', source: 'servicelink', parcelKey: 0 }); // non-string
  const b = listing({ id: 'b', source: 'hud', parcelKey: 0 });
  // Both have parcelKey=0 which is falsy in `if (!listing.parcelKey) continue;`
  // The bake-off treats falsy parcelKey as missing, so no annotation.
  assert.equal(applyCrossSourceBakeOff([a, b]), 0);
});

test('applyCrossSourceBakeOff cross-source match records carry source, listingId, observedAt, openingBid', () => {
  const a = listing({ id: 'a', source: 'servicelink', parcelKey: 'ST-CA:0001', sourceUrl: 'https://servicelink.example.com/x' });
  const b = listing({ id: 'b', source: 'hud', parcelKey: 'ST-CA:0001', sourceUrl: 'https://hud.example.com/y' });
  applyCrossSourceBakeOff([a, b]);
  // The match record is intentionally compact (no sourceUrl) - the
  // client looks it up by listingId when it wants to deep-link.
  for (const match of [...a.crossSourceMatches, ...b.crossSourceMatches]) {
    assert.ok(['source', 'listingId', 'observedAt', 'openingBid'].every((k) => k in match));
    assert.equal(match.sourceUrl, undefined);
  }
});

test('applyCrossSourceBakeOff does not require sourceObservedAt - falls back to provenance.observedAt', () => {
  const observed = '2026-09-14T13:00:00.000Z';
  const a = listing({
    id: 'a',
    source: 'servicelink',
    parcelKey: 'ST-CA:0001',
    sourceObservedAt: undefined,
    provenance: { origin: 'live', observed: true, publisher: 'X', recordId: 'a', observedAt: observed }
  });
  const b = listing({
    id: 'b',
    source: 'hud',
    parcelKey: 'ST-CA:0001',
    sourceObservedAt: undefined,
    provenance: { origin: 'live', observed: true, publisher: 'X', recordId: 'b', observedAt: observed }
  });
  applyCrossSourceBakeOff([a, b]);
  assert.ok(a.crossSourceMatches);
  assert.equal(a.crossSourceMatches[0].observedAt, observed);
});

test('applyCrossSourceBakeOff ignores empty parcelKey strings', () => {
  const a = listing({ id: 'a', source: 'servicelink', parcelKey: '' });
  const b = listing({ id: 'b', source: 'hud', parcelKey: '' });
  assert.equal(applyCrossSourceBakeOff([a, b]), 0);
});