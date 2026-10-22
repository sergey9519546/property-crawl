// test/listings-compare-adversarial.test.mjs
//
// Adversarial challenge and stress test suite for M1:
// - Unshadowed /api/listings/compare route
// - Input validation, boundary counts, duplicate IDs, missing IDs
// - Security, injection, traversal, XSS, unicode, buffer stress
// - Adjacent routes integrity (/api/listings, /api/listings/:id, /api/listings/map, etc.)
// - Next.js App Router proxy parity via proxyPropertyApi
// - Concurrency and stress harness under live HTTP server

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import server from '../server/server.js';
import db from '../server/db/client.js';
import { proxyPropertyApi } from '../src/lib/property-api.ts';

process.env.PROPERTY_INVENTORY_BACKEND = process.env.PROPERTY_INVENTORY_BACKEND || 'memory';
process.env.PROPERTY_API_RATE_LIMIT = '10000'; // High rate limit for stress harness
process.env.SCRAPER_ADMIN_TOKEN = process.env.SCRAPER_ADMIN_TOKEN || 'test-admin-token';

let baseUrl = '';
let port = 0;

function httpRequest(pathname, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(pathname, baseUrl);
    const req = http.request(url, { agent: false, ...options, headers: { connection: 'close', ...(options.headers || {}) } }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let json = null;
        try { json = data ? JSON.parse(data) : null; } catch (_) {}
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: json,
          raw: data,
        });
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => {
      req.destroy(new Error(`Request timed out after 10s: ${pathname}`));
    });
    if (options.body) {
      req.write(typeof options.body === 'object' ? JSON.stringify(options.body) : options.body);
    }
    req.end();
  });
}

