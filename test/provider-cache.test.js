'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createProviderCache, buildKey, bucket, DEFAULT_TTL_MS } = require('../server/media/provider-cache');

test('buildKey rounds lat/lng to a stable bucket and includes the provider + radius', () => {
  const keyA = buildKey({ provider: 'panoramax', lat: 34.0522341, lng: -118.2437121, radius: 100 });
  const keyB = buildKey({ provider: 'panoramax', lat: 34.0522349, lng: -118.2437129, radius: 100 });
  // Sub-meter jitter collapses into the same bucket
  assert.equal(keyA, keyB);
  // Different provider or radius produces a distinct key
  assert.notEqual(keyA, buildKey({ provider: 'panoramax', lat: 34.052234, lng: -118.243712, radius: 50 }));
  assert.notEqual(keyA, buildKey({ provider: 'mapillary', lat: 34.052234, lng: -118.243712, radius: 100 }));
});

test('bucket rounds to 5 decimal places by default', () => {
  assert.equal(bucket(34.052234567, 5), '34.05223');
  assert.equal(bucket(-118.243712345, 5), '-118.24371');
});

test('cache returns a hit on the second lookup with the same key', () => {
  let now = 1_000_000;
  const cache = createProviderCache({ now: () => now, ttlMs: 60_000 });
  cache.set('k', { value: 'a' });
  assert.deepEqual(cache.get('k'), { value: 'a' });
  // Advance time but stay within TTL
  now += 30_000;
  assert.deepEqual(cache.get('k'), { value: 'a' });
});

test('cache returns undefined and removes the entry once it has expired', () => {
  let now = 1_000_000;
  const cache = createProviderCache({ now: () => now, ttlMs: 1000 });
  cache.set('k', 'value');
  now += 500;
  assert.equal(cache.get('k'), 'value');
  now += 600; // total 1100ms past ttl
  assert.equal(cache.get('k'), undefined);
});

test('cache stats reports live + expired entry counts', () => {
  let now = 0;
  const cache = createProviderCache({ now: () => now, ttlMs: 1000 });
  cache.set('a', 1);
  cache.set('b', 2);
  now = 500;
  cache.set('c', 3);
  now = 1400; // a + b have expired, c is still live (set at 500 + 1000 ttl = 1500)
  assert.deepEqual(cache.stats(), { total: 3, live: 1, expired: 2, maxEntries: 1000, ttlMs: 1000 });
});

test('cache evicts the oldest entry once maxEntries is reached', () => {
  let now = 0;
  const cache = createProviderCache({ now: () => now, ttlMs: 60_000, maxEntries: 2 });
  cache.set('a', 1); now += 1;
  cache.set('b', 2); now += 1;
  cache.set('c', 3); now += 1;
  // 'a' was inserted first, 'b' was touched last via set('b'); 'c' is newest
  assert.equal(cache.get('a'), undefined);
  assert.equal(cache.get('b'), 2);
  assert.equal(cache.get('c'), 3);
});

test('getOrLoad calls the loader only on a miss', () => {
  let calls = 0;
  const cache = createProviderCache({ ttlMs: 60_000 });
  const loader = () => { calls += 1; return { value: 'computed' }; };
  assert.deepEqual(cache.getOrLoad('k', loader), { value: 'computed' });
  assert.deepEqual(cache.getOrLoad('k', loader), { value: 'computed' });
  assert.equal(calls, 1);
});

test('cache delete removes only the targeted entry', () => {
  const cache = createProviderCache({ ttlMs: 60_000 });
  cache.set('a', 1); cache.set('b', 2);
  cache.delete('a');
  assert.equal(cache.get('a'), undefined);
  assert.equal(cache.get('b'), 2);
});

test('cache clear removes everything', () => {
  const cache = createProviderCache({ ttlMs: 60_000 });
  cache.set('a', 1); cache.set('b', 2);
  cache.clear();
  assert.equal(cache.get('a'), undefined);
  assert.equal(cache.get('b'), undefined);
});

test('DEFAULT_TTL_MS is 60 seconds (1 minute)', () => {
  assert.equal(DEFAULT_TTL_MS, 60_000);
});
