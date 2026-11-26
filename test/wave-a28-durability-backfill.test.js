'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const unbrowseTool = require('../scripts/crawler-tools-unbrowse.cjs');
const { backfillAssessorRolls, CONVERTED_STATES } = require('../server/enrichment/assessor-backfill');
const { createScrapersHandler } = require('../server/routes/scrapers');
const { ScraperCircuitBreaker } = require('../server/scrapers/circuit-breaker');

function makeValidCandidate() {
  return {
    schemaVersion: unbrowseTool.CANDIDATE_SCHEMA,
    source: 'gsa',
    sourceUrl: 'https://realestatesales.gov/asset-details?property_id=123',
    method: 'GET',
    reviewStatus: 'pending',
    generatedAt: '2026-01-01T00:00:00.000Z',
    evidence: {
      provider: 'unbrowse',
      version: '11.4.1',
      endpointUrl: 'https://realestatesales.gov/asset-details?property_id=123',
      observedAt: '2026-01-01T00:00:00.000Z',
      notes: 'Reviewed public route.',
    },
  };
}

function temporaryCachePath() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pc-wave-a28-')), 'assessor-roll.json');
}

function makeFakeDurableDb() {
  const store = new Map();
  const writes = [];
  const db = {
    isPg: true,
    writes,
    store,
    pool: {
      async query(sql, params = []) {
        const normalized = String(sql).replace(/\s+/g, ' ').trim();
        if (normalized.startsWith('SELECT payload FROM durable_kv_cache')) {
          const [namespace, cacheKey] = params;
          const entry = store.get(`${namespace}:${cacheKey}`);
          return { rows: entry ? [{ payload: entry.payload }] : [] };
        }
        if (normalized.startsWith('SELECT cache_key, payload FROM durable_kv_cache')) {
          const [namespace] = params;
          const rows = [];
          for (const [k, entry] of store.entries()) {
            if (k.startsWith(`${namespace}:`)) {
              rows.push({ cache_key: entry.cacheKey, payload: entry.payload });
            }
          }
          return { rows };
        }
        if (normalized.startsWith('INSERT INTO durable_kv_cache')) {
          const [namespace, cacheKey, payloadJson, ttlMs] = params;
          const payload = JSON.parse(payloadJson);
          store.set(`${namespace}:${cacheKey}`, { namespace, cacheKey, payload, ttlMs });
          writes.push({ namespace, cacheKey, payload, ttlMs });
          return { rowCount: 1, rows: [] };
        }
        return { rows: [] };
      },
    },
  };
  return db;
}

test('candidateToIntake awaits/resolves thenable submitEvidence cleanly and preserves id/deduplicated/provenance', async () => {
  const pending = unbrowseTool.candidateToIntake(makeValidCandidate(), {
    intake: {
      async submitEvidence() {
        return {
          record: { id: 'intake_async_42', status: 'needs_review' },
          deduplicated: true,
        };
      },
    },
  });

  assert.equal(typeof pending.then, 'function');
  const resolved = await pending;
  assert.equal(resolved.record.id, 'intake_async_42');
  assert.equal(resolved.deduplicated, true);
  assert.equal(resolved.provenance, 'unbrowse-route-candidate');
  assert.equal(resolved.candidateSchema, unbrowseTool.CANDIDATE_SCHEMA);

  const syncResult = unbrowseTool.candidateToIntake(makeValidCandidate(), {
    intake: {
      submitEvidence() {
        return {
          record: { id: 'intake_sync_7', status: 'needs_review' },
          deduplicated: false,
        };
      },
    },
  });
  assert.equal(typeof syncResult.then, 'undefined');
  assert.equal(syncResult.record.id, 'intake_sync_7');
  assert.equal(syncResult.deduplicated, false);
  assert.equal(syncResult.provenance, 'unbrowse-route-candidate');
});

test('backfillAssessorRolls skips CONVERTED_STATES when HUD priority fills limit', async () => {
  const queriedStates = [];
  const hudRows = [
    { id: 'hud:1', source: 'hud', state: 'AZ', county: 'Maricopa', lat: 33.4, lng: -112.3, provenance: { origin: 'live', observed: true } },
    { id: 'hud:2', source: 'hud', state: 'AZ', county: 'Maricopa', lat: 33.41, lng: -112.31, provenance: { origin: 'live', observed: true } },
  ];
  const db = {
    async getListings(filters) {
      if (filters.state) queriedStates.push(filters.state);
      if (filters.source === 'hud') return { total: hudRows.length, listings: hudRows };
      return { total: 0, listings: [] };
    },
    async createListing(listing) {
      return listing;
    },
  };

  const result = await backfillAssessorRolls({
    db,
    limit: 2,
    cachePath: temporaryCachePath(),
    fetchFn: async () => ({ ok: true, json: async () => ({ features: [] }) }),
    now: Date.parse('2026-11-01T00:00:00.000Z'),
  });

  assert.equal(result.considered, 2);
  assert.deepEqual(queriedStates, [], 'CONVERTED_STATES should not be queried once candidates.length >= limit');
});

