'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  submitIndexNowUrls,
  pingSitemap,
  INDEXNOW_ENDPOINT,
  MAX_URLS_PER_CHUNK,
  DEFAULT_HOST,
  DEFAULT_SITEMAP_URL,
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

test('Sitemap Ping: dryRun mode simulates pings to Google and Bing', async () => {
  const pingRes = await pingSitemap({
    sitemapUrl: 'https://perfectproperty.org/sitemap.xml',
    engines: ['google', 'bing'],
    dryRun: true,
  });

  assert.equal(pingRes.success, true);
  assert.equal(pingRes.results.length, 2);

  const google = pingRes.results.find((r) => r.engine === 'google');
  assert.ok(google);
  assert.equal(google.status, 200);
  assert.match(google.url, /google\.com\/ping\?sitemap=https%3A%2F%2Fperfectproperty\.org%2Fsitemap\.xml/);

  const bing = pingRes.results.find((r) => r.engine === 'bing');
  assert.ok(bing);
  assert.equal(bing.status, 200);
  assert.match(bing.url, /bing\.com\/ping\?sitemap=https%3A%2F%2Fperfectproperty\.org%2Fsitemap\.xml/);
});

test('Sitemap Ping: sends HTTP GET requests via mock fetch and handles unsupported engines', async () => {
  const pingCalls = [];
  const mockFetch = async (url) => {
    pingCalls.push(url);
    return { ok: true, status: 200 };
  };

  const pingRes = await pingSitemap({
    sitemapUrl: DEFAULT_SITEMAP_URL,
    engines: ['google', 'bing', 'unknown_engine'],
    dryRun: false,
    fetchFn: mockFetch,
  });

  assert.equal(pingCalls.length, 2);
  assert.equal(pingRes.errors.length, 1);
  assert.match(pingRes.errors[0].message, /Unsupported search engine/);
});
