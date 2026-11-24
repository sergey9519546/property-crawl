'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { repairLiveEnrichment } = require('../server/enrichment/repair-live-enrichment');
const { createScrapersHandler } = require('../server/routes/scrapers');
const { inspectMapLocation } = require('../src/lib/listing-map-policy');

function makeFakePool(initialRows) {
  const rows = initialRows.map((r) => JSON.parse(JSON.stringify(r)));
  const updates = [];

  return {
    rows,
    updates,
    async query(sql, params = []) {
      const normalizedSql = sql.replace(/\s+/g, ' ').trim();
      if (normalizedSql.startsWith('SELECT') && normalizedSql.includes("state = 'NJ'") && normalizedSql.includes("assessorRoll")) {
        return {
          rows: rows
            .filter((r) => r.state === 'NJ' && r.provenance?.derivedFields?.assessorRoll?.parcel)
            .map((r) => ({ ...r })),
        };
      }
      if (normalizedSql.startsWith('SELECT') && normalizedSql.includes("WHERE source_key = 'civilview'")) {
        return {
          rows: rows
            .filter((r) => r.source === 'civilview')
            .map((r) => ({ ...r })),
        };
      }
      if (normalizedSql.startsWith('SELECT') && normalizedSql.includes('latitude IS NULL OR longitude IS NULL')) {
        const limit = Number(params[0]) || 60;
        return {
          rows: rows
            .filter((r) => (r.lat == null || r.lng == null || (r.lat === 0 && r.lng === 0)) && r.address && r.state)
            .slice(0, limit)
            .map((r) => ({ ...r })),
        };
      }
      if (normalizedSql.startsWith('UPDATE listings SET latitude = NULL, longitude = NULL')) {
        const [id, provenanceJson] = params;
        const target = rows.find((r) => r.id === id);
        if (target) {
          target.lat = null;
          target.lng = null;
          target.provenance = JSON.parse(provenanceJson);
          updates.push({ kind: 'geocode_backoff', id });
        }
        return { rowCount: target ? 1 : 0, rows: [] };
      }
      if (normalizedSql.startsWith('UPDATE listings SET latitude = $2, longitude = $3')) {
        const [id, lat, lng, assessed, year, propType, provenanceJson] = params;
        const target = rows.find((r) => r.id === id);
        if (target) {
          if (normalizedSql.includes('COALESCE($4, assessed_value)')) {
            target.lat = lat;
            target.lng = lng;
            target.assessed = target.assessed ?? assessed;
            target.year = target.year ?? year;
            target.propType = (target.propType && target.propType !== 'Unknown') ? target.propType : propType;
          } else {
            target.lat = lat;
            target.lng = lng;
            target.assessed = assessed;
            target.year = year;
            target.propType = propType;
          }
          target.provenance = JSON.parse(provenanceJson);
          updates.push({ kind: 'geo_or_nj', id, lat, lng, assessed });
        }
        return { rowCount: target ? 1 : 0, rows: [] };
      }
      if (normalizedSql.startsWith('UPDATE listings SET judgment_amount = COALESCE')) {
        const [id, judgment, provenanceJson] = params;
        const target = rows.find((r) => r.id === id);
        if (target) {
          target.judgment = target.judgment ?? judgment;
          target.provenance = JSON.parse(provenanceJson);
          updates.push({ kind: 'civilview', id, judgment });
        }
        return { rowCount: target ? 1 : 0, rows: [] };
      }
      if (normalizedSql.startsWith('SELECT') && normalizedSql.includes("county IS NULL OR BTRIM(county) = ''")) {
        const limit = Number(params[0]) || 40;
        return {
          rows: rows
            .filter((r) => (!r.county || !String(r.county).trim())
              && r.lat != null && r.lng != null && !(r.lat === 0 && r.lng === 0)
              && !r.provenance?.derivedFields?.countyLookupAttemptedAt)
            .slice(0, limit)
            .map((r) => ({ ...r })),
        };
      }
      if (normalizedSql.startsWith('UPDATE listings SET county = $2')) {
        const [id, county, provenanceJson] = params;
        const target = rows.find((r) => r.id === id);
        if (target) {
          target.county = county;
          target.provenance = JSON.parse(provenanceJson);
          updates.push({ kind: 'county_backfill', id, county });
        }
        return { rowCount: target ? 1 : 0, rows: [] };
      }
      if (normalizedSql.startsWith('UPDATE listings SET provenance = $2::jsonb')) {
        const [id, provenanceJson] = params;
        const target = rows.find((r) => r.id === id);
        if (target) {
          target.provenance = JSON.parse(provenanceJson);
          updates.push({ kind: 'county_lookup_attempted', id });
        }
        return { rowCount: target ? 1 : 0, rows: [] };
      }
      if (normalizedSql.startsWith('SELECT') && normalizedSql.includes('catch_summary IS NULL')) {
        const limit = Number(params[0]) || 250;
        return {
          rows: rows
            .filter((r) => r.catchSummary == null)
            .slice(0, limit)
            .map((r) => ({ ...r })), 
        };
      }
      if (normalizedSql.startsWith('UPDATE listings SET catch_summary = $2')) {
        const [id, summary] = params;
        const target = rows.find((r) => r.id === id);
        if (target) {
          target.catchSummary = summary;
          updates.push({ kind: 'catch_summary', id, summary });
        }
        return { rowCount: target ? 1 : 0, rows: [] };
      }
      throw new Error(`Unexpected SQL in fake pool: ${normalizedSql}`);
    },
  };
}

