'use strict';
// test/listing-inventory.test.js
//
// The hero and the grid each load the whole inventory on mount, and it is ~10,000
// records over 10 sequential pages. Without sharing, the home page fetched all of
// it twice and nothing - not even the hero's market suggestions - was usable
// until both passes finished.
//
// These are structural guards, matching how the rest of the node suite asserts
// on TypeScript sources: the behaviour itself is covered end to end by the
// Playwright suite, which drives the real hero and grid together.

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const loader = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'lib', 'listing-inventory.ts'),
  'utf8',
);
const terminal = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'components', 'terminal', 'interactive-terminal.tsx'),
  'utf8',
);

test('concurrent consumers share one pass over the inventory', () => {
  assert.ok(
    /new WeakMap<typeof fetch,/.test(loader),
    'the shared load must be keyed on the fetch implementation',
  );
  assert.ok(
    /shared\.set\(fetchImpl, \{ result, settledAt: Date\.now\(\) \}\)/.test(loader),
    'an in-flight pass must be published, stamped now, so a concurrent caller joins it',
  );
  // The stamp must be "now". An entry published with a zero stamp reads as long
  // expired to the freshness check below and nothing ever shares - which is
  // exactly what the first version did, while every structural guard passed.
  assert.ok(
    !/shared\.set\(fetchImpl, \{ result, settledAt: 0 \}\)/.test(loader),
    'a zero stamp makes the in-flight entry read as expired, so nothing shares',
  );
});

test('a manual refresh is never served a cached pass', () => {
  assert.ok(/forceRefresh/.test(loader), 'the loader must accept an explicit bypass');
  assert.ok(
    /loadListingInventory<PropertyListing>\(fetch, undefined, \{ forceRefresh: refresh \}\)/.test(terminal),
    'the terminal refresh path must pass forceRefresh, or a refresh serves stale records',
  );
});

test('a failed pass is not shared with later callers', () => {
  assert.ok(
    /if \(shared\.get\(fetchImpl\)\?\.result === result\) shared\.delete\(fetchImpl\)/.test(loader),
    'a rejected pass must be cleared so the next caller can retry',
  );
});

test('a settled pass expires rather than serving the inventory forever', () => {
  assert.ok(
    /SHARED_WINDOW_MS/.test(loader) && /Date\.now\(\) - existing\.settledAt < SHARED_WINDOW_MS/.test(loader),
    'the shared result must expire',
  );
});