// server/db/ai-cache-store.js
//
// The AI cache, extracted from the DatabaseClient god module.
//
// This is the one aggregate that already had a real backend seam: Postgres
// (the `ai_cache` table) or an in-memory Map, selected by `isPg`. Everything
// else in client.js still lives there; only the AI cache moved.
//
// The seam exposes exactly what DatabaseClient.getAiCache/setAiCache exposed:
//
//     store.get(contentHash) -> Promise<row|null>
//     store.set(record)       -> Promise<undefined>
//
// `record` is the camelCase object callers already pass:
//     { contentHash, promptType, model, inputTokens, outputTokens, costUsd,
//       responseText }
//
// Two long-standing asymmetries between the backends are preserved verbatim,
// because callers depend on both and this extraction is not the place to fix
// them:
//
//   1. RETURN SHAPE. Postgres returns the raw row (snake_case, and cost_usd as
//      a NUMERIC string from node-pg). The in-memory Map returns the camelCase
//      record it was handed. server/ai/cache.js reconciles this at the call
//      site with `cached.response_text || cached.responseText`.
//   2. WRITE SEMANTICS. Both backends are last-write-wins. The Postgres side
//      uses `ON CONFLICT ... DO UPDATE` so a re-answered prompt replaces the
//      cached response instead of being pinned to its first one. The table is a
//      cache, not a cost ledger: nothing aggregates it, and it is only ever
//      point-read by content hash, so a newer answer should win.
//
// There is no TTL or expiry on either path; `created_at` is written by the
// table default and never read back. Cache-key normalisation (sha256 of
// `model:trimmedPrompt`) lives in server/ai/cache.js, not here.

const SELECT_SQL = 'SELECT * FROM ai_cache WHERE content_hash = $1';

// Last-write-wins, matching the in-memory Map adapter. This table is a cache,
// not a ledger: nothing aggregates it for cost accounting (that lives in
// CostTracker and telemetry), and it is only ever point-read by content hash.
// `ON CONFLICT DO NOTHING` made it first-write-wins, so in production a
// re-answered prompt was pinned to its first response forever while the
// in-memory path returned the new one — the same prompt yielding different
// answers depending on whether DATABASE_URL was set.
const INSERT_SQL = `INSERT INTO ai_cache (content_hash, prompt_type, model_used, input_tokens, output_tokens, cost_usd, response_text)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (content_hash) DO UPDATE SET
           prompt_type = EXCLUDED.prompt_type,
           model_used = EXCLUDED.model_used,
           input_tokens = EXCLUDED.input_tokens,
           output_tokens = EXCLUDED.output_tokens,
           cost_usd = EXCLUDED.cost_usd,
           response_text = EXCLUDED.response_text`;

/**
 * Postgres-backed adapter over the `ai_cache` table.
 * @param {{ query: Function }} pool
 */
function createPostgresAiCacheStore(pool) {
  return {
    async get(contentHash) {
      const res = await pool.query(SELECT_SQL, [contentHash]);
      return res.rows[0] || null;
    },

    async set(record) {
      await pool.query(INSERT_SQL, [
        record.contentHash,
        record.promptType,
        record.model,
        record.inputTokens,
        record.outputTokens,
        record.costUsd,
        record.responseText,
      ]);
    },
  };
}

/**
 * In-memory adapter. `seed` is adopted, not copied, so the caller keeps one
 * authoritative Map.
 * @param {Map<string, object>} [seed]
 */
function createInMemoryAiCacheStore(seed = new Map()) {
  return {
    async get(contentHash) {
      return seed.get(contentHash) || null;
    },

    async set(record) {
      seed.set(record.contentHash, record);
    },
  };
}

/**
 * True when the argument is a selection spec rather than a bare pool. A pool
 * exposes `query`; a spec carries `pool` / `isPg` / `seed`.
 */
function isSelectionSpec(value) {
  return Boolean(value)
    && typeof value === 'object'
    && ('pool' in value || 'isPg' in value || 'seed' in value);
}

/**
 * Build the AI cache store, choosing a backend the same way client.js did.
 *
 * Two call forms:
 *   createAiCacheStore(pool)                  -> Postgres adapter
 *   createAiCacheStore({ pool, isPg, seed })   -> backend named by isPg
 *
 * The backend is resolved per call rather than captured at build time, because
 * DatabaseClient.isPg is mutable at runtime: the constructor forces it false,
 * verifyConnection() flips it true once Postgres answers, and tests assign
 * db.isPg / db.pool directly. `pool` and `isPg` are therefore read live off the
 * spec, and may be supplied as accessor properties to expose that mutability.
 */
function createAiCacheStore(spec) {
  if (!isSelectionSpec(spec)) return createPostgresAiCacheStore(spec);

  let lastIsPg;
  let lastPool;
  let active = null;

  function current() {
    const isPg = spec.isPg;
    const pool = spec.pool;
    if (active === null || isPg !== lastIsPg || pool !== lastPool) {
      lastIsPg = isPg;
      lastPool = pool;
      active = isPg
        ? createPostgresAiCacheStore(pool)
        : createInMemoryAiCacheStore(spec.seed);
    }
    return active;
  }

  return {
    get(contentHash) {
      return current().get(contentHash);
    },
    set(record) {
      return current().set(record);
    },
  };
}

module.exports = {
  createAiCacheStore,
  createInMemoryAiCacheStore,
};
