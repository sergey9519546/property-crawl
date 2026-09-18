'use strict';

/**
 * Document Review API Route
 * ==========================
 *
 * Thin HTTP wrapper over server/intelligence/document-review.js. The pure
 * module owns the state machine; this route is responsible for:
 *   - resolving the document identifier from the URL / body
 *   - applying the review via the pure module
 *   - surfacing validation errors as 400 / 422 with stable codes
 *
 * Storage: an in-memory Map for now. The persistent layer (Postgres table
 * or workspace-scoped store) is intentionally deferred — the route contract
 * is the durable part.
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
const { resolveOperatorToken } = require('../security/operator-token');
const { presentedRunToken, tokensMatch } = require('./scrapers');

function requireOperator(req, res) {
  const configuredToken = resolveOperatorToken(process.env);
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

const MAX_DOCUMENT_ID_LENGTH = 200;
const MAX_LISTING_ID_LENGTH = 200;
const MAX_BODY_BYTES = 32 * 1024;

// Module-scoped store. Replaced per process — fine for the in-memory
// placeholder; a real backend swaps this out.
const reviews = new Map();

function cleanIdentifier(value, maxLength) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
}

function documentId(listingId, documentIndex, documentUrl) {
  // Use `~` as the path-component separator (URL-safe; `|` would be percent-
  // encoded; `#` is the URL fragment separator; `/` would break path routing).
  const parts = [cleanIdentifier(listingId, MAX_LISTING_ID_LENGTH) || 'unknown'];
  if (Number.isInteger(documentIndex) && documentIndex >= 0) parts.push(`~${documentIndex}`);
  if (typeof documentUrl === 'string' && documentUrl.trim()) parts.push(documentUrl.trim().slice(0, MAX_DOCUMENT_ID_LENGTH));
  return parts.join('~');
}

function readJsonBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    let settled = false;
    const done = (body) => {
      if (settled) return;
      settled = true;
      resolve(body);
    };
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

async function handleDocumentReview(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const method = req.method;
  res.setHeader('Cache-Control', 'no-store');
  if (!requireOperator(req, res)) return;

  if (method === 'GET' && url.pathname === '/api/document-review') {
    const requestedStatus = url.searchParams.get('status');
    const all = [...reviews.values()].map(normalizeReview);
    const filtered = requestedStatus ? filterByStatus(all, requestedStatus) : all;
    const summary = summarizeReviews(all);
    return res.json({
      total: summary.total,
      byStatus: summary.byStatus,
      reviews: filtered,
    });
  }

  if (method === 'POST' && url.pathname === '/api/document-review') {
    const body = await readJsonBody(req);
    if (body === null) return badRequest(res, 'invalid JSON body', 400);
    const listingId = cleanIdentifier(body.listingId, MAX_LISTING_ID_LENGTH);
    if (!listingId) return badRequest(res, 'listingId is required');
    const id = documentId(listingId, body.documentIndex, body.documentUrl);
    if (!id) return badRequest(res, 'document id could not be derived');

    const previous = reviews.has(id) ? normalizeReview(reviews.get(id)) : createPendingReview({ extractedAt: body.extractedAt });
    const result = applyReview(previous, body);
    if (Array.isArray(result.errors) && result.errors.length) {
      const code = result.errors.find(e => e.startsWith('shape:')) ? 400 : 422;
      return badRequest(res, result.errors.join('; '), code);
    }
    reviews.set(id, result);
    return res.status(200).json({ id, listingId, documentIndex: body.documentIndex, documentUrl: body.documentUrl || null, review: result });
  }

  if (method === 'GET' && url.pathname.startsWith('/api/document-review/')) {
    const tail = url.pathname.slice('/api/document-review/'.length).trim();
    if (!tail) return badRequest(res, 'document id is required');
    if (!reviews.has(tail)) return res.status(404).json({ error: 'review not found' });
    return res.json({ id: tail, review: normalizeReview(reviews.get(tail)) });
  }

  return res.status(405).json({ error: 'Method not allowed', method, allowed: ['GET', 'POST'] });
}

// Test helper: lets unit tests reset the in-memory store between cases.
function _resetForTests() {
  reviews.clear();
  return reviews.size === 0;
}

module.exports = handleDocumentReview;
module.exports.handleDocumentReview = handleDocumentReview;
module.exports.REVIEW_STATES = REVIEW_STATES;
module.exports._resetForTests = _resetForTests;
module.exports._store = reviews;
