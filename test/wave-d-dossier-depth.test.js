'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { buildPublicRecordEvidence } = require('../server/public-records');
const { createPropertyIntelligenceHandler } = require('../server/routes/property-intelligence');
const { loadPeerListingsForDeedComps } = require('../server/enrichment/deed-comps');
const { buildPropertyDossier } = require('../server/intelligence/dossier');
const { resolveMunicipalPortal, parseCodeViolationsResponse } = require('../server/enrichment/code-enforcement');
const { IngestionScheduler } = require('../server/scrapers/scheduler');
const { messageToPackets } = require('../server/scrapers/email-ingest');
const { GsaSurplusScraper } = require('../server/scrapers/gsa');
const legalRules = require('../server/ai/legal-rules');
const cashToClose = require('../server/intelligence/cash-to-close');
const { backfillAssessorRolls } = require('../server/enrichment/assessor-backfill');
const { applyHarvest } = require('../server/enrichment/assessor-harvest');

const NOW = Date.now();
const observedAt = new Date(NOW - 3600_000).toISOString();

function liveEmailListing(overrides = {}) {
  return {
    id: 'CIV-NJ-TEST-100',
    source: 'civilview',
    state: 'NJ',
    county: 'Bergen',
    city: 'Park Ridge',
    zip: '07656',
    address: '19 West Park Avenue, Park Ridge, NJ 07656',
    lat: 41.035,
    lng: -74.035,
    openingBid: 100000,
    saleDate: '2027-10-01',
    status: 'scheduled',
    propType: 'Single Family',
    sqft: 1200,
    assessed: 180000,
    raw: 'Block 101 Lot 5',
    sourceUrl: 'https://salesweb.civilview.com/Sales/SaleDetails?PropertyId=2128964683',
    sourceObservedAt: observedAt,
    provenance: {
      origin: 'email_notice',
      observed: true,
      recordKind: 'source_record',
      publisher: 'CivilView',
      recordId: '2128964683',
      observedAt,
    },
    ...overrides,
  };
}

test('I2: buildPublicRecordEvidence accepts email_notice and dispatches enrolled non-FL cadastral + municipal lookups', async () => {
  const listing = liveEmailListing({
    id: 'NJ-ENROLLED-1',
    state: 'NJ',
    county: 'Bergen',
    city: 'Park Ridge',
    apn: '0247-00101-00005',
  });
  const fetchImpl = async (url) => {
    const s = String(url);
    if (s.includes('maps.nj.gov')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          features: [{
            attributes: {
              PAMS_PIN: '0247-00101-00005',
              PROP_LOC: '19 WEST PARK AVE',
              NET_VALUE: 420000,
              LAND_VAL: 150000,
              IMPRVT_VAL: 270000,
              PROP_CLASS: '2',
            },
          }],
        }),
      };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };

  const result = await buildPublicRecordEvidence(listing, {
    allowNetwork: true,
    apiKey: null,
    fetchImpl,
  });

  assert.equal(result.issueCodes.includes('SOURCE_OBSERVATION_REQUIRED'), false);
  assert.equal(result.issueCodes.includes('PARCEL_STATE_NOT_CONFIGURED'), false);
  assert.ok(result.parcel, 'expected NJ enrolled cadastral parcel lookup result');
  assert.equal(result.parcel.status, 'matched');
  assert.equal(result.parcel.canonicalApn, '02470010100005');
  assert.equal(result.parcel.assessedValue.total, 420000);
});

