'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const test = require('node:test');

const { startEmbeddedPostgres } = require('../server/db/pglite-pool');
const { migrate } = require('../scripts/discovery-migrate');
const { DatabaseClient } = require('../server/db/client');
const discovery = require('../server/discovery/query');
const { aggregateByParcelKey } = require('../server/intelligence/enrichment-gateway');
const { createSourceNetworkHandler } = require('../server/routes/source-network');

const BOOT_TIMEOUT_MS = 120_000;

test('parcelKey lookup and provenance upsert keep canonical NJ assessor keys queryable across raw refreshes', { timeout: BOOT_TIMEOUT_MS * 2 }, async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-audit-parcelkey-'));
  try {
    const embedded = await startEmbeddedPostgres({ dataDir });
    await migrate(embedded.pool);
    const pg = new DatabaseClient({ pool: embedded.pool, liveCachePath: null, workspaceStorePath: null });

    // Case 1: Legacy/desynced DB row where provenance.parcelKey holds raw lot/block
    // while derivedFields.assessorRoll carries canonical MOD-IV PAMS PIN.
    await pg.createListing({
      id: 'CIV-NJ-TEST-DESYNC',
      source: 'civilview',
      status: 'scheduled',
      state: 'NJ',
      county: 'Hudson',
      address: '22 BRIGHT ST #2',
      openingBid: 100000,
      sourceObservedAt: '2026-11-10T00:00:00.000Z',
      parcelKey: '34017-LOT36BLOCK14106',
      provenance: {
        origin: 'live',
        observed: true,
        parcelKey: '34017-LOT36BLOCK14106',
        parcelNumber: 'Lot 36, Block 14106',
        derivedFields: {
          assessorRoll: {
            apn: '09061410636C0002',
            parcel: {
              countyFips: '34017',
              canonicalApn: '09061410636C0002',
              rawApn: '0906_14106_36_C0002',
            },
          },
        },
      },
    });

    const view = await aggregateByParcelKey('34017-09061410636C0002', { database: pg });
    assert.equal(view.found, true, 'must resolve canonical MOD-IV parcelKey even when provenance.parcelKey holds lot/block');
    assert.equal(view.listingCount, 1);
    assert.equal(view.sources[0].listingIds[0], 'CIV-NJ-TEST-DESYNC');

    const negative = await aggregateByParcelKey('34003-09061410636C0002', { database: pg });
    assert.equal(negative.found, false, 'different county FIPS must not collide');

    // Case 2: Subsequent raw scraper upsert must NOT overwrite canonical cadastral provenance.parcelKey
    await pg.createListing({
      id: 'CIV-NJ-TEST-KEEP',
      source: 'civilview',
      state: 'NJ',
      county: 'Hudson',
      address: '24 BRIGHT ST',
      openingBid: 120000,
      sourceObservedAt: '2026-11-11T00:00:00.000Z',
      parcelKey: '34017-09061410637',
      provenance: {
        origin: 'live',
        observed: true,
        parcelKey: '34017-09061410637',
        derivedFields: { parcelKey: true },
      },
    });
    await pg.createListing({
      id: 'CIV-NJ-TEST-KEEP',
      source: 'civilview',
      state: 'NJ',
      county: 'Hudson',
      address: '24 BRIGHT ST',
      openingBid: 125000,
      sourceObservedAt: '2026-11-12T00:00:00.000Z',
      parcelKey: '34017-LOT37BLOCK14106',
      provenance: {
        origin: 'live',
        observed: true,
        parcelKey: '34017-LOT37BLOCK14106',
      },
    });
    const afterRefresh = await pg.getListingById('CIV-NJ-TEST-KEEP');
    assert.equal(afterRefresh.provenance.parcelKey, '34017-09061410637');
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

test('search q expands full US state names and boosts exact state matches across PG and memory', { timeout: BOOT_TIMEOUT_MS * 2 }, async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-audit-state-q-'));
  try {
    const embedded = await startEmbeddedPostgres({ dataDir });
    await migrate(embedded.pool);
    const pg = new DatabaseClient({ pool: embedded.pool, liveCachePath: null, workspaceStorePath: null });
    const memory = new DatabaseClient({
      env: { ...process.env, PROPERTY_INVENTORY_BACKEND: 'memory', NODE_ENV: 'test' },
      liveCachePath: null,
      workspaceStorePath: null,
    });
    memory.inMemoryData.listings = [];

    const fixtures = [
      {
        id: 'nc-ohio-ave',
        source: 'servicelink',
        state: 'NC',
        county: 'Gaston',
        city: 'Bessemer City',
        address: '215 E Ohio Ave, Bessemer City, NC 28016',
        openingBid: 90000,
        saleDate: '2026-12-01',
        lat: 35.28,
        lng: -81.28,
        provenance: { origin: 'live', observed: true },
      },
      {
        id: 'oh-cuy-1',
        source: 'sheriff',
        state: 'OH',
        county: 'Cuyahoga',
        city: 'Cleveland',
        address: '1000 Euclid Ave, Cleveland, OH 44115',
        openingBid: 75000,
        saleDate: '2026-12-15',
        lat: 41.50,
        lng: -81.68,
        provenance: { origin: 'live', observed: true },
      },
      {
        id: 'mi-id-has-nj',
        source: 'servicelink',
        state: 'MI',
        county: 'Oakland',
        city: 'Hazel Park',
        address: '1334 E George Ave, Hazel Park, MI 48030',
        openingBid: 65000,
        saleDate: '2026-11-20',
        lat: 42.46,
        lng: -83.10,
        provenance: { origin: 'live', observed: true, recordId: 'a1cTESTNJ001' },
      },
      {
        id: 'nj-hud-1',
        source: 'civilview',
        state: 'NJ',
        county: 'Hudson',
        address: '22 BRIGHT ST #2',
        openingBid: null,
        saleDate: '2026-12-20',
        provenance: { origin: 'live', observed: true },
      },
    ];
    for (const item of fixtures) {
      await pg.createListing(item);
      await memory.createListing(item);
    }

    for (const q of ['Ohio', 'NJ']) {
      const f = discovery.queryFromUrl(new URL(`http://localhost/api/listings?q=${encodeURIComponent(q)}&limit=12&sort=score`));
      const pgRes = await discovery.search(pg, f);
      const memRes = await discovery.search(memory, f);
      assert.deepEqual(
        pgRes.listings.map((l) => l.id),
        memRes.listings.map((l) => l.id),
        `discovery.search PG/memory parity for q=${q}`,
      );
      if (q === 'Ohio') {
        assert.equal(pgRes.listings[0].state, 'OH', 'q=Ohio must rank OH listing first');
      } else {
        assert.equal(pgRes.listings[0].state, 'NJ', 'q=NJ must rank NJ listing ahead of MI Salesforce ID match');
      }
    }

    // Negative control: Ohio Ave street search still finds Ohio Ave when queried specifically
    const streetF = discovery.queryFromUrl(new URL('http://localhost/api/listings?q=Ohio%20Ave&limit=12'));
    const streetPg = await discovery.search(pg, streetF);
    assert.deepEqual(streetPg.listings.map((l) => l.id), ['nc-ohio-ave']);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

test('source-network GET handler caches responses for TTL and invalidates immediately after POST mutations', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-audit-srcnet-'));
  try {
    const token = crypto.randomBytes(16).toString('hex');
    const intake = require('../server/sources/intake');
    const storePath = path.join(dir, 'intake.json');
    let readStoreCalls = 0;
    const handler = createSourceNetworkHandler({
      enableCacheInTest: true,
      cacheTtlMs: 30_000,
      database: { isPg: false, pool: null, getListings: async () => ({ total: 0, listings: [] }) },
      loadObservationsFromPg: async () => {
        readStoreCalls += 1;
        return { runs: {}, records: {}, signals: [], trackedRecords: 0 };
      },
      intake: {
        ...intake,
        listEvidenceSummaries: () => intake.listEvidence({ storePath, limit: 100 }),
        submitEvidence: (body) => intake.submitEvidence(body, { storePath }),
        reviewEvidence: (id, review) => intake.reviewEvidence(id, review, { storePath }),
      },
      env: { NODE_ENV: 'test', SCRAPER_ADMIN_TOKEN: token },
    });

    const invoke = async (method, url, body = null, headers = {}) => {
      const res = {
        statusCode: 200,
        headers: {},
        body: null,
        setHeader(k, v) { this.headers[k] = v; },
        status(code) { this.statusCode = code; return this; },
        json(payload) { this.body = payload; return this; },
      };
      await handler({ method, url, headers, body }, res);
      return res;
    };

    const g1 = await invoke('GET', '/api/source-network');
    assert.equal(g1.statusCode, 200);
    assert.match(g1.headers['Cache-Control'], /max-age=30/);
    const g2 = await invoke('GET', '/api/source-network');
    assert.equal(g2.statusCode, 200);
    assert.equal(readStoreCalls, 1, 'second GET within TTL must serve from cache');

    const post = await invoke(
      'POST',
      '/api/source-network/intake',
      {
        sourceId: 'cache-inval-test',
        sourceUrl: 'https://example.org/r/1',
        capturedAt: new Date().toISOString(),
        kind: 'text',
        body: 'Test cache invalidation payload. This is a test-only evidence packet.',
        customSource: {
          name: 'Cache test publisher',
          organization: 'Test org',
          homepageUrl: 'https://example.org/',
        },
      },
      { authorization: `Bearer ${token}` },
    );
    assert.equal(post.statusCode, 201);

    const g3 = await invoke('GET', '/api/source-network');
    assert.equal(g3.statusCode, 200);
    assert.equal(readStoreCalls, 2, 'POST mutation must invalidate source-network cache');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

test('sort=images ranks multi-photo galleries ahead of single-photo and photoless records across PG (with cursor) and memory', { timeout: BOOT_TIMEOUT_MS * 2 }, async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-audit-sort-images-'));
  try {
    const embedded = await startEmbeddedPostgres({ dataDir });
    await migrate(embedded.pool);
    const pg = new DatabaseClient({ pool: embedded.pool, liveCachePath: null, workspaceStorePath: null });
    const memory = new DatabaseClient({
      env: { ...process.env, PROPERTY_INVENTORY_BACKEND: 'memory', NODE_ENV: 'test' },
      liveCachePath: null,
      workspaceStorePath: null,
    });
    memory.inMemoryData.listings = [];

    const fixtures = [
      {
        id: 'img-none',
        source: 'civilview',
        state: 'NJ',
        county: 'Essex',
        address: '10 None St, Newark, NJ 07102',
        photo: null,
        images: [],
        provenance: { origin: 'live', observed: true },
      },
      {
        id: 'img-one',
        source: 'hud',
        state: 'NJ',
        county: 'Essex',
        address: '20 One St, Newark, NJ 07102',
        photo: 'https://cdn.example.test/one-a.jpg',
        images: ['https://cdn.example.test/one-a.jpg'],
        provenance: { origin: 'live', observed: true },
      },
      {
        id: 'img-three',
        source: 'gsa',
        state: 'NJ',
        county: 'Essex',
        address: '30 Three St, Newark, NJ 07102',
        photo: 'https://cdn.example.test/three-a.jpg',
        images: [
          'https://cdn.example.test/three-a.jpg',
          'https://cdn.example.test/three-b.jpg',
          'https://cdn.example.test/three-c.jpg',
        ],
        provenance: { origin: 'live', observed: true },
      },
    ];
    for (const item of fixtures) {
      await pg.createListing(item);
      await memory.createListing(item);
    }

    const f = discovery.queryFromUrl(new URL('http://localhost/api/listings?sort=images&limit=10'));
    const pgRes = await discovery.search(pg, f);
    const memRes = await discovery.search(memory, f);
    assert.deepEqual(pgRes.listings.map((l) => l.id), ['img-three', 'img-one', 'img-none']);
    assert.deepEqual(memRes.listings.map((l) => l.id), ['img-three', 'img-one', 'img-none']);

    // Cursor pagination over scalar sort=images expr must walk all 3 rows cleanly in PG.
    const page1 = await discovery.search(pg, discovery.queryFromUrl(new URL('http://localhost/api/listings?sort=images&limit=1')));
    assert.deepEqual(page1.listings.map((l) => l.id), ['img-three']);
    assert.ok(page1.page.nextCursor);
    const page2 = await discovery.search(
      pg,
      discovery.queryFromUrl(new URL(`http://localhost/api/listings?sort=images&limit=1&cursor=${encodeURIComponent(page1.page.nextCursor)}`)),
    );
    assert.deepEqual(page2.listings.map((l) => l.id), ['img-one']);
    assert.ok(page2.page.nextCursor);
    const page3 = await discovery.search(
      pg,
      discovery.queryFromUrl(new URL(`http://localhost/api/listings?sort=images&limit=1&cursor=${encodeURIComponent(page2.page.nextCursor)}`)),
    );
    assert.deepEqual(page3.listings.map((l) => l.id), ['img-none']);
    assert.equal(page3.page.hasMore, false);

    // Control: bogus sort still fails closed with 400.
    assert.throws(
      () => discovery.queryFromUrl(new URL('http://localhost/api/listings?sort=bogus')),
      (err) => err instanceof discovery.DiscoveryQueryError && err.status === 400,
    );
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

test('next.config.mjs redirects legacy /watchlists and /map aliases to canonical destinations', async () => {
  const { default: nextConfig } = await import('../next.config.mjs');
  const redirects = await nextConfig.redirects();
  assert.deepEqual(
    redirects.find((r) => r.source === '/watchlists'),
    { source: '/watchlists', destination: '/hunts', permanent: false },
  );
  assert.deepEqual(
    redirects.find((r) => r.source === '/map'),
    { source: '/map', destination: '/listings?view=map', permanent: false },
  );
  assert.equal(redirects.find((r) => r.source === '/unknown-alias'), undefined);
});
