// test/db/ai-cache-store.test.js
//
// Contract suite for the extracted AI-cache seam (server/db/ai-cache-store.js).
//
// The AI cache is the one DatabaseClient aggregate that already had two real
// backends behind `isPg`: Postgres (the `ai_cache` table) and an in-memory Map.
// This suite pins the behaviour both adapters must share, and separately pins
// the places where the two adapters *deliberately* differ today, so the
// extraction cannot quietly paper over them.
//
// Run with:
//   node --test test/db/ai-cache-store.test.js

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createAiCacheStore,
  createInMemoryAiCacheStore,
} = require('../../server/db/ai-cache-store');
const { DatabaseClient } = require('../../server/db/client');

/**
 * Minimal stand-in for the `ai_cache` table. It understands only the two
 * statements the real adapter issues, and it honours ON CONFLICT DO UPDATE so
 * the Postgres adapter's write-if-absent semantics are actually exercised
 * rather than assumed.
 */
function fakeAiCachePool(seedRows = []) {
  const rows = new Map();
  for (const row of seedRows) rows.set(row.content_hash, row);
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (/^\s*SELECT/i.test(sql)) {
        const [hash] = params;
        return { rows: rows.has(hash) ? [rows.get(hash)] : [] };
      }
      if (/^\s*INSERT/i.test(sql)) {
        const [contentHash, ...rest] = params;
        const row = {
          content_hash: contentHash,
          prompt_type: rest[0],
          model_used: rest[1],
          input_tokens: rest[2],
          output_tokens: rest[3],
          cost_usd: rest[4],
          response_text: rest[5],
        };
        // The real statement is an upsert, so a repeated write replaces the row.
        if (!rows.has(contentHash) || /DO\s+UPDATE/i.test(sql)) {
          rows.set(contentHash, row);
          return { rows: [row] };
        }
        return { rows: [] };
      }
      throw new Error(`unexpected SQL in fake pool: ${sql}`);
    },
  };
}

const RECORD = {
  contentHash: 'hash-1',
  promptType: 'listing-summary',
  model: 'gpt-4o-mini',
  inputTokens: 120,
  outputTokens: 45,
  costUsd: 0.0031,
  responseText: 'Sealed bid; 30-day redemption.',
};

// The Postgres row the fake pool produces for RECORD, i.e. the snake_case shape
// the real table returns (cost_usd comes back as a NUMERIC string from node-pg).
const PG_ROW = {
  content_hash: 'hash-1',
  prompt_type: 'listing-summary',
  model_used: 'gpt-4o-mini',
  input_tokens: 120,
  output_tokens: 45,
  cost_usd: '0.003100',
  response_text: 'Sealed bid; 30-day redemption.',
};

// One shared assertion body, run against both adapters, so "the interface" is
// asserted once instead of twice.
async function assertSharedAiCacheContract(store, label) {
  assert.deepStrictEqual(
    await store.get('never-written'),
    null,
    `${label}: an unknown hash must read as null, not undefined`
  );

  assert.strictEqual(
    await store.set(RECORD),
    undefined,
    `${label}: set must resolve to undefined (callers await it)`
  );

  const hit = await store.get('hash-1');
  assert.ok(hit, `${label}: a written hash must read back`);
  assert.equal(typeof hit, 'object', `${label}: a cache hit is an object`);
  const text = hit.response_text || hit.responseText;
  assert.equal(text, RECORD.responseText, `${label}: response text survives the round trip`);
}

test('both adapters satisfy the same get/set interface', async (t) => {
  await t.test('postgres adapter', () =>
    assertSharedAiCacheContract(createAiCacheStore(fakeAiCachePool()), 'postgres'));

  await t.test('in-memory adapter', () =>
    assertSharedAiCacheContract(createInMemoryAiCacheStore(new Map()), 'in-memory'));
});

test('postgres adapter issues the historical statements unchanged', async () => {
  const pool = fakeAiCachePool();
  const store = createAiCacheStore(pool);

  await store.set(RECORD);

  const [insert] = pool.calls;
  assert.match(insert.sql, /INSERT INTO ai_cache/);
  assert.match(insert.sql, /ON CONFLICT \(content_hash\) DO UPDATE SET/);
  assert.deepStrictEqual(
    insert.params,
    [RECORD.contentHash, RECORD.promptType, RECORD.model, RECORD.inputTokens,
      RECORD.outputTokens, RECORD.costUsd, RECORD.responseText],
    'record fields map to the seven table columns in schema order'
  );

  await store.get('hash-1');
  const select = pool.calls[pool.calls.length - 1];
  assert.match(select.sql, /SELECT \* FROM ai_cache WHERE content_hash = \$1/);
  assert.deepStrictEqual(select.params, ['hash-1']);
});

test('postgres adapter returns the row verbatim, including NUMERIC-as-string', async () => {
  const store = createAiCacheStore(fakeAiCachePool([PG_ROW]));
  assert.deepStrictEqual(await store.get('hash-1'), PG_ROW);
});