test('I2: POST /api/property-intelligence runs network-enabled DAG once and serves cached result on authorized GET', async () => {
  const listing = liveEmailListing({
    id: 'CIV-NJ-DAG-1',
    provenance: {
      origin: 'live',
      observed: true,
      recordKind: 'source_record',
      publisher: 'CivilView',
      recordId: '2128964683',
      observedAt,
    },
  });
  let dagCalls = 0;
  let lastAllowNetwork = null;
  const handler = createPropertyIntelligenceHandler({
    database: { getListingById: async () => listing },
    buildPublicRecordEvidence: async () => ({ parcel: null, areaContext: null, issues: [], sources: [] }),
    allowDagNetwork: true,
    executeDag: async (_ctx, opts) => {
      dagCalls += 1;
      lastAllowNetwork = opts.allowNetwork;
      return {
        success: true,
        context: { dossier: { address: listing.address, codeEnforcement: { openViolations: 0 } } },
        telemetry: { totalDurationMs: 12, completedNodes: ['geocode'], failedNodes: [], skippedNodes: [] },
      };
    },
    env: { SCRAPER_ADMIN_TOKEN: 'op-secret' },
  });

  const makeRes = () => ({
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.statusCode = c; return this; },
    json(v) { this.body = v; return this; },
  });

  const postRes = makeRes();
  await handler({
    method: 'POST',
    url: `/api/property-intelligence?listingId=${listing.id}`,
    body: { listingId: listing.id },
    headers: { authorization: 'Bearer op-secret' },
  }, postRes);

  assert.equal(postRes.statusCode, 200);
  assert.equal(dagCalls, 1);
  assert.equal(lastAllowNetwork, true);
  assert.equal(postRes.body.enrichmentExecution.success, true);

  const getRes = makeRes();
  await handler({
    method: 'GET',
    url: `/api/property-intelligence?listingId=${listing.id}`,
    headers: { authorization: 'Bearer op-secret' },
  }, getRes);

  assert.equal(getRes.statusCode, 200);
  assert.equal(dagCalls, 1, 'authorized GET should reuse cached DAG execution');
  assert.equal(getRes.body.enrichmentExecution.success, true);
});

test('I3: loadPeerListingsForDeedComps feeds Postgres peer parcels into buildPropertyDossier L2 deedComps', async () => {
  const subject = liveEmailListing({
    id: 'NJ-SUBJ-1',
    state: 'NJ',
    county: 'Bergen',
    zip: '07656',
    provenance: {
      origin: 'live',
      observed: true,
      recordKind: 'source_record',
      publisher: 'CivilView',
      recordId: '2128964683',
      observedAt,
    },
  });
  const recentSaleDate = new Date(NOW - 60 * 86400_000).toISOString().slice(0, 10);
  const fakePool = {
    async query() {
      return {
        rows: [
          { id: 'PEER-1', state: 'NJ', county: 'Bergen', city: 'Park Ridge', zip: '07656', address: '10 Oak St', sqft: 1500, assessor_parcel: { situsAddress: '10 Oak St', lastSalePrice: 300000, lastSaleDate: recentSaleDate, nuCode: '00', livingAreaSqft: 1500 } },
          { id: 'PEER-2', state: 'NJ', county: 'Bergen', city: 'Park Ridge', zip: '07656', address: '12 Oak St', sqft: 1600, assessor_parcel: { situsAddress: '12 Oak St', lastSalePrice: 320000, lastSaleDate: recentSaleDate, nuCode: '00', livingAreaSqft: 1600 } },
          { id: 'PEER-3', state: 'NJ', county: 'Bergen', city: 'Park Ridge', zip: '07656', address: '14 Oak St', sqft: 1700, assessor_parcel: { situsAddress: '14 Oak St', lastSalePrice: 340000, lastSaleDate: recentSaleDate, nuCode: '00', livingAreaSqft: 1700 } },
          { id: 'PEER-NU', state: 'NJ', county: 'Bergen', city: 'Park Ridge', zip: '07656', address: '16 Oak St', sqft: 1700, assessor_parcel: { situsAddress: '16 Oak St', lastSalePrice: 100, lastSaleDate: recentSaleDate, nuCode: '10', livingAreaSqft: 1700 } },
        ],
      };
    },
  };

  const peerListings = await loadPeerListingsForDeedComps(fakePool, subject);
  assert.equal(peerListings.length, 4);

  const dossier = buildPropertyDossier(subject, { peerListings, now: NOW });
  assert.equal(dossier.publicBenchmarks.deedComps.available, true);
  assert.equal(dossier.publicBenchmarks.deedComps.sampleSize, 3);
  assert.equal(dossier.publicBenchmarks.deedComps.medianSalePrice, 320000);
  assert.equal(dossier.publicBenchmarks.deedComps.medianPricePerSqft, 200);
});

