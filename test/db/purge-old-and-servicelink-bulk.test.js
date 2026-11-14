'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { DatabaseClient } = require('../../server/db/client');
const { startEmbeddedPostgres } = require('../../server/db/pglite-pool');
const { migrate } = require('../../scripts/discovery-migrate');
const { probeDatabaseCapabilities } = require('../../server/db/database-capabilities');
const { importArchive } = require('../../scripts/import-servicelink-archive');

test('Pool configures native statement_timeout without deprecated pool.on("connect") query', () => {
  const clientCode = fs.readFileSync(path.join(__dirname, '..', '..', 'server', 'db', 'client.js'), 'utf8');
  assert.doesNotMatch(clientCode, /this\.pool\.on\('connect'/);
  assert.match(clientCode, /statement_timeout:\s*statementTimeoutMs/);

  const migrateCode = fs.readFileSync(path.join(__dirname, '..', '..', 'scripts', 'discovery-migrate.js'), 'utf8');
  assert.match(migrateCode, /SET LOCAL statement_timeout\s*=\s*'0'/);
});

test('ServiceLink deprecated archive importer refuses --db writes without explicit opt-in', async () => {
  await assert.rejects(
    () => importArchive({ useDb: true, dryRun: false }),
    /ServiceLink archive database import is deprecated/,
  );
});

test('Migration 037 and purgeStaleListings remove old, archive, concluded, and stale ServiceLink bulk while keeping active auto-scraped live records', { timeout: 120_000 }, async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'purge-stale-bulk-'));
  try {
    const embedded = await startEmbeddedPostgres({ dataDir });
    try {
      await migrate(embedded.pool);
      const db = new DatabaseClient({ pool: embedded.pool, liveCachePath: null, workspaceStorePath: null });
      assert.equal(await db.verifyConnection(), true);
      db.inMemoryData.listings = [];

      // Verify fast pg_attribute capability probe works end-to-end against real schema.
      const caps = await probeDatabaseCapabilities(embedded.pool);
      assert.equal(caps.functional, true, `unexpected missing capabilities: ${caps.missing.join(', ')}`);

      const now = Date.now();
      const isoDaysAgo = (days) => new Date(now - days * 86_400_000).toISOString();
      const dateDaysOffset = (days) => new Date(now + days * 86_400_000).toISOString().slice(0, 10);

      const fixtures = [
        // 1. Fresh auto-scraped live ServiceLink -> MUST BE KEPT
        {
          id: 'servicelink:fresh-active',
          source: 'servicelink',
          state: 'NJ',
          county: 'Hudson',
          city: 'Jersey City',
          zip: '07302',
          address: '10 Fresh ServiceLink Way, Jersey City, NJ 07302',
          propType: 'Single Family',
          openingBid: 145000,
          saleDate: dateDaysOffset(20),
          status: 'active',
          lifecycleStatus: 'active',
          provenance: { origin: 'live', observed: true, publisher: 'ServiceLink Auction', recordId: 'fresh-active' },
          sourceObservedAt: isoDaysAgo(0.2),
        },
        // 2. Old massive ServiceLink archive record -> MUST BE PURGED
        {
          id: 'servicelink:archive-old',
          source: 'servicelink',
          state: 'TX',
          county: 'Harris',
          city: 'Houston',
          zip: '77001',
          address: '99 Archive Bulk Rd, Houston, TX 77001',
          propType: 'Single Family',
          openingBid: 90000,
          saleDate: dateDaysOffset(15),
          status: 'active',
          lifecycleStatus: 'active',
          provenance: { origin: 'servicelink-archive', recordKind: 'archive_record', observed: false, publisher: 'ServiceLink Auction', recordId: 'archive-old' },
          sourceObservedAt: isoDaysAgo(0.1),
        },
        // 3. Stale unrefreshed ServiceLink bulk (14 days old) -> MUST BE PURGED
        {
          id: 'servicelink:stale-bulk',
          source: 'servicelink',
          state: 'OH',
          county: 'Cuyahoga',
          city: 'Cleveland',
          zip: '44101',
          address: '200 Old ServiceLink Ave, Cleveland, OH 44101',
          propType: 'Single Family',
          openingBid: 65000,
          saleDate: dateDaysOffset(10),
          status: 'active',
          lifecycleStatus: 'active',
          provenance: { origin: 'live', observed: true, publisher: 'ServiceLink Auction', recordId: 'stale-bulk' },
          sourceObservedAt: isoDaysAgo(14),
        },
        // 4. Static seed row -> MUST BE PURGED
        {
          id: 'hud-seed-old',
          source: 'hud',
          state: 'FL',
          county: 'Orange',
          city: 'Orlando',
          zip: '32801',
          address: '300 Static Seed St, Orlando, FL 32801',
          propType: 'Condo',
          openingBid: 110000,
          saleDate: dateDaysOffset(25),
          status: 'active',
          lifecycleStatus: 'active',
          provenance: { origin: 'seed', observed: false, publisher: 'HUD', recordId: 'seed-old' },
          sourceObservedAt: isoDaysAgo(0.5),
        },
        // 5. Concluded sold live listing -> MUST BE PURGED
        {
          id: 'civilview:sold-old',
          source: 'civilview',
          state: 'NJ',
          county: 'Bergen',
          city: 'Hackensack',
          zip: '07601',
          address: '400 Sold Blvd, Hackensack, NJ 07601',
          propType: 'Single Family',
          openingBid: 210000,
          saleDate: dateDaysOffset(-30),
          status: 'sold',
          lifecycleStatus: 'sold',
          provenance: { origin: 'live', observed: true, publisher: 'CivilView', recordId: 'sold-old' },
          sourceObservedAt: isoDaysAgo(1),
        },
        // 6. Active non-ServiceLink live listing -> MUST BE KEPT
        {
          id: 'gsa:fresh-active',
          source: 'gsa',
          state: 'VA',
          county: 'Fairfax',
          city: 'Reston',
          zip: '20190',
          address: '500 Federal Live Dr, Reston, VA 20190',
          propType: 'Land',
          openingBid: 180000,
          saleDate: dateDaysOffset(12),
          status: 'scheduled',
          lifecycleStatus: 'active',
          provenance: { origin: 'live', observed: true, publisher: 'GSA', recordId: 'fresh-gsa' },
          sourceObservedAt: isoDaysAgo(1),
        },
      ];

      for (const item of fixtures) {
        await db.createListing(item);
      }

      // Insert stale source_observations row for purged listing + fresh observation for kept listing
      await embedded.pool.query(
        `INSERT INTO source_observations (id, listing_id, source_key, record_id, observed_at, raw_payload)
         VALUES
           ('obs-archive-1', 'servicelink:archive-old', 'servicelink', 'archive-old', $1, '{}'::jsonb),
           ('obs-fresh-1', 'servicelink:fresh-active', 'servicelink', 'fresh-active', $2, '{}'::jsonb)`,
        [isoDaysAgo(10), isoDaysAgo(0.2)],
      );

      // Verify batched purgeStaleListings loops cleanly across multiple small batches while keeping active live records
      const runtimePurge = await db.purgeStaleListings({ batchSize: 2, maxBatches: 10, batchPauseMs: 0 });
      assert.equal(runtimePurge.deleted, 4, 'purgeStaleListings must delete archive, seed, concluded, and stale ServiceLink rows');
      assert.equal(runtimePurge.observationsDeleted, 1, 'purgeStaleListings must clean orphaned observations');

      const remainingRuntime = (await embedded.pool.query('SELECT id FROM listings ORDER BY id')).rows.map((r) => r.id);
      assert.deepEqual(remainingRuntime, ['gsa:fresh-active', 'servicelink:fresh-active']);

      // Verify consecutive-duplicate compaction on source_observations preserves endpoints and drops middle heartbeats
      await embedded.pool.query(
        `INSERT INTO source_observations (id, listing_id, source_key, record_id, observed_at, opening_bid, status, raw_payload)
         VALUES
           ('obs-gsa-1', 'gsa:fresh-active', 'gsa', 'fresh-gsa', $1, 180000, 'scheduled', '{}'::jsonb),
           ('obs-gsa-2', 'gsa:fresh-active', 'gsa', 'fresh-gsa', $2, 180000, 'scheduled', '{}'::jsonb),
           ('obs-gsa-3', 'gsa:fresh-active', 'gsa', 'fresh-gsa', $3, 180000, 'scheduled', '{}'::jsonb)`,
        [isoDaysAgo(3), isoDaysAgo(2), isoDaysAgo(1)],
      );
      const compactPurge = await db.purgeStaleListings({ batchSize: 10, maxBatches: 5, batchPauseMs: 0 });
      assert.equal(compactPurge.observationsDeleted, 1, 'must compact 1 redundant intermediate duplicate observation');
      const remainingObsIds = (await embedded.pool.query(`SELECT id FROM source_observations WHERE record_id = 'fresh-gsa' ORDER BY observed_at ASC`)).rows.map((r) => r.id);
      assert.deepEqual(remainingObsIds, ['obs-gsa-1', 'obs-gsa-3']);

      // Re-insert one archive row + an old 4-day ServiceLink row and run 037 SQL migration directly to verify SQL script parity
      await db.createListing(fixtures[1]);
      await db.createListing({
        ...fixtures[2],
        id: 'servicelink:four-day-bulk',
        sourceObservedAt: isoDaysAgo(4),
      });
      const sql037 = fs.readFileSync(
        path.join(__dirname, '..', '..', 'server', 'db', 'migrations', '037_purge_old_and_archive_listings.sql'),
        'utf8',
      );
      await embedded.pool.query(sql037);

      const remainingAfter037 = (await embedded.pool.query('SELECT id FROM listings ORDER BY id')).rows.map((r) => r.id);
      assert.deepEqual(remainingAfter037, ['gsa:fresh-active', 'servicelink:fresh-active']);
    } finally {
      await embedded.pool.end().catch(() => {});
    }
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});
