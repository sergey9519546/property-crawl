const assert = require('assert');
const http = require('http');
const server = require('../server/server');
const db = require('../server/db/client');

console.log('=== RUNNING SERVER & API TEST SUITE ===');

let passed = 0;
let failed = 0;

function test(name, fn) {
  return Promise.resolve()
    .then(() => fn())
    .then(() => {
      console.log(`  ✓ ${name}`);
      passed++;
    })
    .catch((err) => {
      console.error(`  ✗ ${name}`);
      console.error(`    ${err.message}`);
      failed++;
    });
}

function request(path, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(`http://localhost:3999${path}`, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, headers: res.headers, body: data ? JSON.parse(data) : null, raw: data });
        } catch (_) {
          resolve({ status: res.statusCode, headers: res.headers, raw: data });
        }
      });
    });
    req.on('error', reject);
    if (options.body) {
      req.write(typeof options.body === 'object' ? JSON.stringify(options.body) : options.body);
    }
    req.end();
  });
}

async function run() {
  await new Promise((resolve) => server.listen(3999, resolve));
  await db.createListing({
    id: "TEST-1",
    source: "sheriff",
    state: "OH",
    county: "Cuyahoga",
    city: "Cleveland",
    address: "123 Test St",
    openingBid: 50000,
    estLow: 100000,
    estHigh: 150000,
    mid: 125000,
    dealScore: 90
  });
  const seedResponse = await request('/api/listings?limit=100');
  const seedListings = seedResponse.body.listings;
  assert.ok(seedListings.length > 0, 'server test requires at least one seeded listing');
  const primaryListing = seedListings[0];

  await test('GET /api/health returns 200 and status ok', async () => {
    const res = await request('/api/health');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.status, 'ok');
  });

  await test('GET /api/sources returns verified sources list', async () => {
    const res = await request('/api/sources');
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.body));
    assert.strictEqual(res.body.length, 15, `Expected 15 sources, got ${res.body.length}`);
  });

  await test('GET /api/listings returns filtered and paginated listings', async () => {
    const res = await request('/api/listings?limit=5');
    assert.strictEqual(res.status, 200);
    // The page contains at most `limit` listings.
    assert.ok(res.body.listings.length <= 5, `page size ${res.body.listings.length} exceeds limit=5`);
    // `body.total` is the FULL filtered count, not the page size.
    // Compare it to the seed page's `body.total` (which the seed call
    // captured), since both calls return the same unfiltered set when
    // no filters are applied.
    const seedTotal = seedResponse.body.total;
    assert.strictEqual(res.body.total, seedTotal, 'body.total must be the full filtered count, not the page size');
  });

  await test('GET /api/listings with state filter filters correctly', async () => {
    const res = await request('/api/listings?state=OH');
    assert.strictEqual(res.status, 200);
    res.body.listings.forEach(l => assert.strictEqual(l.state, 'OH'));
  });

  await test('GET /api/listings/:id returns single listing', async () => {
    const res = await request(`/api/listings/${encodeURIComponent(primaryListing.id)}`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.id, primaryListing.id);
    assert.strictEqual(res.body.city, primaryListing.city);
  });

  await test('POST /api/parse extracts structured notice and caches result', async () => {
    const res = await request('/api/parse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { noticeText: 'SHERIFF SALE: 3841 E 55th St, Cleveland, OH 44105. Judgment $71,340.' }
    });
    assert.strictEqual(res.status, 200);
    assert.ok(res.body.parsed);
    assert.strictEqual(res.body.parsed.state, 'OH');
  });

  await test('POST /api/alerts and GET /api/alerts manages user watchlist', async () => {
    const userId = 'test_user_42';
    const postRes = await request('/api/alerts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-id': userId },
      body: { listingId: primaryListing.id }
    });
    assert.strictEqual(postRes.status, 201);

    const getRes = await request(`/api/alerts?userId=${userId}`);
    assert.strictEqual(getRes.status, 200);
    assert.strictEqual(getRes.body.savedCount, 1);
    assert.strictEqual(getRes.body.deals[0].id, primaryListing.id);
  });

  await test('GET /api/export?format=csv returns valid CSV stream', async () => {
    const res = await request('/api/export?format=csv');
    assert.strictEqual(res.status, 200);
    assert.ok(res.headers['content-type'].includes('text/csv'));
    assert.ok(res.raw.includes('Opening Bid,Est Low,Est High,Built-in Equity,Deal Score,Cash to Close,Redemption Days,Senior Lien Risk'));
  });

  await test('GET /api/parcel-boundary returns GeoJSON Polygon and cadastral metrics for listing', async () => {
    const res = await request(`/api/parcel-boundary?listingId=${primaryListing.id}`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.type, 'Feature');
    assert.strictEqual(res.body.geometry.type, 'Polygon');
    assert.ok(Array.isArray(res.body.geometry.coordinates[0]));
    assert.strictEqual(res.body.geometry.coordinates[0].length, 5); // 4 corners + closed
    assert.ok(res.body.properties.lotSqft > 0);
    assert.ok(res.body.properties.frontageFt > 0);
    assert.ok(res.body.properties.depthFt > 0);
    assert.ok(res.body.properties.zoning);
    assert.ok(res.body.properties.source);
  });

  await test('POST /api/parcel-boundary accepts custom spatial coordinates and computes setback envelope', async () => {
    const res = await request('/api/parcel-boundary', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: {
        lat: 25.7617,
        lng: -80.1918,
        state: 'FL',
        county: 'Miami-Dade',
        sqft: 2200,
        apn: '01-3124-001-0120'
      }
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.type, 'Feature');
    assert.strictEqual(res.body.geometry.type, 'Polygon');
    assert.ok(res.body.properties.setbackGeometry);
    assert.strictEqual(res.body.properties.setbackGeometry.type, 'Polygon');
    assert.strictEqual(res.body.properties.parcelId, '01-3124-001-0120');
  });

  await new Promise((resolve) => server.close(resolve));
  console.log(`--- SERVER TEST SUMMARY: ${passed} Passed, ${failed} Failed ---`);
  if (failed > 0) process.exit(1);
}

run();
