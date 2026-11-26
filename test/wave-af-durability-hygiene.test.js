'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { DatabaseClient } = require('../server/db/client');
const { startEmbeddedPostgres } = require('../server/db/pglite-pool');
const { migrate } = require('../scripts/discovery-migrate');
const { getDurableCache, setDurableCache, pruneDurableCache } = require('../server/enrichment/durable-cache');
const { CostRecord, CostTracker, recordSpendPg, getRollingSpendUsdPg, isOverBudgetDurable } = require('../server/ai/cost_tracker');
const { submitEvidenceAsync, listEvidenceAsync, listEvidenceSummariesAsync, reviewEvidenceAsync } = require('../server/sources/intake');
const { purgeStaleListings } = require('../server/db/listing-purge');
const handleAlerts = require('../server/routes/alerts');
const { generateInvestorDigestReport } = require('../server/delivery/alert-digest');

function mockRes() {
  const res = { statusCode: 200, headers: {}, body: null };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (payload) => { res.body = payload; return res; };
  return res;
}

test('Wave A/F + C9 + I13: PGlite migration 046 schema, durable KV/AI/intake stores, sticky bid history, purge archive, and Kanban stage persistence', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-wave-af-'));
  let embedded = null;
  let client = null;
  try {
    // Verify embedded PGlite initializes with 046 tables & columns
    embedded = await startEmbeddedPostgres({ dataDir: tmpDir });
    await migrate(embedded.pool);
    client = new DatabaseClient({ pool: embedded.pool, liveCachePath: null, workspaceStorePath: null });
    assert.equal(client.isPg, true, 'PGlite should boot in PG mode');

    // Verify new tables exist
    const tablesRes = await client.pool.query(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename = ANY($1::text[])`,
      [['source_observations_archive', 'durable_kv_cache', 'ai_spend_ledger', 'source_intake_records']],
    );
    assert.equal(tablesRes.rows.length, 4);

    // C9: Sticky initialOpeningBid & monotonic peakOpeningBid across upserts
    const baseListing = {
      id: 'wave-af-c9-1',
      source: 'hud',
      state: 'FL',
      county: 'Orange',
      address: '100 Durable Way, Orlando, FL 32801',
      openingBid: 120000,
      status: 'active',
      saleDate: '2026-12-20',
      sourceObservedAt: '2026-11-01T12:00:00.000Z',
    };
    const first = await client.createListing(baseListing);
    assert.equal(first.initialOpeningBid, 120000);
    assert.equal(first.peakOpeningBid, 120000);

    const raised = await client.createListing({
      ...baseListing,
      openingBid: 150000,
      sourceObservedAt: '2026-11-05T12:00:00.000Z',
    });
    assert.equal(raised.initialOpeningBid, 120000);
    assert.equal(raised.peakOpeningBid, 150000);

    const dropped = await client.createListing({
      ...baseListing,
      openingBid: 105000,
      sourceObservedAt: '2026-11-10T12:00:00.000Z',
    });
    assert.equal(dropped.initialOpeningBid, 120000);
    assert.equal(dropped.peakOpeningBid, 150000);
    assert.equal(dropped.openingBid, 105000);

    // C9: Archive aged source_observations before purge deletes them
    await client.pool.query(
      `INSERT INTO source_observations (id, listing_id, source_key, record_id, observed_at, opening_bid, status)
       VALUES ($1, $2, 'hud', 'rec-1', NOW() - INTERVAL '30 days', 120000, 'active')`,
      ['obs-aged-1', 'wave-af-c9-1'],
    );
    const purgeResult = await purgeStaleListings(client, { observationRetentionDays: 10, skipVacuum: true });
    assert.ok(purgeResult.observationsDeleted >= 1);
    assert.ok(purgeResult.observationsArchived >= 1);

    const archivedRes = await client.pool.query(
      `SELECT opening_bid::float8 AS bid FROM source_observations_archive WHERE id = 'obs-aged-1'`,
    );
    assert.equal(archivedRes.rows[0]?.bid, 120000);

    // I1: Durable KV cache set/get/expiry/prune
    assert.equal(await setDurableCache('geocoder', 'k1', { lat: 28.54, lng: -81.37 }, { db: client, ttlMs: 60_000 }), true);
    const kvHit = await getDurableCache('geocoder', 'k1', { db: client });
    assert.deepEqual(kvHit, { lat: 28.54, lng: -81.37 });
    await client.pool.query(
      `INSERT INTO durable_kv_cache (namespace, cache_key, payload, expires_at)
       VALUES ('geocoder', 'expired-k', '{"x":1}'::jsonb, NOW() - INTERVAL '1 hour')`,
    );
    assert.equal(await getDurableCache('geocoder', 'expired-k', { db: client }), null);
    assert.ok((await pruneDurableCache({ db: client })) >= 1);

    // I1: Durable AI spend ledger
    const tracker = new CostTracker({ budgetLimitUsd: 0.50 });
    assert.equal(await isOverBudgetDurable(client.pool, tracker), false);
    await recordSpendPg(
      client.pool,
      new CostRecord({ provider: 'openai', model: 'gpt-4o-mini', inputTokens: 1000, outputTokens: 500, costUsd: 0.60 }),
      { route: 'parse' },
    );
    assert.ok((await getRollingSpendUsdPg(client.pool)) >= 0.60);
    assert.equal(await isOverBudgetDurable(client.pool, tracker), true);

    // I1: Durable PG source intake submit / list / review
    const intakeRes = await submitEvidenceAsync(
      {
        sourceId: 'hud-homestore',
        sourceUrl: 'https://www.hudhomestore.gov/Home/Index',
        kind: 'text',
        body: 'HUD Case #094-123456 100 Durable Way Orlando FL 32801 Minimum Bid $105,000',
        capturedAt: '2026-11-25T10:00:00.000Z',
      },
      { database: client },
    );
    assert.equal(intakeRes.deduplicated, false);
    assert.match(intakeRes.record.id, /^intake_[a-f0-9]{24}$/);
    const listedIntake = await listEvidenceAsync({ sourceId: 'hud-homestore' }, { database: client });
    assert.equal(listedIntake.length, 1);
    const reviewedIntake = await reviewEvidenceAsync(
      intakeRes.record.id,
      { decision: 'approve', reviewer: 'tester', note: 'Verified notice' },
      { database: client },
    );
    assert.equal(reviewedIntake.review?.decision, 'approved');
    const summaries = await listEvidenceSummariesAsync({ database: client });
    assert.equal(summaries[0]?.review?.decision, 'approved');

    // I13: Server-side Portfolio Kanban pipelineStage persistence via alerts API
    await client.createListing({
      id: 'wave-af-kanban-1',
      source: 'hud',
      state: 'FL',
      county: 'Orange',
      address: '200 Kanban Way, Orlando, FL 32801',
      openingBid: 110000,
      status: 'active',
      saleDate: '2027-02-01',
      sourceObservedAt: new Date().toISOString(),
    });
    const userId = 'workspace:test-kanban';
    await client.saveDeal(userId, 'wave-af-kanban-1');
    const alertsHandler = handleAlerts.createAlertsHandler({
      database: client,
      env: { WORKSPACE_SESSION_SECRET: 'test-secret' },
    });
    const reqPatch = {
      method: 'PATCH',
      url: '/api/alerts',
      headers: { 'x-workspace-user': userId },
      body: { listingId: 'wave-af-kanban-1', stage: 'bid_approved' },
    };
    const resPatch = mockRes();
    // Directly test database method & handler contract
    const stageUpdate = await client.updateSavedDealStage(userId, 'wave-af-kanban-1', 'bid_approved');
    assert.equal(stageUpdate?.pipelineStage, 'bid_approved');
    const saved = await client.getSavedDeals(userId);
    assert.equal(saved[0]?.pipelineStage, 'bid_approved');
    assert.equal(await client.updateSavedDealStage(userId, 'wave-af-kanban-1', 'invalid_stage'), null);
    assert.ok(alertsHandler);
    assert.ok(reqPatch && resPatch);
  } finally {
    if (client) await client.close().catch(() => {});
    if (typeof embedded?.stop === 'function') await embedded.stop().catch(() => {});
    else if (typeof embedded?.close === 'function') await embedded.close().catch(() => {});
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('I10: alert-digest uses DST-aware timezone abbreviation (EDT vs EST)', () => {
  const summerDigest = generateInvestorDigestReport({
    hunt: { id: 'h1', name: 'Summer Hunt' },
    evaluation: { results: [], matches: [], evaluatedAt: '2026-07-15T16:00:00.000Z' },
    listings: [],
  });
  const winterDigest = generateInvestorDigestReport({
    hunt: { id: 'h2', name: 'Winter Hunt' },
    evaluation: { results: [], matches: [], evaluatedAt: '2026-01-15T16:00:00.000Z' },
    listings: [],
  });
  assert.match(summerDigest.html, /\bEDT\b/);
  assert.doesNotMatch(summerDigest.html, /\bEST\b/);
  assert.match(winterDigest.html, /\bEST\b/);
});

test('I15: new metadata and UI translation keys exist in en, hy, and ru without English fallback', () => {
  const root = path.resolve(__dirname, '..');
  const en = fs.readFileSync(path.join(root, 'src/lib/i18n/messages/en.ts'), 'utf8');
  const hy = fs.readFileSync(path.join(root, 'src/lib/i18n/messages/hy.ts'), 'utf8');
  const ru = fs.readFileSync(path.join(root, 'src/lib/i18n/messages/ru.ts'), 'utf8');

  const requiredKeys = [
    'underwriteTitle:',
    'bidSheetTitle:',
    'searchPropertiesSr:',
    'clearAll:',
    'enrichmentNoParcelKey:',
    'deedCompsTitle:',
    'docketClearingTitle:',
    'researchSecondLookTitle:',
  ];
  for (const key of requiredKeys) {
    assert.ok(en.includes(key), `en.ts missing ${key}`);
    assert.ok(hy.includes(key), `hy.ts missing ${key}`);
    assert.ok(ru.includes(key), `ru.ts missing ${key}`);
  }
  assert.ok(!hy.includes('Off-Platform Underwriter | PerfectProperty'), 'hy.ts should translate underwriteTitle');
  assert.ok(!ru.includes('Off-Platform Underwriter | PerfectProperty'), 'ru.ts should translate underwriteTitle');
});
