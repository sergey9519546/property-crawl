'use strict';

// test/db/listing-status-merge.test.js
//
// Regression for the Postgres listings upsert: a stale or partial refresh
// that arrives with status=unknown must never erase a resolved
// sold/closed/cancelled disposition. mergeListingForInMemoryUpsert already
// preserved a known status (client.js); the ON CONFLICT branch used
// "status = EXCLUDED.status", so the two backends disagreed. Only a real
// PostgreSQL engine can see this - the mock-pool tests cannot execute the
// ON CONFLICT projection.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { startEmbeddedPostgres } = require('../../server/db/pglite-pool');
const { migrate } = require('../../scripts/discovery-migrate');
const { DatabaseClient } = require('../../server/db/client');

const BOOT_TIMEOUT_MS = 120_000;

function saleListing(overrides = {}) {
  return {
    id: 'CIV-NJ-7-STATUS-MERGE',
    source: 'civilview',
    state: 'NJ',
    county: 'Bergen',
    address: '19 West Park Avenue, Park Ridge, NJ 07656',
    openingBid: 100000,
    status: 'sold',
    sourceUrl: 'https://salesweb.civilview.com/Sales/SaleDetails?PropertyId=2128964683',
    sourceObservedAt: '2026-11-01T12:00:00.000Z',
    provenance: {
      observed: true,
      origin: 'live',
      recordKind: 'source_record',
      publisher: 'CivilView',
      recordId: '2128964683',
      observedAt: '2026-11-01T12:00:00.000Z',
    },
    ...overrides,
  };
}

