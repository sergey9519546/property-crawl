import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

// 1. Extract API_PATH regex from src/lib/property-api.ts
const API_PATH_SRC = fs.readFileSync(path.join(ROOT, 'src/lib/property-api.ts'), 'utf8');
const regexMatch = API_PATH_SRC.match(/const API_PATH = (\/\^[\s\S]+\$\/);/);
assert.ok(regexMatch, 'API_PATH regex not found in property-api.ts');
// eslint-disable-next-line no-eval
const API_PATH = eval(regexMatch[1]);

// 2. Import proxyPropertyApi
import { proxyPropertyApi } from '../src/lib/property-api.ts';

// 3. Import server handlers
import handleCoverage from '../server/routes/coverage.js';
import { createPortfolioDashboardHandler } from '../server/routes/portfolio-dashboard.js';
import { createPriceDropHandler } from '../server/routes/price-drop.js';
import { requireWorkspaceIdentity } from '../server/security/workspace-identity.js';
import { summarize } from '../server/discovery/coverage-matrix.js';

// --- SUITE 1: API_PATH REGEX BOUNDARIES & ADVERSARIAL MUTATIONS ---

test('API_PATH: strictly accepts valid routes', () => {
  const valid = [
    '/api/coverage',
    '/api/portfolio/dashboard',
    '/api/price-drops',
    '/api/listings/compare',
    '/api/listings',
    '/api/listings/CIV-NJ-10-2129335075',
    '/api/listings/CIV-NJ-10-2129335075/assessor',
    '/api/listings/CIV-NJ-10-2129335075/packet',
    '/api/listings/CIV-NJ-10-2129335075/decision-packet',
    '/api/health',
    '/api/health/ready',
    '/api/sources',
    '/api/export',
  ];
  for (const p of valid) {
    assert.equal(API_PATH.test(p), true, `Expected valid: ${p}`);
  }
});

test('API_PATH: rejects coverage boundary mutations & path extensions', () => {
  const invalid = [
    '/api/coverage/',
    '/api/coverage/foo',
    '/api/coverage/matrix',
    '/api/coverage/123',
    '/api/coverages',
    '/api/coverage_extra',
    '/api/coverage-extra',
    '/api/coverage.json',
    '/api/coverage/download',
    '/api/coverage/../something',
    '/api/coverage/..',
    '/api/sub/coverage',
    '/coverage',
  ];
  for (const p of invalid) {
    assert.equal(API_PATH.test(p), false, `Expected rejected: ${p}`);
  }
});

test('API_PATH: rejects portfolio/dashboard boundary mutations & path extensions', () => {
  const invalid = [
    '/api/portfolio/dashboard/',
    '/api/portfolio/dashboard/extra',
    '/api/portfolio/dashboard/foo',
    '/api/portfolio/dashboard/123',
    '/api/portfolio',
    '/api/portfolio/',
    '/api/portfolio/other',
    '/api/portfolio/dashboards',
    '/api/portfolios/dashboard',
    '/api/portfolio-dashboard',
    '/api/portfolio/dashboard.json',
    '/api/portfolio/dashboard/..',
    '/api/portfolio/dashboard/../foo',
  ];
  for (const p of invalid) {
    assert.equal(API_PATH.test(p), false, `Expected rejected: ${p}`);
  }
});

test('API_PATH: rejects price-drops boundary mutations & path extensions', () => {
  const invalid = [
    '/api/price-drops/',
    '/api/price-drops/bad',
    '/api/price-drops/123',
    '/api/price-drops/history',
    '/api/price-drop',
    '/api/price-dropss',
    '/api/price-drops-feed',
    '/api/price-drops.json',
    '/api/price_drops',
    '/api/pricedrops',
    '/api/price-drops/..',
    '/api/price-drops/../something',
  ];
  for (const p of invalid) {
    assert.equal(API_PATH.test(p), false, `Expected rejected: ${p}`);
  }
});