test.before(async () => {
  // Ensure server is listening on ephemeral port
  await new Promise((resolve) => {
    if (server.listening) {
      const addr = server.address();
      port = typeof addr === 'object' && addr ? addr.port : 3999;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    } else {
      server.listen(0, '127.0.0.1', () => {
        port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    }
  });

  // Ensure test listing fixtures exist in DB
  const fixtures = [
    {
      id: 'CIV-NJ-10-2129335075',
      source: 'civilview',
      state: 'NJ',
      county: 'Camden',
      city: 'Camden',
      address: '100 Federal St',
      openingBid: 100000,
      mid: 150000,
      dealScore: 85,
      sqft: 2000,
      year: 1990,
      propType: 'Single Family',
    },
    {
      id: 'CIV-NJ-10-2129335092',
      source: 'civilview',
      state: 'NJ',
      county: 'Camden',
      city: 'Cherry Hill',
      address: '200 Haddonfield Rd',
      openingBid: 120000,
      mid: 180000,
      dealScore: 80,
      sqft: 2400,
      year: 2005,
      propType: 'Single Family',
    },
    {
      id: 'TEST-COMPARE-3',
      source: 'sheriff',
      state: 'OH',
      county: 'Cuyahoga',
      city: 'Cleveland',
      address: '300 Euclid Ave',
      openingBid: 80000,
      mid: 140000,
      dealScore: 88,
      sqft: 1800,
      year: 1980,
      propType: 'Single Family',
    },
    {
      id: 'TEST-COMPARE-4',
      source: 'treasury',
      state: 'TX',
      county: 'Webb',
      city: 'Bruni',
      address: '400 Main St',
      openingBid: 50000,
      mid: 100000,
      dealScore: 92,
      sqft: 1500,
      year: 1975,
      propType: 'Single Family',
    },
  ];

  for (const item of fixtures) {
    const existing = await db.getListingById(item.id);
    if (!existing) {
      await db.createListing(item);
    }
  }
});

// --- SUITE 1: /api/listings/compare Parameter Boundaries & Count Limits ---

test('1.1 Zero IDs: /api/listings/compare returns HTTP 400 ids_required', async () => {
  const res = await httpRequest('/api/listings/compare');
  assert.equal(res.status, 400);
  assert.equal(res.body.error, 'ids_required');
  assert.equal(res.body.minRequired, 2);
});

test('1.2 Empty query param: ?ids= returns HTTP 400 ids_required', async () => {
  const res = await httpRequest('/api/listings/compare?ids=');
  assert.equal(res.status, 400);
  assert.equal(res.body.error, 'ids_required');
});

test('1.3 Only commas or empty segments: ?ids=,,, returns HTTP 400 ids_required', async () => {
  const res = await httpRequest('/api/listings/compare?ids=,,,');
  assert.equal(res.status, 400);
  assert.equal(res.body.error, 'ids_required');
});

test('1.4 Whitespace only: ?ids=%20,%20%20 returns HTTP 400 ids_required', async () => {
  const res = await httpRequest('/api/listings/compare?ids=%20,%20%20');
  assert.equal(res.status, 400);
  assert.equal(res.body.error, 'ids_required');
});

test('1.5 Exactly 1 valid ID: returns HTTP 400 ids_required (minRequired: 2)', async () => {
  const res = await httpRequest('/api/listings/compare?ids=CIV-NJ-10-2129335075');
  assert.equal(res.status, 400);
  assert.equal(res.body.error, 'ids_required');
  assert.equal(res.body.minRequired, 2);
});

test('1.6 1 valid ID with empty trailing commas: returns HTTP 400 ids_required', async () => {
  const res = await httpRequest('/api/listings/compare?ids=CIV-NJ-10-2129335075,,');
  assert.equal(res.status, 400);
  assert.equal(res.body.error, 'ids_required');
});

test('1.7 Exactly 2 valid IDs (comma-separated): returns HTTP 200 with schema and count 2', async () => {
  const res = await httpRequest('/api/listings/compare?ids=CIV-NJ-10-2129335075,CIV-NJ-10-2129335092');
  assert.equal(res.status, 200);
  assert.equal(res.body.schema, 'property-crawl.compare/v1');
  assert.equal(res.body.targetId, 'CIV-NJ-10-2129335075');
  assert.equal(res.body.count, 2);
  assert.ok(Array.isArray(res.body.rows));
  assert.equal(res.body.rows.length, 2);
  assert.ok(res.body.winnerByField);
  assert.equal(res.headers['cache-control'], 'no-store');
});

test('1.8 Exactly 2 valid IDs (repeated ?ids= param): returns HTTP 200', async () => {
  const res = await httpRequest('/api/listings/compare?ids=CIV-NJ-10-2129335075&ids=CIV-NJ-10-2129335092');
  assert.equal(res.status, 200);
  assert.equal(res.body.schema, 'property-crawl.compare/v1');
  assert.equal(res.body.count, 2);
});

test('1.9 3 valid IDs: returns HTTP 200 with count 3', async () => {
  const res = await httpRequest('/api/listings/compare?ids=CIV-NJ-10-2129335075,CIV-NJ-10-2129335092,TEST-COMPARE-3');
  assert.equal(res.status, 200);
  assert.equal(res.body.schema, 'property-crawl.compare/v1');
  assert.equal(res.body.count, 3);
  assert.equal(res.body.rows.length, 3);
});

test('1.10 4 valid IDs (MAX_LISTINGS boundary): returns HTTP 200 with count 4', async () => {
  const res = await httpRequest('/api/listings/compare?ids=CIV-NJ-10-2129335075,CIV-NJ-10-2129335092,TEST-COMPARE-3,TEST-COMPARE-4');
  assert.equal(res.status, 200);
  assert.equal(res.body.schema, 'property-crawl.compare/v1');
  assert.equal(res.body.count, 4);
  assert.equal(res.body.rows.length, 4);
});

test('1.11 5 valid IDs (> MAX_LISTINGS limit): returns HTTP 400 too_many_ids', async () => {
  const res = await httpRequest('/api/listings/compare?ids=CIV-NJ-10-2129335075,CIV-NJ-10-2129335092,TEST-COMPARE-3,TEST-COMPARE-4,EXTRA-5');
  assert.equal(res.status, 400);
  assert.equal(res.body.error, 'too_many_ids');
  assert.equal(res.body.maxAllowed, 4);
});

test('1.12 Flood of 50 IDs: returns HTTP 400 too_many_ids without server crash', async () => {
  const flood = Array.from({ length: 50 }, (_, i) => `ID-${i}`).join(',');
  const res = await httpRequest(`/api/listings/compare?ids=${flood}`);
  assert.equal(res.status, 400);
  assert.equal(res.body.error, 'too_many_ids');
  assert.equal(res.body.maxAllowed, 4);
});

test('1.13 Duplicate IDs (?ids=ID,ID): handles duplicate ID safely without throwing', async () => {
  const res = await httpRequest('/api/listings/compare?ids=CIV-NJ-10-2129335075,CIV-NJ-10-2129335075');
  assert.equal(res.status, 200);
  assert.equal(res.body.schema, 'property-crawl.compare/v1');
  assert.equal(res.body.count, 2);
  assert.equal(res.body.targetId, 'CIV-NJ-10-2129335075');
});

// --- SUITE 2: Invalid / Nonexistent IDs ---

test('2.1 Both IDs nonexistent: returns HTTP 404 listings_not_found with requested list', async () => {
  const res = await httpRequest('/api/listings/compare?ids=NONEXISTENT_A,NONEXISTENT_B');
  assert.equal(res.status, 404);
  assert.equal(res.body.error, 'listings_not_found');
  assert.deepEqual(res.body.requested, ['NONEXISTENT_A', 'NONEXISTENT_B']);
});

test('2.2 Partial nonexistent (valid target, missing comparison): returns HTTP 404 with missing[]', async () => {
  const res = await httpRequest('/api/listings/compare?ids=CIV-NJ-10-2129335075,NONEXISTENT_B');
  assert.equal(res.status, 404);
  assert.equal(res.body.error, 'listings_not_found');
  assert.deepEqual(res.body.missing, ['NONEXISTENT_B']);
});

test('2.3 Partial nonexistent (missing target, valid comparison): returns HTTP 404 with missing[]', async () => {
  const res = await httpRequest('/api/listings/compare?ids=NONEXISTENT_A,CIV-NJ-10-2129335075');
  assert.equal(res.status, 404);
  assert.equal(res.body.error, 'listings_not_found');
  assert.deepEqual(res.body.missing, ['NONEXISTENT_A']);
});

test('2.4 Multiple missing: returns HTTP 404 with all missing IDs', async () => {
  const res = await httpRequest('/api/listings/compare?ids=CIV-NJ-10-2129335075,MISSING_1,MISSING_2');
  assert.equal(res.status, 404);
  assert.equal(res.body.error, 'listings_not_found');
  assert.deepEqual(res.body.missing, ['MISSING_1', 'MISSING_2']);
});

// --- SUITE 3: Security & Adversarial Injection Resistance ---

test('3.1 SQL Injection payload in IDs: fails safely with 404 listings_not_found', async () => {
  const sqlInjection = encodeURIComponent("CIV-NJ-10-2129335075' OR '1'='1");
  const res = await httpRequest(`/api/listings/compare?ids=CIV-NJ-10-2129335075,${sqlInjection}`);
  assert.equal(res.status, 404);
  assert.equal(res.body.error, 'listings_not_found');
});

test('3.2 SQL Injection DROP TABLE attempt: safe 404 without database corruption', async () => {
  const dropPayload = encodeURIComponent("'; DROP TABLE listings; --");
  const res = await httpRequest(`/api/listings/compare?ids=CIV-NJ-10-2129335075,${dropPayload}`);
  assert.equal(res.status, 404);
  // Verify table / listings still intact
  const verifyListing = await db.getListingById('CIV-NJ-10-2129335075');
  assert.ok(verifyListing, 'Listing must survive SQL injection probe');
});

test('3.3 Path traversal in IDs: safe 404 without file leakage', async () => {
  const traversal = encodeURIComponent('../../../../etc/passwd');
  const res = await httpRequest(`/api/listings/compare?ids=CIV-NJ-10-2129335075,${traversal}`);
  assert.equal(res.status, 404);
  assert.equal(res.body.error, 'listings_not_found');
});

test('3.4 Null byte injection: handled safely without crashing process', async () => {
  const nullByte = encodeURIComponent('CIV-NJ-10-2129335075\0');
  const res = await httpRequest(`/api/listings/compare?ids=CIV-NJ-10-2129335075,${nullByte}`);
  assert.equal(res.status, 404);
});

test('3.5 XSS script injection in IDs: does not reflect unescaped HTML in response', async () => {
  const xss = encodeURIComponent('<script>alert("xss")</script>');
  const res = await httpRequest(`/api/listings/compare?ids=CIV-NJ-10-2129335075,${xss}`);
  assert.equal(res.status, 404);
  assert.equal(res.headers['content-type'], 'application/json');
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
});

test('3.6 Unicode and emoji characters in IDs: handled gracefully with 404', async () => {
  const unicode = encodeURIComponent('🏠🏡,🏢');
  const res = await httpRequest(`/api/listings/compare?ids=${unicode}`);
  assert.equal(res.status, 404);
  assert.equal(res.body.error, 'listings_not_found');
});

test('3.7 Very long ID string (buffer/ReDoS stress): rejects or 404s without hanging', async () => {
  const longId = encodeURIComponent('A'.repeat(2000));
  const t0 = performance.now();
  const res = await httpRequest(`/api/listings/compare?ids=CIV-NJ-10-2129335075,${longId}`);
  const elapsed = performance.now() - t0;
  assert.ok(elapsed < 1000, `Request took too long: ${elapsed}ms`);
  assert.equal(res.status, 404);
});

test('3.8 Non-GET HTTP methods: return 405 Method Not Allowed with Allow: GET', async () => {
  for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
    const res = await httpRequest('/api/listings/compare?ids=CIV-NJ-10-2129335075,CIV-NJ-10-2129335092', { method });
    assert.equal(res.status, 405, `Method ${method} must return 405`);
    assert.equal(res.headers.allow, 'GET');
    assert.equal(res.body.error, 'method_not_allowed');
  }
});

// --- SUITE 4: Routing Isolation & Adjacent Routes Integrity ---

test('4.1 Adjacent route: GET /api/listings returns listings collection with total', async () => {
  const res = await httpRequest('/api/listings');
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body.listings));
  assert.ok(Number.isFinite(res.body.total));
  assert.ok(res.body.listings.length > 0);
});

