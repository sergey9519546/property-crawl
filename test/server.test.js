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
  await db.createListing({
    id: "TEST-UNVERIFIED-GEO",
    source: "sheriff",
    state: "OH",
    county: "Cuyahoga",
    city: "Cleveland",
    address: "456 Unverified St",
    lat: 41.4993,
    lng: -81.6944,
    provenance: { origin: "snapshot", observed: false, recordKind: "demo" }
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

  await test('legacy asset server never exposes configuration or workspace source', async () => {
    for (const path of ['/.env.local', '/server/server.js', '/package.json', '/.git/config', '/data/listings.snapshot.json']) {
      const res = await request(path);
      assert.strictEqual(res.status, 404, path);
    }
  });

  await test('GET /api/sources returns verified sources list', async () => {
    const res = await request('/api/sources');
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.body));
    assert.strictEqual(res.body.length, 16, `Expected 16 sources, got ${res.body.length}`);
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

  await test('POST /api/listings is read-only and rejects public ingestion', async () => {
    const res = await request('/api/listings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: {
        id: 'UNTRUSTED-HTTP-INSERT',
        source: 'civilview',
        state: 'NJ',
        address: '1 Fabricated Record Way',
      },
    });
    assert.strictEqual(res.status, 405);
    assert.match(res.body.error, /method not allowed/i);
    assert.strictEqual(await db.getListingById('UNTRUSTED-HTTP-INSERT'), null);
  });

  await test('POST /api/scrapers/run fails closed without an admin token', async () => {
    const previous = process.env.SCRAPER_ADMIN_TOKEN;
    delete process.env.SCRAPER_ADMIN_TOKEN;
    try {
      const res = await request('/api/scrapers/run', { method: 'POST' });
      assert.strictEqual(res.status, 503);
      assert.strictEqual(res.body.requiredConfiguration, 'SCRAPER_ADMIN_TOKEN');
    } finally {
      if (previous === undefined) delete process.env.SCRAPER_ADMIN_TOKEN;
      else process.env.SCRAPER_ADMIN_TOKEN = previous;
    }
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
    assert.strictEqual(res.body.parsed.judgment_amount, 71340);
    assert.strictEqual(res.body.parsed.opening_bid, null, 'judgment must not become an opening bid');
    assert.strictEqual(res.body.parsed.estLow, null);
    assert.strictEqual(res.body.parsed.estHigh, null);
    assert.strictEqual(res.body.parsed.dealScore, null);
    assert.strictEqual(res.body.parsed.deposit_terms, null);
    assert.strictEqual(res.body.parsed.attorney, null);
    assert.strictEqual(res.body.parsed.sale_time, null);
    assert.strictEqual(res.body.reviewRequired, true);
  });

  await test('POST /api/parse keeps appraisal-only notices nullable instead of inventing a bid or valuation band', async () => {
    const res = await request('/api/parse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { noticeText: 'Case No. TRUTH-APPRAISAL-1. Property located at 21 Oak St, Dayton, OH 45402. Appraised at $150,000.' }
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.parsed.appraised_value, 150000);
    assert.strictEqual(res.body.parsed.opening_bid, null);
    assert.strictEqual(res.body.parsed.opening_bid_basis, null);
    assert.strictEqual(res.body.parsed.estLow, null);
    assert.strictEqual(res.body.parsed.estHigh, null);
    assert.strictEqual(res.body.parsed.mid, null);
    assert.strictEqual(res.body.parsed.equity, null);
    assert.strictEqual(res.body.parsed.cash_to_close, null);
  });

  await test('POST /api/parse derives a bid only from an appraisal plus an explicit notice fraction', async () => {
    const res = await request('/api/parse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { noticeText: 'Case No. TRUTH-FRACTION-1. Property located at 22 Oak St, Dayton, OH 45402. Appraised at $150,000. The minimum opening bid shall be two-thirds of the appraised value.' }
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.parsed.appraised_value, 150000);
    assert.strictEqual(res.body.parsed.opening_bid, 100000);
    assert.strictEqual(res.body.parsed.opening_bid_basis, 'derived_from_explicit_notice_fraction');
    assert.strictEqual(res.body.parsed.statutory_bid_fraction, 2 / 3);
    assert.match(res.body.parsed.evidence.opening_bid, /two-thirds/i);
  });

  await test('POST /api/parse does not mistake the fraction base appraisal for a stated bid', async () => {
    const res = await request('/api/parse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { noticeText: 'Case No. TRUTH-FRACTION-BASE-1. The property shall be sold at a minimum opening bid of two-thirds of the appraised value of $150,000.' }
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.parsed.appraised_value, 150000);
    assert.strictEqual(res.body.parsed.opening_bid, 100000);
    assert.strictEqual(res.body.parsed.opening_bid_basis, 'derived_from_explicit_notice_fraction');
  });

  await test('POST /api/parse keeps LLM candidates separate from extracted facts', async () => {
    const originalFetch = global.fetch;
    const originalApiKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = 'test-key';
    global.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({
          candidates: {
            state: { value: 'CA', evidence: 'California' },
            opening_bid: { value: 999999, evidence: 'California' }
          }
        }) } }],
        usage: { prompt_tokens: 10, completion_tokens: 10 }
      })
    });

    try {
      const res = await request('/api/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: { noticeText: 'NOTICE REF LLM-SEPARATION-2026. California is mentioned without a property locality or price.', forceLlm: true }
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.parsed.state, null);
      assert.strictEqual(res.body.parsed.opening_bid, null);
      assert.strictEqual(res.body.unverifiedCandidates.state.value, 'CA');
      assert.strictEqual(res.body.unverifiedCandidates.state.status, 'llm_candidate_unverified');
      assert.strictEqual(res.body.unverifiedCandidates.opening_bid, undefined, 'numeric candidate without matching evidence must be rejected');
      assert.strictEqual(res.body.reviewRequired, true);
    } finally {
      global.fetch = originalFetch;
      if (originalApiKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = originalApiKey;
    }
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
    assert.ok(res.raw.includes('Opening Bid,Est Low,Est High,Bid Spread,Deal Score (1-99, triage only),Cash Requirement Status'));
  });

  await test('GET /api/parcel-boundary fails closed when a listing has no exact coordinates', async () => {
    const res = await request('/api/parcel-boundary?listingId=TEST-1');
    assert.strictEqual(res.status, 422);
    assert.strictEqual(res.body.code, 'EXACT_COORDINATES_REQUIRED');
    assert.strictEqual(res.body.geometry, null);
  });

  await test('GET /api/parcel-boundary rejects snapshot coordinates as unverified', async () => {
    const res = await request('/api/parcel-boundary?listingId=TEST-UNVERIFIED-GEO');
    assert.strictEqual(res.status, 422);
    assert.strictEqual(res.body.code, 'EXACT_COORDINATES_UNVERIFIED');
    assert.strictEqual(res.body.geometry, null);
  });

  await test('POST /api/parcel-boundary returns only source geometry and source-observed facts', async () => {
    const originalFetch = global.fetch;
    global.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        type: 'FeatureCollection',
        features: [{
          type: 'Feature',
          geometry: {
            type: 'Polygon',
            coordinates: [[[-80.192, 25.761], [-80.191, 25.761], [-80.191, 25.762], [-80.192, 25.762], [-80.192, 25.761]]]
          },
          properties: { ACRES: 0.25, FRONT_FEET: 54 }
        }]
      })
    });

    try {
      const res = await request('/api/parcel-boundary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: {
          lat: 25.7617,
          lng: -80.1918,
          state: 'FL',
          sqft: 2200,
          apn: 'USER-SUPPLIED-APN'
        }
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.type, 'Feature');
      assert.strictEqual(res.body.geometry.type, 'Polygon');
      assert.strictEqual(res.body.properties.parcelId, null, 'request APN must not be presented as a source fact');
      assert.strictEqual(res.body.properties.lotAcres, 0.25);
      assert.strictEqual(res.body.properties.lotSqft, 10890);
      assert.strictEqual(res.body.properties.frontageFt, 54);
      assert.strictEqual(res.body.properties.depthFt, null);
      assert.strictEqual(res.body.properties.zoning, null);
      assert.strictEqual(res.body.properties.topography, null);
      assert.strictEqual(res.body.properties.setbacks, null);
      assert.strictEqual(res.body.properties.setbackGeometry, null);
      assert.strictEqual(res.body.properties.surveyStatus, 'not_a_survey');
      assert.match(res.body.properties.disclaimer, /not a boundary survey/i);
    } finally {
      global.fetch = originalFetch;
    }
  });

  await test('POST /api/parcel-boundary never synthesizes a polygon when the source has no match', async () => {
    const originalFetch = global.fetch;
    global.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ type: 'FeatureCollection', features: [] })
    });

    try {
      const res = await request('/api/parcel-boundary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: { lat: 25.7617, lng: -80.1918, state: 'FL' }
      });
      assert.strictEqual(res.status, 404);
      assert.strictEqual(res.body.code, 'PARCEL_GEOMETRY_NOT_FOUND');
      assert.strictEqual(res.body.geometry, null);
    } finally {
      global.fetch = originalFetch;
    }
  });

  await test('API throttling returns retry guidance and cannot be bypassed with forged forwarded headers', async () => {
    let limited;
    for (let i = 0; i < 121; i++) {
      const response = await request('/api/health', { headers: { 'x-forwarded-for': `203.0.113.${i}` } });
      if (response.status === 429) { limited = response; break; }
    }
    assert.ok(limited, 'socket budget must apply despite changing forwarded headers');
    assert.ok(Number(limited.headers['retry-after']) > 0);
    assert.strictEqual(limited.headers['x-ratelimit-limit'], '120');
  });

  await new Promise((resolve) => server.close(resolve));
  console.log(`--- SERVER TEST SUMMARY: ${passed} Passed, ${failed} Failed ---`);
  if (failed > 0) process.exit(1);
}

run();
