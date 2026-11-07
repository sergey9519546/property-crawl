'use strict';

// test/db/listing-q-literal-parity.test.js
//
// The q keyword filter must behave identically on both backends. The
// in-memory matcher is a literal .includes() substring test; the SQL branch
// used ILIKE with the raw query, so q=100% matched EVERY Postgres row
// (% is a wildcard) and none in memory. The escape now makes both backends
// apply the same literal rule; this test pins it on a real engine.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { startEmbeddedPostgres } = require('../../server/db/pglite-pool');
const { migrate } = require('../../scripts/discovery-migrate');
const { DatabaseClient } = require('../../server/db/client');

const BOOT_TIMEOUT_MS = 120_000;

function fixtures() {
  const base = {
    source: 'servicelink',
    state: 'AZ',
    county: 'Maricopa',
    address: '1 Query Parity St, Avondale, AZ 85323',
    openingBid: 100000,
    provenance: { origin: 'live', observed: true },
  };
  return [
    { ...base, id: 'qparity:exact' },
    { ...base, id: 'qparity:other', address: '99 Elsewhere Ave, Phoenix, AZ 85001' },
  ];
}

async function seed(db) {
  for (const listing of fixtures()) await db.createListing(listing);
}

test('q with LIKE metacharacters matches the same rows on Postgres and memory', { timeout: BOOT_TIMEOUT_MS * 2 }, async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-q-parity-'));
  try {
    const embedded = await startEmbeddedPostgres({ dataDir });
    await migrate(embedded.pool);
    const pg = new DatabaseClient({ pool: embedded.pool, liveCachePath: null, workspaceStorePath: null });
    const memory = new DatabaseClient({ liveCachePath: null, workspaceStorePath: null });
    await seed(pg);
    await seed(memory);

    for (const q of ['100%', 'Query_Parity', 'Avondale']) {
      const fromPg = (await pg.getListings({ q, limit: 50 })).listings.map((l) => l.id).sort();
      const fromMemory = (await memory.getListings({ q, limit: 50 })).listings.map((l) => l.id).sort();
      assert.deepEqual(fromPg, fromMemory, `q=${JSON.stringify(q)} must match the same rows on both backends`);
    }

    // The wildcard forms must not match everything: only the rows that
    // literally contain the characters.
    const pct = (await pg.getListings({ q: '100%', limit: 50 })).listings.map((l) => l.id);
    assert.deepEqual(pct, [], 'q=100% must not match every row (literal substring semantics)');

    const literal = (await pg.getListings({ q: 'Query Parity', limit: 50 })).listings.map((l) => l.id);
    assert.deepEqual(literal, ['qparity:exact'], 'a plain keyword still matches its row');
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

