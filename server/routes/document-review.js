'use strict';

/**
 * Document Review API Route
 * ==========================
 *
 * Thin HTTP wrapper over server/intelligence/document-review.js. The pure
 * module owns the state machine; this route owns:
 *   - resolving the document identifier from the URL / body
 *   - applying the review via the pure module
 *   - persisting decisions to a versioned file store
 *   - hydrating a pending queue from listing document evidence when the
 *     store has no explicit review yet (never invents documents)
 */

const {
  REVIEW_STATES,
  validateReviewInput,
  applyReview,
  normalizeReview,
  createPendingReview,
  filterByStatus,
  summarizeReviews,
} = require('../intelligence/document-review');
const { createDocumentReviewStore } = require('../intelligence/document-review-store');
const { resolveOperatorToken } = require('../security/operator-token');
const { presentedRunToken, tokensMatch } = require('./scrapers');

const MAX_DOCUMENT_ID_LENGTH = 200;
const MAX_LISTING_ID_LENGTH = 200;
const MAX_BODY_BYTES = 32 * 1024;
const HYDRATION_LISTING_LIMIT = 500;
const HYDRATION_PER_LISTING_LIMIT = 20;
const HYDRATION_TOTAL_LIMIT = 200;

function requireOperator(req, res, env) {
  const configuredToken = resolveOperatorToken(env || process.env);
  if (!configuredToken) {
    res.status(503).json({
      error: 'Document review needs SCRAPER_ADMIN_TOKEN (or PROPERTY_OPERATOR_SECRET) on the API server.',
      requiredConfiguration: 'SCRAPER_ADMIN_TOKEN',
    });
    return false;
  }
  if (!tokensMatch(presentedRunToken(req), configuredToken)) {
    res.status(401).json({ error: 'Operator credential required for document review' });
    return false;
  }
  return true;
}

let store = createDocumentReviewStore();

function getStore(database) {
  const pool = database && database.pool ? database.pool : null;
  if (pool && !store.pool) {
    store = createDocumentReviewStore({ pool, storePath: store.storePath, env: process.env });
  }
  return store;
}

function cleanIdentifier(value, maxLength) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
}

function documentId(listingId, documentIndex, documentUrl) {
  // Documented format: `${listingId}~${documentIndex}~${documentUrl}`.
  // URL component is percent-encoded so the id stays a single path segment
  // on the Next proxy (`document-review(?:\/[^/]+)?`).
  const parts = [cleanIdentifier(listingId, MAX_LISTING_ID_LENGTH) || 'unknown'];
  if (Number.isInteger(documentIndex) && documentIndex >= 0) parts.push(String(documentIndex));
  if (typeof documentUrl === 'string' && documentUrl.trim()) {
    parts.push(encodeURIComponent(documentUrl.trim().slice(0, MAX_DOCUMENT_ID_LENGTH)));
  }
  return parts.join('~');
}

function decodeDocumentId(id) {
  const parts = String(id).split('~');
  const listingId = parts[0];
  const documentIndex = Number.isInteger(Number(parts[1])) ? Number(parts[1]) : null;
  let documentUrl = null;
  if (parts.length > 2) {
    try { documentUrl = decodeURIComponent(parts.slice(2).join('~')); } catch { documentUrl = parts.slice(2).join('~'); }
  }
  return { listingId, documentIndex, documentUrl };
}

function readJsonBody(req) {
  // server.js already awaits parseJsonBody(req) before routing; reuse req.body
  // instead of re-reading a consumed stream (that path deadlocks POST).
  if (req.body !== undefined && req.body !== null && typeof req.body === 'object') {
    return Promise.resolve(req.body);
  }
  if (req.body === null) return Promise.resolve(null);
  return new Promise((resolve) => {
    let raw = '';
    let settled = false;
    const done = (body) => {
      if (settled) return;
      settled = true;
      resolve(body);
    };
    // If the stream was already consumed and no body was attached, fail closed
    // rather than waiting forever for events that will never fire.
    if (req.readableEnded || req.complete) {
      done(req.body !== undefined ? req.body : {});
      return;
    }
    req.on('data', chunk => {
      raw += chunk;
      if (raw.length > MAX_BODY_BYTES) {
        req.socket.destroy();
        done(null);
      }
    });
    req.on('end', () => {
      if (!raw) return done({});
      try {
        done(JSON.parse(raw));
      } catch (_) {
        done(null);
      }
    });
    req.on('close', () => done(raw ? null : {}));
    req.on('error', () => done(null));
  });
}