test('API_PATH: rejects path traversal and character injection attempts', () => {
  const attacks = [
    '/api/coverage/../../etc/passwd',
    '/api/price-drops/../../admin',
    '/api/portfolio/dashboard/../../secret',
    '/api/coverage%00',
    '/api/coverage\x00',
    '/api/coverage\r\n',
    '/api/coverage?test=1', // url.pathname should not include query string, but if tested directly against API_PATH it must reject
    '/api/coverage/foo/bar',
    '/api/portfolio/dashboard/foo/bar',
    '/api/price-drops/foo/bar',
    '/api/coverage//',
    '//api/coverage',
    '/api//coverage',
    '/api/./coverage',
  ];
  for (const p of attacks) {
    assert.equal(API_PATH.test(p), false, `Expected rejected traversal/injection: ${p}`);
  }
});

test('API_PATH: ReDoS resistance and length bounding on M1 routes', () => {
  const highLengthAttacks = [
    '/api/coverage' + 'a'.repeat(5000),
    '/api/coverage/' + 'a'.repeat(5000),
    '/api/portfolio/dashboard' + 'x'.repeat(5000),
    '/api/portfolio/dashboard/' + 'x'.repeat(5000),
    '/api/price-drops' + 'y'.repeat(5000),
    '/api/price-drops/' + 'y'.repeat(5000),
    '/api/portfolio/' + 'dash/'.repeat(500),
    '/api/' + 'coverage/'.repeat(500),
    '/api/' + 'price-drops/'.repeat(500),
  ];
  for (const p of highLengthAttacks) {
    const t0 = performance.now();
    const result = API_PATH.test(p);
    const elapsed = performance.now() - t0;
    assert.equal(result, false, `Must reject attack vector: ${p.slice(0, 40)}...`);
    assert.ok(elapsed < 50, `ReDoS detected: took ${elapsed}ms on input length ${p.length}`);
  }
});

// --- SUITE 2: PROXY FUNCTIONAL BEHAVIOR & UPSTREAM DISPATCH ---

test('proxyPropertyApi: rejects invalid route with 404 without calling upstream', async () => {
  let upstreamCalled = false;
  const mockFetch = async () => {
    upstreamCalled = true;
    return new Response('{}', { status: 200 });
  };

  const targets = [
    'https://example.com/api/coverage/foo',
    'https://example.com/api/price-drops/bad',
    'https://example.com/api/portfolio/bad',
    'https://example.com/api/portfolio',
    'https://example.com/api/price-drop',
  ];

  for (const target of targets) {
    upstreamCalled = false;
    const res = await proxyPropertyApi(new Request(target), { fetchImpl: mockFetch });
    assert.equal(res.status, 404);
    assert.equal(upstreamCalled, false, `Upstream must not be called for ${target}`);
    const body = await res.json();
    assert.equal(body.error, 'Unknown API route');
  }
});

test('proxyPropertyApi: forwards /api/coverage to upstream with query parameters intact', async () => {
  let forwardedUrl = null;
  const mockFetch = async (url) => {
    forwardedUrl = url;
    return Response.json({ catalog: { total: 100 } });
  };

  const res = await proxyPropertyApi(
    new Request('https://example.com/api/coverage?filter=active&state=CA'),
    { apiUrl: 'http://127.0.0.1:3000', fetchImpl: mockFetch }
  );

  assert.equal(res.status, 200);
  assert.equal(forwardedUrl, 'http://127.0.0.1:3000/api/coverage?filter=active&state=CA');
  const data = await res.json();
  assert.equal(data.catalog.total, 100);
});

test('proxyPropertyApi: injects Authorization header when operatorToken is provided', async () => {
  let forwardedHeaders = null;
  const mockFetch = async (url, options) => {
    forwardedHeaders = options.headers;
    return Response.json({ success: true });
  };

  await proxyPropertyApi(
    new Request('https://example.com/api/price-drops'),
    { apiUrl: 'http://127.0.0.1:3000', operatorToken: 'secret-token-123', fetchImpl: mockFetch }
  );

  assert.ok(forwardedHeaders, 'Headers must be passed');
  assert.equal(forwardedHeaders.get('authorization'), 'Bearer secret-token-123');
});

test('proxyPropertyApi: handles upstream 503 and network abortion gracefully', async () => {
  const timeoutFetch = async () => {
    throw new Error('fetch failed: request aborted / timeout');
  };
  const offlineFetch = async () => {
    throw new Error('ECONNREFUSED');
  };

  const timeoutRes = await proxyPropertyApi(
    new Request('https://example.com/api/coverage'),
    { fetchImpl: timeoutFetch }
  );
  assert.equal(timeoutRes.status, 503);
  const timeoutBody = await timeoutRes.json();
  assert.match(timeoutBody.error, /timed out/i);

  const offlineRes = await proxyPropertyApi(
    new Request('https://example.com/api/coverage'),
    { fetchImpl: offlineFetch }
  );
  assert.equal(offlineRes.status, 503);
  const offlineBody = await offlineRes.json();
  assert.match(offlineBody.error, /unavailable/i);
});

