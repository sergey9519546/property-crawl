import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import worker, { OperationsAgent, EmailNoticeAgent } from '../../cloudflare/property-crawl-edge/worker.js';
import { resetMcpRateLimiterForTests } from '../../cloudflare/property-crawl-edge/mcp.js';

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
    assert.equal(calls[5].body.action, 'dispatch-digests');

    const ctxDigests = createCtx();
    await worker.scheduled({ cron: '53 */6 * * *' }, env, ctxDigests);
    await ctxDigests.flush();
    assert.equal(calls[6].body.action, 'dispatch-digests');

    const ctxPrewarm = createCtx();
    await worker.scheduled({ cron: '11 */2 * * *' }, env, ctxPrewarm);
    await ctxPrewarm.flush();
    assert.deepEqual(calls[7].body, {
      action: 'ai-prewarm',
      limit: 3,
      freeOnly: true,
      maxDurationMs: 38000,
    });

    const wranglerToml = fs.readFileSync(path.resolve('cloudflare/property-crawl-edge/wrangler.toml'), 'utf8');
    const cronsLine = wranglerToml.split(/\r?\n/).find((line) => line.startsWith('crons ='));
    assert.ok(cronsLine, 'wrangler.toml must declare crons');
    const parsedCrons = JSON.parse(cronsLine.replace(/^crons\s*=\s*/, ''));
    assert.ok(parsedCrons.length <= 5, `Expected <= 5 Workers Free crons, found ${parsedCrons.length}`);
    assert.equal(parsedCrons.length, 5);
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

function createDurableObjectCtx() {
  const db = new DatabaseSync(':memory:');
  const alarms = [];
  return {
    db,
    alarms,
    storage: {
      sql: {
        exec(query, ...params) {
          if (params.length === 0 && /;\s*\S/.test(query)) {
            db.exec(query);
            return { toArray: () => [] };
          }
          const stmt = db.prepare(query);
          if (/^\s*SELECT\b/i.test(query)) {
            const rows = stmt.all(...params);
            return { toArray: () => rows };
          }
          stmt.run(...params);
          return { toArray: () => [] };
        },
      },
      async setAlarm(ts) {
        alarms.push(ts);
      },
    },
  };
}

function createNamespace(instance) {
  return {
    idFromName(name) {
      return `id:${name}`;
    },
    get() {
      return {
        fetch(input, init) {
          const req = input instanceof Request ? input : new Request(input, init);
          return instance.fetch(req);
        },
      };
    },
  };
}

test('OperationsAgent dispatches crons, queues 502 failures for alarm backoff recovery, alerts after max attempts, and gates /agents/operations/status', async () => {
  const prevFetch = globalThis.fetch;
  let upstreamMode = 'ok';
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ url: String(url), body });
    if (String(url).includes('hooks.example.test')) {
      return new Response('alerted', { status: 200 });
    }
    if (upstreamMode === 'fail-502') {
      return new Response('bad gateway', { status: 502 });
    }
    return new Response(JSON.stringify({ status: 'completed' }), { status: 200 });
  };

  try {
    const doCtx = createDurableObjectCtx();
    const env = {
      API_ORIGIN: 'https://property-crawl-api.vercel.app',
      ORIGIN_URL: 'https://property-crawl-api.vercel.app',
      SCRAPER_ADMIN_TOKEN: 'op-secret',
      EDGE_SHARED_SECRET: 'edge-sec',
      ALERT_WEBHOOK_URL: 'https://hooks.example.test/alert',
    };
    const opsAgent = new OperationsAgent(doCtx, env);
    env.OPS_AGENT = createNamespace(opsAgent);

    // Unauthorized status probe fails closed
    const unauthStatus = await worker.fetch(
      new Request('https://edge.perfectproperty.bid/agents/operations/status'),
      env,
      createCtx(),
    );
    assert.equal(unauthStatus.status, 401);

    // Authorized 200 cron run logs to op_runs with 0 pending retries
    const okCtx = createCtx();
    await worker.scheduled({ cron: '*/5 * * * *' }, env, okCtx);
    await okCtx.flush();

    const status1 = await (await worker.fetch(
      new Request('https://edge.perfectproperty.bid/agents/operations/status', {
        headers: { Authorization: 'Bearer op-secret' },
      }),
      env,
      createCtx(),
    )).json();
    assert.equal(status1.schema, 'property-crawl.operations-agent/v1');
    assert.equal(status1.pendingCount, 0);
    assert.equal(status1.recentRuns[0].action, 'next-slice');
    assert.equal(status1.recentRuns[0].ok, 1);

    // 502 failure queues into op_retry_queue and schedules an alarm
    upstreamMode = 'fail-502';
    const failCtx = createCtx();
    await worker.scheduled({ cron: '29 * * * *' }, env, failCtx);
    await failCtx.flush();
    assert.equal(doCtx.alarms.length, 1);

    // Force due time to test alarm recovery
    doCtx.db.exec('UPDATE op_retry_queue SET next_run_at = 1');
    upstreamMode = 'ok';
    await opsAgent.alarm();

    const status2 = await (await worker.fetch(
      new Request('https://edge.perfectproperty.bid/agents/operations/status', {
        headers: { Authorization: 'Bearer op-secret' },
      }),
      env,
      createCtx(),
    )).json();
    assert.equal(status2.pendingCount, 0);
    assert.equal(status2.recentRuns[0].action, 'repair-enrichment');
    assert.equal(status2.recentRuns[0].attempt, 2);
    assert.equal(status2.recentRuns[0].ok, 1);

    // Repeated 502s exhaust max_attempts=3 and fire operator alert
    upstreamMode = 'fail-502';
    const exhaustCtx = createCtx();
    await worker.scheduled({ cron: '17 */6 * * *' }, env, exhaustCtx);
    await exhaustCtx.flush();
    doCtx.db.exec('UPDATE op_retry_queue SET next_run_at = 1');
    await opsAgent.alarm(); // attempt 2
    doCtx.db.exec('UPDATE op_retry_queue SET next_run_at = 1');
    await opsAgent.alarm(); // attempt 3 -> exhausted -> webhook alert
    assert.ok(calls.some((c) => c.url.includes('hooks.example.test') && c.body?.exhausted === true));
  } finally {
    globalThis.fetch = prevFetch;
  }
});