test('4.2 Adjacent route: GET /api/listings with filter (?state=NJ)', async () => {
  const res = await httpRequest('/api/listings?state=NJ&limit=5');
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body.listings));
  for (const l of res.body.listings) {
    assert.equal(l.state, 'NJ');
  }
});

test('4.3 Adjacent route: GET /api/listings/:id returns single listing detail with documentEvidence', async () => {
  const res = await httpRequest('/api/listings/CIV-NJ-10-2129335075');
  assert.equal(res.status, 200);
  assert.equal(res.body.id, 'CIV-NJ-10-2129335075');
  assert.ok(typeof res.body.city === 'string' && res.body.city.length > 0);
  assert.ok(res.body.documentEvidence, 'Must contain documentEvidence');
});

test('4.4 Adjacent route: GET /api/listings/:id with nonexistent ID returns 404', async () => {
  const res = await httpRequest('/api/listings/NONEXISTENT_ITEM_999');
  assert.equal(res.status, 404);
  assert.equal(res.body.error, 'Listing not found');
});

test('4.5 Adjacent route: GET /api/listings/map returns GeoJSON features', async () => {
  const res = await httpRequest('/api/listings/map');
  assert.equal(res.status, 200);
  assert.ok(res.body.type === 'FeatureCollection' || Array.isArray(res.body.features) || res.body.clusters);
});

