'use strict';

// test/db-seed-failure-is-reported.test.js
//
// Seeding the in-memory provider IS the demo inventory. The catch around it
// logged and continued, so a corrupt or oversized live-listings.json - the file
// scrapers rewrite continuously, and loadLiveRecords throws on both - left a
// perfectly healthy server serving `total: 0` listings. /api/health said demo,
// reachable, fine. One console line was the only evidence.
//
// refreshLiveCache() cannot rescue it, and deliberately so: that one preserves
// current inventory when the cache is unreadable, which is right for a refresh
// and useless when the inventory it would preserve is empty.
//
// The fix follows the shape the codebase already uses for postgresError:
// record it on the client, surface it in health and in the listings payload.
// Not thrown - an operator still gets a running server - but never silent.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const CLIENT = path.join(ROOT, 'server', 'db', 'client.js');
const SERVER = path.join(ROOT, 'server', 'server.js');
const LISTINGS = path.join(ROOT, 'server', 'routes', 'listings.js');

const codeOf = (p) => {
  const raw = fs.readFileSync(p, 'utf8');
  return raw
    .split(/\r?\n/)
    .filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l))
    .join('\n');
};

test('a failed seed is recorded on the client, not only logged', () => {
  const code = codeOf(CLIENT);
  assert.match(code, /this\.seedError\s*=/,
    'the seed failure must be stored on the client, not swallowed into a log line');
  assert.match(code, /this\.seeded\s*=\s*false/);
  assert.match(code, /this\.seeded\s*=\s*true|if \(this\.seeded === undefined\) this\.seeded = true/,
    'a successful seed must mark the client seeded');
});

test('the health payload reports seeding, alongside the other honesty signals', () => {
  const code = codeOf(SERVER);
  assert.match(code, /seeded:\s*db\.seeded/);
  assert.match(code, /seedError:\s*db\.seedError/);
  // It has to sit with the signals that already exist, not replace them.
  assert.match(code, /postgresReachable/);
});

test('the listings payload reports seeding too', () => {
  // A demo inventory that failed to seed is indistinguishable from a genuinely
  // empty search unless the count carries the reason.
  const code = codeOf(LISTINGS);
  assert.match(code, /seeded:\s*db\.seeded/);
  assert.match(code, /seedError:\s*db\.seedError/);
});

test('the seed catch no longer discards the error', () => {
  const code = codeOf(CLIENT);
  // The old shape was a bare `catch (err) { console.error(...) }` with nothing
  // else in the block.
  assert.doesNotMatch(
    code,
    /catch\s*\(err\)\s*\{\s*console\.error\('\[DB\] Failed to seed in-memory provider:'\s*,\s*err\)\s*;\s*\}/,
    'a seed failure that is only logged is the bug this file exists to stop'
  );
});