test('EmailNoticeAgent archives raw MIME in R2, queues 504 failures in SQLite, and recovers on alarm()', async () => {
  const prevFetch = globalThis.fetch;
  let shouldFail = true;
  const r2Objects = new Map();
  globalThis.fetch = async () => {
    if (shouldFail) return new Response('gateway timeout', { status: 504 });
    return new Response(JSON.stringify({ status: 'completed', action: 'email-ingest' }), { status: 200 });
  };

  try {
    const doCtx = createDurableObjectCtx();
    const env = {
      API_ORIGIN: 'https://property-crawl-api.vercel.app',
      SCRAPER_ADMIN_TOKEN: 'op-secret',
      EDGE_SHARED_SECRET: 'edge-sec',
      VAULT: {
        async put(key, value) {
          r2Objects.set(key, String(value));
        },
        async get(key) {
          const val = r2Objects.get(key);
          if (!val) return null;
          return { text: async () => val };
        },
      },
    };
    const emailAgent = new EmailNoticeAgent(doCtx, env);
    env.EMAIL_AGENT = createNamespace(emailAgent);

    const rawMime = 'From: alerts@njpublicnotices.com\r\nSubject: Sheriff Sale Essex\r\n\r\n548 Sandford Ave';
    const ctx = createCtx();
    await worker.email(
      {
        from: 'alerts@njpublicnotices.com',
        to: 'notices@perfectproperty.bid',
        headers: new Headers({ subject: 'Sheriff Sale Essex' }),
        raw: rawMime,
      },
      env,
      ctx,
    );
    await ctx.flush();

    assert.equal(r2Objects.size, 1);
    const [storedKey] = r2Objects.keys();
    assert.ok(storedKey.startsWith('private/email-inbox/'));
    assert.equal(doCtx.alarms.length, 1);

    const pendingStatus = await (await worker.fetch(
      new Request('https://edge.perfectproperty.bid/agents/email/status', {
        headers: { 'x-scraper-admin-token': 'op-secret' },
      }),
      env,
      createCtx(),
    )).json();
    assert.equal(pendingStatus.pendingCount, 1);
    assert.equal(pendingStatus.pending[0].attempts, 1);

    // Recover on alarm retry
    shouldFail = false;
    doCtx.db.exec('UPDATE email_queue SET next_run_at = 1');
    await emailAgent.alarm();

    const recoveredStatus = await (await worker.fetch(
      new Request('https://edge.perfectproperty.bid/agents/email/status', {
        headers: { Authorization: 'Bearer op-secret' },
      }),
      env,
      createCtx(),
    )).json();
    assert.equal(recoveredStatus.pendingCount, 0);
    assert.equal(recoveredStatus.dlqCount, 0);
  } finally {
    globalThis.fetch = prevFetch;
  }
});