test('4.6 Adjacent route: GET /api/listings/map with sort=quality normalizes without error', async () => {
  const res = await httpRequest('/api/listings/map?sort=quality');
  assert.equal(res.status, 200);
});

test('4.7 Adjacent route: GET /api/listings/:id/assessor returns assessor interpretation', async () => {
  const res = await httpRequest('/api/listings/CIV-NJ-10-2129335075/assessor');
  assert.equal(res.status, 200);
  assert.equal(res.body.listingId, 'CIV-NJ-10-2129335075');
});

test('4.8 Adjacent route: GET /api/listings/:id/packet fails closed without token and succeeds with operator token', async () => {
  // Without token
  const unauthRes = await httpRequest('/api/listings/CIV-NJ-10-2129335075/packet');
  assert.ok([401, 503].includes(unauthRes.status), 'Unauthenticated packet request must fail closed with 401 or 503');

  // With operator token
  const prevToken = process.env.SCRAPER_ADMIN_TOKEN;
  process.env.SCRAPER_ADMIN_TOKEN = 'test-packet-token';
  try {
    const authRes = await httpRequest('/api/listings/CIV-NJ-10-2129335075/packet', {
      headers: { authorization: 'Bearer test-packet-token' }
    });
    assert.equal(authRes.status, 200);
    assert.equal(authRes.body.schemaVersion, 'decision-packet/v1');
    assert.equal(authRes.body.property.id, 'CIV-NJ-10-2129335075');
  } finally {
    if (prevToken === undefined) delete process.env.SCRAPER_ADMIN_TOKEN;
    else process.env.SCRAPER_ADMIN_TOKEN = prevToken;
  }
});

test('4.9 Adjacent route: POST /api/listings is rejected with 405', async () => {
  const res = await httpRequest('/api/listings', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: { id: 'FORGED-1' },
  });
  assert.equal(res.status, 405);
});

test('4.10 Subpath boundary: GET /api/listings/compare/ (trailing slash) rejected or 400', async () => {
  const res = await httpRequest('/api/listings/compare/');
  assert.equal(res.status, 400);
  assert.match(res.body.error, /invalid listing identifier/i);
});

test('4.11 Subpath boundary: GET /api/listings/compare/extra rejected with 400', async () => {
  const res = await httpRequest('/api/listings/compare/extra');
  assert.equal(res.status, 400);
  assert.match(res.body.error, /invalid listing identifier/i);
});

