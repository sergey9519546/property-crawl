import { test } from 'node:test';
import assert from 'node:assert/strict';
import { proxyPropertyApi } from '../src/lib/property-api.ts';
import { appOrigin } from '../src/lib/app-origin.ts';
import {
  SAVED_LISTINGS_DEVICE_KEY,
  readDeviceWatchlistIds,
  toggleDeviceWatchlistId,
  syncDeviceWatchlistToServer,
} from '../src/lib/watchlist-sync.ts';

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

test('walkthrough and property images use the canonical metadata gate and preserve media attribution', async () => {
  const response = await proxyPropertyApi(new Request('https://app.example/api/property-image?listingId=NEW-123&mode=walkthrough'), {
    apiUrl: 'http://127.0.0.1:3102',
    fetchImpl: async (url) => {
      assert.equal(url, 'http://127.0.0.1:3102/api/property-image?listingId=NEW-123&mode=walkthrough');
      return Response.json({available: true, coverage: 'nearby_street'}, {headers: {
        'x-property-image-attribution': 'Google Maps', 'referrer-policy': 'no-referrer', 'cross-origin-resource-policy': 'same-origin',
      }});
    },
  });
  assert.equal((await response.json()).coverage, 'nearby_street');
  assert.equal(response.headers.get('x-property-image-attribution'), 'Google Maps');
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
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

test('property-image providers route is proxied cleanly to canonical backend', async () => {
  let calledUrl = '';
  const response = await proxyPropertyApi(new Request('https://app.example/api/property-image/providers'), {
    apiUrl: 'http://127.0.0.1:3102',
    fetchImpl: async (url) => {
      calledUrl = url;
      return Response.json({ schema: 'property-crawl.property-image-providers/v1', providers: [] });
    },
  });
  assert.equal(calledUrl, 'http://127.0.0.1:3102/api/property-image/providers');
  assert.equal(response.status, 200);
});

test('proxyPropertyApi caches public-domain USGS/USDA aerial tiles and keeps no-store for Street View images', async () => {
  const usgsAerial = await proxyPropertyApi(
    new Request('https://app.example/api/property-image?listingId=NJ-1&mode=aerial'),
    {
      apiUrl: 'http://127.0.0.1:3102',
      fetchImpl: async () => new Response(Buffer.from([0xff, 0xd8, 0xff, 0xe0]), {
        status: 200,
        headers: {
          'content-type': 'image/jpeg',
          'cache-control': 'public, max-age=604800, stale-while-revalidate=2592000',
          'x-property-image-provider': 'USGS National Map',
          'x-property-image-coordinate-basis': 'source_coordinates',
          'x-property-image-coordinate-precision': 'source_observed',
        },
      }),
    },
  );
  assert.equal(usgsAerial.headers.get('cache-control'), 'public, max-age=604800, stale-while-revalidate=2592000');
  assert.equal(usgsAerial.headers.get('x-property-image-coordinate-basis'), 'source_coordinates');
  assert.equal(usgsAerial.headers.get('x-property-image-coordinate-precision'), 'source_observed');

  const streetViewImage = await proxyPropertyApi(
    new Request('https://app.example/api/property-image?listingId=NJ-1&mode=image'),
    {
      apiUrl: 'http://127.0.0.1:3102',
      fetchImpl: async () => new Response(Buffer.from([0xff, 0xd8, 0xff, 0xe0]), {
        status: 200,
        headers: {
          'content-type': 'image/jpeg',
          'cache-control': 'public, max-age=86400',
          'x-property-image-provider': 'Google Maps',
        },
      }),
    },
  );
  assert.equal(streetViewImage.headers.get('cache-control'), 'no-store');
});

test('proxyPropertyApi preserves server-injected operatorToken even when client sends a rogue Authorization header', async () => {
  const seenHeaders = [];
  const fetchImpl = async (_url, options) => {
    seenHeaders.push(options.headers);
    return Response.json({ ok: true });
  };

  // Operator route: operatorToken without accountId must not be clobbered by client Authorization
  await proxyPropertyApi(
    new Request('https://app.example/api/scrapers', {
      headers: { authorization: 'Bearer attacker-forged-token' },
    }),
    { apiUrl: 'http://127.0.0.1:3102', operatorToken: 'server-operator-secret', role: 'operator', fetchImpl },
  );
  assert.equal(seenHeaders[0].get('authorization'), 'Bearer server-operator-secret');
  assert.equal(seenHeaders[0].get('x-pp-account'), null);
  assert.equal(seenHeaders[0].get('x-pp-role'), 'operator');

  // Member route: operatorToken with accountId sets x-pp-account and keeps server token
  await proxyPropertyApi(
    new Request('https://app.example/api/hunts', {
      headers: { authorization: 'Bearer attacker-forged-token' },
    }),
    { apiUrl: 'http://127.0.0.1:3102', operatorToken: 'server-operator-secret', accountId: 'acct_123', fetchImpl },
  );
  assert.equal(seenHeaders[1].get('authorization'), 'Bearer server-operator-secret');
  assert.equal(seenHeaders[1].get('x-pp-account'), 'acct_123');

  // Unprivileged route: without operatorToken, incoming Authorization continues to pass through
  await proxyPropertyApi(
    new Request('https://app.example/api/listings', {
      headers: { authorization: 'Bearer caller-token' },
    }),
    { apiUrl: 'http://127.0.0.1:3102', fetchImpl },
  );
  assert.equal(seenHeaders[2].get('authorization'), 'Bearer caller-token');
});

test('watchlist-sync persists guest saves and idempotently reconciles them into /api/alerts', async () => {
  const store = new Map();
  const storage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => { store.set(key, value); },
    removeItem: (key) => { store.delete(key); },
  };

  assert.equal(SAVED_LISTINGS_DEVICE_KEY, 'perfectproperty:saved-listings');
  toggleDeviceWatchlistId('L-LOCAL-1', false, storage);
  toggleDeviceWatchlistId('L-SHARED', false, storage);
  toggleDeviceWatchlistId('L-RETIRED', false, storage);
  assert.deepEqual(readDeviceWatchlistIds(storage), ['L-LOCAL-1', 'L-SHARED', 'L-RETIRED']);

  const serverDeals = new Set(['L-SHARED']);
  const postCalls = [];
  const skippedIds = new Set();

  const fetchImpl = async (url, init = {}) => {
    assert.equal(url, '/api/alerts');
    if (!init.method || init.method === 'GET') {
      const deals = Array.from(serverDeals).map((id) => ({ id, listingId: id }));
      return Response.json({ savedCount: deals.length, deals });
    }
    if (init.method === 'POST') {
      const { listingId } = JSON.parse(String(init.body || '{}'));
      postCalls.push(listingId);
      if (listingId === 'L-RETIRED') {
        return Response.json({ error: 'Listing not found' }, { status: 404 });
      }
      serverDeals.add(listingId);
      return Response.json({ success: true }, { status: 201 });
    }
    throw new Error(`Unexpected method ${init.method}`);
  };

  const first = await syncDeviceWatchlistToServer({ storage, fetchImpl, skippedIds });
  assert.deepEqual(postCalls.sort(), ['L-LOCAL-1', 'L-RETIRED']);
  assert.deepEqual(first.syncedIds, ['L-LOCAL-1']);
  assert.deepEqual(first.ids.sort(), ['L-LOCAL-1', 'L-SHARED']);
  assert.equal(first.savedCount, 2);
  assert.deepEqual(readDeviceWatchlistIds(storage), ['L-RETIRED']);

  // Second pass must be idempotent: no duplicate POST for L-LOCAL-1, L-SHARED, or permanently rejected L-RETIRED.
  postCalls.length = 0;
  const second = await syncDeviceWatchlistToServer({ storage, fetchImpl, skippedIds });
  assert.deepEqual(postCalls, []);
  assert.deepEqual(second.syncedIds, []);
  assert.equal(second.savedCount, 2);
});

test('appOrigin validates https NEXT_PUBLIC_APP_URL fallback in production and rejects unsafe origins', () => {
  const req = new Request('https://spoofed.attacker.example/api/account/login');

  assert.equal(
    appOrigin(req, {
      NODE_ENV: 'production',
      PUBLIC_APP_ORIGIN: 'https://perfectproperty.bid/',
      NEXT_PUBLIC_APP_URL: 'https://other.example',
    }),
    'https://perfectproperty.bid',
  );

  assert.equal(
    appOrigin(req, {
      NODE_ENV: 'production',
      NEXT_PUBLIC_APP_URL: 'https://app.perfectproperty.bid/listings',
    }),
    'https://app.perfectproperty.bid',
  );

  for (const unsafe of [
    'http://perfectproperty.bid',
    'https://*.perfectproperty.bid',
    '*',
    'javascript:alert(1)',
    'https://user:pass@perfectproperty.bid',
    'not-a-valid-url',
    '',
  ]) {
    assert.equal(
      appOrigin(req, { NODE_ENV: 'production', NEXT_PUBLIC_APP_URL: unsafe }),
      null,
      `expected production appOrigin to reject unsafe NEXT_PUBLIC_APP_URL=${unsafe}`,
    );
  }

  assert.equal(
    appOrigin(new Request('http://127.0.0.1:3001/api/account/login'), { NODE_ENV: 'development' }),
    'http://127.0.0.1:3001',
  );
});
