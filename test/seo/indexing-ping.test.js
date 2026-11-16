'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  submitIndexNowUrls,
  pingSitemap,
  INDEXNOW_ENDPOINT,
  DEFAULT_TEST_KEY,
  MAX_URLS_PER_CHUNK,
  DEFAULT_HOST,
  DEFAULT_SITEMAP_URL,
  SITEMAP_PING_ENDPOINTS,
  DEPRECATED_SITEMAP_PING_ENDPOINTS,
} = require('../../server/seo/indexing-ping.js');

test('IndexNow: dryRun mode constructs valid payload without HTTP requests', async () => {
  const sampleUrls = [
    'https://perfectproperty.org/',
    'https://perfectproperty.org/listings',
    'https://perfectproperty.org/states/FL/orange',
  ];

  const result = await submitIndexNowUrls({
    host: 'perfectproperty.org',
    key: 'test_custom_key_123',
    keyLocation: 'https://perfectproperty.org/test_custom_key_123.txt',
    urls: sampleUrls,
    dryRun: true,
  });

  assert.equal(result.success, true);
  assert.equal(result.submittedCount, 3);
  assert.equal(result.dryRun, true);
  assert.equal(result.batches.length, 1);

  const batch = result.batches[0];
  assert.equal(batch.batch, 1);
  assert.equal(batch.count, 3);
  assert.equal(batch.dryRun, true);
  assert.equal(batch.endpoint, INDEXNOW_ENDPOINT);

  assert.deepEqual(batch.payload, {
    host: 'perfectproperty.org',
    key: 'test_custom_key_123',
    keyLocation: 'https://perfectproperty.org/test_custom_key_123.txt',
    urlList: sampleUrls,
  });
});

test('IndexNow: batching chunks URLs into slices of <= 10,000', async () => {
  const totalCount = 15500;
  const largeUrlList = Array.from({ length: totalCount }, (_, i) => `https://perfectproperty.org/listings/${i + 1}`);

  const result = await submitIndexNowUrls({
    host: 'perfectproperty.org',
    urls: largeUrlList,
    dryRun: true,
  });

  assert.equal(result.success, true);
  assert.equal(result.submittedCount, totalCount);
  assert.equal(result.batches.length, 2);

  assert.equal(result.batches[0].count, MAX_URLS_PER_CHUNK); // 10,000
  assert.equal(result.batches[0].payload.urlList.length, MAX_URLS_PER_CHUNK);

  assert.equal(result.batches[1].count, 5500);
  assert.equal(result.batches[1].payload.urlList.length, 5500);
});

test('IndexNow: sends valid POST request to API endpoint with mocked fetch', async () => {
  const capturedRequests = [];
  const mockFetch = async (url, opts) => {
    capturedRequests.push({ url, opts });
    return {
      status: 200,
      ok: true,
    };
  };

  const sampleUrls = [
    'https://perfectproperty.org/states/NJ/essex',
    'https://perfectproperty.org/states/OH/cuyahoga',
  ];

  const result = await submitIndexNowUrls({
    host: 'perfectproperty.org',
    key: 'my_verified_key',
    urls: sampleUrls,
    dryRun: false,
    fetchFn: mockFetch,
  });

  assert.equal(result.success, true);
  assert.equal(result.errors.length, 0);
  assert.equal(capturedRequests.length, 1);

  const req = capturedRequests[0];
  assert.equal(req.url, INDEXNOW_ENDPOINT);
  assert.equal(req.opts.method, 'POST');
  assert.equal(req.opts.headers['Content-Type'], 'application/json; charset=utf-8');

  const parsedBody = JSON.parse(req.opts.body);
  assert.equal(parsedBody.host, 'perfectproperty.org');
  assert.equal(parsedBody.key, 'my_verified_key');
  assert.deepEqual(parsedBody.urlList, sampleUrls);
});

test('IndexNow: handles empty list and network errors gracefully', async () => {
  // Empty array
  const emptyRes = await submitIndexNowUrls({ urls: [] });
  assert.equal(emptyRes.success, true);
  assert.equal(emptyRes.submittedCount, 0);
  assert.equal(emptyRes.batches.length, 0);

  // Network rejection
  const failingFetch = async () => {
    throw new Error('Connection reset by peer');
  };

  const failRes = await submitIndexNowUrls({
    urls: ['https://perfectproperty.org/listings/1'],
    fetchFn: failingFetch,
  });

  assert.equal(failRes.success, false);
  assert.equal(failRes.errors.length, 1);
  assert.match(failRes.errors[0].message, /Connection reset by peer/);
});

