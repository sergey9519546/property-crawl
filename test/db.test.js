// test/db.test.js
//
// Database-layer contract suite.
//
// Two responsibilities:
//   1. (always) Assert the canonical seed records in data.js expose exactly the
//      camelCase fields the PG layer promises to return. This guards the
//      alias/cast contract in server/db/client.js against drift without
//      needing a live database.
//   2. (with DATABASE_URL) Round-trip a record through the real Postgres path
//      and assert the returned shape matches the in-memory shape, including
//      numeric types (node-pg returns NUMERIC as decimal strings unless cast).
//
// Run with:
//   node test/db.test.js                # contract + optional PG round-trip
//   DATABASE_URL=postgres://… node test/db.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const EXPECTED_LISTING_KEYS = [
  'id', 'source', 'state', 'county', 'city', 'zip', 'address',
  'lat', 'lng', 'beds', 'baths', 'sqft', 'year', 'propType',
  'openingBid', 'estLow', 'estHigh', 'assessed', 'mid', 'ratio', 'equity',
  'dealScore', 'saleDate', 'plaintiff', 'defendant', 'judgment',
  'attorney', 'occupancy', 'deposit', 'photo', 'sourceUrl', 'raw',
];

// Source registry contract: key + label/tier/color/note/websiteUrl.
const EXPECTED_SOURCE_KEYS = ['key', 'label', 'tier', 'color', 'note', 'websiteUrl'];

function loadSeed() {
  const dataJsPath = path.resolve(__dirname, '..', 'data.js');
  const sandbox = { window: {}, Math };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(dataJsPath, 'utf8'), sandbox);
  return sandbox.window;
}

let passed = 0;
let failed = 0;

function test(name, fn) {
  return Promise.resolve()
    .then(() => fn())
    .then(() => { process.stdout.write(`  ✓ ${name}\n`); passed++; })
    .catch((err) => { process.stderr.write(`  ✗ ${name}\n    ${err.message}\n`); failed++; });
}

async function run() {
  const { LISTINGS = [], SOURCES = {} } = loadSeed();

  await test('data.js seed records expose the camelCase listing contract', async () => {
    assert.ok(LISTINGS.length > 0, 'expected a non-empty seed');
    for (const listing of LISTINGS) {
      for (const key of EXPECTED_LISTING_KEYS) {
        assert.ok(
          key in listing,
          `listing ${listing.id} is missing "${key}" — update the seed or the PG alias contract`,
        );
      }
    }
  });

  await test('data.js source registry exposes the camelCase source contract', async () => {
    const keys = Object.keys(SOURCES);
    assert.ok(keys.length > 0, 'expected a non-empty source registry');
    for (const key of keys) {
      for (const field of EXPECTED_SOURCE_KEYS.slice(1)) {
        assert.ok(
          field in SOURCES[key],
          `source "${key}" is missing "${field}"`,
        );
      }
    }
  });

  if (process.env.DATABASE_URL) {
    const db = require('../server/db/client');
    await test('Postgres path returns the same camelCase shape and numeric types', async () => {
      // Reuse the in-memory seed craft for a throwaway round-trip.
      const seed = LISTINGS[0];
      const record = { ...seed, id: `TEST-${Date.now()}` };

      await db.createListing(record);

      const fetched = await db.getListingById(record.id);
      assert.ok(fetched, 'round-tripped listing should be retrievable');
      for (const key of EXPECTED_LISTING_KEYS) {
        assert.ok(key in fetched, `PG row missing "${key}"`);
      }
      for (const numeric of ['openingBid', 'estLow', 'estHigh', 'assessed', 'mid', 'ratio', 'equity', 'dealScore', 'lat', 'lng']) {
        assert.strictEqual(
          typeof fetched[numeric], 'number',
          `PG "${numeric}" should be a number (got ${typeof fetched[numeric]}: ${fetched[numeric]})`,
        );
      }
    });
  } else {
    process.stdout.write('  ⓘ DATABASE_URL not set — skipping live Postgres round-trip\n');
  }

  process.stdout.write(`--- DB TEST SUMMARY: ${passed} Passed, ${failed} Failed ---\n`);
  if (failed > 0) process.exit(1);
}

run();