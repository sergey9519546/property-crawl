'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { DatabaseClient, prepareListingForPersistence } = require('../../server/db/client');
const { startEmbeddedPostgres } = require('../../server/db/pglite-pool');
const { migrate } = require('../../scripts/discovery-migrate');

test('prepareListingForPersistence computes a deterministic catchSummary', () => {
  const normalized = prepareListingForPersistence({
    id: 'catch:prep-1',
    source: 'treasury',
    state: 'FL',
    address: '1 Main St, Tampa, FL',
    openingBid: 100000,
    saleDate: '2027-01-15',
    redemptionDays: 45,
  });
  assert.equal(typeof normalized.catchSummary, 'string');
  assert.match(normalized.catchSummary, /45-day statutory redemption/);
});

test('prepareListingForPersistence leaves catchSummary null for a clean record', () => {
  const normalized = prepareListingForPersistence({
    id: 'catch:prep-2',
    source: 'treasury',
    state: 'FL',
    address: '2 Main St, Tampa, FL',
    openingBid: 100000,
    estLow: 200000,
    estHigh: 250000,
    saleDate: '2027-01-15',
    occupancy: 'unoccupied',
    deposit: 'certified funds',
    redemptionDays: 0,
    seniorLienRisk: 'low',
  });
  assert.equal(normalized.catchSummary, null);
});

test('catchSummary round-trips through PostgreSQL (single + bulk)', { timeout: 120_000 }, async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'catch-summary-pg-'));
  try {
    const embedded = await startEmbeddedPostgres({ dataDir });
    try {
      await migrate(embedded.pool);
      const db = new DatabaseClient({ pool: embedded.pool, liveCachePath: null, workspaceStorePath: null });

      // Single insert path
      await db.createListing({
        id: 'catch:pg-single',
        source: 'treasury',
        state: 'FL',
        county: 'Hillsborough',
        city: 'Tampa',
        address: '1 Single Way, Tampa, FL',
        openingBid: 100000,
        saleDate: '2027-01-15',
        redemptionDays: 45,
      });
      const single = await db.getListingById('catch:pg-single');
      assert.equal(typeof single.catchSummary, 'string');
      assert.match(single.catchSummary, /45-day statutory redemption/);

      // Bulk insert path
      await db.createListingsBulk([
        {
          id: 'catch:pg-bulk',
          source: 'treasury',
          state: 'FL',
          county: 'Hillsborough',
          city: 'Tampa',
          address: '2 Bulk Way, Tampa, FL',
          openingBid: 200000,
          estLow: 300000,
          estHigh: 400000,
          saleDate: '2027-02-20',
          occupancy: 'occupied',
          deposit: 'certified funds',
        },
      ]);
      const bulk = await db.getListingById('catch:pg-bulk');
      assert.equal(typeof bulk.catchSummary, 'string');
      assert.match(bulk.catchSummary, /Reported occupied/);

      // Clean record persists a NULL catch_summary
      await db.createListing({
        id: 'catch:pg-clean',
        source: 'treasury',
        state: 'FL',
        county: 'Hillsborough',
        city: 'Tampa',
        address: '3 Clean Way, Tampa, FL',
        openingBid: 100000,
        estLow: 200000,
        estHigh: 250000,
        saleDate: '2027-03-01',
        occupancy: 'unoccupied',
        deposit: 'certified funds',
        redemptionDays: 0,
        seniorLienRisk: 'low',
      });
      const clean = await db.getListingById('catch:pg-clean');
      assert.equal(clean.catchSummary, null);
    } finally {
      await embedded.pool.end().catch(() => {});
    }
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

test('summary select includes catchSummary', async () => {
  const db = new DatabaseClient({ pool: null, liveCachePath: null, workspaceStorePath: null });
  assert.match(db.summaryListingSelect, /catch_summary/);
  assert.match(db.listingSelect, /catch_summary/);
});