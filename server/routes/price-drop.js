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
const { requireWorkspaceIdentity } = require('../security/workspace-identity');

function defaultIdentity(req, res) {
  return requireWorkspaceIdentity(req, res);
}

async function loadHistoryLookup(database, listingIds) {
  // Returns a Map<listingId, mostRecentSnapshot> for the requested ids.
  // The history is global (not per-user); if the DB doesn't implement
  // getListingHistory, the route returns dropped=false for every saved
  // listing — fail-closed, not "you have no drops" claim.
  if (!database || typeof database.getListingHistory !== 'function') return new Map();
  try {
    const history = await database.getListingHistory(listingIds);
    if (history instanceof Map) return history;
    // Backward-compat: some test stubs return a plain array.
    const map = new Map();
    if (Array.isArray(history)) {
      for (const entry of history) {
        if (!entry || typeof entry !== 'object' || !entry.listingId) continue;
        map.set(entry.listingId, entry);
      }
    }
    return map;
  } catch (_) {
    return new Map();
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
    const historyLookup = await loadHistoryLookup(database, listingIds);

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