'use strict';

const assert = require('node:assert/strict');
const { test, describe } = require('node:test');
const { seedFromV0, loadV0Data } = require('../scripts/seed-from-v0');

describe('Database Seeder from v0 (Task 3.1)', () => {
  test('loadV0Data loads valid sources and listings from data.js', () => {
    const data = loadV0Data();
    assert.ok(data.sources, 'Sources object must exist');
    assert.ok(Array.isArray(data.listings), 'Listings must be an array');
    assert.ok(Object.keys(data.sources).length >= 10);
    assert.ok(data.listings.length > 50);

    const first = data.listings[0];
    assert.ok(first.id, 'Listing must have an id');
    assert.ok(first.address, 'Listing must have an address');
    assert.ok(first.source, 'Listing must have a source');
  });

  test('seedFromV0 dry-run succeeds without DATABASE_URL', async () => {
    const logs = [];
    const result = await seedFromV0({
      dryRun: true,
      logger: (msg) => logs.push(msg),
    });

    assert.equal(result.success, true);
    assert.equal(result.dryRun, true);
    assert.ok(result.sourcesCount >= 10);
    assert.ok(result.listingsCount > 50);
    assert.ok(result.geocodedCount > 0);
    assert.ok(result.statesCount > 0);
    assert.ok(logs.some((l) => l.includes('dry-run mode')));
  });

  test('seedFromV0 dry-run validates geocoding and state coverage', async () => {
    const result = await seedFromV0({
      databaseUrl: null, // unset DATABASE_URL triggers preview/dry-run mode
      logger: () => {},
    });

    assert.equal(result.success, true);
    assert.equal(result.dryRun, true);
    assert.equal(result.geocodedCount, result.listingsCount);
  });
});
