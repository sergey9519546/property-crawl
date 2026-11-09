'use strict';

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
    address: '1 Field Parity St, Avondale, AZ 85323',
    occupancy: 'Vacant',
    deposit: '10% deposit',
    plaintiff: 'Plaintiff One',
    defendant: 'Defendant One',
    attorney: 'Attorney One',
    openingBid: 100000,
    provenance: { origin: 'live', observed: true },
  };
  return [
    { ...base, id: 'fp:base' },
    { ...base, id: 'fp:state', state: 'ZZ' },
    { ...base, id: 'fp:occupancy', occupancy: 'OccupiedUnique' },
    { ...base, id: 'fp:deposit', deposit: 'DepositUniqueTerm' },
    { ...base, id: 'fp:source', source: 'sheriff' },
  ];
}

async function seed(db) {
  for (const listing of fixtures()) await db.createListing(listing);
}

test('q field parity: PG and memory return identical id sets for state/occupancy/deposit/source label', { timeout: BOOT_TIMEOUT_MS * 2 }, async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-q-fieldparity-'));
  try {
    const embedded = await startEmbeddedPostgres({ dataDir });
    await migrate(embedded.pool);
    const pg = new DatabaseClient({ pool: embedded.pool, liveCachePath: null, workspaceStorePath: null });
    const memory = new DatabaseClient({ env: { ...process.env, PROPERTY_INVENTORY_BACKEND: 'memory', NODE_ENV: 'test' }, liveCachePath: null, workspaceStorePath: null });
    memory.inMemoryData.listings = [];
    await seed(pg);
    await seed(memory);

    const cases = ['ZZ', 'OccupiedUnique', 'DepositUniqueTerm', 'Sheriff'];
    for (const q of cases) {
      const fromPg = (await pg.getListings({ q, limit: 50 })).listings.map((l) => l.id).sort();
      const fromMemory = (await memory.getListings({ q, limit: 50 })).listings.map((l) => l.id).sort();
      assert.deepEqual(fromPg, fromMemory, `q=${JSON.stringify(q)} must match the same rows on both backends`);
      assert.ok(fromPg.length > 0, `q=${JSON.stringify(q)} must match at least one row`);
    }

    // Each unique token matches exactly its own row.
    assert.deepEqual((await pg.getListings({ q: 'ZZ', limit: 50 })).listings.map((l) => l.id), ['fp:state']);
    assert.deepEqual((await pg.getListings({ q: 'OccupiedUnique', limit: 50 })).listings.map((l) => l.id), ['fp:occupancy']);
    assert.deepEqual((await pg.getListings({ q: 'DepositUniqueTerm', limit: 50 })).listings.map((l) => l.id), ['fp:deposit']);
    assert.deepEqual((await pg.getListings({ q: 'Sheriff', limit: 50 })).listings.map((l) => l.id), ['fp:source']);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});