test('4.12 Route collision boundary: GET /api/listings/comparex treated as listing ID lookup', async () => {
  const res = await httpRequest('/api/listings/comparex');
  assert.equal(res.status, 404);
  assert.equal(res.body.error, 'Listing not found');
});

// --- SUITE 5: Next.js Proxy Parity (proxyPropertyApi) ---

test('5.1 proxyPropertyApi: forwards /api/listings/compare with valid IDs and returns 200', async () => {
  const req = new Request(`${baseUrl}/api/listings/compare?ids=CIV-NJ-10-2129335075,CIV-NJ-10-2129335092`);
  const res = await proxyPropertyApi(req, { apiUrl: baseUrl });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.schema, 'property-crawl.compare/v1');
  assert.equal(data.count, 2);
  assert.equal(data.targetId, 'CIV-NJ-10-2129335075');
});

test('5.2 proxyPropertyApi: forwards /api/listings/compare without IDs and preserves 400', async () => {
  const req = new Request(`${baseUrl}/api/listings/compare`);
  const res = await proxyPropertyApi(req, { apiUrl: baseUrl });
  assert.equal(res.status, 400);
  const data = await res.json();
  assert.equal(data.error, 'ids_required');
});

test('5.3 proxyPropertyApi: forwards /api/listings/compare with missing IDs and preserves 404', async () => {
  const req = new Request(`${baseUrl}/api/listings/compare?ids=MISSING_A,MISSING_B`);
  const res = await proxyPropertyApi(req, { apiUrl: baseUrl });
  assert.equal(res.status, 404);
  const data = await res.json();
  assert.equal(data.error, 'listings_not_found');
});

test('5.4 proxyPropertyApi: forwards adjacent GET /api/listings cleanly', async () => {
  const req = new Request(`${baseUrl}/api/listings?limit=2`);
  const res = await proxyPropertyApi(req, { apiUrl: baseUrl });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.ok(Array.isArray(data.listings));
});

test('5.5 proxyPropertyApi: forwards adjacent GET /api/listings/:id cleanly', async () => {
  const req = new Request(`${baseUrl}/api/listings/CIV-NJ-10-2129335075`);
  const res = await proxyPropertyApi(req, { apiUrl: baseUrl });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.id, 'CIV-NJ-10-2129335075');
});

test('5.6 proxyPropertyApi: rejects disallowlisted /api/listings/invalid/nested/path with 404', async () => {
  const req = new Request(`${baseUrl}/api/listings/invalid/nested/path`);
  const res = await proxyPropertyApi(req, { apiUrl: baseUrl });
  assert.equal(res.status, 404);
  const data = await res.json();
  assert.equal(data.error, 'Unknown API route');
});

// --- SUITE 6: Concurrency & Stress Harness ---

test('6.1 Concurrency Stress: 50 simultaneous parallel requests across compare and adjacent routes', async () => {
  const tasks = [];
  for (let i = 0; i < 50; i++) {
    const bucket = i % 5;
    if (bucket === 0) {
      // Valid compare 2 IDs
      tasks.push(
        httpRequest('/api/listings/compare?ids=CIV-NJ-10-2129335075,CIV-NJ-10-2129335092')
          .then((r) => { assert.equal(r.status, 200); })
      );
    } else if (bucket === 1) {
      // Valid compare 3 IDs
      tasks.push(
        httpRequest('/api/listings/compare?ids=CIV-NJ-10-2129335075,CIV-NJ-10-2129335092,TEST-COMPARE-3')
          .then((r) => { assert.equal(r.status, 200); })
      );
    } else if (bucket === 2) {
      // Invalid compare (zero IDs) -> 400
      tasks.push(
        httpRequest('/api/listings/compare')
          .then((r) => { assert.equal(r.status, 400); })
      );
    } else if (bucket === 3) {
      // Nonexistent compare -> 404
      tasks.push(
        httpRequest('/api/listings/compare?ids=CIV-NJ-10-2129335075,FAKE_ID_' + i)
          .then((r) => { assert.equal(r.status, 404); })
      );
    } else {
      // Adjacent route -> 200
      tasks.push(
        httpRequest('/api/listings/CIV-NJ-10-2129335075')
          .then((r) => { assert.equal(r.status, 200); })
      );
    }
  }

  const results = await Promise.allSettled(tasks);
  const failed = results.filter((r) => r.status === 'rejected');
  assert.equal(failed.length, 0, `All 50 concurrent requests must succeed. Failures: ${failed.map(f => f.reason?.message).join(', ')}`);
});

test.after(async () => {
  if (server && server.listening) {
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