// --- SUITE 3: COVERAGE MATRIX CONTRACT & HONESTY ---

test('/api/coverage: summarize() exposes required matrix schema without leaking internal file paths', () => {
  const matrix = summarize();

  // Root contract
  assert.ok(matrix.catalog, 'Must have catalog');
  assert.ok(matrix.catalogByState, 'Must have catalogByState');
  assert.ok(matrix.liveByState, 'Must have liveByState');
  assert.ok(Array.isArray(matrix.states), 'Must have states array');
  assert.equal(matrix.states.length, 51, 'Must include all 50 states + DC');
  assert.ok(matrix.statusLabels, 'Must have statusLabels');

  // Live state contract
  assert.ok(matrix.liveByState.byStateSource, 'liveByState must have byStateSource');
  assert.ok(matrix.liveByState.byStateTotal, 'liveByState must have byStateTotal');
  assert.ok(matrix.liveByState.byCounty, 'liveByState must have byCounty');
  assert.equal(typeof matrix.liveByState.totalRecords, 'number');
  assert.equal(typeof matrix.liveByState.countedRecords, 'number');

  // Security invariant: storePath must NOT be exposed
  assert.equal(
    matrix.liveByState.storePath,
    undefined,
    'storePath must be omitted to prevent leaking filesystem username or deployment layout'
  );
});

test('/api/coverage: handleCoverage server route returns 200 on GET, 405 on non-GET', async () => {
  const makeCaptureRes = () => {
    return {
      statusCode: 200,
      headers: {},
      body: null,
      setHeader(k, v) { this.headers[k] = v; return this; },
      status(code) { this.statusCode = code; return this; },
      json(val) { this.body = val; return this; },
    };
  };

  const getRes = makeCaptureRes();
  await handleCoverage({ method: 'GET' }, getRes);
  assert.equal(getRes.statusCode, 200);
  assert.ok(getRes.body.catalog);
  assert.equal(getRes.body.states.length, 51);

  const postRes = makeCaptureRes();
  await handleCoverage({ method: 'POST' }, postRes);
  assert.equal(postRes.statusCode, 405);
  assert.equal(postRes.body.error, 'Method not allowed');
});

// --- SUITE 4: AUTHENTICATION ENFORCEMENT & SECURITY GATES ---

test('Workspace Identity: requires configured operator token in environment', () => {
  const makeCaptureRes = () => {
    return {
      statusCode: 200,
      body: null,
      status(c) { this.statusCode = c; return this; },
      json(b) { this.body = b; return this; },
    };
  };

  // 1. When no token is configured
  const res1 = makeCaptureRes();
  const id1 = requireWorkspaceIdentity(
    { headers: { authorization: 'Bearer some-token' } },
    res1,
    { SCRAPER_ADMIN_TOKEN: '', PROPERTY_OPERATOR_SECRET: '' }
  );
  assert.equal(id1, null);
  assert.equal(res1.statusCode, 503);
  assert.match(res1.body.error, /not configured/i);

  // 2. When token is configured, but request presents invalid/missing token
  const res2 = makeCaptureRes();
  const id2 = requireWorkspaceIdentity(
    { headers: {} },
    res2,
    { SCRAPER_ADMIN_TOKEN: 'correct-secret-123' }
  );
  assert.equal(id2, null);
  assert.equal(res2.statusCode, 401);
  assert.match(res2.body.error, /unlock the private workspace/i);

  // 3. When token is configured and request presents correct token
  const res3 = makeCaptureRes();
  const id3 = requireWorkspaceIdentity(
    { headers: { authorization: 'Bearer correct-secret-123' } },
    res3,
    { SCRAPER_ADMIN_TOKEN: 'correct-secret-123' }
  );
  assert.ok(id3);
  assert.match(id3, /^workspace:/);
});

