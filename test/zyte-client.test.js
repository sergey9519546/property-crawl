'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  zyteConfigured,
  validatePublicHttpsUrl,
  zyteFetch,
  zyteFetchLike,
  scrapyCloudListJobs,
  scheduleZyteJob,
  DEFAULT_PROJECT_ID,
} = require('../server/scrapers/zyte-client');

test('zyteConfigured: returns false when ZYTE_API_KEY unset and true when set', () => {
  assert.equal(zyteConfigured({}), false);
  assert.equal(zyteConfigured({ ZYTE_API_KEY: '' }), false);
  assert.equal(zyteConfigured({ ZYTE_API_KEY: '   ' }), false);
  assert.equal(zyteConfigured({ ZYTE_API_KEY: 'zyte-test-key-123' }), true);
});

test('validatePublicHttpsUrl: enforces public HTTPS only and rejects private/loopback/credentials', () => {
  const rejected = [
    'http://public-site.com',
    'https://localhost/api',
    'https://sub.localhost/api',
    'https://printer.local/api',
    'https://metadata.internal/api',
    'https://0.0.0.0/api',
    'https://127.0.0.1/meta',
    'https://10.0.0.1/test',
    'https://192.168.1.1/data',
    'https://172.16.0.1/data',
    'https://100.64.0.1/cgnat',
    'https://169.254.169.254/latest/meta-data/',
    'https://[::1]/',
    'https://[::]/',
    'https://[::ffff:127.0.0.1]/',
    'https://[::ffff:7f00:1]/',
    'https://[::ffff:10.0.0.1]/',
    'https://[::ffff:a00:1]/',
    'https://[::ffff:192.168.1.1]/',
    'https://[::ffff:c0a8:101]/',
    'https://[::ffff:169.254.169.254]/',
    'https://[::ffff:a9fe:a9fe]/',
    'https://[::ffff:172.16.0.1]/',
    'https://[::ffff:0.0.0.0]/',
    'https://[0:0:0:0:0:ffff:127.0.0.1]/',
    'https://[fe80::1]/',
    'https://[fd00::1]/',
    'https://[fc00::1]/',
    'https://[64:ff9b::127.0.0.1]/',
    'https://user:pass@goodsite.com/path',
    'not-a-url',
  ];

  for (const url of rejected) {
    const res = validatePublicHttpsUrl(url);
    assert.equal(res.valid, false, `Should reject ${url}`);
  }

  const valid = validatePublicHttpsUrl('https://county.gov/foreclosures/sales.html');
  assert.equal(valid.valid, true);
  assert.equal(valid.parsed.hostname, 'county.gov');
});

test('validatePublicHttpsUrl: returns SSRF_BLOCKED_HOST for IPv6-mapped IPv4 and IPv6 local literals', async () => {
  const ipv6SsrfTargets = [
    'https://[::ffff:127.0.0.1]/',
    'https://[::ffff:7f00:1]/',
    'https://[::ffff:169.254.169.254]/',
    'https://[::ffff:a9fe:a9fe]/',
    'https://[::ffff:10.0.0.1]/',
    'https://[::ffff:a00:1]/',
    'https://[::ffff:192.168.1.1]/',
    'https://[::ffff:c0a8:101]/',
    'https://[::ffff:172.16.0.1]/',
    'https://[::ffff:0.0.0.0]/',
    'https://[fe80::1]/',
    'https://[fd00::1]/',
    'https://[::1]/',
    'https://[::]/',
  ];

  for (const target of ipv6SsrfTargets) {
    const check = validatePublicHttpsUrl(target);
    assert.equal(check.valid, false, `validatePublicHttpsUrl must reject ${target}`);
    assert.equal(check.error, 'SSRF_BLOCKED_HOST', `validatePublicHttpsUrl must return SSRF_BLOCKED_HOST for ${target}`);

    let networkCalled = false;
    const fetchRes = await zyteFetch(target, {
      env: { ZYTE_API_KEY: 'test-key' },
      fetchImpl: async () => {
        networkCalled = true;
        return { ok: true, status: 200, json: async () => ({}) };
      },
    });
    assert.equal(fetchRes.ok, false, `zyteFetch must block ${target}`);
    assert.equal(fetchRes.status, 400);
    assert.equal(fetchRes.error, 'SSRF_BLOCKED_HOST');
    assert.equal(networkCalled, false, `zyteFetch must not dispatch network call for ${target}`);
  }
});

test('zyteFetch: fails closed with 503 when ZYTE_API_KEY is not configured', async () => {
  const res = await zyteFetch('https://public-county.gov/auction', {
    env: {},
  });
  assert.equal(res.ok, false);
  assert.equal(res.status, 503);
  assert.equal(res.error, 'ZYTE_NOT_CONFIGURED');
});

test('zyteFetch: fails with 400 when URL fails SSRF validation', async () => {
  const res = await zyteFetch('https://169.254.169.254/meta-data', {
    env: { ZYTE_API_KEY: 'test-key' },
  });
  assert.equal(res.ok, false);
  assert.equal(res.status, 400);
  assert.equal(res.error, 'SSRF_BLOCKED_HOST');
});