test('repairLiveEnrichment clears mismatched NJ situs parcel, backfills CivilView upset/judgment without fabricating openingBid, and Census-geocodes missing coords', async () => {
  const pool = makeFakePool([
    {
      id: 'CIV-NJ-10-2249533993',
      source: 'civilview',
      state: 'NJ',
      county: 'Hudson',
      city: 'NORTH BERGEN',
      zip: '07047',
      address: '1427 46TH STREET, NORTH BERGEN, NJ 07047',
      sourceUrl: 'https://salesweb.civilview.com/Sales/SaleDetails?PropertyId=2249533993',
      lat: 40.783149,
      lng: -74.029037,
      assessed: 705700,
      year: 1989,
      propType: 'Triplex',
      openingBid: null,
      judgment: null,
      raw: 'TAX LOT 38 BLOCK 153\nESTIMATED UPSET BID AMOUNT: $1,263,000.00\nCURRENT AMOUNT DUE: $312,000.00',
      sourceObservedAt: '2026-10-15T12:00:00.000Z',
      provenance: {
        origin: 'live',
        observed: true,
        recordKind: 'source_record',
        publisher: 'CivilView',
        recordId: '2249533993',
        observedAt: '2026-10-15T12:00:00.000Z',
        parcelKey: '34017-090815338',
        coordinates: { lat: 40.783149, lng: -74.029037 },
        derivedFields: {
          parcelKey: true,
          assessorRoll: {
            parcel: {
              situsAddress: '712 80TH ST',
              canonicalApn: '090815338',
              assessedValue: { total: 705700 },
            },
          },
        },
      },
    },
    {
      id: 'GSA-TX-101',
      source: 'gsa',
      state: 'TX',
      county: 'Travis',
      city: 'Austin',
      zip: '78701',
      address: '300 W 8TH ST',
      sourceUrl: 'https://realestatesales.gov/asset-details?property_id=101',
      lat: null,
      lng: null,
      assessed: null,
      year: null,
      propType: 'Commercial',
      openingBid: 50000,
      judgment: null,
      raw: 'Federal courthouse annex',
      sourceObservedAt: '2026-10-15T12:00:00.000Z',
      provenance: {
        origin: 'live',
        observed: true,
        recordKind: 'source_record',
        publisher: 'GSA',
        recordId: '101',
        observedAt: '2026-10-15T12:00:00.000Z',
      },
    },
  ]);

  const report = await repairLiveEnrichment({
    pool,
    dryRun: false,
    now: Date.parse('2026-11-10T00:00:00.000Z'),
    enrichNjListing: async (listing) => {
      if (listing.id === 'CIV-NJ-10-2249533993') {
        listing.lat = 40.779111;
        listing.lng = -74.021222;
        listing.assessed = 415000;
        listing.year = 1925;
        listing.propType = 'Single Family';
        listing.provenance.derivedFields = listing.provenance.derivedFields || {};
        listing.provenance.derivedFields.assessorRoll = {
          parcel: {
            situsAddress: '1427 46TH ST',
            canonicalApn: '090807412',
            assessedValue: { total: 415000 },
          },
        };
        listing.provenance.coordinates = {
          origin: 'geocoder',
          provider: 'NJGIN Cadastral Parcel Centroid',
          verification: 'exact_address_match',
          precision: 'parcel',
          sourceRecordUrl: listing.sourceUrl,
          observedAt: '2026-11-10T00:00:00.000Z',
          lat: 40.779111,
          lng: -74.021222,
          matchedAddress: {
            address: listing.address,
            city: listing.city,
            state: listing.state,
            zip: listing.zip,
          },
        };
      }
      return { found: true };
    },
    resolveCensusCoordinates: async ({ observedAddress }) => {
      if (observedAddress?.zip5 === '78701') {
        return { lat: 30.2706, lng: -97.7458, basis: 'source_observed_address_census_geocode' };
      }
      return null;
    },
  });

  assert.equal(report.njMismatchedFound, 1);
  assert.equal(report.njMismatchedCleared, 1);
  assert.equal(report.njReEnriched, 1);
  assert.equal(report.civilviewUpdated, 1);
  assert.equal(report.geocodedCount, 1);
  assert.equal(report.catchBackfilled, 2);

  const njRow = pool.rows.find((r) => r.id === 'CIV-NJ-10-2249533993');
  assert.equal(njRow.lat, 40.779111);
  assert.equal(njRow.assessed, 415000);
  assert.equal(njRow.provenance.derivedFields.assessorRoll.parcel.situsAddress, '1427 46TH ST');
  assert.equal(njRow.provenance.approximateUpsetPrice.amount, 1263000);
  assert.equal(njRow.judgment, 312000);
  assert.equal(njRow.openingBid, null, 'must never fabricate openingBid from upset or judgment');
  assert.equal(inspectMapLocation(njRow).accepted, true, 'NJ repaired coords must pass map policy');

  const gsaRow = pool.rows.find((r) => r.id === 'GSA-TX-101');
  assert.equal(gsaRow.lat, 30.2706);
  assert.equal(gsaRow.lng, -97.7458);
  assert.equal(inspectMapLocation(gsaRow).accepted, true, 'Census geocoded coords must pass map policy');
  assert.ok(typeof njRow.catchSummary === 'string' && njRow.catchSummary.includes('judgment'.toLowerCase()) || njRow.catchSummary.length > 0);
  assert.ok(typeof gsaRow.catchSummary === 'string' && gsaRow.catchSummary.includes('$50,000'));
});

