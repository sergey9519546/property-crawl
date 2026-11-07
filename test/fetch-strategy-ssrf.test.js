'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { scraplingHttpGet, waterfallFetch } = require('../server/scrapers/fetch-strategy');

test('scraplingHttpGet rejects private, loopback, metadata, and credential URLs', async () => {
  for (const url of [
    'http://example.com/x',
    'https://127.0.0.1/admin',
    'https://localhost/x',
    'https://10.0.0.5/x',
    'https://192.168.1.1/x',
    'https://172.16.0.1/x',
    'https://169.254.169.254/latest/meta-data/',
    'https://user:pass@example.com/x',
    'https://[::1]/x',
  ]) {
    const result = await scraplingHttpGet(url);
    assert.equal(result.ok, false, url);
    assert.equal(result.error, 'SCRAPLING_INVALID_URL', url);
    assert.equal(result.tier, 'scrapling-http');
  }
});

test('waterfallFetch treats empty native body as failure and keeps Scrapling SSRF fail-closed', async () => {
  const result = await waterfallFetch({
    url: 'https://169.254.169.254/latest/meta-data/',
    sourceKey: 'gsa',
    nativeFetch: async () => null,
    env: { SCRAPLING_SOURCES: 'gsa', SCRAPLING_PYTHON: process.execPath },
  });
  assert.equal(result.ok, false);
  assert.equal(result.tier, 'fail-closed');
  assert.ok(result.attempts.some((a) => a.tier === 'native' && a.error === 'empty_body'));
  const scraplingAttempt = result.attempts.find((a) => a.tier === 'scrapling-http');
  if (scraplingAttempt) {
    assert.equal(scraplingAttempt.ok, false);
  }
});

test('waterfallFetch still succeeds when native returns non-empty HTML', async () => {
  const result = await waterfallFetch({
    url: 'https://example.com/listing',
    sourceKey: 'gsa',
    nativeFetch: async () => '<html>ok</html>',
  });
  assert.equal(result.ok, true);
  assert.equal(result.tier, 'native');
  assert.match(result.html, /ok/);
});

test('native fetch tier refuses private, loopback, metadata, and credential URLs before any request', async () => {
  const { fetchTextWithPolicy, assertFetchableUrl } = require('../server/scrapers/http');
  for (const [url, reason] of [
    ['http://169.254.169.254/latest/meta-data/', 'SSRF_BLOCKED_HOST'],
    ['https://127.0.0.1/admin', 'SSRF_BLOCKED_HOST'],
    ['https://10.0.0.5/x', 'SSRF_BLOCKED_HOST'],
    ['https://user:pass@example.com/x', 'SSRF_CREDENTIALS_IN_URL'],
    ['file:///etc/passwd', 'SSRF_UNSUPPORTED_PROTOCOL'],
  ]) {
    assert.equal(assertFetchableUrl(url).reason, reason, url);
  }
  let fetchCalls = 0;
  await assert.rejects(
    fetchTextWithPolicy('http://169.254.169.254/latest/meta-data/', {
      fetchImpl: async () => { fetchCalls++; return { text: async () => 'secret' }; },
      autoThrottle: false,
    }),
    (error) => error.code === 'SSRF_BLOCKED_HOST'
  );
  assert.equal(fetchCalls, 0, 'a blocked host must be refused before the transport is used');
});

test('native fetch tier re-validates the final URL after redirects and never reads a private body', async () => {
  const { fetchTextWithPolicy } = require('../server/scrapers/http');
  let bodyReads = 0;
  await assert.rejects(
    fetchTextWithPolicy('https://publisher.example/start', {
      fetchImpl: async () => ({
      url: 'http://169.254.169.254/latest/meta-data/',
      status: 200,
      headers: { get: () => null },
      text: async () => { bodyReads++; return 'secret'; },
      }),
      autoThrottle: false,
    }),
    (error) => error.code === 'SSRF_BLOCKED_HOST'
  );
  assert.equal(bodyReads, 0, 'a redirect onto a private host must not leak the internal response body');
});

test('native fetch tier still succeeds for a public publisher URL', async () => {
  const { fetchTextWithPolicy } = require('../server/scrapers/http');
  const body = await fetchTextWithPolicy('https://salesweb.civilview.com/Sales/SaleDetails', {
    fetchImpl: async () => ({ url: 'https://salesweb.civilview.com/Sales/SaleDetails', status: 200, headers: { get: () => null }, text: async () => '<html>public</html>' }),
    autoThrottle: false,
  });
  assert.match(body, /public/);
});