test('/mcp Streamable HTTP endpoint handles GET discovery, initialize, tools/list, tools/call, and JSON-RPC error codes', async () => {
  resetMcpRateLimiterForTests();
  const prevFetch = globalThis.fetch;
  const upstreamCalls = [];
  globalThis.fetch = async (url, init) => {
    upstreamCalls.push({
      url: String(url),
      method: init?.method,
      headers: Object.fromEntries(new Headers(init?.headers || {}).entries()),
      body: init?.body ? JSON.parse(String(init.body)) : null,
    });
    if (String(url).endsWith('/api/check-ladder')) {
      return new Response(JSON.stringify({ schema: 'perfectproperty.check-ladder.v1', summary: { activeTargetCount: 1 } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ schema: 'ok', hudSafmr: { fairMarketRent: 2430 } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  try {
    const env = {
      ORIGIN_URL: 'https://property-crawl-api.vercel.app',
      EDGE_SHARED_SECRET: 'edge-sec',
    };

    const metaRes = await worker.fetch(new Request('https://edge.perfectproperty.bid/mcp'), env, createCtx());
    assert.equal(metaRes.status, 200);
    const meta = await metaRes.json();
    assert.equal(meta.name, 'perfectproperty-mcp');
    assert.equal(meta.tools.length, 5);

    const initRes = await worker.fetch(
      new Request('https://edge.perfectproperty.bid/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
      }),
      env,
      createCtx(),
    );
    const initJson = await initRes.json();
    assert.equal(initJson.result.protocolVersion, '2025-03-26');

    const callRes = await worker.fetch(
      new Request('https://edge.perfectproperty.bid/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/call',
          params: { name: 'underwrite_address', arguments: { address: '548-550 Sandford Ave', state: 'NJ', zip: '07106' } },
        }),
      }),
      env,
      createCtx(),
    );
    const callJson = await callRes.json();
    assert.equal(callJson.result.isError, false);
    assert.equal(callJson.result.structuredContent.hudSafmr.fairMarketRent, 2430);
    assert.equal(upstreamCalls[0].headers['x-edge-secret'], 'edge-sec');

    const badJsonRes = await worker.fetch(
      new Request('https://edge.perfectproperty.bid/mcp', { method: 'POST', body: '{bad-json' }),
      env,
      createCtx(),
    );
    assert.equal(badJsonRes.status, 400);
    assert.equal((await badJsonRes.json()).error.code, -32700);

    const unknownMethodRes = await worker.fetch(
      new Request('https://edge.perfectproperty.bid/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'nonexistent/method' }),
      }),
      env,
      createCtx(),
    );
    assert.equal((await unknownMethodRes.json()).error.code, -32601);

    const ladderCallRes = await worker.fetch(
      new Request('https://edge.perfectproperty.bid/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 4,
          method: 'tools/call',
          params: {
            name: 'compute_check_ladder',
            arguments: {
              targets: [{ id: 'CIV-1', address: '548 Sandford Ave', state: 'NJ', source: 'civilview', maxBid: 150000 }],
              availableCapital: 40000,
            },
          },
        }),
      }),
      env,
      createCtx(),
    );
    const ladderCallJson = await ladderCallRes.json();
    assert.equal(ladderCallJson.result.isError, false);
    assert.equal(ladderCallJson.result.structuredContent.schema, 'perfectproperty.check-ladder.v1');
    assert.equal(upstreamCalls[1].url, 'https://property-crawl-api.vercel.app/api/check-ladder');
    assert.equal(upstreamCalls[1].method, 'POST');
    assert.equal(upstreamCalls[1].body.availableCapital, 40000);
  } finally {
    resetMcpRateLimiterForTests();
    globalThis.fetch = prevFetch;
  }
});

