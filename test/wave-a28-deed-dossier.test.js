'use strict';

const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const test = require('node:test');

const { createUnderwriteHandler } = require('../server/routes/underwrite');
const { applyHarvest } = require('../server/enrichment/assessor-harvest');
const { buildPropertyDossier } = require('../server/intelligence/dossier');
const { createPropertyIntelligenceHandler } = require('../server/routes/property-intelligence');

function makeReq(method, url, body = null) {
  const raw = body ? JSON.stringify(body) : '';
  const stream = Readable.from(raw ? [Buffer.from(raw)] : []);
  stream.method = method;
  stream.url = url;
  stream.headers = {
    'content-type': 'application/json',
    'content-length': String(Buffer.byteLength(raw)),
  };
  return stream;
}

function makeRes() {
  return {
    statusCode: 200,
    payload: null,
    headers: {},
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
    end() {
      return this;
    },
  };
}

test('POST /api/underwrite passes database.pool to loadPeerListingsForDeedComps and produces n >= 3 qualified deed comps', async () => {
  const queryCalls = [];
  const peerRows = [
    {
      id: 'peer-1',
      state: 'NJ',
      county: 'Essex',
      city: 'Newark',
      zip: '07102',
      address: '101 Broad St, Newark, NJ 07102',
      sqft: 1500,
      assessor_parcel: {
        lastSalePrice: 320000,
        lastSaleDate: '2026-08-15',
        livingAreaSqft: 1500,
        nuCode: '00',
      },
    },
    {
      id: 'peer-2',
      state: 'NJ',
      county: 'Essex',
      city: 'Newark',
      zip: '07102',
      address: '202 Market St, Newark, NJ 07102',
      sqft: 1600,
      assessor_parcel: {
        lastSalePrice: 350000,
        lastSaleDate: '2026-07-10',
        livingAreaSqft: 1600,
        nuCode: '00',
      },
    },
    {
      id: 'peer-3',
      state: 'NJ',
      county: 'Essex',
      city: 'Newark',
      zip: '07102',
      address: '303 Raymond Blvd, Newark, NJ 07102',
      sqft: 1450,
      assessor_parcel: {
        lastSalePrice: 305000,
        lastSaleDate: '2026-06-20',
        livingAreaSqft: 1450,
        nuCode: '00',
      },
    },
  ];

  const pool = {
    async query(sql, params) {
      queryCalls.push({ sql, params });
      return { rows: peerRows };
    },
  };
  const database = { isPg: true, pool };

  const handler = createUnderwriteHandler({
    database,
    now: () => new Date('2026-11-26T12:00:00Z'),
  });

  const req = makeReq('POST', '/api/underwrite', {
    address: '50 Park Pl, Newark, NJ 07102',
    state: 'NJ',
    county: 'Essex',
    zip: '07102',
    openingBid: 180000,
    assessed: 280000,
  });
  const res = makeRes();

  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(queryCalls.length, 1, 'pool.query must be called once via database.pool');
  assert.equal(queryCalls[0].params[0], 'NJ');
  assert.equal(queryCalls[0].params[2], '07102');

  const deedComps = res.payload?.publicBenchmarks?.consensus?.deedComps;
  assert.ok(deedComps, 'publicBenchmarks.deedComps must be populated');
  assert.equal(deedComps.available, true);
  assert.ok(deedComps.sampleSize >= 3, `Expected sampleSize >= 3 qualified deed comps, got ${deedComps.sampleSize}`);
  assert.equal(deedComps.medianSalePrice, 320000);
});

