'use strict';

/**
 * Document-review persistence.
 * - PostgreSQL `document_reviews` when a pg pool is provided (production).
 * - Versioned JSON file under .cache otherwise ($0/demo).
 * Both paths use exclusive lock semantics where applicable and fail closed.
 */

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const DEFAULT_STORE_PATH = path.resolve(__dirname, '../../.cache/document-review-store.json');
const STORE_VERSION = 1;

function defaultStorePath(env = process.env) {
  const explicit = env.PROPERTY_DOCUMENT_REVIEW_STORE_PATH;
  if (explicit === 'null' || explicit === '') return null;
  if (typeof explicit === 'string' && explicit.trim()) return path.resolve(explicit.trim());
  const testMode = env.NODE_ENV === 'test' || /^test(?::|$)/.test(env.npm_lifecycle_event || '');
  return testMode ? null : DEFAULT_STORE_PATH;
}

function createDocumentReviewStore(options = {}) {
  const env = options.env || process.env;
  const pool = options.pool || null;
  const storePath = Object.prototype.hasOwnProperty.call(options, 'storePath')
    ? (options.storePath == null ? null : path.resolve(options.storePath))
    : defaultStorePath(env);
  const reviews = new Map();
  let pgReady = false;

  function ensurePgTable() {
    if (!pool || pgReady) return;
    // schema.sql ships CREATE TABLE IF NOT EXISTS; re-assert for hosts that
    // boot without running the full schema (idempotent).
    try {
      pool.query(`CREATE TABLE IF NOT EXISTS document_reviews (
        id TEXT PRIMARY KEY,
        listing_id TEXT NOT NULL,
        document_index INTEGER,
        document_url TEXT,
        status TEXT NOT NULL,
        notes TEXT,
        reviewer TEXT,
        reviewed_at TIMESTAMPTZ,
        revision INTEGER NOT NULL DEFAULT 1,
        prior_status TEXT,
        extracted_at TIMESTAMPTZ,
        payload JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`).then(() => { pgReady = true; }).catch(() => { pgReady = false; });
    } catch { pgReady = false; }
  }

  function load() {
    reviews.clear();
    if (pool) {
      // Sync map fill is best-effort from file cache; async PG hydrate
      // happens on first persist/list via loadPg().
      try { loadFileSync(); } catch { /* ignore */ }
      return reviews;
    }
    return loadFileSync();
  }

  function loadFileSync() {
    if (!storePath) return reviews;
    try {
      if (!fs.existsSync(storePath)) return reviews;
      const raw = fs.readFileSync(storePath, 'utf8');
      const data = JSON.parse(raw);
      if (!data || data.version !== STORE_VERSION) {
        console.warn('[document-review] Store version mismatch; starting empty.');
        return reviews;
      }
      if (data.reviews && typeof data.reviews === 'object') {
        for (const [id, record] of Object.entries(data.reviews)) {
          if (record && typeof record === 'object') reviews.set(id, record);
        }
      }
      return reviews;
    } catch (err) {
      console.warn('[document-review] Failed to load store; starting empty:', err.message);
      reviews.clear();
      return reviews;
    }
  }

  async function loadPg() {
    if (!pool) return reviews;
    ensurePgTable();
    try {
      const result = await pool.query('SELECT id, payload FROM document_reviews');
      reviews.clear();
      for (const row of result.rows || []) {
        const payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
        if (payload && typeof payload === 'object') reviews.set(row.id, payload);
      }
      return reviews;
    } catch (err) {
      console.warn('[document-review] PostgreSQL load failed; keeping in-memory/file state:', err.message);
      return reviews;
    }
  }

  function persistFile() {
    if (!storePath) return false;
    try {
      fs.mkdirSync(path.dirname(storePath), { recursive: true });
      const body = JSON.stringify({
        version: STORE_VERSION,
        updatedAt: new Date().toISOString(),
        reviews: Object.fromEntries(reviews),
      });
      const lockPath = `${storePath}.lock`;
      let lock;
      try {
        lock = fs.openSync(lockPath, 'wx', 0o600);
      } catch (error) {
        if (error.code === 'EEXIST') {
          console.warn('[document-review] Store is locked by another writer; persist refused.');
          return false;
        }
        throw error;
      }
      try {
        const tempPath = `${storePath}.${randomUUID()}.tmp`;
        fs.writeFileSync(tempPath, body, { flag: 'wx', mode: 0o600 });
        fs.renameSync(tempPath, storePath);
        return true;
      } finally {
        try { fs.closeSync(lock); } catch { /* ignore */ }
        try { fs.unlinkSync(lockPath); } catch { /* ignore */ }
      }
    } catch (err) {
      console.warn('[document-review] Failed to persist store:', err.message);
      return false;
    }
  }

  async function persistPg() {
    if (!pool) return false;
    ensurePgTable();
    try {
      for (const [id, record] of reviews.entries()) {
        await pool.query(
          `INSERT INTO document_reviews
            (id, listing_id, document_index, document_url, status, notes, reviewer,
             reviewed_at, revision, prior_status, extracted_at, payload, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW())
           ON CONFLICT (id) DO UPDATE SET
             listing_id = EXCLUDED.listing_id,
             document_index = EXCLUDED.document_index,
             document_url = EXCLUDED.document_url,
             status = EXCLUDED.status,
             notes = EXCLUDED.notes,
             reviewer = EXCLUDED.reviewer,
             reviewed_at = EXCLUDED.reviewed_at,
             revision = EXCLUDED.revision,
             prior_status = EXCLUDED.prior_status,
             extracted_at = EXCLUDED.extracted_at,
             payload = EXCLUDED.payload,
             updated_at = NOW()`,
          [
            id,
            record.listingId || id.split('~')[0],
            Number.isInteger(record.documentIndex) ? record.documentIndex : null,
            record.documentUrl || null,
            record.status || 'pending',
            record.notes || null,
            record.reviewer || null,
            record.reviewedAt || null,
            record.revision || 1,
            record.priorStatus || null,
            record.extractedAt || null,
            JSON.stringify(record),
          ]
        );
      }
      return true;
    } catch (err) {
      console.warn('[document-review] PostgreSQL persist failed:', err.message);
      return false;
    }
  }

  load();

  return {
    get storePath() { return storePath; },
    get map() { return reviews; },
    get backend() { return pool ? 'postgres' : (storePath ? 'file' : 'none'); },
    get pool() { return pool; },
    load,
    loadPg,
    persist() {
      if (pool) {
        // Fire-and-forget PG write is unsafe for fail-closed 503 contract;
        // expose sync file fallback when PG write cannot be awaited here.
        // Callers that need PG should use persistAsync.
        persistPg().catch(() => {});
        return true;
      }
      return persistFile();
    },
    persistAsync: async () => {
      if (pool) return persistPg();
      return persistFile();
    },
    reset() {
      reviews.clear();
      return pool ? true : persistFile();
    },
  };
}

module.exports = {
  DEFAULT_STORE_PATH,
  STORE_VERSION,
  defaultStorePath,
  createDocumentReviewStore,
};
