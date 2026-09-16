'use strict';

// server/routes/watchlist-comps.js
//
// GET /api/watchlist/:listingId/comps — surface the most comparable
// active listings for a saved watchlist record. Read-only, no auth
// (comps are public analytics); calls into
// server/intelligence/watchlist-comps.js.
//
// Query params:
//   radiusKm    — proximity radius (1..50, default 8)
//   sqftBand    — ± band as fraction (0.05..1, default 0.30)
//   maxAgeDays  — ignore candidates older than N days (1..730, default 365)
//   limit       — cap on returned comps (1..50, default 8)

const db = require('../db/client');
const { findWatchlistComps } = require('../intelligence/watchlist-comps');

function boundedInt(raw, fallback, min, max) {
  if (raw === null || raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return fallback;
  if (n < min || n > max) return fallback;
  return n;
}

function boundedFloat(raw, fallback, min, max) {
  if (raw === null || raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  if (n < min || n > max) return fallback;
  return n;
}

async function loadTargetAndPool(listingId, database = db) {
  const target = await database.getListingById(listingId);
  if (!target) return { error: { status: 404, body: { error: 'listing_not_found', listingId } } };
  const inventory = await database.getListings({ limit: 1000 });
  const pool = Array.isArray(inventory?.listings) ? inventory.listings : [];
  return { target, pool };
}

function createWatchlistCompsHandler(dependencies = {}) {
  const database = dependencies.database || db;
  const now = typeof dependencies.now === 'function'
    ? dependencies.now
    : (dependencies.now ? () => dependencies.now : () => Date.now());

  return async function handleWatchlistComps(req, res, urlInput) {
    if (String(req?.method || '').toUpperCase() !== 'GET') {
      res.statusCode = 405;
      res.setHeader('Allow', 'GET');
      return res.json({ error: 'method_not_allowed' });
    }

    const url = urlInput instanceof URL ? urlInput : new URL(req.url, 'http://localhost');
    const segments = url.pathname.split('/').filter(Boolean);
    // Path shape: /api/watchlist/:listingId/comps
    const listingId = segments[2];
    const action = segments[3];
    if (!listingId || action !== 'comps') {
      return res.status(404).json({ error: 'not_found' });
    }

    const radiusKm = boundedFloat(url.searchParams.get('radiusKm'), 8, 0.5, 50);
    const sqftBand = boundedFloat(url.searchParams.get('sqftBand'), 0.30, 0.05, 1);
    const maxAgeDays = boundedInt(url.searchParams.get('maxAgeDays'), 365, 1, 730);
    const limit = boundedInt(url.searchParams.get('limit'), 8, 1, 50);

    const loaded = await loadTargetAndPool(listingId, database);
    if (loaded.error) return res.status(loaded.error.status).json(loaded.error.body);

    const result = findWatchlistComps(loaded.target, loaded.pool, {
      radiusKm,
      sqftBand,
      maxAgeDays,
      limit,
      nowMs: now()
    });

    res.setHeader('Cache-Control', 'no-store');
    return res.json({
      schema: 'property-crawl.watchlist-comps/v1',
      targetId: listingId,
      radiusKm,
      sqftBand,
      maxAgeDays,
      limit,
      comps: result.comps.map((c) => ({
        listing: c.listing,
        distanceKm: c.distanceKm === null ? null : Number(c.distanceKm.toFixed(3)),
        score: c.score
      })),
      stats: result.stats,
      reason: result.reason || null
    });
  };
}

module.exports = {
  createWatchlistCompsHandler,
  loadTargetAndPool
};