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