test('POST /api/scrapers/run?action=repair-enrichment enforces SCRAPER_ADMIN_TOKEN and dispatches repairLiveEnrichment', async () => {
  let calledWith = null;
  const handler = createScrapersHandler({
    env: { SCRAPER_ADMIN_TOKEN: 'top-secret-token' },
    repairLiveEnrichment: async (opts) => {
      calledWith = opts;
      return { dryRun: opts.dryRun, njMismatchedCleared: 2, civilviewUpdated: 10, geocodedCount: 5 };
    },
  });

  const makeRes = () => ({
    statusCode: 200,
    body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  });

  const unauthRes = makeRes();
  await handler({ method: 'POST', url: '/api/scrapers/run?action=repair-enrichment', headers: {} }, unauthRes);
  assert.equal(unauthRes.statusCode, 401);
  assert.equal(calledWith, null);

  const authRes = makeRes();
  await handler({
    method: 'POST',
    url: '/api/scrapers/run?action=repair-enrichment&njLimit=15&geocodeLimit=25&dryRun=true',
    headers: { 'x-scraper-token': 'top-secret-token' },
    body: {},
  }, authRes);
  assert.equal(authRes.statusCode, 200);
  assert.equal(authRes.body.status, 'completed');
  assert.equal(authRes.body.action, 'repair-enrichment');
  assert.deepEqual(calledWith, { njLimit: 15, geocodeLimit: 25, dryRun: true });
  assert.equal(authRes.body.report.civilviewUpdated, 10);
});

test('purgeStaleListings purges vanished rows for fresh single-page federal sources and uses >=1000 observation batch size', async () => {
  const { DatabaseClient } = require('../server/db/client');
  const queries = [];
  const pool = {
    async query(sql, params = []) {
      const norm = sql.replace(/\s+/g, ' ').trim();
      queries.push({ sql: norm, params });
      if (norm.includes('SELECT DISTINCT source_key FROM listings')) {
        return { rows: [{ source_key: 'treasury' }] };
      }
      if (norm.includes('SELECT 1 FROM listings WHERE source_key =')) {
        return { rows: [{ '?column?': 1 }] };
      }
      if (norm.includes('SELECT 1 FROM pg_indexes')) {
        return { rows: [] };
      }
      return { rowCount: 0, rows: [] };
    },
  };
  const client = new DatabaseClient({ pool, liveCachePath: null, workspaceStorePath: null });
  client.isPg = true;
  await client.purgeStaleListings({ batchPauseMs: 0 });

  const fedCheck = queries.find((q) => q.sql.includes('SELECT DISTINCT source_key FROM listings'));
  assert.ok(fedCheck, 'expected fresh federal source lookup');
  assert.deepEqual(fedCheck.params[0], ['treasury', 'irs', 'gsa', 'usda']);

  const passB = queries.find((q) => q.sql.includes('DELETE FROM listings') && q.sql.includes('source_key = ANY($6::text[])'));
  assert.ok(passB, 'expected Pass B SQL to purge stale rows from fresh federal sources');
  assert.deepEqual(passB.params[5], ['treasury']);

  const obsDel = queries.find((q) => q.sql.includes('DELETE FROM source_observations') && q.sql.includes('observed_at < NOW()'));
  assert.ok(obsDel, 'expected source_observations retention delete query');
  assert.ok(Number(obsDel.params[2]) >= 1000, `expected obsBatchSize >= 1000, got ${obsDel.params[2]}`);
});