test('assessor-harvest applyHarvest preserves recordedSalePrice, deedDate, and SALES_CODE -> nuCode on durableParcel', () => {
  const listing = {
    id: 'nj-essex-1',
    state: 'NJ',
    county: 'Essex',
    provenance: {},
  };
  const candidate = {
    listing,
    countyKey: 'nj-essex',
    cleanApn: '01-00010-0000-00001',
  };
  const parcel = {
    source: 'arcgis_rest',
    countyFips: '34013',
    countyName: 'Essex',
    rawApn: '01-00010-0000-00001',
    canonicalApn: '01-00010-0000-00001',
    recordedSalePrice: 415000,
    deedDate: '2026-05-12',
    rawAttributes: {
      SALES_CODE: '00',
    },
    assessedValue: { total: 350000, land: 120000, improvements: 230000 },
  };

  applyHarvest(candidate, parcel, '2026-11-26T12:00:00Z');

  const durableParcel = listing.provenance.derivedFields.assessorRoll.parcel;
  assert.equal(durableParcel.lastSalePrice, 415000);
  assert.equal(durableParcel.recordedSalePrice, 415000);
  assert.equal(durableParcel.lastSaleDate, '2026-05-12');
  assert.equal(durableParcel.deedDate, '2026-05-12');
  assert.equal(durableParcel.nuCode, '00');
});

test('HUD/GSA/USDA REO listings emit docketClearingAnalytics === null while civilview/sheriff emit it when countyStats is present', async () => {
  const sampleCountyStats = {
    totalDockets: 120,
    outcomeCounts: {
      sold_plaintiff: 34,
      sold_third_party: 20,
      adjourned: 42,
      dismissed: 24,
    },
    saleRate: 0.45,
    sampleSufficient: true,
  };

  for (const source of ['hud', 'gsa', 'usda']) {
    const dossier = buildPropertyDossier(
      {
        id: `${source}-1`,
        source,
        state: 'NJ',
        county: 'Essex',
        address: '10 Main St, Newark, NJ 07102',
        historicalEvents: [
          { status: 'proceeded' },
          { status: 'adjourned' },
        ],
      },
      {
        countyStats: sampleCountyStats,
        historyUnavailable: true,
      }
    );
    assert.equal(dossier.docketClearingAnalytics, null, `${source} dossier must set docketClearingAnalytics === null`);
  }

  for (const source of ['civilview', 'sheriff']) {
    const dossier = buildPropertyDossier(
      {
        id: `${source}-1`,
        source,
        state: 'NJ',
        county: 'Essex',
        address: '10 Main St, Newark, NJ 07102',
      },
      {
        countyStats: sampleCountyStats,
        historyUnavailable: true,
      }
    );
    assert.deepEqual(dossier.docketClearingAnalytics, sampleCountyStats, `${source} dossier must keep docketClearingAnalytics`);
  }

  // Handler verification: HUD skips loadCountyObservationStats and emits null; civilview calls it and emits analytics
  for (const [source, expectLoaded] of [['hud', false], ['civilview', true]]) {
    let loaderCalled = false;
    const listing = {
      id: `${source}-handler-1`,
      source,
      state: 'NJ',
      county: 'Essex',
      zip: '07102',
      address: '20 Elm St, Newark, NJ 07102',
      provenance: { origin: 'live', observedAt: '2026-11-20T00:00:00Z' },
    };
    const handler = createPropertyIntelligenceHandler({
      database: {
        isPg: true,
        pool: { async query() { return { rows: [] }; } },
        async getListingById() { return listing; },
      },
      durableEvidence: {
        async readResearch() { return null; },
        async loadEvidence() { return { observations: { records: {}, signals: [] } }; },
      },
      loadCountyObservationStats: async () => {
        loaderCalled = true;
        return sampleCountyStats;
      },
      loadPeerListingsForDeedComps: async () => [],
    });

    const req = makeReq('GET', `/api/property-intelligence?listingId=${listing.id}`);
    const res = makeRes();
    await handler(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(loaderCalled, expectLoaded, `${source} loadCountyObservationStats called=${loaderCalled}`);
    if (expectLoaded) {
      assert.deepEqual(res.payload.docketClearingAnalytics, sampleCountyStats);
    } else {
      assert.equal(res.payload.docketClearingAnalytics, null);
    }
  }
});