test('backfillAssessorRolls batches CONVERTED_STATES in parallel batches of 4 deterministically', async () => {
  let active = 0;
  let maxConcurrent = 0;
  const queriedStates = [];
  const harvestedOrder = [];

  const rowsByState = {
    [CONVERTED_STATES[0]]: [
      { id: `${CONVERTED_STATES[0]}-1`, source: 'servicelink', state: 'AZ', county: 'Maricopa', lat: 33.4, lng: -112.3, provenance: { origin: 'live', observed: true } },
      { id: `${CONVERTED_STATES[0]}-2`, source: 'servicelink', state: 'AZ', county: 'Maricopa', lat: 33.41, lng: -112.31, provenance: { origin: 'live', observed: true } },
    ],
    [CONVERTED_STATES[1]]: [
      { id: `${CONVERTED_STATES[1]}-1`, source: 'servicelink', state: 'FL', county: 'Miami-Dade', lat: 25.7, lng: -80.2, provenance: { origin: 'live', observed: true } },
    ],
  };

  const db = {
    async getListings(filters) {
      if (filters.source === 'hud') return { total: 0, listings: [] };
      active += 1;
      maxConcurrent = Math.max(maxConcurrent, active);
      queriedStates.push(filters.state);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active -= 1;
      const matches = rowsByState[filters.state] || [];
      return { total: matches.length, listings: matches };
    },
    async createListing(listing) {
      return listing;
    },
  };

  const result = await backfillAssessorRolls({
    db,
    limit: 3,
    cachePath: temporaryCachePath(),
    fetchFn: async (url) => {
      harvestedOrder.push(String(url));
      return { ok: true, json: async () => ({ features: [] }) };
    },
    now: Date.parse('2026-11-01T00:00:00.000Z'),
  });

  assert.equal(result.considered, 3);
  assert.ok(maxConcurrent > 1 && maxConcurrent <= 4, `expected bounded batch concurrency in (1, 4], got ${maxConcurrent}`);
  assert.equal(queriedStates.length, CONVERTED_STATES.length);
  assert.ok(harvestedOrder.length >= 2);
});

test('action=next-slice hydrates sliceLastRunAt from durable_kv_cache and persists scraper_slice_attempt', async () => {
  const prevMap = createScrapersHandler._sliceLastRunAt;
  createScrapersHandler._sliceLastRunAt = new Map();

  try {
    const now = Date.now();
    const seededAt = now - 15 * 60_000;
    const durableDb = makeFakeDurableDb();
    durableDb.store.set('scraper_slice_attempt:servicelink', {
      namespace: 'scraper_slice_attempt',
      cacheKey: 'servicelink',
      payload: { at: seededAt, reason: 'previous_cold_run' },
      ttlMs: 2 * 3600 * 1000,
    });

    const basePoolQuery = durableDb.pool.query.bind(durableDb.pool);
    const db = {
      isPg: true,
      pool: {
        async query(sql, params = []) {
          const normalized = String(sql).replace(/\s+/g, ' ').trim();
          if (normalized.includes('durable_kv_cache')) {
            return basePoolQuery(sql, params);
          }
          if (normalized.includes('FROM discovery_checkpoints')) {
            return { rows: [] };
          }
          if (normalized.includes('FROM listings')) {
            return {
              rows: [
                { source_key: 'servicelink', latest_at: new Date(now - 2 * 3600_000).toISOString(), oldest_active_at: new Date(now - 24 * 3600_000).toISOString() },
                { source_key: 'hud', latest_at: new Date(now - 3 * 3600_000).toISOString(), oldest_active_at: new Date(now - 24 * 3600_000).toISOString() },
              ],
            };
          }
          if (normalized.includes('FROM source_observation_runs')) {
            return { rows: [] };
          }
          return { rows: [] };
        },
      },
    };

    const runAllCalls = [];
    const handler = createScrapersHandler({
      database: db,
      env: { SCRAPER_ADMIN_TOKEN: 'wave-a28-token' },
      scheduler: {
        database: db,
        async runAll(opts) {
          runAllCalls.push(opts);
          return { ok: true, count: 0 };
        },
      },
    });

    const res = {
      statusCode: 200,
      body: null,
      status(code) { this.statusCode = code; return this; },
      json(payload) { this.body = payload; return this; },
    };

    await handler({
      method: 'POST',
      url: '/api/scrapers/run?action=next-slice',
      headers: { authorization: 'Bearer wave-a28-token' },
      body: {},
    }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.action, 'next-slice');
    assert.equal(createScrapersHandler._sliceLastRunAt.get('servicelink'), seededAt);
    assert.equal(runAllCalls.length, 1);

    const persisted = durableDb.writes.find((w) => w.namespace === 'scraper_slice_attempt' && w.cacheKey === res.body.source);
    assert.ok(persisted, 'expected scraper_slice_attempt write in durable_kv_cache');
    assert.equal(persisted.ttlMs, 2 * 3600 * 1000);
    assert.equal(typeof persisted.payload.at, 'number');
    assert.equal(persisted.payload.reason, res.body.reason);
  } finally {
    createScrapersHandler._sliceLastRunAt = prevMap;
  }
});

test('ScraperCircuitBreaker hydrateFromDurableCache / persistToDurableCache round-trips OPEN state cleanly', async () => {
  const db = makeFakeDurableDb();
  const breaker1 = new ScraperCircuitBreaker({ sourceKey: 'servicelink', failureThreshold: 3, cooldownMs: 3600_000 });
  breaker1.trip('HTTP 403 Forbidden', { immediate: true });
  assert.equal(breaker1.isOpen(), true);

  const persisted = await breaker1.persistToDurableCache(db);
  assert.equal(persisted, true);

  const breaker2 = new ScraperCircuitBreaker({ sourceKey: 'servicelink', failureThreshold: 3, cooldownMs: 3600_000 });
  assert.equal(breaker2.isOpen(), false);

  const hydrated = await breaker2.hydrateFromDurableCache(db);
  assert.equal(hydrated, true);
  assert.equal(breaker2.state, 'OPEN');
  assert.equal(breaker2.isOpen(), true);
  assert.equal(breaker2.lastFailureReason, 'HTTP 403 Forbidden');
  assert.equal(breaker2.consecutiveFailures, 1);

  assert.equal(await breaker2.hydrateFromDurableCache(null), false);
  assert.equal(await breaker2.persistToDurableCache(null), false);
});