test('OperationsAgent treats HTTP 200 sourceResults errors as retryable and queues exact run-source retry for next-slice', async () => {
  const prevFetch = globalThis.fetch;
  let mode = 'slice-timeout';
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ url: String(url), body });
    if (String(url).includes('hooks.example.test')) {
      return new Response('alerted', { status: 200 });
    }
    if (mode === 'slice-timeout') {
      return new Response(JSON.stringify({
        status: 'completed',
        result: { sourceResults: [{ sourceId: 'treasury', error: 'TreasuryForfeitureCollector timed out' }] },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (mode === 'captcha-blocked') {
      return new Response(JSON.stringify({
        status: 'completed',
        result: { sourceResults: [{ sourceId: 'landbank', error: 'HTTP 403 captcha challenge blocked' }] },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify({ status: 'completed', result: { sourceResults: [{ sourceId: 'treasury', count: 4 }] } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  try {
    const doCtx = createDurableObjectCtx();
    const env = {
      API_ORIGIN: 'https://property-crawl-api.vercel.app',
      SCRAPER_ADMIN_TOKEN: 'op-secret',
      ALERT_WEBHOOK_URL: 'https://hooks.example.test/alert',
    };
    const opsAgent = new OperationsAgent(doCtx, env);

    const dispatchRes = await opsAgent.fetch(new Request('https://internal/dispatch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'next-slice', payload: { action: 'next-slice' } }),
    }));
    assert.equal(dispatchRes.status, 202);
    const dispatchJson = await dispatchRes.json();
    assert.equal(dispatchJson.queuedForRetry, true);

    const queuedRows = doCtx.db.prepare('SELECT action, payload_json, last_error FROM op_retry_queue').all();
    assert.equal(queuedRows.length, 1);
    assert.deepEqual(JSON.parse(queuedRows[0].payload_json), {
      action: 'run-source',
      source: 'treasury',
      slice: true,
    });
    assert.match(queuedRows[0].last_error, /treasury: TreasuryForfeitureCollector timed out/);

    const runsBeforeAlarm = doCtx.db.prepare('SELECT ok, error FROM op_runs ORDER BY id DESC LIMIT 1').all();
    assert.equal(runsBeforeAlarm[0].ok, 0);

    // Alarm retries exact run-source payload and clears queue on recovery
    mode = 'ok';
    doCtx.db.exec('UPDATE op_retry_queue SET next_run_at = 1');
    await opsAgent.alarm();
    assert.deepEqual(calls[1].body, { action: 'run-source', source: 'treasury', slice: true });
    assert.equal(doCtx.db.prepare('SELECT COUNT(*) AS c FROM op_retry_queue').get().c, 0);

    // Non-retryable captcha/403 sourceResults error fails immediately without queuing retry
    mode = 'captcha-blocked';
    const blockedRes = await opsAgent.fetch(new Request('https://internal/dispatch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'next-slice', payload: { action: 'next-slice' } }),
    }));
    assert.equal(blockedRes.status, 502);
    const blockedJson = await blockedRes.json();
    assert.equal(blockedJson.queuedForRetry, false);
    assert.equal(doCtx.db.prepare('SELECT COUNT(*) AS c FROM op_retry_queue').get().c, 0);
  } finally {
    globalThis.fetch = prevFetch;
  }
});

test('/mcp enforces per-IP sliding-window rate limiting with HTTP 429 and JSON-RPC -32029', async () => {
  resetMcpRateLimiterForTests();
  try {
    const env = {
      ORIGIN_URL: 'https://property-crawl-api.vercel.app',
      MCP_RATE_LIMIT_PER_MIN: '2',
    };

    const makePost = (ip, id) => worker.fetch(
      new Request('https://edge.perfectproperty.bid/mcp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'cf-connecting-ip': ip,
        },
        body: JSON.stringify({ jsonrpc: '2.0', id, method: 'ping' }),
      }),
      env,
      createCtx(),
    );

    const r1 = await makePost('198.51.100.10', 1);
    const r2 = await makePost('198.51.100.10', 2);
    const r3 = await makePost('198.51.100.10', 3);
    assert.equal(r1.status, 200);
    assert.equal(r2.status, 200);
    assert.equal(r3.status, 429);
    assert.equal(r3.headers.get('Retry-After'), '60');
    const errJson = await r3.json();
    assert.equal(errJson.jsonrpc, '2.0');
    assert.equal(errJson.id, null);
    assert.equal(errJson.error.code, -32029);

    // Separate client IP has its own bucket
    const otherIpRes = await makePost('198.51.100.11', 4);
    assert.equal(otherIpRes.status, 200);
  } finally {
    resetMcpRateLimiterForTests();
  }
});

test('wrangler.toml binds OPS_AGENT, EMAIL_AGENT, SQLite DO migration v1, and stays within 5 Workers Free crons', () => {
  const wranglerToml = fs.readFileSync(path.resolve('cloudflare/property-crawl-edge/wrangler.toml'), 'utf8');
  assert.match(wranglerToml, /compatibility_flags = \["nodejs_compat"\]/);
  assert.match(wranglerToml, /name = "OPS_AGENT"/);
  assert.match(wranglerToml, /class_name = "OperationsAgent"/);
  assert.match(wranglerToml, /name = "EMAIL_AGENT"/);
  assert.match(wranglerToml, /class_name = "EmailNoticeAgent"/);
  assert.match(wranglerToml, /new_sqlite_classes = \["OperationsAgent", "EmailNoticeAgent"\]/);
  const cronsLine = wranglerToml.split(/\r?\n/).find((line) => line.startsWith('crons ='));
  assert.ok(cronsLine);
  const parsedCrons = JSON.parse(cronsLine.replace(/^crons\s*=\s*/, ''));
  assert.ok(parsedCrons.length <= 5);
});