test('portfolio/dashboard: handler rejects unauthenticated and non-GET requests', async () => {
  const makeCaptureRes = () => {
    return {
      statusCode: 200,
      headers: {},
      body: null,
      setHeader(k, v) { this.headers[k] = v; return this; },
      status(c) { this.statusCode = c; return this; },
      json(b) { this.body = b; return this; },
    };
  };

  const handler = createPortfolioDashboardHandler({
    database: { getSavedDeals: async () => [] },
    requireWorkspaceIdentity: (req, res) => {
      res.status(401).json({ error: 'unauthenticated' });
      return null;
    },
  });

  // Method check
  const postRes = makeCaptureRes();
  await handler({ method: 'POST', url: '/api/portfolio/dashboard' }, postRes);
  assert.equal(postRes.statusCode, 405);
  assert.equal(postRes.headers.Allow, 'GET');

  // Auth rejection
  const getRes = makeCaptureRes();
  await handler({ method: 'GET', url: '/api/portfolio/dashboard' }, getRes);
  assert.equal(getRes.statusCode, 401);
  assert.equal(getRes.body.error, 'unauthenticated');

  // Subpath mismatch
  const badPathRes = makeCaptureRes();
  await handler({ method: 'GET', url: '/api/portfolio/dashboard/extra' }, badPathRes);
  assert.equal(badPathRes.statusCode, 404);
});

test('price-drops: handler rejects unauthenticated and non-GET requests', async () => {
  const makeCaptureRes = () => {
    return {
      statusCode: 200,
      headers: {},
      body: null,
      setHeader(k, v) { this.headers[k] = v; return this; },
      status(c) { this.statusCode = c; return this; },
      json(b) { this.body = b; return this; },
    };
  };

  const handler = createPriceDropHandler({
    database: { getSavedDeals: async () => [] },
    requireWorkspaceIdentity: (req, res) => {
      res.status(401).json({ error: 'unauthenticated' });
      return null;
    },
  });

  // Method check
  const postRes = makeCaptureRes();
  await handler({ method: 'POST', url: '/api/price-drops' }, postRes);
  assert.equal(postRes.statusCode, 405);
  assert.equal(postRes.headers.Allow, 'GET');

  // Auth rejection
  const getRes = makeCaptureRes();
  await handler({ method: 'GET', url: '/api/price-drops' }, getRes);
  assert.equal(getRes.statusCode, 401);
  assert.equal(getRes.body.error, 'unauthenticated');

  // Subpath mismatch
  const badPathRes = makeCaptureRes();
  await handler({ method: 'GET', url: '/api/price-drops/bad' }, badPathRes);
  assert.equal(badPathRes.statusCode, 404);
});

// --- SUITE 5: LIVE END-TO-END HTTP INTEGRATION TEST ---

