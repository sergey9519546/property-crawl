'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { DatabaseClient } = require('../../server/db/client');
const { startEmbeddedPostgres } = require('../../server/db/pglite-pool');
const { migrate } = require('../../scripts/discovery-migrate');

test('DatabaseClient.createListingsBulk handles empty arrays and non-arrays safely', async () => {
  const db = new DatabaseClient({ pool: null, liveCachePath: null, workspaceStorePath: null });
  assert.equal(await db.createListingsBulk([]), 0);
  assert.equal(await db.createListingsBulk(null), 0);
  assert.equal(await db.createListingsBulk(undefined), 0);
});

test('DatabaseClient.createListingsBulk in-memory sequential fallback', async () => {
  const db = new DatabaseClient({ pool: null, liveCachePath: null, workspaceStorePath: null });
  db.inMemoryData.listings = [];

  const items = [
    {
      id: 'bulk:test-1',
      source: 'gsa',
      state: 'TX',
      county: 'Travis',
      city: 'Austin',
      address: '100 Test St, Austin, TX',
      openingBid: 50000,
      estLow: 100000,
      estHigh: 120000,
      status: 'active',
      lifecycleStatus: 'active',
    },
    {
      id: 'bulk:test-2',
      source: 'hud',
      state: 'FL',
      county: 'Miami-Dade',
      city: 'Miami',
      address: '200 Ocean Dr, Miami, FL',
      openingBid: 80000,
      estLow: 150000,
      estHigh: 170000,
      status: 'active',
      lifecycleStatus: 'active',
    },
  ];

  const count = await db.createListingsBulk(items);
  assert.equal(count, 2);
  assert.equal(db.inMemoryData.listings.length, 2);
  assert.equal(db.inMemoryData.listings.some(l => l.id === 'bulk:test-1'), true);
  assert.equal(db.inMemoryData.listings.some(l => l.id === 'bulk:test-2'), true);
});

test('DatabaseClient.createListingsBulk in PostgreSQL executes chunked upserts', { timeout: 120_000 }, async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bulk-upsert-test-'));
  try {
    const embedded = await startEmbeddedPostgres({ dataDir });
    try {
      await migrate(embedded.pool);
      const db = new DatabaseClient({ pool: embedded.pool, liveCachePath: null, workspaceStorePath: null });
      assert.equal(await db.verifyConnection(), true);

      // Create 55 test items (exceeding a chunk size of 50 to test multiple chunks)
      const now = new Date().toISOString();
      const items = Array.from({ length: 55 }, (_, i) => ({
        id: `bulk:pg-${i + 1}`,
        source: 'treasury',
        state: 'CA',
        county: 'Orange',
        city: 'Irvine',
        address: `${100 + i} Spectrum Way, Irvine, CA`,
        openingBid: 100000 + i * 1000,
        estLow: 200000,
        estHigh: 300000,
        status: 'active',
        lifecycleStatus: 'active',
        sourceObservedAt: now,
      }));

      const count = await db.createListingsBulk(items, { chunkSize: 25, yieldEveryChunks: 1 });
      assert.equal(count, 55);

      const rows = (await embedded.pool.query('SELECT count(*)::int AS n FROM listings WHERE id LIKE $1', ['bulk:pg-%'])).rows;
      assert.equal(rows[0].n, 55);

      // Verify idempotency / upsert update
      const updateItems = [
        {
          id: 'bulk:pg-1',
          source: 'treasury',
          state: 'CA',
          county: 'Orange',
          city: 'Irvine',
          address: '100 Spectrum Way, Irvine, CA',
          openingBid: 120000,
          estLow: 250000,
          estHigh: 350000,
          status: 'active',
          lifecycleStatus: 'active',
          sourceObservedAt: new Date(Date.now() + 1000).toISOString(),
        },
      ];

      const updateCount = await db.createListingsBulk(updateItems, { chunkSize: 10 });
      assert.equal(updateCount, 1);

      const updated = await db.getListingById('bulk:pg-1');
      assert.equal(updated.openingBid, 120000);
      assert.equal(updated.estLow, 250000);
    } finally {
      await embedded.pool.end().catch(() => {});
    }
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});
