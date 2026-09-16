'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { SOURCE_CATALOG, SOURCE_STATUS_BY_ID } = require('../server/sources/catalog');

function findSource(id) {
  return SOURCE_CATALOG.find((entry) => entry.id === id);
}

test('catalog freezes robotsExclusion so catalog consumers cannot mutate it', () => {
  const gsa = findSource('gsa-real-estate-sales');
  assert.ok(gsa, 'GSA catalog entry exists');
  assert.ok(Array.isArray(gsa.robotsExclusion));
  assert.ok(Object.isFrozen(gsa.robotsExclusion));
  assert.deepEqual([...gsa.robotsExclusion], ['/our-listing']);
});

test('catalog omits robotsExclusion (or leaves it empty) for sources that do not declare an exclusion', () => {
  const servicelink = findSource('servicelink');
  assert.ok(servicelink, 'ServiceLink catalog entry exists');
  assert.ok(Array.isArray(servicelink.robotsExclusion));
  assert.equal(servicelink.robotsExclusion.length, 0);
});

test('catalog exposes a helper to look up robotsExclusion by adapterKey', () => {
  const { getRobotsExclusionForAdapter } = require('../server/sources/catalog');
  assert.deepEqual(getRobotsExclusionForAdapter('gsa'), ['/our-listing']);
  assert.deepEqual(getRobotsExclusionForAdapter('servicelink'), []);
  assert.equal(getRobotsExclusionForAdapter('no-such-adapter'), null);
});

test('catalog exposes a helper to ask whether a specific path is excluded for an adapter', () => {
  const { isPathExcludedForAdapter } = require('../server/sources/catalog');
  assert.equal(isPathExcludedForAdapter('gsa', '/our-listing'), true);
  assert.equal(isPathExcludedForAdapter('gsa', '/asset-details/?property_id=1'), false);
  assert.equal(isPathExcludedForAdapter('servicelink', '/anything'), false);
  assert.equal(isPathExcludedForAdapter('no-such-adapter', '/anything'), false);
});

test('catalog entries can be iterated without errors', () => {
  // The catalog is frozen; this is a smoke check that the freeze didn't
  // accidentally break iteration in any consumer. Pre-existing gaps in the
  // SOURCE_STATUS_BY_ID table (49/58 currently mapped) are tracked elsewhere.
  assert.ok(SOURCE_CATALOG.length > 0);
  for (const entry of SOURCE_CATALOG) {
    assert.ok(entry.id && typeof entry.id === 'string');
    assert.ok(entry.label && typeof entry.label === 'string');
  }
});

test('GsaSurplusScraper.scrapeFeed refuses the catalog-declared robots exclusion by default', async () => {
  // Reach into the export without going through the singleton's shared
  // state so the test is hermetic. We restore process.env at the end.
  const previousEnv = process.env.SCRAPER_RESPECT_ROBOTS;
  delete process.env.SCRAPER_RESPECT_ROBOTS;
  try {
    const { GsaSurplusScraper } = require('../server/scrapers/gsa');
    const scraper = new GsaSurplusScraper();
    const listings = await scraper.scrapeFeed();
    assert.deepEqual(listings, []);
    assert.ok(scraper.lastRunReport);
    assert.equal(scraper.lastRunReport.outcome, 'skipped_robots_exclusion');
    assert.equal(scraper.lastRunReport.robotsExclusion.path, '/our-listing');
    assert.equal(scraper.lastRunReport.recordsDiscovered, 0);
  } finally {
    if (previousEnv === undefined) delete process.env.SCRAPER_RESPECT_ROBOTS;
    else process.env.SCRAPER_RESPECT_ROBOTS = previousEnv;
  }
});

test('GsaSurplusScraper.scrapeFeed still calls fetchText when SCRAPER_RESPECT_ROBOTS=0 (operator override)', async () => {
  // With the override active, the scraper must attempt to fetch (and fail
  // with a network error in the test env, since realestatesales.gov is not
  // reachable from here). The important thing is that the exclusion guard is
  // no longer the first thing that returns; the actual fetch happens.
  const previousEnv = process.env.SCRAPER_RESPECT_ROBOTS;
  process.env.SCRAPER_RESPECT_ROBOTS = '0';
  try {
    const { GsaSurplusScraper } = require('../server/scrapers/gsa');
    const scraper = new GsaSurplusScraper();
    scraper.fetchText = async () => { throw new Error('fetch attempted'); };
    await assert.rejects(scraper.scrapeFeed(), /fetch attempted/);
  } finally {
    if (previousEnv === undefined) delete process.env.SCRAPER_RESPECT_ROBOTS;
    else process.env.SCRAPER_RESPECT_ROBOTS = previousEnv;
  }
});
