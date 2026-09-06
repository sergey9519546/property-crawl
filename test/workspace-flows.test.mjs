import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadListingInventory } from '../src/lib/listing-inventory.ts';
import { matchesSavedSearch, parseSavedSearches } from '../src/lib/saved-searches.ts';
import { parseStreetViewMetadata, formatCaptureDate, requestStreetViewMetadata } from '../src/lib/street-view-client.ts';

test('Street View client bounds disclosure fields and does not imply a successful match on unavailable responses', () => {
  assert.deepEqual(parseStreetViewMetadata({ available: false, reason: 'No match' }), { available: false, reason: 'No match' });
  const result = parseStreetViewMetadata({ available: true, provider: 'Google Maps', captureDate: '2012-09', distanceMeters: -1 });
  assert.equal(result.metadata.distanceMeters, null);
  assert.equal(formatCaptureDate(result.metadata.captureDate), 'Captured September 2012');
  assert.equal(formatCaptureDate(null), 'Capture date unavailable');
  assert.throws(() => parseStreetViewMetadata(null));
});

test('Street View requests coalesce in flight but are not persisted after completion', async (t) => {
  let release;
  let calls = 0;
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = () => { calls++; return new Promise((resolve) => { release = () => resolve(Response.json({ available: false })); }); };
  const first = requestStreetViewMetadata('record-1');
  const second = requestStreetViewMetadata('record-1');
  assert.equal(first, second);
  assert.equal(calls, 1);
  release();
  await first;
  const next = requestStreetViewMetadata('record-1');
  assert.equal(calls, 2);
  release();
  await next;
});

test('inventory loads subsequent pages instead of silently stopping at the first fifty', async () => {
  const calls = [];
  const result = await loadListingInventory(async (url) => {
    calls.push(url);
    const offset = Number(new URL(url, 'http://localhost').searchParams.get('offset'));
    return Response.json({ total: 1002, listings: Array.from({ length: offset ? 2 : 1000 }, (_, i) => ({ id: `record-${offset + i}` })) });
  });
  assert.equal(result.listings.length, 1002);
  assert.equal(result.listings.at(-1).id, 'record-1001');
  assert.match(calls[1], /offset=1000/);
  assert.equal(result.truncated, false);
});

test('an incomplete refresh rejects instead of returning a misleading partial inventory', async () => {
  let calls = 0;
  await assert.rejects(loadListingInventory(async () => ++calls === 1
    ? Response.json({ total: 2, listings: [{ id: 'one' }] })
    : Response.json({ error: 'unavailable' }, { status: 503 })), /retained/);
});

test('saved-search filters include unknowns only when their constraints are unrestricted', () => {
  const search = { id: 's', name: 'NJ', state: 'NJ', minScore: 0, maxBid: 0, createdAt: '2026-09-04' };
  assert.equal(matchesSavedSearch({ state: 'NJ', dealScore: null, openingBid: null }, search), true);
  assert.equal(matchesSavedSearch({ state: 'NJ', dealScore: null }, { ...search, minScore: 70 }), false);
  assert.equal(matchesSavedSearch({ state: 'NJ', openingBid: null }, { ...search, maxBid: 250000 }), false);
  assert.equal(matchesSavedSearch({ state: 'OH', openingBid: 100000 }, search), false);
  assert.equal(matchesSavedSearch({ state: 'NJ', dealScore: 80, openingBid: 120000 }, { ...search, minScore: 70, maxBid: 250000 }), true);
});

test('corrupt and legacy fake alert storage is not treated as active saved searches', () => {
  assert.deepEqual(parseSavedSearches('{bad'), []);
  assert.deepEqual(parseSavedSearches(JSON.stringify([{ email: 'investor@firm.com', active: true }])), []);
  const value = { id: 's', name: 'NJ', state: 'NJ', minScore: 0, maxBid: 0, createdAt: '2026-09-04' };
  assert.deepEqual(parseSavedSearches(JSON.stringify([value])), [value]);
});
