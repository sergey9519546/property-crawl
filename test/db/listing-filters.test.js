'use strict';

// getListings county + missingAssessorRoll filters.
//
// The assessor-roll backfill (server/enrichment/assessor-backfill.js) pulls
// stored, roll-less listings through these filters. The filters must behave
// identically on a real PostgreSQL engine and on the in-memory provider, so
// this test runs both: a throwaway embedded PostgreSQL for the SQL branch and
// a fresh in-memory client for the parity branch.
//
// The roll marker (provenance.derivedFields.assessorRoll) is the authority:
// a row with an assessed figure from another enrichment path must NOT count
// as rolled, and a rolled row must be excluded even if its assessed figure
// were cleared.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { startEmbeddedPostgres } = require('../../server/db/pglite-pool');
const { migrate } = require('../../scripts/discovery-migrate');
const { DatabaseClient, prepareListingForPersistence } = require('../../server/db/client');

function fixtures() {
  const base = {
    source: 'servicelink',
    state: 'AZ',
    county: 'Maricopa',
    address: '1 Filter Test St, Avondale, AZ 85323',
    lat: 33.4,
    lng: -112.3,
    openingBid: 100000,
    provenance: { origin: 'live', observed: true },
  };
  return [
    { ...base, id: 'filtertest:roll-less' },
    {
      ...base,
      id: 'filtertest:rolled',
      provenance: { origin: 'live', observed: true, derivedFields: { assessorRoll: { countyKey: 'AZ-MARICOPA' } } },
      assessed: 300000,
    },
    { ...base, id: 'filtertest:other-county', county: 'Pima' },
  ];
}

async function assertFilterBehaviour(db) {
  const maricopa = await db.getListings({ state: 'AZ', county: 'Maricopa', missingAssessorRoll: true, limit: 50 });
  const ids = maricopa.listings.map((l) => l.id);
  assert.ok(ids.includes('filtertest:roll-less'), 'roll-less Maricopa row must match');
  assert.ok(!ids.includes('filtertest:rolled'), 'rolled Maricopa row must be excluded');
  assert.ok(!ids.includes('filtertest:other-county'), 'other-county row must be excluded by the county filter');

  const caseInsensitive = await db.getListings({ state: 'AZ', county: 'maricopa', missingAssessorRoll: true, limit: 50 });
  assert.ok(caseInsensitive.listings.some((l) => l.id === 'filtertest:roll-less'), 'county filter is case-insensitive');

  const countyOnly = await db.getListings({ state: 'AZ', county: 'Pima', limit: 50 });
  assert.ok(countyOnly.listings.some((l) => l.id === 'filtertest:other-county'), 'county filter matches without the roll filter');
  assert.ok(!countyOnly.listings.some((l) => l.id === 'filtertest:roll-less'), 'county filter excludes other counties');
}

test('county + missingAssessorRoll filters run on a real PostgreSQL engine', { timeout: 180_000 }, async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-embedded-rollfilters-'));
  try {
    const { pool } = await startEmbeddedPostgres({ dataDir });
    try {
      await migrate(pool);
      const db = new DatabaseClient({ pool, liveCachePath: null, workspaceStorePath: null });
      for (const listing of fixtures()) {
        await db.createListing(prepareListingForPersistence(listing));
      }
      await assertFilterBehaviour(db);
    } finally {
      await pool.end();
    }
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

test('county + missingAssessorRoll filters behave identically in memory', async () => {
  const db = new DatabaseClient();
  for (const listing of fixtures()) {
    await db.createListing(prepareListingForPersistence(listing));
  }
  await assertFilterBehaviour(db);
});
