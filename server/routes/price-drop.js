'use strict';

// server/routes/price-drop.js
//
// GET /api/price-drops — returns detected price drops across the
// user's saved listings. Each saved listing is paired with its prior
// snapshot (the engine reads "previous" from the listing-history
// table when present; falls back to a "no previous" verdict when
// the history is missing — the drop detector returns dropped=false
// in that case rather than inventing one).
//
// Auth: workspace-identity gate (the saved-listings layer enforces
// it; the route just plumbs through).

const db = require('../db/client');
const { detectPriceDrop, summarizePriceDrops } = require('../intelligence/price-drop-detector');
const { requireUserIdentity } = require('../security/workspace-identity');

function defaultIdentity(req, res) {
  return requireUserIdentity(req, res);
}

async function loadHistoryLookup(database, listingIds, options = { prior: true }) {
  // Returns { lookup: Map<listingId, mostRecentSnapshot>, unavailable: boolean }.
  if (!database || typeof database.getListingHistory !== 'function') return { lookup: new Map(), unavailable: true };
  try {
    const history = await database.getListingHistory(listingIds, options);
    if (history instanceof Map) return { lookup: history, unavailable: false };
    // Backward-compat: some test stubs return a plain array.
    const map = new Map();
    if (Array.isArray(history)) {
      for (const entry of history) {
        if (!entry || typeof entry !== 'object' || !entry.listingId) continue;
        map.set(entry.listingId, entry);
      }
    }
    return { lookup: map, unavailable: false };
  } catch (err) {
    console.warn('[PriceDrops] getListingHistory lookup failed:', err?.message || err);
    return { lookup: new Map(), unavailable: true };
  }
}

function createPriceDropHandler(dependencies = {}) {
  const database = dependencies.database || db;
  const identity = dependencies.requireWorkspaceIdentity || defaultIdentity;
  const now = typeof dependencies.now === 'function'
    ? dependencies.now
    : (dependencies.now ? () => dependencies.now : () => Date.now());

  return async function handlePriceDrop(req, res, urlInput) {
    if (String(req?.method || '').toUpperCase() !== 'GET') {
      res.statusCode = 405;
      res.setHeader('Allow', 'GET');
      return res.json({ error: 'method_not_allowed' });
    }

    const url = urlInput instanceof URL ? urlInput : new URL(req.url, 'http://localhost');
    if (url.pathname !== '/api/price-drops') {
      return res.status(404).json({ error: 'not_found' });
    }

    const userId = identity(req, res);
    if (!userId) return;

    const saved = await database.getSavedDeals(userId);
    const savedListings = Array.isArray(saved) ? saved : [];
    const listingIds = savedListings.map((l) => l && l.id).filter(Boolean);
    const { lookup: historyLookup, unavailable: historyUnavailable } = await loadHistoryLookup(database, listingIds, { prior: true });

    const drops = [];
    for (const listing of savedListings) {
      const previous = historyLookup.get(listing.id) || null;
      const verdict = detectPriceDrop({ current: listing, previous });
      drops.push({ listingId: listing.id, ...verdict });
    }

    const summary = summarizePriceDrops(drops, { nowMs: now() });

    res.setHeader('Cache-Control', 'no-store');
    return res.json({
      schema: 'property-crawl.price-drops/v1',
      userId,
      historyUnavailable,
      ...summary,
      drops: drops.map((d) => ({
        listingId: d.listingId,
        dropped: d.dropped,
        currentBid: d.currentBid ?? null,
        previousBid: d.previousBid ?? null,
        delta: d.delta ?? null,
        deltaPct: d.deltaPct ?? null,
        severity: d.severity ?? 'none',
        reason: d.reason ?? null
      }))
    });
  };
}

module.exports = {
  createPriceDropHandler
};