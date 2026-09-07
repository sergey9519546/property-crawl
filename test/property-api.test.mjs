import { test } from 'node:test';
import assert from 'node:assert/strict';
import { proxyPropertyApi } from '../src/lib/property-api.ts';

test('Next listing transport resolves the canonical API and preserves exact record identity', async () => {
  let calledUrl;
  const response = await proxyPropertyApi(new Request('https://app.example/api/listings/NEW-123'), {
    apiUrl: 'http://127.0.0.1:3102',
    fetchImpl: async (url, options) => {
      calledUrl = url;
      assert.equal(options.cache, 'no-store');
      assert.equal(options.redirect, 'error');
      return Response.json({ id: 'NEW-123', address: 'Newly collected property' });
    },
  });
  assert.equal(calledUrl, 'http://127.0.0.1:3102/api/listings/NEW-123');
  assert.equal((await response.json()).id, 'NEW-123');
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('cross-origin writes and unrelated paths cannot reach the canonical API', async () => {
  const neverFetch = async () => { throw new Error('should not call upstream'); };
  const denied = await proxyPropertyApi(new Request('https://app.example/api/enrich', { method: 'POST', headers: { origin: 'https://attacker.example' } }), { fetchImpl: neverFetch });
  assert.equal(denied.status, 403);
  assert.equal((await proxyPropertyApi(new Request('https://app.example/admin'), { fetchImpl: neverFetch })).status, 404);
});

test('canonical API failure returns unavailable, never a different snapshot record', async () => {
  const response = await proxyPropertyApi(new Request('https://app.example/api/listings'), { fetchImpl: async () => { throw new Error('offline'); } });
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.listings, undefined);
  assert.match(body.error, /No substitute records/);
});

test('evidence audit and exports preserve request bodies and download headers', async () => {
  const response = await proxyPropertyApi(new Request('https://app.example/api/verify-docket', { method: 'POST', body: JSON.stringify({ listingId: 'NEW-123' }), headers: { 'content-type': 'application/json' } }), {
    fetchImpl: async (_, options) => {
      assert.equal(JSON.parse(new TextDecoder().decode(options.body)).listingId, 'NEW-123');
      assert.equal(options.headers.get('authorization'), null);
      return new Response('evidence', { headers: { 'content-type': 'text/csv', 'content-disposition': 'attachment; filename="evidence.csv"' } });
    },
  });
  assert.equal(await response.text(), 'evidence');
  assert.match(response.headers.get('content-disposition'), /evidence.csv/);
});

test('oversized bodies are rejected before any upstream request', async () => {
  const response = await proxyPropertyApi(new Request('https://app.example/api/enrich', { method: 'POST', body: 'x'.repeat(2 * 1024 * 1024 + 1) }));
  assert.equal(response.status, 413);
});

test('health and scraper telemetry use the canonical backend and never invent admin credentials', async () => {
  for (const route of ['health', 'sources', 'scrapers', 'scrapers/health']) {
    const response = await proxyPropertyApi(new Request(`https://app.example/api/${route}`), {
      fetchImpl: async (url, options) => {
        assert.ok(url.endsWith(`/api/${route}`));
        assert.equal(options.headers.get('x-scraper-token'), null);
        return Response.json({ status: 'canonical-backend' });
      },
    });
    assert.equal((await response.json()).status, 'canonical-backend');
  }
  const offline = await proxyPropertyApi(new Request('https://app.example/api/health'), { fetchImpl: async () => { throw new Error('offline'); } });
  assert.equal(offline.status, 503);
});

test('rate limits preserve retry guidance through the UI proxy', async () => {
  const response = await proxyPropertyApi(new Request('https://app.example/api/listings'), {
    fetchImpl: async () => Response.json({ error: 'Too Many Requests' }, { status: 429, headers: { 'Retry-After': '45', 'X-RateLimit-Limit': '120' } }),
  });
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('retry-after'), '45');
  assert.equal(response.headers.get('x-ratelimit-limit'), '120');
});

test('opportunity signals route proxies through to canonical backend', async () => {
  let calledUrl = '';
  const response = await proxyPropertyApi(new Request('https://app.example/api/property-signals?listingId=FL-100'), {
    apiUrl: 'http://127.0.0.1:3102',
    fetchImpl: async (url) => {
      calledUrl = url;
      return Response.json({ triagePriority: 85, signals: [] });
    },
  });
  assert.equal(calledUrl, 'http://127.0.0.1:3102/api/property-signals?listingId=FL-100');
  const data = await response.json();
  assert.equal(data.triagePriority, 85);
});