test('postgres writes are last-write-wins, matching the in-memory adapter', async () => {
  const store = createAiCacheStore(fakeAiCachePool());
  await store.set(RECORD);
  await store.set({ ...RECORD, responseText: 'a later, different answer' });

  const hit = await store.get('hash-1');
  assert.equal(
    hit.response_text,
    'a later, different answer',
    'a re-answered prompt must replace the cached row; ai_cache is a cache, not a ledger',
  );
});

test('in-memory adapter returns the camelCase record it was handed', async () => {
  const store = createInMemoryAiCacheStore(new Map());
  await store.set(RECORD);
  assert.deepStrictEqual(await store.get('hash-1'), RECORD);
});

test('in-memory adapter writes are last-write-wins (Map.set overwrites)', async () => {
  // Asymmetry with Postgres, preserved deliberately: nothing may normalise it
  // in this extraction. See the module report.
  const store = createInMemoryAiCacheStore(new Map());
  await store.set(RECORD);
  await store.set({ ...RECORD, responseText: 'a later, different answer' });

  const hit = await store.get('hash-1');
  assert.equal(hit.responseText, 'a later, different answer');
});

test('in-memory adapter adopts a caller-supplied Map rather than copying it', async () => {
  const seed = new Map([['pre-existing', { contentHash: 'pre-existing', responseText: 'warm' }]]);
  const store = createInMemoryAiCacheStore(seed);
  assert.deepStrictEqual(await store.get('pre-existing'), seed.get('pre-existing'));
  await store.set(RECORD);
  assert.ok(seed.has('hash-1'), 'writes land in the caller-owned Map');
});

test('createAiCacheStore({ pool, isPg }) selects the backend named by isPg', async () => {
  const pool = fakeAiCachePool();
  const seed = new Map();

  const pg = createAiCacheStore({ pool, isPg: true, seed });
  await pg.set(RECORD);
  assert.equal(pool.calls.length, 1, 'isPg:true must reach Postgres');
  assert.equal(seed.size, 0, 'isPg:true must not touch the in-memory Map');

  const mem = createAiCacheStore({ pool, isPg: false, seed });
  await mem.set(RECORD);
  assert.equal(pool.calls.length, 1, 'isPg:false must not touch Postgres');
  assert.equal(seed.size, 1, 'isPg:false must write to the in-memory Map');
});

test('the store follows isPg/pool flipping after it was built', async () => {
  // DatabaseClient.isPg is mutable at runtime: init() forces it false, then
  // verifyConnection() flips it true, and tests assign db.isPg/db.pool directly.
  // A store that captured its backend once would silently serve the wrong one.
  const pool = fakeAiCachePool();
  const mode = { isPg: false, pool };
  const store = createAiCacheStore({
    get isPg() { return mode.isPg; },
    get pool() { return mode.pool; },
    seed: new Map(),
  });

  await store.set(RECORD);
  assert.equal(pool.calls.length, 0, 'in-memory while isPg is false');

  mode.isPg = true;
  await store.set({ ...RECORD, contentHash: 'hash-2' });
  assert.equal(pool.calls.length, 1, 'Postgres as soon as isPg flips true');
  assert.equal((await store.get('hash-2')).content_hash, 'hash-2');
});

test('DatabaseClient.getAiCache/setAiCache still work in-memory', async () => {
  const db = new DatabaseClient({ env: { NODE_ENV: 'test' } });
  assert.equal(db.isPg, false);

  assert.deepStrictEqual(await db.getAiCache('hash-1'), null);
  assert.strictEqual(await db.setAiCache(RECORD), undefined);
  assert.deepStrictEqual(await db.getAiCache('hash-1'), RECORD);
});

test('DatabaseClient AI cache follows a post-construction isPg flip', async () => {
  const db = new DatabaseClient({ env: { NODE_ENV: 'test' } });
  const pool = fakeAiCachePool();
  const originalIsPg = db.isPg;
  const originalPool = db.pool;
  try {
    db.isPg = true;
    db.pool = pool;

    await db.setAiCache(RECORD);
    assert.equal(pool.calls.length, 1, 'client delegates to the Postgres adapter once isPg is true');

    // The PG adapter answers with the raw row. Asserting the snake_case shape is
    // what proves the read went to Postgres rather than to the in-memory Map.
    const hit = await db.getAiCache('hash-1');
    assert.equal(hit.content_hash, 'hash-1');
    assert.equal(hit.response_text, RECORD.responseText);
    assert.equal(hit.responseText, undefined, 'the camelCase record is not what Postgres returns');
    assert.equal(hit.contentHash, undefined);
    assert.equal(db.inMemoryData.aiCache.get('hash-1'), undefined, 'in-memory Map stayed untouched');
  } finally {
    db.isPg = originalIsPg;
    db.pool = originalPool;
  }
});