test('zyteFetch: extracts static HTML (httpResponseBody) with basic auth', async () => {
  const mockHtml = '<html><body><h1>County Sales</h1></body></html>';
  const base64Body = Buffer.from(mockHtml, 'utf8').toString('base64');
  let dispatchedAuth = '';
  let dispatchedBody = null;

  const mockFetch = async (url, init) => {
    dispatchedAuth = init.headers.Authorization;
    dispatchedBody = JSON.parse(init.body);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        url: dispatchedBody.url,
        httpResponseBody: base64Body,
      }),
    };
  };

  const res = await zyteFetch('https://county-auctions.gov/list', {
    env: { ZYTE_API_KEY: 'secret-key-xyz' },
    fetchImpl: mockFetch,
  });

  assert.equal(res.ok, true);
  assert.equal(res.status, 200);
  assert.equal(res.html, mockHtml);
  assert.equal(dispatchedBody.browserHtml, undefined);
  assert.equal(dispatchedBody.httpResponseBody, true);
  // Verify basic auth format without logging raw key
  assert.equal(dispatchedAuth, `Basic ${Buffer.from('secret-key-xyz:').toString('base64')}`);
});

test('zyteFetch: extracts dynamic HTML (browserHtml) when browser: true', async () => {
  const mockRenderedHtml = '<div id="app">Dynamic React Portal Listings</div>';
  let dispatchedBody = null;

  const mockFetch = async (url, init) => {
    dispatchedBody = JSON.parse(init.body);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        url: dispatchedBody.url,
        browserHtml: mockRenderedHtml,
      }),
    };
  };

  const res = await zyteFetch('https://portal-app.county.gov/app', {
    browser: true,
    env: { ZYTE_API_KEY: 'secret-key-xyz' },
    fetchImpl: mockFetch,
  });

  assert.equal(res.ok, true);
  assert.equal(res.status, 200);
  assert.equal(res.html, mockRenderedHtml);
  assert.equal(dispatchedBody.browserHtml, true);
  assert.equal(dispatchedBody.httpResponseBody, undefined);
});

test('zyteFetchLike: returns fetch-compatible response shape', async () => {
  const mockJson = { count: 42, county: 'Orange' };
  const base64Json = Buffer.from(JSON.stringify(mockJson), 'utf8').toString('base64');

  const mockFetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ httpResponseBody: base64Json }),
  });

  const res = await zyteFetchLike('https://orange.county.gov/api/data', {
    env: { ZYTE_API_KEY: 'k1' },
    fetchImpl: mockFetch,
  });

  assert.equal(res.ok, true);
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.match(text, /Orange/);
  const parsed = await res.json();
  assert.equal(parsed.count, 42);
});

test('scrapyCloudListJobs: queries Scrapy Cloud jobs with default project ID 870105', async () => {
  let calledUrl = '';
  const mockFetch = async (url) => {
    calledUrl = url;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        total: 2,
        jobs: [
          { id: '870105/1/1', spider: 'nj_civilview', state: 'finished' },
          { id: '870105/1/2', spider: 'fl_realauction', state: 'running' },
        ],
      }),
    };
  };

  const res = await scrapyCloudListJobs({
    env: { ZYTE_API_KEY: 'k1' },
    fetchImpl: mockFetch,
  });

  assert.equal(res.ok, true);
  assert.equal(res.jobs.length, 2);
  assert.ok(calledUrl.includes(`project=${DEFAULT_PROJECT_ID}`));
  assert.ok(calledUrl.includes('count=15'));
});

test('scheduleZyteJob: requires spider and posts form parameters with recipe', async () => {
  const failRes = await scheduleZyteJob({
    spider: '',
    env: { ZYTE_API_KEY: 'k1' },
  });
  assert.equal(failRes.ok, false);
  assert.equal(failRes.error, 'MISSING_SPIDER_NAME');

  let postedBody = '';
  const mockFetch = async (url, init) => {
    postedBody = init.body;
    return {
      ok: true,
      status: 200,
      json: async () => ({ status: 'ok', jobid: '870105/1/3' }),
    };
  };

  const okRes = await scheduleZyteJob({
    spider: 'oh_sheriff',
    recipe: 'foreclosure',
    env: { ZYTE_API_KEY: 'k1' },
    fetchImpl: mockFetch,
  });

  assert.equal(okRes.ok, true);
  assert.equal(okRes.jobId, '870105/1/3');
  const params = new URLSearchParams(postedBody);
  assert.equal(params.get('spider'), 'oh_sheriff');
  assert.equal(params.get('project'), DEFAULT_PROJECT_ID);
  const settings = JSON.parse(params.get('job_settings'));
  assert.equal(settings.LOVABLE_RECIPE, 'foreclosure');
});

test('src/lib/zyte.server TypeScript wrapper re-exports canonical zyte-client operations', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const wrapperRel = '../src/lib/zyte.server';
  const wrapperSrc = fs.readFileSync(path.resolve(__dirname, `${wrapperRel}.ts`), 'utf8');
  assert.match(wrapperSrc, /from "@server\/scrapers\/zyte-client"/);
  for (const fn of ['zyteConfigured', 'zyteFetch', 'zyteFetchLike', 'scrapyCloudListJobs', 'scheduleZyteJob']) {
    assert.match(wrapperSrc, new RegExp(`\\b${fn}\\b`), `zyte.server.ts must expose ${fn}`);
  }
});