test('a stale unknown-status refresh cannot erase a resolved disposition in Postgres', { timeout: BOOT_TIMEOUT_MS * 2 }, async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-status-merge-'));
  try {
    const embedded = await startEmbeddedPostgres({ dataDir });
    await migrate(embedded.pool);
    const db = new DatabaseClient({ pool: embedded.pool, liveCachePath: null, workspaceStorePath: null });

    await db.createListing(saleListing());
    const sold = await db.getListingById('CIV-NJ-7-STATUS-MERGE');
    assert.equal(sold.status, 'sold', 'precondition: the resolved status is stored');

    // A later partial refresh (e.g. a scraper that only saw the calendar
    // row, no disposition) arrives with status 'unknown'.
    await db.createListing(saleListing({ status: 'unknown', sourceObservedAt: '2026-11-02T12:00:00.000Z' }));
    const after = await db.getListingById('CIV-NJ-7-STATUS-MERGE');
    assert.equal(after.status, 'sold', 'unknown must not erase sold');

    // A genuine status change still updates.
    await db.createListing(saleListing({ status: 'cancelled', sourceObservedAt: '2026-11-03T12:00:00.000Z' }));
    const cancelled = await db.getListingById('CIV-NJ-7-STATUS-MERGE');
    assert.equal(cancelled.status, 'cancelled', 'a real disposition change still lands');
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

test('Postgres ON CONFLICT DO UPDATE preserves derivedFields.assessorRoll and batches reconcileDuplicateDockets', { timeout: BOOT_TIMEOUT_MS * 2 }, async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-derived-merge-'));
  try {
    const embedded = await startEmbeddedPostgres({ dataDir });
    await migrate(embedded.pool);

    const queries = [];
    const trackedPool = {
      query(text, params) {
        queries.push({ text: String(text), params });
        return embedded.pool.query(text, params);
      },
      connect() {
        return embedded.pool.connect();
      },
    };
    const db = new DatabaseClient({ pool: trackedPool, liveCachePath: null, workspaceStorePath: null });

    // Enriched NJ listing with NJGIN MOD-IV parcel + coords + assessed value.
    await db.createListing(saleListing({
      id: 'CIV-NJ-1-2242210237',
      county: 'Camden County',
      lat: 39.792519,
      lng: -74.928191,
      assessed: 181200,
      status: 'scheduled',
      provenance: {
        observed: true,
        origin: 'live',
        recordKind: 'source_record',
        publisher: 'CivilView',
        recordId: '2242210237',
        observedAt: '2026-11-01T12:00:00.000Z',
        derivedFields: {
          parcelKey: true,
          assessorRoll: {
            basis: 'NJGIN_MODIV_CADASTRAL',
            countyKey: 'NJ-CAMDEN',
            observedAt: '2026-11-01T12:05:00.000Z',
            parcel: { source: 'NJGIN_MODIV_CADASTRAL', canonicalApn: '040514008', assessedValue: { total: 181200 } },
          },
        },
      },
    }));

    // Re-scrape arrives without coords, assessed, or assessorRoll (only instrumentPriority).
    await db.createListing(saleListing({
      id: 'CIV-NJ-1-2242210237',
      county: 'Camden County',
      lat: null,
      lng: null,
      assessed: null,
      status: 'scheduled',
      sourceObservedAt: '2026-11-02T12:00:00.000Z',
      provenance: {
        observed: true,
        origin: 'live',
        recordKind: 'source_record',
        publisher: 'CivilView',
        recordId: '2242210237',
        observedAt: '2026-11-02T12:00:00.000Z',
        derivedFields: { instrumentPriority: { priority: 'first_lien' } },
      },
    }));

    const reloaded = await db.getListingById('CIV-NJ-1-2242210237');
    assert.equal(reloaded.lat, 39.792519);
    assert.equal(reloaded.assessed, 181200);
    assert.equal(reloaded.provenance?.derivedFields?.assessorRoll?.basis, 'NJGIN_MODIV_CADASTRAL', 're-scrape must preserve prior derivedFields.assessorRoll');
    assert.equal(reloaded.provenance?.derivedFields?.parcelKey, true);
    assert.equal(reloaded.provenance?.derivedFields?.instrumentPriority?.priority, 'first_lien', 'new derivedFields keys must also persist');

    // Batched reconcileDuplicateDockets across 3 duplicate pairs.
    const dupListings = [];
    for (let i = 1; i <= 3; i += 1) {
      const older = saleListing({
        id: `CIV-NJ-9-OLD-${i}`,
        county: 'Morris County',
        address: `${100 + i} Pine St, Dover, NJ 07801`,
        saleDate: '2026-10-01',
        sourceObservedAt: '2026-10-01T00:00:00.000Z',
        provenance: { observed: true, origin: 'live', publisher: 'CivilView', recordId: `OLD-${i}`, sourceFacts: { courtCaseNumber: `F-10${i}-25` } },
      });
      const newer = saleListing({
        id: `CIV-NJ-9-NEW-${i}`,
        county: 'Morris County',
        address: `${100 + i} Pine St, Dover, NJ 07801`,
        saleDate: '2026-12-01',
        sourceObservedAt: '2026-11-02T00:00:00.000Z',
        provenance: { observed: true, origin: 'live', publisher: 'CivilView', recordId: `NEW-${i}`, sourceFacts: { courtCaseNumber: `F-10${i}-25` } },
      });
      await db.createListing(older);
      await db.createListing(newer);
      dupListings.push(newer);
    }

    queries.length = 0;
    const dupOut = await db.reconcileDuplicateDockets('civilview', dupListings, { at: '2026-11-03T00:00:00.000Z' });
    assert.equal(dupOut.superseded, 3);
    const updateQueries = queries.filter((q) => /^UPDATE listings\b/i.test(q.text.trim()));
    assert.equal(updateQueries.length, 1, 'reconcileDuplicateDockets must batch superseded updates into a single SQL statement');
    for (let i = 1; i <= 3; i += 1) {
      const oldRow = await db.getListingById(`CIV-NJ-9-OLD-${i}`);
      assert.equal(oldRow.provenance?.supersededBy?.byId, `CIV-NJ-9-NEW-${i}`);
    }
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

