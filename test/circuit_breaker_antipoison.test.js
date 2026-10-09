'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { CollectorRegistry } = require('../server/sources/collector-registry');
const { ScraperCircuitBreaker } = require('../server/scrapers/circuit-breaker');

test('CollectorRegistry registers source collectors and initializes telemetry', () => {
  const registry = new CollectorRegistry();
  registry.registerCollector('civilview', async () => [{ id: 'cv-1' }]);

  const telem = registry.getTelemetry('civilview');
  assert.equal(telem.sourceKey, 'civilview');
  assert.equal(telem.circuitState, 'CLOSED');
  assert.equal(telem.isOpen, false);
  assert.equal(telem.listingCount, 0);
  assert.equal(telem.suppressedOverwrites, 0);
});

test('CollectorRegistry executes successful collection and saves snapshot', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'registry-snap-'));

  try {
    const registry = new CollectorRegistry({ snapshotDir: tmpDir });
    const mockListings = [
      { id: 'hud-101', address: '123 Main St', state: 'OH', openingBid: 45000 },
      { id: 'hud-102', address: '456 Elm St', state: 'OH', openingBid: 60000 },
    ];

    registry.registerCollector('hud', async () => mockListings);

    const result = await registry.executeCollector('hud');
    assert.equal(result.ok, true);
    assert.equal(result.count, 2);
    assert.equal(result.preservedSnapshot, false);

    // Verify snapshot was stored
    const snapshot = registry.getSnapshot('hud');
    assert.equal(snapshot.length, 2);
    assert.equal(snapshot[0].id, 'hud-101');

    const telem = registry.getTelemetry('hud');
    assert.equal(telem.status, 'HEALTHY');
    assert.equal(telem.listingCount, 2);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Anti-Poisoning Gate suppresses anomalous zero-count drops and preserves snapshot', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'registry-snap-'));

  try {
    const registry = new CollectorRegistry({ snapshotDir: tmpDir });
    const initialListings = [
      { id: 'treasury-01', address: '789 Oak St', state: 'FL', openingBid: 120000 },
      { id: 'treasury-02', address: '101 Pine St', state: 'FL', openingBid: 150000 },
    ];

    // Seed snapshot with 2 verified listings
    registry.saveSnapshot('treasury', initialListings);

    // Flaky scraper returns empty array
    registry.registerCollector('treasury', async () => []);

    const result = await registry.executeCollector('treasury');

    // Anti-poisoning gate MUST catch this and NOT wipe the listings
    assert.equal(result.ok, false);
    assert.equal(result.error, 'ANOMALOUS_EMPTY_COLLECTION_SUPPRESSED');
    assert.equal(result.preservedSnapshot, true);
    assert.equal(result.listings.length, 2, 'Must retain prior verified snapshot');

    const telem = registry.getTelemetry('treasury');
    assert.equal(telem.status, 'ANOMALOUS_DROP_SUPPRESSED');
    assert.equal(telem.suppressedOverwrites, 1);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('WAF bot challenge trips breaker immediately and prevents database poisoning', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'registry-snap-'));

  try {
    const registry = new CollectorRegistry({ snapshotDir: tmpDir });
    const priorListings = [{ id: 'irs-01', address: '500 Broad St' }];
    registry.saveSnapshot('irs', priorListings);

    // Scraper encounters Cloudflare Turnstile challenge wall
    registry.registerCollector('irs', async () => ({
      rawResponse: {
        status: 403,
        body: '<html><title>Just a moment...</title><body>Checking your browser before accessing site. cf-turnstile</body></html>',
      },
      listings: [],
    }));

    const result = await registry.executeCollector('irs');

    assert.equal(result.ok, false);
    assert.match(result.error, /CIRCUIT_BREAKER_TRIPPED/);
    assert.equal(result.preservedSnapshot, true);
    assert.equal(result.listings.length, 1);

    const telem = registry.getTelemetry('irs');
    assert.equal(telem.status, 'WAF_CHALLENGE_BLOCKED');
    assert.equal(telem.circuitState, 'OPEN');
    assert.equal(telem.isOpen, true);

    // Subsequent calls while circuit is OPEN immediately fail closed
    const secondCall = await registry.executeCollector('irs');
    assert.equal(secondCall.ok, false);
    assert.equal(secondCall.error, 'CIRCUIT_OPEN_FAIL_CLOSED');
    assert.equal(secondCall.listings.length, 1);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('getAllTelemetry aggregates across all registered collectors for health endpoint', () => {
  const registry = new CollectorRegistry();
  registry.registerCollector('gsa', async () => []);
  registry.registerCollector('usda', async () => []);

  const all = registry.getAllTelemetry();
  assert.ok(all.gsa);
  assert.ok(all.usda);
  assert.equal(all.gsa.circuitState, 'CLOSED');
  assert.equal(all.usda.circuitState, 'CLOSED');
});