test('POST /api/scrapers/run?action=next-slice does not starve active sources by looping on recently-run zero-yield trustee', async () => {
  const now = Date.now();
  const isoAgo = (ms) => new Date(now - ms).toISOString();
  let capturedRun = null;
  const mockDb = {
    isPg: true,
    pool: {
      async query(sql) {
        const norm = sql.replace(/\s+/g, ' ').trim();
        if (norm.includes('FROM discovery_checkpoints')) return { rows: [] };
        if (norm.includes('FROM listings')) {
          return {
            rows: [
              { source_key: 'servicelink', latest_at: isoAgo(3.5 * 3600_000) },
              { source_key: 'hud', latest_at: isoAgo(30 * 60_000) },
              { source_key: 'sheriff', latest_at: isoAgo(3.5 * 3600_000) },
              { source_key: 'civilview', latest_at: isoAgo(30 * 60_000) },
              { source_key: 'gsa', latest_at: isoAgo(30 * 60_000) },
              { source_key: 'usda', latest_at: isoAgo(30 * 60_000) },
              { source_key: 'treasury', latest_at: isoAgo(3.5 * 3600_000) },
              { source_key: 'irs', latest_at: isoAgo(30 * 60_000) },
            ],
          };
        }
        if (norm.includes('FROM source_observation_runs')) {
          return {
            rows: [
              { source_key: 'trustee', last_run_at: isoAgo(5 * 60_000), accepted_count: 0 },
              { source_key: 'servicelink', last_run_at: isoAgo(3.5 * 3600_000), accepted_count: 1400 },
              { source_key: 'sheriff', last_run_at: isoAgo(3.5 * 3600_000), accepted_count: 280 },
              { source_key: 'treasury', last_run_at: isoAgo(3.5 * 3600_000), accepted_count: 8 },
            ],
          };
        }
        return { rows: [] };
      },
    },
  };
  const handler = createScrapersHandler({
    env: { SCRAPER_ADMIN_TOKEN: 'slice-guard-token' },
    database: mockDb,
    scheduler: {
      database: mockDb,
      async runAll(opts) {
        capturedRun = opts;
        return { totalIngested: 12 };
      },
    },
  });
  const res = {
    statusCode: 200,
    body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
  await handler({
    method: 'POST',
    url: '/api/scrapers/run',
    headers: { 'x-scraper-token': 'slice-guard-token' },
    body: { action: 'next-slice' },
  }, res);
  assert.equal(res.statusCode, 200);
  assert.notEqual(res.body.source, 'trustee', 'recently-run zero-yield trustee must not loop and starve active sources');
  assert.equal(res.body.source, 'servicelink', 'highest cadence-staleness ratio (3.5h/6h) must be selected next');
  assert.equal(capturedRun.scraperTimeoutMs, 25_000);
});

test('POST /api/scrapers/run?action=next-slice resumes active continuation cursor unless another source is genuinely overdue', async () => {
  const now = Date.now();
  const isoAgo = (ms) => new Date(now - ms).toISOString();
  const runNextSlice = async ({ gsaAgeMs, sheriffAgeMs }) => {
    const mockDb = {
      isPg: true,
      pool: {
        async query(sql) {
          const norm = sql.replace(/\s+/g, ' ').trim();
          if (norm.includes('FROM discovery_checkpoints')) {
            return { rows: [{ source_key: 'servicelink', cursor: '2', updated_at: isoAgo(5 * 60_000) }] };
          }
          if (norm.includes('FROM listings')) {
            return {
              rows: [
                { source_key: 'servicelink', latest_at: isoAgo(5 * 60_000) },
                { source_key: 'hud', latest_at: isoAgo(60 * 60_000) },
                { source_key: 'sheriff', latest_at: isoAgo(sheriffAgeMs) },
                { source_key: 'civilview', latest_at: isoAgo(60 * 60_000) },
                { source_key: 'gsa', latest_at: isoAgo(gsaAgeMs) },
                { source_key: 'usda', latest_at: isoAgo(60 * 60_000) },
                { source_key: 'treasury', latest_at: isoAgo(60 * 60_000) },
                { source_key: 'irs', latest_at: isoAgo(60 * 60_000) },
              ],
            };
          }
          if (norm.includes('FROM source_observation_runs')) {
            return {
              rows: [
                { source_key: 'trustee', last_run_at: isoAgo(10 * 60_000), accepted_count: 0 },
              ],
            };
          }
          return { rows: [] };
        },
      },
    };
    const handler = createScrapersHandler({
      env: { SCRAPER_ADMIN_TOKEN: 'cursor-guard-token' },
      database: mockDb,
      scheduler: { database: mockDb, async runAll() { return { totalIngested: 5 }; } },
    });
    const res = {
      statusCode: 200,
      body: null,
      status(c) { this.statusCode = c; return this; },
      json(b) { this.body = b; return this; },
    };
    await handler({
      method: 'POST',
      url: '/api/scrapers/run',
      headers: { 'x-scraper-token': 'cursor-guard-token' },
      body: { action: 'next-slice' },
    }, res);
    return res.body;
  };

  // Non-overdue 24h GSA (2h old) must NOT preempt ServiceLink's active multi-page sweep
  const resumedBody = await runNextSlice({ gsaAgeMs: 2 * 3600_000, sheriffAgeMs: 2 * 3600_000 });
  assert.equal(resumedBody.source, 'servicelink');
  assert.equal(resumedBody.reason, 'active_continuation_cursor');

  // Overdue 12h Sheriff (10h old -> 0.83 >= 0.75) MUST preempt so Sheriff does not go stale
  const preemptedBody = await runNextSlice({ gsaAgeMs: 2 * 3600_000, sheriffAgeMs: 10 * 3600_000 });
  assert.equal(preemptedBody.source, 'sheriff');
  assert.equal(preemptedBody.reason, 'oldest_observation');
});


test('GET /api/scrapers hydrates telemetry from Postgres when in-memory telemetry is cold', async () => {
  const coldTelemetry = {
    getHealthReport() {
      return {
        systemStatus: 'idle',
        snapshotEvidence: { mode: 'filesystem', ok: true },
        totalScrapers: 0,
        scrapersInFault: 0,
        scrapersChallengeGated: 0,
        scrapersWithDrift: 0,
        details: {},
      };
    },
  };
  const mockDb = {
    isPg: true,
    pool: {
      async query(sql) {
        const norm = sql.replace(/\s+/g, ' ').trim();
        if (norm.includes('FROM source_observation_runs')) {
          return {
            rows: [
              {
                source_key: 'servicelink',
                last_run_at: '2026-11-23T16:19:10.983Z',
                last_success_at: '2026-11-23T16:19:10.983Z',
                last_non_empty_at: '2026-11-23T16:19:10.983Z',
                accepted_count: 200,
                evidence_count: 200,
                rejected_count: 0,
                error: null,
                duration_ms: 18420,
                runs_count: 42,
              },
              {
                source_key: 'sheriff',
                last_run_at: '2026-11-23T08:56:01.436Z',
                last_success_at: '2026-11-23T08:00:00.000Z',
                last_non_empty_at: '2026-11-23T08:00:00.000Z',
                accepted_count: 0,
                evidence_count: 0,
                rejected_count: 0,
                error: 'secret-internal-stack-trace',
                duration_ms: 4100,
                runs_count: 9,
              },
            ],
          };
        }
        if (norm.includes('FROM listings') && norm.includes('discovery_is_live')) {
          return {
            rows: [
              { source_key: 'servicelink', active_listings: 2675 },
              { source_key: 'sheriff', active_listings: 295 },
            ],
          };
        }
        return { rows: [] };
      },
    },
  };

  const handler = createScrapersHandler({
    env: { SCRAPER_ADMIN_TOKEN: 'telemetry-secret' },
    database: mockDb,
    telemetry: coldTelemetry,
    scheduler: { database: mockDb, realScrapers: [] },
  });

  const unauthRes = {
    statusCode: 200,
    body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
  await handler({ method: 'GET', url: '/api/scrapers', headers: {} }, unauthRes);
  assert.equal(unauthRes.statusCode, 200);
  assert.equal(unauthRes.body.telemetrySource, 'postgres+memory');
  assert.equal(unauthRes.body.totalScrapers, 2);
  assert.equal(unauthRes.body.scrapersInFault, 1);
  assert.equal(unauthRes.body.systemStatus, 'degraded');
  assert.ok(Array.isArray(unauthRes.body.scrapers) && unauthRes.body.scrapers.length === 2);
  const sl = unauthRes.body.scrapers.find((s) => s.sourceKey === 'servicelink');
  const sh = unauthRes.body.scrapers.find((s) => s.sourceKey === 'sheriff');
  assert.equal(sl.activeListings, 2675);
  assert.equal(sl.recordsIngested, 200);
  assert.equal(sl.status, 'healthy');
  assert.equal(sh.status, 'error');
  assert.equal(sh.lastError, undefined, 'unauthenticated requests must omit internal lastError');

  const authRes = {
    statusCode: 200,
    body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
  await handler({ method: 'GET', url: '/api/scrapers', headers: { 'x-scraper-token': 'telemetry-secret' } }, authRes);
  const shAuth = authRes.body.scrapers.find((s) => s.sourceKey === 'sheriff');
  assert.equal(shAuth.lastError, 'secret-internal-stack-trace');
});

test('GET /api/scrapers and /api/scrapers/health classify INCONCLUSIVE_BLOCKED and DISCOVERY_ONLY sources without false degraded faults', async () => {
  const coldTelemetry = {
    getHealthReport() {
      return {
        systemStatus: 'idle',
        snapshotEvidence: { mode: 'filesystem', ok: true },
        totalScrapers: 0,
        scrapersInFault: 0,
        scrapersChallengeGated: 0,
        scrapersWithDrift: 0,
        details: {},
      };
    },
  };
  let treasuryError = null;
  const mockDb = {
    isPg: true,
    pool: {
      async query(sql) {
        const norm = sql.replace(/\s+/g, ' ').trim();
        if (norm.includes('FROM source_observation_runs')) {
          return {
            rows: [
              {
                source_key: 'servicelink',
                last_run_at: '2026-11-24T08:00:00.000Z',
                last_success_at: '2026-11-24T08:00:00.000Z',
                last_non_empty_at: '2026-11-24T08:00:00.000Z',
                accepted_count: 150,
                evidence_count: 150,
                rejected_count: 0,
                error: null,
                duration_ms: 9000,
                runs_count: 12,
              },
              {
                source_key: 'treasury',
                last_run_at: '2026-11-24T08:00:00.000Z',
                last_success_at: treasuryError ? '2026-11-23T08:00:00.000Z' : '2026-11-24T08:00:00.000Z',
                last_non_empty_at: '2026-11-24T08:00:00.000Z',
                accepted_count: treasuryError ? 0 : 4,
                evidence_count: treasuryError ? 0 : 4,
                rejected_count: 0,
                error: treasuryError,
                duration_ms: 2500,
                runs_count: 5,
              },
              {
                source_key: 'bid4assets',
                last_run_at: '2026-11-16T08:00:00.000Z',
                last_success_at: null,
                last_non_empty_at: null,
                accepted_count: 0,
                evidence_count: 0,
                rejected_count: 0,
                error: 'Blocked by upstream challenge',
                duration_ms: 1200,
                runs_count: 2,
              },
              {
                source_key: 'landbank',
                last_run_at: '2026-11-16T08:00:00.000Z',
                last_success_at: null,
                last_non_empty_at: null,
                accepted_count: 0,
                evidence_count: 0,
                rejected_count: 0,
                error: 'Turnstile verification required',
                duration_ms: 1100,
                runs_count: 2,
              },
              {
                source_key: 'ca-controller-tax-sale',
                last_run_at: '2026-11-16T08:00:00.000Z',
                last_success_at: null,
                last_non_empty_at: null,
                accepted_count: 0,
                evidence_count: 0,
                rejected_count: 0,
                error: 'Cloudflare challenge page',
                duration_ms: 950,
                runs_count: 1,
              },
              {
                source_key: 'fannie',
                last_run_at: '2026-11-16T08:00:00.000Z',
                last_success_at: null,
                last_non_empty_at: null,
                accepted_count: 0,
                evidence_count: 0,
                rejected_count: 0,
                error: 'SPA payload unparseable',
                duration_ms: 800,
                runs_count: 1,
              },
            ],
          };
        }
        if (norm.includes('FROM listings') && norm.includes('discovery_is_live')) {
          return {
            rows: [
              { source_key: 'servicelink', active_listings: 1200 },
              { source_key: 'treasury', active_listings: 4 },
            ],
          };
        }
        return { rows: [] };
      },
    },
  };

  const handler = createScrapersHandler({
    env: { SCRAPER_ADMIN_TOKEN: 'telemetry-secret' },
    database: mockDb,
    telemetry: coldTelemetry,
    scheduler: { database: mockDb, realScrapers: [] },
  });

  const makeRes = () => ({
    statusCode: 200,
    body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  });

  // 1. Healthy active collectors + gated/discovery-only stale rows -> nominal_gated, 0 fault
  for (const endpoint of ['/api/scrapers', '/api/scrapers/health']) {
    const res = makeRes();
    await handler({ method: 'GET', url: endpoint, headers: {} }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.scrapersInFault, 0);
    assert.equal(res.body.scrapersChallengeGated, 3);
    assert.equal(res.body.systemStatus, 'nominal_gated');

    const byKey = new Map(res.body.scrapers.map((s) => [s.sourceKey, s]));
    assert.equal(byKey.get('servicelink').status, 'healthy');
    assert.equal(byKey.get('treasury').status, 'healthy');
    assert.equal(byKey.get('bid4assets').status, 'challenge_gated');
    assert.equal(byKey.get('bid4assets').consecutiveFailures, 0);
    assert.equal(byKey.get('landbank').status, 'challenge_gated');
    assert.equal(byKey.get('landbank').consecutiveFailures, 0);
    assert.equal(byKey.get('ca-controller-tax-sale').status, 'challenge_gated');
    assert.equal(byKey.get('ca-controller-tax-sale').consecutiveFailures, 0);
    assert.equal(byKey.get('fannie').status, 'discovery_only');
    assert.equal(byKey.get('fannie').consecutiveFailures, 0);
  }

  // 2. Genuine active collector error on treasury must still report degraded and scrapersInFault=1
  treasuryError = 'HTTP 502 Bad Gateway';
  const degradedRes = makeRes();
  await handler({ method: 'GET', url: '/api/scrapers', headers: {} }, degradedRes);
  assert.equal(degradedRes.statusCode, 200);
  assert.equal(degradedRes.body.scrapersInFault, 1);
  assert.equal(degradedRes.body.scrapersChallengeGated, 3);
  assert.equal(degradedRes.body.systemStatus, 'degraded');
  const treasuryRow = degradedRes.body.scrapers.find((s) => s.sourceKey === 'treasury');
  assert.equal(treasuryRow.status, 'error');
  assert.equal(treasuryRow.consecutiveFailures, 1);
});


test('repairLiveEnrichment Pass 3b backfills missing HUD county and countyFips via Census TIGERweb', async () => {
  const pool = makeFakePool([
    {
      id: 'HUD-TX-48201',
      source: 'hud',
      state: 'TX',
      county: null,
      city: 'HOUSTON',
      zip: '77002',
      address: '100 Main St, Houston, TX 77002',
      sourceUrl: 'https://www.hudhomestore.gov/listing/HUD-TX-48201',
      lat: 29.7604,
      lng: -95.3698,
      propType: 'Single Family',
      raw: 'HUD REO',
      sourceObservedAt: '2026-11-22T00:00:00.000Z',
      provenance: {
        origin: 'live',
        observed: true,
        recordKind: 'source_record',
        publisher: 'HUD Home Store',
        recordId: 'HUD-TX-48201',
        observedAt: '2026-11-22T00:00:00.000Z',
      },
    },
    {
      id: 'HUD-MISS-000',
      source: 'hud',
      state: 'FL',
      county: null,
      city: 'MIAMI',
      zip: '33101',
      address: '200 Biscayne Blvd, Miami, FL 33101',
      sourceUrl: 'https://www.hudhomestore.gov/listing/HUD-MISS-000',
      lat: 25.7743,
      lng: -80.1937,
      propType: 'Single Family',
      raw: 'HUD REO',
      sourceObservedAt: '2026-11-22T00:00:00.000Z',
      provenance: {
        origin: 'live',
        observed: true,
        recordKind: 'source_record',
        publisher: 'HUD Home Store',
        recordId: 'HUD-MISS-000',
        observedAt: '2026-11-22T00:00:00.000Z',
      },
    },
  ]);

  const mockFetch = async (url) => {
    if (String(url).includes('tigerweb.geo.census.gov')) {
      if (String(url).includes('-95.3698')) {
        return {
          ok: true,
          async json() {
            return {
              features: [
                { attributes: { NAME: 'Harris County', BASENAME: 'Harris', STATE: '48', COUNTY: '201', GEOID: '48201' } },
              ],
            };
          },
        };
      }
      return { ok: true, async json() { return { features: [] }; } };
    }
    throw new Error(`Unexpected remote URL: ${url}`);
  };

  const report = await repairLiveEnrichment({
    pool,
    fetchFn: mockFetch,
    includeCatchBackfill: false,
    includeAssessorBackfill: false,
  });

  assert.equal(report.countyCandidates, 2);
  assert.equal(report.countyBackfilled, 1);
  assert.deepEqual(report.errors, []);

  const hitRow = pool.rows.find((r) => r.id === 'HUD-TX-48201');
  assert.equal(hitRow.county, 'Harris');
  assert.equal(hitRow.provenance.derivedFields.countyFips, '48201');
  assert.equal(hitRow.provenance.derivedFields.countySource, 'census-tigerweb-state-county');
  assert.ok(hitRow.provenance.derivedFields.countyLookupAttemptedAt);

  const missRow = pool.rows.find((r) => r.id === 'HUD-MISS-000');
  assert.equal(missRow.county, null);
  assert.ok(missRow.provenance.derivedFields.countyLookupAttemptedAt);
});


test('repairLiveEnrichment handles null Census geocode cleanly when resolveArcgisCoordinates is omitted', async () => {
  const pool = makeFakePool([
    {
      id: 'SL-NOCOORD-NULL',
      source: 'servicelink',
      state: 'TX',
      county: 'Harris',
      city: 'Houston',
      zip: '77002',
      address: '999 Missing Rd, Houston, TX 77002',
      sourceUrl: 'https://www.servicelinkauction.com/listing/SL-NOCOORD-NULL',
      lat: null,
      lng: null,
      propType: 'Single Family',
      raw: 'REO',
      sourceObservedAt: '2026-11-22T00:00:00.000Z',
      provenance: {
        origin: 'live',
        observed: true,
        recordKind: 'source_record',
        publisher: 'ServiceLink Auction',
        recordId: 'SL-NOCOORD-NULL',
        observedAt: '2026-11-22T00:00:00.000Z',
      },
    },
  ]);

  const report = await repairLiveEnrichment({
    pool,
    resolveCensusCoordinates: async () => null,
    includeCountyBackfill: false,
    includeCatchBackfill: false,
    includeAssessorBackfill: false,
  });

  assert.equal(report.geocodeCandidates, 1);
  assert.equal(report.geocodedCount, 0);
  assert.deepEqual(report.errors, []);
  const row = pool.rows.find((r) => r.id === 'SL-NOCOORD-NULL');
  assert.ok(row.provenance.derivedFields.geocodeAttemptedAt);
});

test('repairLiveEnrichment invokes backfillAssessorRolls before Pass 4 with default limit 35 and skips when <= 4s reserve remains', async () => {
  const pool = makeFakePool([
    {
      id: 'SH-OH-1',
      source: 'sheriff',
      state: 'OH',
      county: 'Cuyahoga',
      city: 'Cleveland',
      zip: '44114',
      address: '100 Public Square, Cleveland, OH 44114',
      sourceUrl: 'https://cuyahoga.sheriffsaleauction.com/listing/1',
      lat: 41.4993,
      lng: -81.6944,
      propType: 'Single Family',
      openingBid: null,
      raw: 'Sheriff sale',
      sourceObservedAt: '2026-11-22T00:00:00.000Z',
      provenance: { origin: 'live', observed: true },
    },
  ]);

  const callOrder = [];
  let capturedOpts = null;
  const origQuery = pool.query.bind(pool);
  pool.query = async (sql, params) => {
    if (String(sql).includes('catch_summary IS NULL')) callOrder.push('pass4_catch');
    return origQuery(sql, params);
  };
  const fakeDb = {
    pool,
    async getListings() { return { total: 0, listings: [] }; },
    async createListing(l) { return l; },
  };

  const report = await repairLiveEnrichment({
    db: fakeDb,
    pool,
    includeCountyBackfill: false,
    maxDurationMs: 20_000,
    wallClock: () => 1_000,
    backfillAssessorRolls: async (opts) => {
      callOrder.push('assessor_backfill');
      capturedOpts = opts;
      return { considered: 1, harvested: 1, persisted: 1 };
    },
  });

  assert.deepEqual(callOrder, ['assessor_backfill', 'pass4_catch']);
  assert.equal(capturedOpts.limit, 35);
  assert.equal(capturedOpts.maxDurationMs, 16_000, 'must reserve 4s for Pass 4');
  assert.equal(report.assessorBackfill.harvested, 1);
  assert.equal(report.catchBackfilled, 1);

  // When only 3.5s remains (< 4s reserve), assessor backfill must be skipped so Pass 4 still runs.
  let tick = 0;
  let skippedCalls = 0;
  const pool2 = makeFakePool([
    {
      id: 'SH-OH-2',
      source: 'sheriff',
      state: 'OH',
      county: 'Cuyahoga',
      city: 'Cleveland',
      zip: '44114',
      address: '200 Public Square, Cleveland, OH 44114',
      sourceUrl: 'https://cuyahoga.sheriffsaleauction.com/listing/2',
      lat: 41.5,
      lng: -81.7,
      propType: 'Single Family',
      openingBid: null,
      raw: 'Sheriff sale',
      sourceObservedAt: '2026-11-22T00:00:00.000Z',
      provenance: { origin: 'live', observed: true },
    },
  ]);
  const reserveReport = await repairLiveEnrichment({
    db: { pool: pool2, async getListings() { return { total: 0, listings: [] }; }, async createListing(l) { return l; } },
    pool: pool2,
    includeCountyBackfill: false,
    maxDurationMs: 20_000,
    wallClock: () => {
      tick += 1;
      // startedAt = 0; jump to 16500ms after initial checks so 3500ms remains before Pass 3c
      return tick <= 1 ? 0 : 16_500;
    },
    backfillAssessorRolls: async () => {
      skippedCalls += 1;
      return { considered: 0, harvested: 0 };
    },
  });
  assert.equal(skippedCalls, 0, 'assessor backfill must skip when <= 4s reserve remains');
  assert.equal(reserveReport.catchBackfilled, 1, 'Pass 4 must still run within its 4s reserve');
});

test('repairLiveEnrichment caps DEFAULT_GEOCODE_LIMIT to 25 and yields Census geocoding early under tight maxDurationMs so Pass 3c runs', async () => {
  const rows = [];
  for (let i = 1; i <= 30; i += 1) {
    rows.push({
      id: `SL-GEO-${i}`,
      source: 'servicelink',
      state: 'TX',
      county: 'Travis',
      city: 'Austin',
      zip: '78701',
      address: `${100 + i} Congress Ave, Austin, TX 78701`,
      sourceUrl: `https://www.servicelinkauction.com/listing/${i}`,
      lat: null,
      lng: null,
      propType: 'Single Family',
      openingBid: 100000,
      raw: 'REO',
      sourceObservedAt: '2026-11-22T00:00:00.000Z',
      provenance: { origin: 'live', observed: true },
    });
  }
  const pool = makeFakePool(rows);
  let capturedGeocodeLimit = null;
  const origQuery = pool.query.bind(pool);
  pool.query = async (sql, params) => {
    if (String(sql).includes('latitude IS NULL OR longitude IS NULL')) {
      capturedGeocodeLimit = Number(params[0]);
    }
    return origQuery(sql, params);
  };

  let nowTick = 0;
  let assessorCalled = false;
  let assessorOpts = null;
  const report = await repairLiveEnrichment({
    db: {
      pool,
      async getListings() { return { total: 0, listings: [] }; },
      async createListing(l) { return l; },
    },
    pool,
    maxDurationMs: 12_000,
    wallClock: () => nowTick,
    includeCountyBackfill: false,
    includeCatchBackfill: false,
    resolveCensusCoordinates: async () => {
      // Advance clock by 2000ms per lookup; 45% of 12_000ms is 5_400ms -> yields after ~3 calls
      nowTick += 2_000;
      return { lat: 30.2672, lng: -97.7431, basis: 'source_observed_address_census_geocode' };
    },
    backfillAssessorRolls: async (opts) => {
      assessorCalled = true;
      assessorOpts = opts;
      return { considered: 1, harvested: 1, persisted: 1 };
    },
  });

  assert.equal(capturedGeocodeLimit, 25, 'DEFAULT_GEOCODE_LIMIT must default to 25');
  assert.equal(report.geocodeCandidates, 25);
  assert.ok(report.geocodedCount > 0 && report.geocodedCount < 10, `expected Pass 2 to yield early, got ${report.geocodedCount}`);
  assert.equal(assessorCalled, true, 'Pass 3c backfillAssessorRolls must execute after Pass 2 yields early');
  assert.ok(assessorOpts.maxDurationMs >= 2_000, `expected assessor reserve > 0, got ${assessorOpts.maxDurationMs}`);
});

test('POST /api/scrapers/run?action=repair-enrichment forwards bounded assessorLimit and countyLimit', async () => {
  let calledWith = null;
  const handler = createScrapersHandler({
    env: { SCRAPER_ADMIN_TOKEN: 'top-secret-token' },
    repairLiveEnrichment: async (opts) => {
      calledWith = opts;
      return { dryRun: opts.dryRun };
    },
  });
  const makeRes = () => ({
    statusCode: 200,
    body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  });

  const res1 = makeRes();
  await handler({
    method: 'POST',
    url: '/api/scrapers/run?action=repair-enrichment&assessorLimit=75&countyLimit=500&safmrLimit=30&spatialLimit=0',
    headers: { 'x-scraper-token': 'top-secret-token' },
    body: { countyLimit: 250 },
  }, res1);
  assert.equal(res1.statusCode, 200);
  assert.deepEqual(calledWith, {
    assessorLimit: 75,
    countyLimit: 200,
    safmrLimit: 30,
    dryRun: false,
  });
});
