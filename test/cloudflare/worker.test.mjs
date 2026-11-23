import test from 'node:test';
import assert from 'node:assert/strict';

import worker from '../../cloudflare/property-crawl-edge/worker.js';

function createMockCache() {
  const store = new Map();
  return {
    store,
    async match(req) {
      const key = typeof req === 'string' ? req : req.url;
      const hit = store.get(key);
      return hit ? hit.clone() : undefined;
    },
    async put(req, res) {
      const key = typeof req === 'string' ? req : req.url;
      store.set(key, res.clone());
    },
  };
}

function createCtx() {
  const pending = [];
  return {
    pending,
    waitUntil(promise) {
      pending.push(Promise.resolve(promise));
    },
    async flush() {
      await Promise.allSettled(pending);
    },
  };
}

test('Cloudflare edge worker serves /health, rejects private/traversal /vault keys, and serves public R2 objects with range/304', async () => {
  const bodyBytes = new TextEncoder().encode('0123456789ABCDEF');
  const vaultCalls = [];
  const env = {
    ORIGIN_URL: 'https://property-crawl-api.vercel.app',
    VAULT: {
      async head(key) {
        vaultCalls.push(['head', key]);
        if (key !== 'public/doc.pdf') return null;
        return {
          size: bodyBytes.length,
          httpEtag: '"etag-1"',
          etag: 'etag-1',
          writeHttpMetadata(h) { h.set('content-type', 'application/pdf'); },
        };
      },
      async get(key, opts) {
        vaultCalls.push(['get', key, opts]);
        if (key !== 'public/doc.pdf') return null;
        const headers = opts?.range;
        if (headers?.get?.('if-none-match') === '"etag-1"') {
          return {
            size: bodyBytes.length,
            httpEtag: '"etag-1"',
            etag: 'etag-1',
            writeHttpMetadata(h) { h.set('content-type', 'application/pdf'); },
          };
        }
        const isRange = headers?.get?.('range') === 'bytes=0-3';
        return {
          size: bodyBytes.length,
          httpEtag: '"etag-1"',
          etag: 'etag-1',
          range: isRange ? { offset: 0, length: 4 } : undefined,
          body: isRange ? bodyBytes.slice(0, 4) : bodyBytes,
          writeHttpMetadata(h) { h.set('content-type', 'application/pdf'); },
        };
      },
    },
  };

  const healthRes = await worker.fetch(new Request('https://edge.perfectproperty.bid/health'), env, createCtx());
  assert.equal(healthRes.status, 200);
  const health = await healthRes.json();
  assert.equal(health.ok, true);
  assert.equal(health.vaultBound, true);

  const privRes = await worker.fetch(new Request('https://edge.perfectproperty.bid/vault/private/secret.pdf'), env, createCtx());
  assert.equal(privRes.status, 403);

  const travRes = await worker.fetch(new Request('https://edge.perfectproperty.bid/vault/public/%2e%2e/secret.pdf'), env, createCtx());
  assert.equal(travRes.status, 403);

  const headRes = await worker.fetch(new Request('https://edge.perfectproperty.bid/vault/public/doc.pdf', { method: 'HEAD', headers: { 'If-None-Match': '"etag-1"' } }), env, createCtx());
  assert.equal(headRes.status, 304);

  const rangeRes = await worker.fetch(new Request('https://edge.perfectproperty.bid/vault/public/doc.pdf', { headers: { Range: 'bytes=0-3' } }), env, createCtx());
  assert.equal(rangeRes.status, 206);
  assert.equal(rangeRes.headers.get('content-range'), 'bytes 0-3/16');
  assert.equal(rangeRes.headers.get('content-security-policy'), "default-src 'none'; sandbox");
  assert.equal(await rangeRes.text(), '0123');
});

test('Cloudflare edge worker caches CACHEABLE_PATHS without Vary: Origin, skips cache when Vary: Origin, and sets x-edge-secret', async () => {
  const prevCaches = globalThis.caches;
  const prevFetch = globalThis.fetch;
  const mockCache = createMockCache();
  globalThis.caches = { default: mockCache };

  let upstreamCalls = 0;
  let lastUpstreamHeaders = null;
  let varyOriginMode = false;
  globalThis.fetch = async (url, init) => {
    upstreamCalls += 1;
    lastUpstreamHeaders = new Headers(init?.headers || {});
    if (String(url).includes('/api/property-image')) {
      return new Response('img', { status: 200, headers: { 'Cache-Control': 'public, max-age=3600' } });
    }
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        Vary: varyOriginMode ? 'Origin, Accept-Encoding' : 'Accept-Encoding',
      },
    });
  };

  try {
    const env = {
      ORIGIN_URL: 'https://property-crawl-api.vercel.app',
      EDGE_SHARED_SECRET: 'edge-shared-secret-value',
    };

    // 1. Vary: Origin blocks edge cache storage
    varyOriginMode = true;
    const ctx1 = createCtx();
    const resVary = await worker.fetch(new Request('https://edge.perfectproperty.bid/api/sources', { headers: { 'cf-connecting-ip': '203.0.113.5' } }), env, ctx1);
    await ctx1.flush();
    assert.equal(resVary.status, 200);
    assert.equal(resVary.headers.get('X-Edge-Cache'), null);
    assert.equal(lastUpstreamHeaders.get('x-edge-secret'), 'edge-shared-secret-value');
    assert.equal(lastUpstreamHeaders.get('x-pp-client-ip'), '203.0.113.5');

    // 2. Clean Vary: Accept-Encoding populates cache (MISS -> HIT)
    varyOriginMode = false;
    const ctx2 = createCtx();
    const missRes = await worker.fetch(new Request('https://edge.perfectproperty.bid/api/sources'), env, ctx2);
    await ctx2.flush();
    assert.equal(missRes.headers.get('X-Edge-Cache'), 'MISS');

    const ctx3 = createCtx();
    const hitRes = await worker.fetch(new Request('https://edge.perfectproperty.bid/api/sources'), env, ctx3);
    await ctx3.flush();
    assert.equal(hitRes.headers.get('X-Edge-Cache'), 'HIT');
    assert.equal(upstreamCalls, 2);

    // 3. NO_STORE_PREFIXES forces Cache-Control: no-store, max-age=0
    const imgRes = await worker.fetch(new Request('https://edge.perfectproperty.bid/api/property-image/123'), env, createCtx());
    assert.equal(imgRes.headers.get('Cache-Control'), 'no-store, max-age=0');
  } finally {
    globalThis.caches = prevCaches;
    globalThis.fetch = prevFetch;
  }
});

