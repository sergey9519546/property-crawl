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
  'redemptionDays', 'redemptionWarning', 'seniorLienRisk', 'seniorLienWarning', 'cashToClose', 'cashToCloseDetails',
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
    assert.ok(Array.isArray(LISTINGS), 'expected LISTINGS to be an array');
    if (LISTINGS.length > 0) {
      for (const listing of LISTINGS) {
        for (const key of EXPECTED_LISTING_KEYS) {
          assert.ok(
            key in listing,
            `listing ${listing.id} is missing "${key}" — update the seed or the PG alias contract`,
          );
        }
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

  await test('database ingestion preserves unknown source fields without fabricated metrics', async () => {
    const db = require('../server/db/client');
    const suffix = Date.now().toString(36);
    const marker = `Nullability Contract ${suffix}`;
    const common = {
      source: 'civilview',
      state: 'CA',
      county: 'Lake',
      city: 'Hidden Valley Lake',
      zip: '95467',
      baths: 2.5,
      openingBid: 42000,
      propType: 'Unknown',
      sourceUrl: `https://salesweb.civilview.com/example?PropertyId=${suffix}`,
      raw: `Official source record used by ${marker}`,
      provenance: {
        publisher: 'CivilView / Lake County Sheriff',
        propertyId: suffix,
        openingBidSource: 'CivilView Approx. Upset',
      },
      cashToCloseDetails: {
        openingBid: 42000,
        buyersPremium: 0,
        transferTax: 168,
        deedPrepAndRecording: 500,
        totalCashToClose: 42668,
        basis: 'explicit test evidence',
      },
      sourceObservedAt: '2026-09-04T15:30:00-07:00',
      status: 'scheduled',
    };

    const unknown = await db.createListing({
      ...common,
      id: `NULL-${suffix}`,
      address: `1 ${marker} Ave`,
      lat: null,
      lng: null,
      estLow: null,
      estHigh: null,
      saleDate: null,
      mid: 999999,
      ratio: 0.01,
      equity: 999999,
      dealScore: 99,
    });

    for (const field of ['lat', 'lng', 'estLow', 'estHigh', 'saleDate', 'mid', 'ratio', 'equity', 'dealScore']) {
      assert.strictEqual(unknown[field], null, `${field} must remain unknown`);
    }
    assert.strictEqual(unknown.deposit, null, 'unknown deposit terms must not become a fabricated default');
    assert.strictEqual(unknown.redemptionDays, null, 'unknown redemption period must not imply immediate possession');
    assert.strictEqual(unknown.seniorLienRisk, null, 'unknown lien risk must not be labeled normal');
    assert.strictEqual(unknown.baths, 2.5, 'fractional bathrooms must survive in-memory ingestion');
    assert.deepStrictEqual(unknown.provenance, common.provenance, 'structured field provenance must survive ingestion');
    assert.deepStrictEqual(unknown.cashToCloseDetails, common.cashToCloseDetails, 'itemized cash-to-close evidence must survive ingestion');
    assert.strictEqual(unknown.sourceObservedAt, '2026-09-04T22:30:00.000Z');
    assert.ok(Number.isFinite(Date.parse(unknown.fetchedAt)), 'the persistence boundary must stamp fetchedAt');

    const noBidMarker = `No Published Bid ${suffix}`;
    const noBid = await db.createListing({
      ...common,
      id: `NO-BID-${suffix}`,
      address: `3 ${noBidMarker} Ave`,
      county: null,
      city: null,
      zip: null,
      propType: null,
      openingBid: null,
      estLow: 100000,
      estHigh: 120000,
      saleDate: 'not-a-date',
    });
    for (const field of ['county', 'city', 'zip', 'propType', 'openingBid', 'saleDate', 'ratio', 'equity', 'dealScore']) {
      assert.strictEqual(noBid[field], null, `${field} must remain unknown when the source did not publish it`);
    }
    assert.strictEqual(noBid.mid, 110000, 'a published estimate band can retain its own midpoint without a bid');
    const maxBidFiltered = await db.getListings({ q: noBidMarker, maxBid: 50000, sort: 'bid-asc' });
    assert.strictEqual(maxBidFiltered.total, 0, 'an unknown opening bid must not satisfy a maximum-bid filter');
    const cleanLienFiltered = await db.getListings({ q: noBidMarker, seniorLien: 'clean' });
    assert.strictEqual(cleanLienFiltered.total, 0, 'an unknown lien signal must not satisfy a clean-lien filter');

    const valued = await db.createListing({
      ...common,
      id: `VALUED-${suffix}`,
      address: `2 ${marker} Ave`,
      lat: 38.807,
      lng: -122.558,
      estLow: 100000,
      estHigh: 120000,
      saleDate: '2026-09-11',
      mid: 1,
      ratio: 1,
      equity: 1,
      dealScore: 1,
    });
    assert.strictEqual(valued.mid, 110000);
    assert.strictEqual(valued.equity, 68000);
    assert.strictEqual(valued.dealScore, 80);
    assert.ok(Math.abs(valued.ratio - (42000 / 110000)) < Number.EPSILON);

    const refreshed = await db.createListing({
      ...common,
      id: valued.id,
      address: valued.address,
      lat: null,
      lng: null,
      estLow: null,
      estHigh: null,
      saleDate: null,
      baths: null,
      cashToCloseDetails: null,
      provenance: { detailPageFetched: true },
      sourceObservedAt: null,
    });
    assert.strictEqual(refreshed.estLow, 100000, 'a partial refresh must not erase a known estimate band');
    assert.strictEqual(refreshed.estHigh, 120000, 'a partial refresh must not erase a known estimate band');
    assert.strictEqual(refreshed.lat, 38.807, 'a partial refresh must not erase a known geocode');
    assert.strictEqual(refreshed.lng, -122.558, 'a partial refresh must not erase a known geocode');
    assert.strictEqual(refreshed.saleDate, '2026-09-11', 'a partial refresh must not erase a known sale date');
    assert.strictEqual(refreshed.baths, 2.5, 'a partial refresh must not erase a known fractional bath count');
    assert.deepStrictEqual(refreshed.cashToCloseDetails, common.cashToCloseDetails, 'a partial refresh must not erase itemized cash-to-close evidence');
    assert.deepStrictEqual(refreshed.provenance, {
      ...common.provenance,
      detailPageFetched: true,
    }, 'partial refresh provenance must merge instead of replacing earlier evidence');
    assert.strictEqual(refreshed.sourceObservedAt, '2026-09-04T22:30:00.000Z');

    const sorted = await db.getListings({ q: marker, sort: 'score', limit: 10 });
    assert.deepStrictEqual(sorted.listings.map((listing) => listing.id), [valued.id, unknown.id]);

    const oversized = await db.createListing({
      ...common,
      id: `OVERSIZED-${suffix}`,
      address: `4 ${marker} Ave`,
      cashToCloseDetails: { note: 'x'.repeat(65_537) },
    });
    assert.strictEqual(oversized.cashToCloseDetails, null, 'oversized cash-to-close JSON must be rejected at the persistence boundary');
  });

  await test('Postgres schema and migration explicitly support nullable source evidence', async () => {
    const schema = fs.readFileSync(path.resolve(__dirname, '..', 'server', 'db', 'schema.sql'), 'utf8');
    const migration = fs.readFileSync(
      path.resolve(__dirname, '..', 'server', 'db', 'migrations', '003_nullable_source_values.sql'),
      'utf8',
    );
    const precisionMigration = fs.readFileSync(
      path.resolve(__dirname, '..', 'server', 'db', 'migrations', '004_listing_precision_and_cash_details.sql'),
      'utf8',
    );
    const mirrorSchema = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'lib', 'db', 'schema.sql'), 'utf8');
    const mirrorPrecisionMigration = fs.readFileSync(
      path.resolve(__dirname, '..', 'src', 'lib', 'db', 'migrations', '004_listing_precision_and_cash_details.sql'),
      'utf8',
    );
    const dbClients = [
      fs.readFileSync(path.resolve(__dirname, '..', 'server', 'db', 'client.js'), 'utf8'),
      fs.readFileSync(path.resolve(__dirname, '..', 'src', 'lib', 'db', 'client.js'), 'utf8'),
    ];
    for (const column of ['county', 'city', 'zip', 'latitude', 'longitude', 'prop_type', 'opening_bid', 'est_low', 'est_high', 'deal_score', 'sale_date']) {
      assert.match(migration, new RegExp(`ALTER COLUMN ${column} DROP NOT NULL`));
    }
    assert.match(schema, /ELSE GREATEST\(0, \(\(est_low \+ est_high\) \/ 2\) - opening_bid\)/);
    assert.match(schema, /provenance JSONB/);
    assert.match(schema, /fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW\(\)/);
    assert.match(migration, /ADD COLUMN IF NOT EXISTS provenance JSONB/);
    assert.match(schema, /deal_score DESC NULLS LAST/);
    assert.match(schema, /baths NUMERIC\(4, 1\)/);
    assert.match(schema, /cash_to_close_details JSONB/);
    assert.match(schema, /octet_length\(cash_to_close_details::text\) <= 65536/);
    assert.match(precisionMigration, /ALTER COLUMN baths TYPE NUMERIC\(4, 1\)/);
    assert.match(precisionMigration, /ADD COLUMN IF NOT EXISTS cash_to_close_details JSONB/);
    assert.strictEqual(mirrorSchema, schema, 'server and Next schema mirrors must stay byte-equivalent');
    assert.strictEqual(mirrorPrecisionMigration, precisionMigration, 'forward migration mirrors must stay byte-equivalent');
    for (const client of dbClients) {
      assert.match(client, /baths::float8\s+AS "baths"/);
      assert.match(client, /cash_to_close_details AS "cashToCloseDetails"/);
      assert.match(client, /Buffer\.byteLength\(serialized, 'utf8'\) > 65_536/);
      assert.match(client, /cash_to_close_details = COALESCE\(EXCLUDED\.cash_to_close_details, listings\.cash_to_close_details\)/);
    }
  });

  await test('Postgres write projection keeps fractional baths and bounded cash details in the canonical slots', async () => {
    const db = require('../server/db/client');
    const originalIsPg = db.isPg;
    const originalPool = db.pool;
    let capturedSql = '';
    let capturedParams = [];
    const cashToCloseDetails = {
      openingBid: 50000,
      buyersPremium: 2500,
      totalCashToClose: 52500,
      basis: 'explicit projection test',
    };

    try {
      db.isPg = true;
      db.pool = {
        query: async (sql, params) => {
          capturedSql = sql;
          capturedParams = params;
          return { rows: [{ id: 'PG-PROJECTION', baths: 2.5, cashToCloseDetails }] };
        },
      };

      await db.createListing({
        id: 'PG-PROJECTION',
        source: 'civilview',
        state: 'CA',
        address: '5 Projection Test Ave',
        baths: 2.5,
        openingBid: 50000,
        cashToClose: 52500,
        cashToCloseDetails,
      });

      assert.match(capturedSql, /cash_to_close_details/);
      assert.match(capturedSql, /baths::float8\s+AS "baths"/);
      assert.strictEqual(capturedParams.length, 42, 'INSERT parameter count must match the 42 source parameters');
      assert.strictEqual(capturedParams[10], 2.5, 'fractional baths must occupy the baths parameter');
      assert.deepStrictEqual(capturedParams[40], cashToCloseDetails, 'cash details must occupy the JSONB parameter');
      assert.strictEqual(capturedParams[41], 'active', 'status must remain the final parameter');
    } finally {
      db.isPg = originalIsPg;
      db.pool = originalPool;
    }
  });

  if (process.env.DATABASE_URL) {
    const db = require('../server/db/client');
    await test('Postgres path returns the same camelCase shape and numeric types', async () => {
      // Reuse the in-memory seed craft for a throwaway round-trip.
      const seed = LISTINGS[0];
      const record = {
        ...seed,
        id: `TEST-${Date.now()}`,
        baths: 2.5,
        cashToCloseDetails: {
          openingBid: seed.openingBid,
          buyersPremium: 1250,
          totalCashToClose: Number(seed.openingBid) + 1250,
          basis: 'explicit Postgres round-trip test',
        },
      };

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
      assert.strictEqual(fetched.baths, 2.5, 'PG NUMERIC baths must be cast back to a number without truncating half-baths');
      assert.deepStrictEqual(fetched.cashToCloseDetails, record.cashToCloseDetails, 'PG JSONB cash-to-close details must round-trip');
    });
  } else {
    process.stdout.write('  ⓘ DATABASE_URL not set — skipping live Postgres round-trip\n');
  }

  process.stdout.write(`--- DB TEST SUMMARY: ${passed} Passed, ${failed} Failed ---\n`);
  if (failed > 0) process.exit(1);
}

run();