test('IndexNow: refuses default_test_key and unset key when NODE_ENV === production', async () => {
  let fetchCalled = 0;
  const mockFetch = async () => {
    fetchCalled += 1;
    return { ok: true, status: 200 };
  };

  const unsetProd = await submitIndexNowUrls({
    host: DEFAULT_HOST,
    urls: ['https://perfectproperty.org/listings/1'],
    env: { NODE_ENV: 'production' },
    fetchFn: mockFetch,
  });
  assert.equal(unsetProd.success, false);
  assert.equal(unsetProd.submittedCount, 0);
  assert.equal(unsetProd.batches.length, 0);
  assert.equal(unsetProd.errors[0].code, 'INDEXNOW_KEY_REQUIRED');

  const explicitDefaultProd = await submitIndexNowUrls({
    host: DEFAULT_HOST,
    key: DEFAULT_TEST_KEY,
    urls: ['https://perfectproperty.org/listings/1'],
    env: { NODE_ENV: 'production' },
    dryRun: true,
    fetchFn: mockFetch,
  });
  assert.equal(explicitDefaultProd.success, false);
  assert.equal(explicitDefaultProd.errors[0].code, 'INDEXNOW_KEY_REQUIRED');
  assert.equal(fetchCalled, 0);

  const realKeyProd = await submitIndexNowUrls({
    host: DEFAULT_HOST,
    urls: ['https://perfectproperty.org/listings/1'],
    env: { NODE_ENV: 'production', INDEXNOW_KEY: 'prod_verified_indexnow_key' },
    fetchFn: mockFetch,
  });
  assert.equal(realKeyProd.success, true);
  assert.equal(fetchCalled, 1);
});

test('Sitemap Ping: defaults to IndexNow only and excludes retired Google/Bing endpoints by default', async () => {
  assert.equal(SITEMAP_PING_ENDPOINTS.google, undefined);
  assert.equal(SITEMAP_PING_ENDPOINTS.bing, undefined);
  assert.equal(SITEMAP_PING_ENDPOINTS.indexnow, INDEXNOW_ENDPOINT);
  assert.match(DEPRECATED_SITEMAP_PING_ENDPOINTS.google, /google\.com\/ping/);
  assert.match(DEPRECATED_SITEMAP_PING_ENDPOINTS.bing, /bing\.com\/ping/);

  const calls = [];
  const pingRes = await pingSitemap({
    sitemapUrl: 'https://perfectproperty.org/sitemap.xml',
    dryRun: true,
    fetchFn: async (url) => {
      calls.push(url);
      return { ok: true, status: 200 };
    },
  });

  assert.equal(pingRes.success, true);
  assert.equal(pingRes.results.length, 1);
  assert.equal(pingRes.results[0].engine, 'indexnow');
  assert.equal(pingRes.results[0].url, INDEXNOW_ENDPOINT);
  assert.equal(pingRes.results[0].status, 200);
  assert.equal(calls.length, 0);
});

test('Sitemap Ping: skips retired Google/Bing URLs unless allowDeprecatedEndpoints is explicitly set and rejects unknown engines', async () => {
  const pingCalls = [];
  const mockFetch = async (url) => {
    pingCalls.push(url);
    return { ok: true, status: 200 };
  };

  const blockedRes = await pingSitemap({
    sitemapUrl: DEFAULT_SITEMAP_URL,
    engines: ['google', 'bing', 'unknown_engine'],
    dryRun: false,
    fetchFn: mockFetch,
  });

  assert.equal(pingCalls.length, 0);
  assert.equal(blockedRes.success, false);
  assert.equal(blockedRes.results.length, 2);
  assert.equal(blockedRes.results.every((r) => r.deprecated === true && r.skipped === true && r.status === 410), true);
  assert.equal(blockedRes.errors.length, 3);
  assert.match(blockedRes.errors[2].message, /Unsupported search engine/);

  const optInRes = await pingSitemap({
    sitemapUrl: DEFAULT_SITEMAP_URL,
    engines: ['google', 'bing'],
    allowDeprecatedEndpoints: true,
    dryRun: false,
    fetchFn: mockFetch,
  });

  assert.equal(optInRes.success, true);
  assert.equal(pingCalls.length, 2);
  assert.match(pingCalls[0], /google\.com\/ping\?sitemap=/);
  assert.match(pingCalls[1], /bing\.com\/ping\?sitemap=/);
});