test('I16: socrata-code-enforcement, collector-registry, la-recorder, gsa-api, and cash-to-close are wired', async () => {
  // 1. Socrata LA portal wired into code-enforcement.js
  const laPortal = resolveMunicipalPortal({ state: 'CA', city: 'Los Angeles' });
  assert.equal(laPortal?.source, 'SOCRATA_LOS_ANGELES');
  const parsedLaCe = parseCodeViolationsResponse([{ address: '100 Main St', order_type: 'Unsafe Structure Order', status: 'OPEN', effective_date: '2026-10-01', fees_assessed: '450' }], laPortal);
  assert.equal(parsedLaCe.openViolationsCount, 1);
  assert.equal(parsedLaCe.hasDemolitionRisk, true);

  // 2. CollectorRegistry wired into ScraperScheduler
  const fakeScraper = {
    name: 'FakeCollector',
    sourceKey: 'hud',
    async scrapeFeed() { return []; },
  };
  const scheduler = new IngestionScheduler({ realScrapers: [fakeScraper], gateBlocked: false });
  const telem = scheduler.getCollectorRegistryTelemetry();
  assert.ok(telem.hud);
  assert.equal(telem.hud.sourceKey, 'hud');

  // 3. LA Recorder wired into email-ingest
  const laEmail = messageToPackets({
    subject: 'Los Angeles Notice of Trustee Sale TS# 2026-9910',
    from: 'notices@example.org',
    body: 'Los Angeles County Notice of Trustee Sale. AIN: 5001-001-002. T.S. No. 2026-9910. Recorded 10/15/2026.',
  }, { observedAt });
  assert.equal(laEmail.matched, true);
  assert.equal(laEmail.packets[0].fields.apn, '5001-001-002');
  assert.ok(laEmail.packets[0].fields.caseNumber);
  assert.equal(laEmail.packets[0].fields.county, 'Los Angeles');
  assert.equal(laEmail.packets[0].fields.state, 'CA');

  // 4. GSA Open-Data API wired as default augmentation alongside disposition list
  const gsa = new GsaSurplusScraper({
    useScrapling: false,
    enableOpenDataAugment: true,
    apiFetchImpl: async () => JSON.stringify({
      auctions: [{
        auctionNumber: 'GSA-API-101',
        propertyType: 'Real Estate',
        propertyDescription: 'Commercial Building 4,000 sq ft at 500 Federal Plaza, Dallas, TX 75201',
        itemStreet: '500 Federal Plaza',
        itemCity: 'Dallas',
        itemState: 'TX',
        itemZip: '75201',
        openingBid: 250000,
      }],
    }),
  });
  gsa.collectDispositionList = async () => {
    gsa.lastRunReport = { outcome: 'empty', recordsDiscovered: 0, recordsEmitted: 0, recordsRejected: 0, complete: true, fullSweepComplete: true };
    return [];
  };
  const prevRespect = process.env.SCRAPER_RESPECT_ROBOTS;
  delete process.env.SCRAPER_RESPECT_ROBOTS;
  try {
    const gsaItems = await gsa.scrapeFeed();
    assert.equal(gsaItems.length, 1);
    assert.equal(gsaItems[0].id, 'GSA-TX-GSA-API-101-75201');
    assert.equal(gsa.lastRunReport.openDataApiAugmented, true);
    assert.equal(gsa.lastRunReport.openDataApiCount, 1);
  } finally {
    if (prevRespect !== undefined) process.env.SCRAPER_RESPECT_ROBOTS = prevRespect;
  }

  // 5. cash-to-close merged into legal-rules.js
  assert.equal(legalRules.calculateCompleteCashToClose, cashToClose.calculateCompleteCashToClose);
  assert.equal(legalRules.JURISDICTION_FEE_SCHEDULES, cashToClose.JURISDICTION_FEE_SCHEDULES);
  const ctc = legalRules.calculateCompleteCashToClose({ winningBid: 100000, state: 'OH' });
  assert.ok(ctc.totalAcquisitionCost > 100000);
});

