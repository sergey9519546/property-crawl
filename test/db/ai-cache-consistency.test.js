'use strict';

// test/db/ai-cache-consistency.test.js
//
// The two AI-cache backends must behave identically. They previously did not:
// Postgres used ON CONFLICT DO NOTHING (first-write-wins) while the in-memory
// Map overwrites (last-write-wins). The same prompt + model therefore returned
// a different cached answer depending on whether DATABASE_URL was set — and in
// production a re-answered prompt stayed pinned to its first response forever.
//
// ai_cache is a cache, not a ledger: nothing aggregates it for cost accounting
// (that lives in CostTracker and telemetry) and it is only ever point-read by
// content hash, so last-write-wins is the correct semantic for both.

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  createAiCacheStore,
  createInMemoryAiCacheStore,
} = require('../../server/db/ai-cache-store');

// A fake pool that behaves like the real table: a DO UPDATE upsert overwrites,
// a DO NOTHING insert is ignored.
function fakePool() {
  const rows = new Map();
  return {
    rows,
    query: async (sql, params) => {
      if (/INSERT/i.test(sql)) {
        const rec = {
          content_hash: params[0],
          prompt_type: params[1],
          model_used: params[2],
          input_tokens: params[3],
          output_tokens: params[4],
          cost_usd: params[5],
          response_text: params[6],
        };
        const existing = rows.get(rec.content_hash);
        if (existing && /DO\s+NOTHING/i.test(sql)) return { rows: [], rowCount: 0 };
        rows.set(rec.content_hash, rec);
        return { rows: [rec], rowCount: 1 };
      }
      const found = rows.get(params[0]);
      return { rows: found ? [found] : [], rowCount: found ? 1 : 0 };
    },
  };
}

const record = (text, cost = 0.1) => ({
  contentHash: 'same-key',
  promptType: 'general',
  model: 'gpt-4o-mini',
  inputTokens: 10,
  outputTokens: 20,
  costUsd: cost,
  responseText: text,
});

test('both backends return the newest answer for a re-written key', async () => {
  const pg = createAiCacheStore(fakePool());
  const mem = createInMemoryAiCacheStore(new Map());

  for (const store of [pg, mem]) {
    await store.set(record('FIRST', 0.1));
    await store.set(record('SECOND', 0.2));
  }

  const fromPg = await pg.get('same-key');
  const fromMem = await mem.get('same-key');
  const pgText = fromPg.response_text ?? fromPg.responseText;
  const memText = fromMem.response_text ?? fromMem.responseText;

  assert.equal(pgText, 'SECOND', 'Postgres must not pin the first answer');
  assert.equal(memText, 'SECOND');
  assert.equal(pgText, memText, 'the two backends must agree');
});

test('the Postgres upsert replaces the stored columns, not just the response', async () => {
  const pool = fakePool();
  const pg = createAiCacheStore(pool);
  await pg.set(record('FIRST', 0.1));
  await pg.set({ ...record('SECOND', 0.9), model: 'newer-model', outputTokens: 999 });

  const stored = pool.rows.get('same-key');
  assert.equal(stored.response_text, 'SECOND');
  assert.equal(stored.model_used, 'newer-model');
  // This fake passes values through unchanged; real node-pg returns NUMERIC as
  // a string, which the cache client already reconciles.
  assert.equal(Number(stored.cost_usd), 0.9);
  assert.equal(Number(stored.output_tokens), 999);
});

test('a first write still reads back on both backends', async () => {
  const pg = createAiCacheStore(fakePool());
  const mem = createInMemoryAiCacheStore(new Map());
  for (const store of [pg, mem]) {
    await store.set(record('ONLY', 0.3));
    const hit = await store.get('same-key');
    assert.ok(hit, 'a freshly written key must be readable');
  }
});

test('a missing key returns null on both backends', async () => {
  const pg = createAiCacheStore(fakePool());
  const mem = createInMemoryAiCacheStore(new Map());
  assert.equal(await pg.get('absent'), null);
  assert.equal(await mem.get('absent'), null);
});