test('Cloudflare edge worker scheduled() maps cron expressions to actions, aborts cleanly if token missing, and alerts on failure', async () => {
  const prevFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ url: String(url), headers: Object.fromEntries(new Headers(init?.headers || {}).entries()), body });
    if (body?.action === 'repair-enrichment') {
      return new Response('upstream failure', { status: 502 });
    }
    return new Response(JSON.stringify({ status: 'completed' }), { status: 200 });
  };

  try {
    // Missing token skips cleanly
    await worker.scheduled({ cron: '*/5 * * * *' }, {}, createCtx());
    assert.equal(calls.length, 0);

    const env = {
      API_ORIGIN: 'https://property-crawl-api.vercel.app',
      SCRAPER_ADMIN_TOKEN: 'op-secret',
      EDGE_SHARED_SECRET: 'edge-sec',
      ALERT_WEBHOOK_URL: 'https://hooks.example.test/alert',
    };

    const ctxSlice = createCtx();
    await worker.scheduled({ cron: '*/5 * * * *' }, env, ctxSlice);
    await ctxSlice.flush();
    assert.equal(calls[0].body.action, 'next-slice');
    assert.equal(calls[0].headers['x-edge-secret'], 'edge-sec');

    const ctxPrune = createCtx();
    await worker.scheduled({ cron: '17 */6 * * *' }, env, ctxPrune);
    await ctxPrune.flush();
    assert.equal(calls[1].body.action, 'prune');

    const ctxEnrich = createCtx();
    await worker.scheduled({ cron: '29 * * * *' }, env, ctxEnrich);
    await ctxEnrich.flush();
    assert.equal(calls[2].body.action, 'repair-enrichment');
    assert.equal(calls[3].url, 'https://hooks.example.test/alert');
    assert.equal(calls[3].body.event, 'edge_cron_failure');
    assert.equal(calls[3].body.action, 'repair-enrichment');

    const ctxSecondLook = createCtx();
    await worker.scheduled({ cron: '41 */6 * * *' }, env, ctxSecondLook);
    await ctxSecondLook.flush();
    assert.equal(calls[4].body.action, 'second-look');

    const ctxDigests = createCtx();
    await worker.scheduled({ cron: '53 */6 * * *' }, env, ctxDigests);
    await ctxDigests.flush();
    assert.equal(calls[5].body.action, 'dispatch-digests');
  } finally {
    globalThis.fetch = prevFetch;
  }
});

test('Cloudflare edge worker email() rejects when token missing and forwards raw MIME to /api/scrapers/run', async () => {
  const prevFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({
      url: String(url),
      method: init?.method,
      headers: Object.fromEntries(new Headers(init?.headers || {}).entries()),
      body: init?.body ? JSON.parse(init.body) : null,
    });
    return new Response(JSON.stringify({ status: 'completed', action: 'email-ingest' }), { status: 200 });
  };

  try {
    let rejectedReason = null;
    await worker.email(
      {
        from: 'alerts@floridapublicnotices.com',
        to: 'ingest@perfectproperty.bid',
        raw: 'From: alerts@floridapublicnotices.com\r\nSubject: Foreclosure Notice\r\n\r\nBody text',
        setReject(reason) { rejectedReason = reason; },
      },
      {},
      createCtx()
    );
    assert.equal(rejectedReason, 'Email ingestion not configured');
    assert.equal(calls.length, 0);

    const rawMime = 'From: alerts@floridapublicnotices.com\r\nSubject: Notice of Sale\r\n\r\n123 Oak St, Miami, FL 33130';
    const rawStream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(rawMime));
        controller.close();
      },
    });
    const ctx = createCtx();
    await worker.email(
      {
        from: 'alerts@floridapublicnotices.com',
        to: 'ingest@perfectproperty.bid',
        headers: new Headers({ subject: 'Notice of Sale' }),
        raw: rawStream,
      },
      {
        API_ORIGIN: 'https://property-crawl-api.vercel.app',
        SCRAPER_ADMIN_TOKEN: 'op-secret',
        EDGE_SHARED_SECRET: 'edge-sec',
      },
      ctx
    );
    await ctx.flush();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://property-crawl-api.vercel.app/api/scrapers/run');
    assert.equal(calls[0].method, 'POST');
    assert.equal(calls[0].headers['x-scraper-admin-token'], 'op-secret');
    assert.equal(calls[0].headers['x-edge-secret'], 'edge-sec');
    assert.equal(calls[0].body.action, 'email-ingest');
    assert.equal(calls[0].body.raw, rawMime);
    assert.equal(calls[0].body.subject, 'Notice of Sale');
  } finally {
    globalThis.fetch = prevFetch;
  }
});