test('I17: backfillAssessorRolls prioritizes HUD rows missing specs and applyHarvest populates specs without fabricating openingBid', async () => {
  const hudRow = {
    id: 'HUD-123-456789',
    source: 'hud',
    state: 'FL',
    county: 'Orange',
    lat: 28.54,
    lng: -81.38,
    assessed: null,
    sqft: null,
    year: null,
    openingBid: null,
    provenance: { origin: 'live', observed: true, recordId: '123-456789' },
  };
  const otherRow = {
    id: 'CIV-FL-1',
    source: 'civilview',
    state: 'FL',
    county: 'Orange',
    lat: 28.55,
    lng: -81.39,
    assessed: 200000,
    sqft: 1500,
    year: 1998,
    provenance: { origin: 'live', observed: true, recordId: '1' },
  };
  const fakeDb = {
    async getListings(filters = {}) {
      if (filters.source === 'hud') return { listings: [hudRow] };
      if (filters.state === 'FL') return { listings: [otherRow, hudRow] };
      return { listings: [] };
    },
    async createListing() {},
  };

  // Verify applyHarvest populates specs without touching openingBid
  applyHarvest(
    { listing: hudRow, countyKey: 'FL-ORANGE', cleanApn: '123456' },
    {
      source: 'Florida DOR',
      countyFips: '12095',
      countyName: 'Orange',
      rawApn: '12-34-56',
      canonicalApn: '123456',
      assessedValue: { total: 265000, land: 65000, improvements: 200000 },
      rawAttributes: { TOT_LVG_AR: 1840, ACT_YR_BLT: 2004, SALE_PRC1: 280000, SALE_YR1: 2025, SALE_MO1: 9, QUAL_CD1: '01' },
    },
    observedAt,
  );
  assert.equal(hudRow.assessed, 265000);
  assert.equal(hudRow.sqft, 1840);
  assert.equal(hudRow.year, 2004);
  assert.equal(hudRow.openingBid, null);
  assert.equal(hudRow.provenance.derivedFields.assessorRoll.parcel.lastSalePrice, 280000);
  assert.equal(hudRow.provenance.derivedFields.assessorRoll.parcel.lastSaleDate, '2025-09-01');

  // Verify backfillAssessorRolls prioritizes HUD row before otherRow when both lack rolls
  const hudUnrolled = { ...hudRow, assessed: null, sqft: null, year: null, assessorParcel: null, provenance: { origin: 'live', observed: true, recordId: '123-456789' } };
  const persistedIds = [];
  const hudFirstDb = {
    async getListings(filters = {}) {
      if (filters.source === 'hud') return { listings: [hudUnrolled] };
      if (filters.state === 'FL') return { listings: [otherRow, hudUnrolled] };
      return { listings: [] };
    },
    async createListing(row) { persistedIds.push(row.id); },
  };
  const tmpCache = path.join(os.tmpdir(), `wave-d-assessor-${process.pid}-${Date.now()}.json`);
  try {
    const backfillRes = await backfillAssessorRolls({
      db: hudFirstDb,
      limit: 1,
      cachePath: tmpCache,
      fetchFn: async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          features: [{
            attributes: { PARCEL_ID: '12-34-56', JV: 210000, LND_VAL: 60000, TOT_LVG_AR: 1600, ACT_YR_BLT: 2001, PHY_ADDR1: '100 HUD ST' },
          }],
        }),
      }),
    });
    assert.equal(backfillRes.considered, 1);
    assert.deepEqual(persistedIds, ['HUD-123-456789']);
  } finally {
    fs.rmSync(tmpCache, { force: true });
  }
});
