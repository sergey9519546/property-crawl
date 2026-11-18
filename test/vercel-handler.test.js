'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');

const MemoryRateLimiter = require('../server/security/rate_limiter');
const {
  configureServerlessEnv,
  applyForwardedClientIp,
  createServerlessDispatcher,
} = require('../server/vercel-handler');

function mockRes() {
  const headers = {};
  return {
    statusCode: 200,
    headers,
    body: null,
    setHeader(name, value) { headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
    end() { return this; },
  };
}

function runLimiter(limiterMiddleware, req) {
  let allowed = false;
  const res = mockRes();
  limiterMiddleware(req, res, () => { allowed = true; });
  return { allowed, statusCode: res.statusCode, headers: res.headers, body: res.body };
}

test('configureServerlessEnv applies /tmp cache defaults and disables background scrapers on Vercel', () => {
  const env = { VERCEL: '1' };
  const configured = configureServerlessEnv(env);
  assert.equal(configured, true);
  assert.equal(env.SCRAPER_BACKGROUND_ENABLED, '0');
  assert.equal(env.DISCOVERY_STORAGE_PATH, os.tmpdir());
  assert.equal(env.DISCOVERY_MIN_FREE_BYTES, String(64 * 1024 * 1024));
  assert.equal(env.PROPERTY_IMAGE_CENSUS_GEOCODER_FALLBACK, '1');
  assert.equal(env.PROPERTY_IMAGE_GOOGLE_PANORAMAX_FALLBACK, '1');
  assert.equal(env.PROPERTY_IMAGE_GOOGLE_MAPILLARY_FALLBACK, '1');
  assert.equal(
    env.PROPERTY_LIVE_CACHE_PATH,
    path.join(os.tmpdir(), 'property-crawl-cache', 'live-listings.json'),
  );
  assert.equal(
    env.PROPERTY_ACCOUNTS_PATH,
    path.join(os.tmpdir(), 'property-crawl-cache', 'accounts.json'),
  );
});

test('configureServerlessEnv preserves explicit operator overrides on Vercel and ignores non-serverless environments', () => {
  assert.equal(configureServerlessEnv({}), false);

  const customDir = path.join(os.tmpdir(), 'custom-discovery');
  const env = {
    VERCEL: '1',
    SCRAPER_BACKGROUND_ENABLED: '1',
    DISCOVERY_STORAGE_PATH: customDir,
    DISCOVERY_MIN_FREE_BYTES: '1024',
    PROPERTY_IMAGE_CENSUS_GEOCODER_FALLBACK: '0',
    PROPERTY_IMAGE_GOOGLE_PANORAMAX_FALLBACK: '0',
    PROPERTY_IMAGE_GOOGLE_MAPILLARY_FALLBACK: '0',
  };
  assert.equal(configureServerlessEnv(env), true);
  assert.equal(env.SCRAPER_BACKGROUND_ENABLED, '1');
  assert.equal(env.DISCOVERY_STORAGE_PATH, customDir);
  assert.equal(env.DISCOVERY_MIN_FREE_BYTES, '1024');
  assert.equal(env.PROPERTY_IMAGE_CENSUS_GEOCODER_FALLBACK, '0');
  assert.equal(env.PROPERTY_IMAGE_GOOGLE_PANORAMAX_FALLBACK, '0');
  assert.equal(env.PROPERTY_IMAGE_GOOGLE_MAPILLARY_FALLBACK, '0');
});

test('createServerlessDispatcher caches verified DB check and retries after transient failures', async () => {
  let verifyCalls = 0;
  let shouldSucceed = false;
  const dispatched = [];
  const fakeDb = {
    postgresReachable: false,
    isPg: false,
    async verifyConnection() {
      verifyCalls += 1;
      if (!shouldSucceed) return false;
      this.postgresReachable = true;
      this.isPg = true;
      return true;
    },
  };
  const fakeServer = {
    listeners() {
      return [
        (req, res) => {
          dispatched.push({ url: req.url, isPg: fakeDb.isPg });
          res.end('ok');
        },
      ];
    },
  };

  const handler = createServerlessDispatcher({ server: fakeServer, db: fakeDb });
  await handler({ url: '/api/health' }, { end() {} });
  assert.equal(verifyCalls, 1);
  assert.equal(dispatched[0].isPg, false);

  shouldSucceed = true;
  await handler({ url: '/api/health' }, { end() {} });
  assert.equal(verifyCalls, 2);
  assert.equal(dispatched[1].isPg, true);

  await handler({ url: '/api/listings' }, { end() {} });
  assert.equal(verifyCalls, 2);
});

test('applyForwardedClientIp restores client IP for MemoryRateLimiter and extractClientIp when TRUSTED_PROXY_COUNT=1', async () => {
  const { extractClientIp } = await import('../src/lib/workspace-unlock-limiter.ts');
  const limiter = new MemoryRateLimiter({ windowMs: 60_000, maxRequests: 1, trustedProxyCount: 1 }).middleware();
  const env = { TRUSTED_PROXY_COUNT: '1' };

  const reqClientA1 = {
    socket: { remoteAddress: '127.0.0.1' },
    headers: { 'x-forwarded-for': '172.64.0.1', 'x-pp-client-ip': '198.51.100.10' },
  };
  const reqClientA2 = {
    socket: { remoteAddress: '127.0.0.1' },
    headers: { 'x-forwarded-for': '172.64.0.1', 'x-pp-client-ip': '198.51.100.10' },
  };
  const reqClientB = {
    socket: { remoteAddress: '127.0.0.1' },
    headers: { 'x-forwarded-for': '172.64.0.1', 'x-pp-client-ip': '198.51.100.11' },
  };

  assert.equal(applyForwardedClientIp(reqClientA1, env), true);
  assert.equal(applyForwardedClientIp(reqClientA2, env), true);
  assert.equal(applyForwardedClientIp(reqClientB, env), true);

  assert.equal(reqClientA1.headers['x-forwarded-for'].startsWith('198.51.100.10'), true);
  assert.equal(extractClientIp(reqClientA1, env), '198.51.100.10');
  assert.equal(extractClientIp(reqClientB, env), '198.51.100.11');

  assert.equal(runLimiter(limiter, reqClientA1).allowed, true);
  const blockedA = runLimiter(limiter, reqClientA2);
  assert.equal(blockedA.allowed, false);
  assert.equal(blockedA.statusCode, 429);

  // Distinct x-pp-client-ip behind the exact same proxy IP gets its own rate bucket.
  assert.equal(runLimiter(limiter, reqClientB).allowed, true);
});

test('applyForwardedClientIp preserves trailing proxy hop for TRUSTED_PROXY_COUNT=2 and parses IPv6/comma lists', () => {
  const limiter = new MemoryRateLimiter({ windowMs: 60_000, maxRequests: 1, trustedProxyCount: 2 }).middleware();
  const env = { TRUSTED_PROXY_COUNT: '2' };

  const req = {
    socket: { remoteAddress: '127.0.0.1' },
    headers: {
      'x-forwarded-for': '10.0.0.9, 172.64.0.1',
      'x-pp-client-ip': [' 2001:db8::1, 10.0.0.5 '],
    },
  };
  assert.equal(applyForwardedClientIp(req, env), true);
  assert.equal(req.headers['x-forwarded-for'], '2001:db8::1, 172.64.0.1');

  const reqSameUser = {
    socket: { remoteAddress: '127.0.0.1' },
    headers: {
      'x-forwarded-for': '172.64.0.1',
      'x-pp-client-ip': '2001:db8::1',
    },
  };
  assert.equal(applyForwardedClientIp(reqSameUser, env), true);
  assert.equal(reqSameUser.headers['x-forwarded-for'], '2001:db8::1, 172.64.0.1');

  assert.equal(runLimiter(limiter, req).allowed, true);
  assert.equal(runLimiter(limiter, reqSameUser).statusCode, 429);
});

test('applyForwardedClientIp rejects TRUSTED_PROXY_COUNT=0 and malformed x-pp-client-ip without altering bucketing', () => {
  for (const env of [{ TRUSTED_PROXY_COUNT: '0' }, {}, { TRUSTED_PROXY_COUNT: '-1' }, { TRUSTED_PROXY_COUNT: 'abc' }, { TRUSTED_PROXY_COUNT: '0.5' }]) {
    const req = {
      socket: { remoteAddress: '10.0.0.50' },
      headers: { 'x-forwarded-for': '172.64.0.1', 'x-pp-client-ip': '198.51.100.10' },
    };
    assert.equal(applyForwardedClientIp(req, env), false);
    assert.equal(req.headers['x-forwarded-for'], '172.64.0.1');
  }

  const zeroProxyLimiter = new MemoryRateLimiter({ windowMs: 60_000, maxRequests: 1, trustedProxyCount: 0 }).middleware();
  const r1 = { socket: { remoteAddress: '10.0.0.50' }, headers: { 'x-pp-client-ip': '198.51.100.10' } };
  const r2 = { socket: { remoteAddress: '10.0.0.50' }, headers: { 'x-pp-client-ip': '198.51.100.11' } };
  applyForwardedClientIp(r1, { TRUSTED_PROXY_COUNT: '0' });
  applyForwardedClientIp(r2, { TRUSTED_PROXY_COUNT: '0' });
  assert.equal(runLimiter(zeroProxyLimiter, r1).allowed, true);
  assert.equal(runLimiter(zeroProxyLimiter, r2).statusCode, 429);

  const malformedValues = [
    '',
    '   ',
    ', , ',
    'not-an-ip',
    '198.51.100.10; evil=1',
    '198.51.100.10\r\nX-Injected: 1',
    '198.51.100.10\n1.2.3.4',
    '198.51.100.10 1.2.3.4',
    '1'.repeat(65),
  ];
  const proxyLimiter = new MemoryRateLimiter({ windowMs: 60_000, maxRequests: 1, trustedProxyCount: 1 }).middleware();
  const baselineReq = {
    socket: { remoteAddress: '127.0.0.1' },
    headers: { 'x-forwarded-for': '172.64.0.1' },
  };
  assert.equal(runLimiter(proxyLimiter, baselineReq).allowed, true);

  for (const badValue of malformedValues) {
    const badReq = {
      socket: { remoteAddress: '127.0.0.1' },
      headers: { 'x-forwarded-for': '172.64.0.1', 'x-pp-client-ip': badValue },
    };
    assert.equal(applyForwardedClientIp(badReq, { TRUSTED_PROXY_COUNT: '1' }), false);
    assert.equal(badReq.headers['x-forwarded-for'], '172.64.0.1');
    // Still shares the overwritten proxy bucket '172.64.0.1' rather than minting a fresh bucket.
    assert.equal(runLimiter(proxyLimiter, badReq).statusCode, 429);
  }
});

test('createServerlessDispatcher applies forwarded client IP before MemoryRateLimiter runs', async () => {
  const limiter = new MemoryRateLimiter({ windowMs: 60_000, maxRequests: 1, trustedProxyCount: 1 }).middleware();
  const fakeDb = { postgresReachable: true, isPg: true, async verifyConnection() { return true; } };
  const fakeServer = {
    listeners() {
      return [
        (req, res) => limiter(req, res, () => { res.statusCode = 200; res.end('ok'); }),
      ];
    },
  };

  const handler = createServerlessDispatcher({
    server: fakeServer,
    db: fakeDb,
    env: { TRUSTED_PROXY_COUNT: '1' },
  });

  const res1 = mockRes();
  await handler({ url: '/api/listings', socket: { remoteAddress: '127.0.0.1' }, headers: { 'x-forwarded-for': '172.64.0.1', 'x-pp-client-ip': '203.0.113.20' } }, res1);
  assert.equal(res1.statusCode, 200);

  const res2 = mockRes();
  await handler({ url: '/api/listings', socket: { remoteAddress: '127.0.0.1' }, headers: { 'x-forwarded-for': '172.64.0.1', 'x-pp-client-ip': '203.0.113.20' } }, res2);
  assert.equal(res2.statusCode, 429);

  const resOther = mockRes();
  await handler({ url: '/api/listings', socket: { remoteAddress: '127.0.0.1' }, headers: { 'x-forwarded-for': '172.64.0.1', 'x-pp-client-ip': '203.0.113.21' } }, resOther);
  assert.equal(resOther.statusCode, 200);
});

test('proxyPropertyApi sets x-pp-client-ip from x-real-ip or first x-forwarded-for hop and ignores incoming x-pp-client-ip', async () => {
  const { proxyPropertyApi } = await import('../src/lib/property-api.ts');
  const seenHeaders = [];
  const fetchImpl = async (_url, options) => {
    seenHeaders.push(options.headers);
    return Response.json({ ok: true });
  };

  await proxyPropertyApi(
    new Request('https://app.example/api/listings', {
      headers: {
        'x-real-ip': '198.51.100.10',
        'x-forwarded-for': '203.0.113.5, 198.51.100.10',
        'x-pp-client-ip': '1.2.3.4',
      },
    }),
    { apiUrl: 'http://127.0.0.1:3000', fetchImpl },
  );
  assert.equal(seenHeaders[0].get('x-forwarded-for'), '203.0.113.5, 198.51.100.10');
  assert.equal(seenHeaders[0].get('x-pp-client-ip'), '198.51.100.10');

  await proxyPropertyApi(
    new Request('https://app.example/api/listings', {
      headers: {
        'x-forwarded-for': '203.0.113.5, 10.0.0.1',
      },
    }),
    { apiUrl: 'http://127.0.0.1:3000', fetchImpl },
  );
  assert.equal(seenHeaders[1].get('x-forwarded-for'), '203.0.113.5, 10.0.0.1');
  assert.equal(seenHeaders[1].get('x-pp-client-ip'), '203.0.113.5');

  await proxyPropertyApi(
    new Request('https://app.example/api/listings', {
      headers: {
        'x-pp-client-ip': '1.2.3.4',
      },
    }),
    { apiUrl: 'http://127.0.0.1:3000', fetchImpl },
  );
  assert.equal(seenHeaders[2].get('x-forwarded-for'), null);
  assert.equal(seenHeaders[2].get('x-pp-client-ip'), null);
});
