'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { DatabaseClient } = require('../server/db/client');
const { startEmbeddedPostgres } = require('../server/db/pglite-pool');
const { migrate } = require('../scripts/discovery-migrate');
const researchStore = require('../server/intelligence/research-store');
const { applySecondLookReconsiderationPg } = require('../server/intelligence/second-look');
const { createPriceDropHandler } = require('../server/routes/price-drop');
const { evaluateOpportunitySignals } = require('../server/intelligence/signals');
const { loadObservationsForRecord } = require('../server/db/observations-persistence');
const { createSavedSearchesHandler } = require('../server/routes/saved-searches');
const { normalizeCandidateDeedRecord } = require('../server/enrichment/deed-comps');
const { standardizeEmailNoticeListing } = require('../server/sources/email-notices');
const { getEvidenceByIdAsync, submitEvidenceAsync } = require('../server/sources/intake');

function mockRes() {
  const res = { statusCode: 200, headers: {}, body: null };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (payload) => { res.body = payload; return res; };
  return res;
}

test('A26 P0+P1: C3 PG second-look, C9 readers + archive union, C7 quota, missingAssessorRoll, PG intake getById', async () => {
  const prevAdminToken = process.env.SCRAPER_ADMIN_TOKEN;
  process.env.SCRAPER_ADMIN_TOKEN = 'test-a26-admin-token';
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-a26-'));
  let embedded = null;
  let db = null;
  try {
    embedded = await startEmbeddedPostgres({ dataDir: tmpDir });
    await migrate(embedded.pool);
    db = new DatabaseClient({ pool: embedded.pool, liveCachePath: null, workspaceStorePath: null });

    // Seed active listing with pre-existing assessed value (no assessorRoll) and bid drop from peak
    await db.createListing({
      id: 'a26-l1',
      source: 'civilview',
      state: 'OH',
      county: 'Cuyahoga',
      address: '100 Audit Blvd, Cleveland, OH 44114',
      openingBid: 180000,
      assessed: 210000,
      status: 'active',
      saleDate: '2027-03-15',
      sourceUrl: 'https://salesweb.civilview.com/Sales/SaleDetails?PropertyId=99999',
      raw: 'Notice of Sheriff Sale for 100 Audit Blvd, Cleveland, OH 44114',
      sourceObservedAt: '2026-11-01T10:00:00.000Z',
      provenance: { origin: 'live', observed: true, publisher: 'CivilView', recordId: 'A26-CV-1', observedAt: '2026-11-01T10:00:00.000Z', sourceFacts: {} },
    });
    // Drop bid to 140k (initial=180k, peak=180k, current=140k)
    await db.createListing({
      id: 'a26-l1',
      source: 'civilview',
      state: 'OH',
      county: 'Cuyahoga',
      address: '100 Audit Blvd, Cleveland, OH 44114',
      openingBid: 140000,
      assessed: 210000,
      status: 'active',
      saleDate: '2027-03-15',
      sourceUrl: 'https://salesweb.civilview.com/Sales/SaleDetails?PropertyId=99999',
      raw: 'Notice of Sheriff Sale for 100 Audit Blvd, Cleveland, OH 44114',
      sourceObservedAt: '2026-11-10T10:00:00.000Z',
      provenance: { origin: 'live', observed: true, publisher: 'CivilView', recordId: 'A26-CV-1', observedAt: '2026-11-10T10:00:00.000Z', sourceFacts: {} },
    });

    // missingAssessorRoll MUST return rows with assessed_value > 0 when derivedFields.assessorRoll is absent
    const missingRoll = await db.getListings({ state: 'OH', missingAssessorRoll: true });
    assert.ok(missingRoll.listings.some((r) => r.id === 'a26-l1'), 'missingAssessorRoll should include assessed>0 without assessorRoll');

    // C3: PG research_cases pass -> second-look trigger preserves reconsideration & latestTrigger
    const created = await researchStore.createCasePg(db, 'account:acct_pro_1', {
      listing: {
        id: 'a26-l1',
        source: 'civilview',
        state: 'OH',
        address: '100 Audit Blvd, Cleveland, OH 44114',
        openingBid: 180000,
        sourceUrl: 'https://salesweb.civilview.com/Sales/SaleDetails?PropertyId=99999',
        raw: 'Notice of Sheriff Sale for 100 Audit Blvd, Cleveland, OH 44114',
        sourceObservedAt: '2026-11-01T10:00:00.000Z',
        provenance: { origin: 'live', observed: true, publisher: 'CivilView', recordId: 'A26-CV-1', observedAt: '2026-11-01T10:00:00.000Z' },
      },
    });
    const passed = await researchStore.updateCasePg(db, 'account:acct_pro_1', created.case.id, {
      state: 'pass',
      reasonCodes: ['price_too_high'],
      reconsideration: { mode: 'any', conditions: [{ field: 'openingBid', operator: 'lte', value: 150000 }] },
      expectedRevision: created.case.revision,
    });
    const passCases = await researchStore.listAllCasesByStatePg(db, 'pass');
    assert.equal(passCases.length, 1);
    assert.equal(passCases[0].ownerId, 'account:acct_pro_1');

    const freshListing = await db.getListingById('a26-l1');
    const reopened = await applySecondLookReconsiderationPg(db, 'account:acct_pro_1', passed.id, freshListing);
    assert.equal(reopened.triggered, true);
    assert.equal(reopened.case.workspaceState, 'inbox');
    assert.equal(reopened.case.reconsiderationRequired, true);
    assert.ok(reopened.case.reconsideration);
    assert.equal(reopened.case.latestTrigger?.priorDecidedOpeningBid, 180000);

    // C9: price-drop route falls back to peakOpeningBid/initialOpeningBid when listing_history is empty
    await db.pool.query("DELETE FROM listing_history WHERE listing_id = 'a26-l1'");
    const userId = 'workspace:a26';
    await db.saveDeal(userId, 'a26-l1');
    const pdHandler = createPriceDropHandler({ database: db, requireWorkspaceIdentity: () => userId });
    const pdRes = mockRes();
    await pdHandler({ method: 'GET', url: '/api/price-drops', headers: { 'x-workspace-user': userId } }, pdRes);
    assert.equal(pdRes.statusCode, 200);
    assert.equal(pdRes.body.drops[0]?.dropped, true);
    assert.equal(pdRes.body.drops[0]?.previousBid, 180000);
    assert.equal(pdRes.body.drops[0]?.initialOpeningBid, 180000);

    // C9: signals.js uses peakOpeningBid/initialOpeningBid when recordHistory is empty
    const sig = evaluateOpportunitySignals(freshListing, {});
    assert.ok(sig.trajectory.cumulativeBidDropPct > 20);

    // C9: loadObservationsForRecord unions source_observations and source_observations_archive
    await db.pool.query(
      `INSERT INTO source_observations_archive (id, listing_id, source_key, record_id, observed_at, opening_bid, status)
       VALUES ('arch-obs-1', 'a26-l1', 'civilview', 'A26-CV-1', '2026-10-01T10:00:00.000Z', 180000, 'active')`,
    );
    const obsBundle = await loadObservationsForRecord(db.pool, freshListing);
    assert.equal(Object.values(obsBundle.records)[0]?.observations, 1);

    // C7: saved-searches recognizes workspace:operator (unlimited) and account:acct_... (pro quota > 5)
    const { handleSavedSearches: ssHandler } = createSavedSearchesHandler({ database: db, env: { WORKSPACE_SESSION_SECRET: 'sec' } });
    for (let i = 0; i < 6; i++) {
      const r = mockRes();
      await ssHandler({
        method: 'POST',
        url: '/api/saved-searches',
        headers: { authorization: 'Bearer test-a26-admin-token' },
        body: { label: `Op Search ${i}`, filters: { states: ['OH'] } },
      }, r);
      assert.equal(r.statusCode, 201, `operator search ${i} should not be capped at 5`);
    }
    for (let i = 0; i < 6; i++) {
      const r = mockRes();
      await ssHandler({
        method: 'POST',
        url: '/api/saved-searches',
        headers: { authorization: 'Bearer test-a26-admin-token', 'x-pp-account': 'acct_0123456789abcdef01234567' },
        body: { label: `Acct Search ${i}`, filters: { states: ['OH'] } },
      }, r);
      assert.equal(r.statusCode, 201, `account search ${i} should not be capped at 5`);
    }

    // I1: PG source_intake_records getEvidenceByIdAsync
    const intake = await submitEvidenceAsync(
      {
        sourceId: 'hud-homestore',
        sourceUrl: 'https://www.hudhomestore.gov/',
        kind: 'text',
        body: 'HUD Case #381-111222 100 Audit Blvd Cleveland OH 44114',
        capturedAt: '2026-11-25T10:00:00.000Z',
      },
      { database: db },
    );
    const fetched = await getEvidenceByIdAsync(intake.record.id, { database: db });
    assert.equal(fetched?.id, intake.record.id);
  } finally {
    if (prevAdminToken === undefined) delete process.env.SCRAPER_ADMIN_TOKEN;
    else process.env.SCRAPER_ADMIN_TOKEN = prevAdminToken;
    if (db) await db.close().catch(() => {});
    if (typeof embedded?.stop === 'function') await embedded.stop().catch(() => {});
    else if (typeof embedded?.close === 'function') await embedded.close().catch(() => {});
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('A26: deed-comps rawAttributes extraction & I7 zero-fabrication email-notice URLs', async () => {
  const norm = normalizeCandidateDeedRecord({
    rawAttributes: {
      SALE_PRICE: 325000,
      DEED_DATE: '2026-08-15',
      BLDG_SQFT: 1850,
    },
  });
  assert.equal(norm.salePrice, 325000);
  assert.equal(norm.sqft, 1850);
  assert.ok(norm.saleDate);

  const njNotice = await standardizeEmailNoticeListing(
    { state: 'NJ', property_address: '123 Main St, Newark, NJ 07102', opening_bid: 150000 },
    { rawSnippet: 'FORECLOSURE SALE: 123 Main St', skipVault: true, vault: null },
  );
  assert.equal(njNotice.sourceUrl, 'https://www.njpublicnotices.com');
  assert.doesNotMatch(njNotice.sourceUrl, /\/notice\/email-notice-/);
  const unknownStateNotice = await standardizeEmailNoticeListing(
    { state: 'XX', property_address: '123 Main St' },
    { rawSnippet: 'FORECLOSURE SALE: 123 Main St', skipVault: true, vault: null },
  );
  assert.equal(unknownStateNotice.sourceUrl, null);
});