function badRequest(res, error, code = 400) {
  return res.status(code).json({ error });
}

function safeHttpUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

function documentContainers(listing) {
  const factDocuments = listing?.provenance?.sourceFacts?.documents;
  const mediaDocuments = listing?.provenance?.media?.documents;
  return [
    ...(Array.isArray(factDocuments) ? [{ path: 'provenance.sourceFacts.documents', documents: factDocuments }] : []),
    ...(Array.isArray(mediaDocuments) ? [{ path: 'provenance.media.documents', documents: mediaDocuments }] : []),
  ];
}

/**
 * Enumerate reviewable publisher documents on a listing.
 * Only real declared documents with a label or URL become queue candidates.
 * Duplicate (url+index) pairs across containers are collapsed.
 */
function enumerateListingDocuments(listing, perListingLimit = HYDRATION_PER_LISTING_LIMIT) {
  if (!listing?.id) return [];
  const out = [];
  const seen = new Set();
  for (const container of documentContainers(listing)) {
    for (let index = 0; index < container.documents.length && out.length < perListingLimit; index++) {
      const document = container.documents[index];
      if (!document || typeof document !== 'object' || Array.isArray(document)) continue;
      const url = safeHttpUrl(
        document.fileUrl || document.mediaUrl || document.url
        || document.documentUrl || document.documentURL || document.sourceUrl
      );
      const label = String(
        document.title || document.label || document.name
        || document.documentName || document.documentType || ''
      ).replace(/\s+/g, ' ').trim().slice(0, 200) || null;
      if (!url && !label) continue;
      const key = `${index}|${url || label}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        listingId: String(listing.id),
        documentIndex: index,
        documentUrl: url,
        label,
        sourceField: `${container.path}[${index}]`,
        extractedAt: listing.sourceObservedAt || listing.provenance?.observedAt || null,
      });
    }
    if (out.length >= perListingLimit) break;
  }
  return out;
}

async function hydratePendingCandidates(database) {
  if (!database || typeof database.getListings !== 'function') return [];
  let listings = [];
  try {
    const result = await database.getListings({ limit: HYDRATION_LISTING_LIMIT });
    listings = Array.isArray(result?.listings) ? result.listings : [];
  } catch {
    return [];
  }
  const candidates = [];
  const known = new Set(store.map.keys());
  for (const listing of listings) {
    if (candidates.length >= HYDRATION_TOTAL_LIMIT) break;
    for (const doc of enumerateListingDocuments(listing)) {
      const id = documentId(doc.listingId, doc.documentIndex, doc.documentUrl);
      if (!id || known.has(id)) continue;
      known.add(id);
      candidates.push({
        id,
        listingId: doc.listingId,
        documentIndex: doc.documentIndex,
        documentUrl: doc.documentUrl,
        label: doc.label,
        sourceField: doc.sourceField,
        review: createPendingReview({ extractedAt: doc.extractedAt }),
        hydration: 'listing-document',
      });
      if (candidates.length >= HYDRATION_TOTAL_LIMIT) break;
    }
  }
  return candidates;
}

async function handleDocumentReview(req, res, dependencies = {}) {
  const env = dependencies.env || process.env;
  const database = dependencies.database || require('../db/client');
  store = getStore(database);
  const url = new URL(req.url, 'http://localhost');
  const method = req.method;
  res.setHeader('Cache-Control', 'no-store');
  if (!requireOperator(req, res, env)) return;

  if (method === 'GET' && url.pathname === '/api/document-review') {
    const requestedStatus = url.searchParams.get('status');
    const hydrate = url.searchParams.get('hydrate') !== 'false';
    const stored = [...store.map.entries()].map(([id, record]) => ({
      id,
      ...normalizeReview(record),
      listingId: record.listingId || id.split('~')[0],
      documentIndex: Number.isInteger(record.documentIndex) ? record.documentIndex : null,
      documentUrl: record.documentUrl || null,
      hydration: 'store',
    }));

    let combined = stored;
    if (hydrate && (!requestedStatus || requestedStatus === 'pending')) {
      const candidates = await hydratePendingCandidates(database);
      const storedIds = new Set(stored.map((entry) => entry.id));
      combined = [
        ...candidates.filter((entry) => !storedIds.has(entry.id)),
        ...stored,
      ];
    }

    const requested = requestedStatus
      ? combined.filter((entry) => (entry.review?.status || entry.status) === requestedStatus)
      : combined;
    const statusPool = hydrate ? combined : stored;
    const summary = summarizeReviews(statusPool.map((entry) => entry.review || entry));
    return res.json({
      total: summary.total,
      byStatus: summary.byStatus,
      reviews: requested.map((entry) => {
        const review = normalizeReview(entry.review || entry);
        return {
          id: entry.id,
          listingId: entry.listingId,
          documentIndex: entry.documentIndex ?? null,
          documentUrl: entry.documentUrl ?? null,
          label: entry.label || null,
          review,
          ...(entry.hydration ? { hydration: entry.hydration } : {}),
        };
      }),
      hydration: {
        enabled: Boolean(hydrate),
        storeCount: stored.length,
        pendingFromListings: combined.filter((e) => e.hydration === 'listing-document').length,
      },
    });
  }

  if (method === 'POST' && url.pathname === '/api/document-review') {
    const body = await readJsonBody(req);
    if (body === null) return badRequest(res, 'invalid JSON body', 400);
    const listingId = cleanIdentifier(body.listingId, MAX_LISTING_ID_LENGTH);
    if (!listingId) return badRequest(res, 'listingId is required');
    const id = documentId(listingId, body.documentIndex, body.documentUrl);
    if (!id) return badRequest(res, 'document id could not be derived');

    const previousRaw = store.map.has(id) ? store.map.get(id) : null;
    const previous = previousRaw
      ? normalizeReview(previousRaw)
      : createPendingReview({ extractedAt: body.extractedAt });
    const result = applyReview(previous, body, {
      current: previous,
      expectedRevision: body.revision,
    });
    if (Array.isArray(result.errors) && result.errors.length) {
      const code = result.errors.find(e => e.startsWith('shape:')) ? 400 : 422;
      return badRequest(res, result.errors.join('; '), code);
    }
    store.map.set(id, {
      ...result,
      listingId,
      documentIndex: Number.isInteger(body.documentIndex) ? body.documentIndex : null,
      documentUrl: typeof body.documentUrl === 'string' && body.documentUrl.trim()
        ? body.documentUrl.trim().slice(0, MAX_DOCUMENT_ID_LENGTH)
        : null,
    });
    const persisted = typeof store.persistAsync === 'function'
      ? await store.persistAsync()
      : store.persist();
    if (!persisted) {
      // Roll back the in-memory decision so GET cannot advertise durability
      // the durable backend never received.
      if (previousRaw) store.map.set(id, previousRaw);
      else store.map.delete(id);
      return res.status(503).json({
        error: 'Document review could not be persisted',
        id,
        listingId,
        review: result,
        persisted: false,
        requiredConfiguration: 'writable document-review store (PostgreSQL or .cache)',
      });
    }
    return res.status(200).json({
      id,
      listingId,
      documentIndex: body.documentIndex,
      documentUrl: body.documentUrl || null,
      review: result,
      persisted,
    });
  }

  if (method === 'GET' && url.pathname.startsWith('/api/document-review/')) {
    const tail = url.pathname.slice('/api/document-review/'.length).trim();
    if (!tail) return badRequest(res, 'document id is required');
    if (!store.map.has(tail)) return res.status(404).json({ error: 'review not found' });
    const record = store.map.get(tail);
    return res.json({
      id: tail,
      listingId: record.listingId || tail.split('~')[0],
      documentIndex: Number.isInteger(record.documentIndex) ? record.documentIndex : null,
      documentUrl: record.documentUrl || null,
      review: normalizeReview(record),
      hydration: 'store',
    });
  }

  return res.status(405).json({ error: 'Method not allowed', method, allowed: ['GET', 'POST'] });
}

// Test helpers
function _resetForTests(options = {}) {
  if (options.storePath !== undefined || options.env || options.pool !== undefined) {
    store = createDocumentReviewStore({
      ...(options.storePath !== undefined ? { storePath: options.storePath } : {}),
      ...(options.pool !== undefined ? { pool: options.pool } : {}),
      ...(options.env ? { env: options.env } : {}),
    });
    return store.map.size === 0;
  }
  store.map.clear();
  return store.reset() || store.map.size === 0;
}

function _getStore() {
  return store;
}

module.exports = (req, res) => handleDocumentReview(req, res);
module.exports.handleDocumentReview = handleDocumentReview;
module.exports.REVIEW_STATES = REVIEW_STATES;
module.exports._resetForTests = _resetForTests;
module.exports._getStore = _getStore;
Object.defineProperty(module.exports, '_store', {
  enumerable: true,
  get() { return store.map; },
});
module.exports.enumerateListingDocuments = enumerateListingDocuments;
module.exports.documentId = documentId;
module.exports.decodeDocumentId = decodeDocumentId;