test('End-to-End: live HTTP proxy round-trip verifies reachability, auth, and boundary enforcement', async () => {
  const TEST_OPERATOR_SECRET = 'challenger-test-operator-secret-2026';
  const env = {
    SCRAPER_ADMIN_TOKEN: TEST_OPERATOR_SECRET,
    PROPERTY_WORKSPACE_ID: 'test-workspace'
  };

  const dashboardHandler = createPortfolioDashboardHandler({
    database: { getSavedDeals: async () => [] },
    requireWorkspaceIdentity: (req, res) => requireWorkspaceIdentity(req, res, env)
  });

  const priceDropHandler = createPriceDropHandler({
    database: { getSavedDeals: async () => [], getListingHistory: async () => new Map() },
    requireWorkspaceIdentity: (req, res) => requireWorkspaceIdentity(req, res, env)
  });

  // Spin up an ephemeral backend server mimicking server/server.js routing
  const server = http.createServer(async (req, res) => {
    // augment res with json helper
    res.json = function(val) {
      this.setHeader('Content-Type', 'application/json');
      this.end(JSON.stringify(val));
      return this;
    };
    res.status = function(code) {
      this.statusCode = code;
      return this;
    };

    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/api/coverage') {
      return handleCoverage(req, res);
    }
    if (url.pathname === '/api/portfolio/dashboard') {
      return dashboardHandler(req, res, url);
    }
    if (url.pathname === '/api/price-drops') {
      return priceDropHandler(req, res, url);
    }
    res.status(404).json({ error: 'not_found' });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const backendUrl = `http://127.0.0.1:${address.port}`;

  try {
    // 1. /api/coverage: Public GET succeeds
    const covRes = await proxyPropertyApi(
      new Request('https://app.example/api/coverage'),
      { apiUrl: backendUrl }
    );
    assert.equal(covRes.status, 200);
    const covBody = await covRes.json();
    assert.ok(covBody.catalog);
    assert.equal(covBody.states.length, 51);

    // 2. /api/coverage: POST returns 405 Method Not Allowed
    const covPostRes = await proxyPropertyApi(
      new Request('https://app.example/api/coverage', { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } }),
      { apiUrl: backendUrl }
    );
    assert.equal(covPostRes.status, 405);
    const covPostErr = await covPostRes.json();
    assert.match(covPostErr.error, /Method not allowed/);

    // 3. /api/coverage/foo: Blocked at proxy (404), never hits backend
    const covBadRes = await proxyPropertyApi(
      new Request('https://app.example/api/coverage/foo'),
      { apiUrl: backendUrl }
    );
    assert.equal(covBadRes.status, 404);
    assert.equal((await covBadRes.json()).error, 'Unknown API route');

    // 4. /api/portfolio/dashboard: Unauthenticated returns 401
    const dashUnauth = await proxyPropertyApi(
      new Request('https://app.example/api/portfolio/dashboard'),
      { apiUrl: backendUrl }
    );
    assert.equal(dashUnauth.status, 401);
    assert.match((await dashUnauth.json()).error, /unlock the private workspace/i);

    // 5. /api/portfolio/dashboard: Authenticated with operatorToken returns 200
    const dashAuth = await proxyPropertyApi(
      new Request('https://app.example/api/portfolio/dashboard'),
      { apiUrl: backendUrl, operatorToken: TEST_OPERATOR_SECRET }
    );
    assert.equal(dashAuth.status, 200);
    const dashBody = await dashAuth.json();
    assert.equal(dashBody.schema, 'property-crawl.portfolio-dashboard/v1');
    assert.equal(dashBody.count, 0);

    // 6. /api/portfolio/dashboard/bad: Blocked at proxy (404)
    const dashBad = await proxyPropertyApi(
      new Request('https://app.example/api/portfolio/dashboard/bad'),
      { apiUrl: backendUrl, operatorToken: TEST_OPERATOR_SECRET }
    );
    assert.equal(dashBad.status, 404);

    // 7. /api/price-drops: Unauthenticated returns 401
    const priceUnauth = await proxyPropertyApi(
      new Request('https://app.example/api/price-drops'),
      { apiUrl: backendUrl }
    );
    assert.equal(priceUnauth.status, 401);
    assert.match((await priceUnauth.json()).error, /unlock the private workspace/i);

    // 8. /api/price-drops: Authenticated with operatorToken returns 200
    const priceAuth = await proxyPropertyApi(
      new Request('https://app.example/api/price-drops'),
      { apiUrl: backendUrl, operatorToken: TEST_OPERATOR_SECRET }
    );
    assert.equal(priceAuth.status, 200);
    const priceBody = await priceAuth.json();
    assert.equal(priceBody.schema, 'property-crawl.price-drops/v1');
    assert.equal(priceBody.scanned, 0);

    // 9. /api/price-drops/bad: Blocked at proxy (404)
    const priceBad = await proxyPropertyApi(
      new Request('https://app.example/api/price-drops/bad'),
      { apiUrl: backendUrl, operatorToken: TEST_OPERATOR_SECRET }
    );
    assert.equal(priceBad.status, 404);

    // 10. CORS denial on cross-origin request
    const corsDenial = await proxyPropertyApi(
      new Request('https://app.example/api/coverage', {
        headers: { Origin: 'https://evil-untrusted-site.org' }
      }),
      { apiUrl: backendUrl }
    );
    assert.equal(corsDenial.status, 403);
    assert.match((await corsDenial.json()).error, /Cross-origin/);

    // 11. Request URL length boundary check (> 8192 characters)
    const longUrl = 'https://app.example/api/coverage?' + 'param=' + 'x'.repeat(8200);
    const lengthDenial = await proxyPropertyApi(
      new Request(longUrl),
      { apiUrl: backendUrl }
    );
    assert.equal(lengthDenial.status, 414);
    assert.match((await lengthDenial.json()).error, /too long/);

  } finally {
    server.close();
  }
});

