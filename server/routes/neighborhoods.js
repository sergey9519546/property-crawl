'use strict';

// server/routes/neighborhoods.js
//
// GET /api/neighborhoods                  — list every neighborhood bucket
// GET /api/neighborhoods/:kind/:key       — single bucket (e.g. zip:12345)
//
// Reads from server/intelligence/neighborhood-stats.js. Read-only,
// public analytics; no auth.
//
// Query params:
//   maxAgeDays  — drop stale listings (default 365)
//   state       — restrict to one state on the list endpoint
//   limit       — cap on rows returned by the list endpoint (default 100)

const db = require('../db/client');
const { computeNeighborhoodStats, getNeighborhoodStats } = require('../intelligence/neighborhood-stats');

function boundedInt(raw, fallback, min, max) {
  if (raw === null || raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return fallback;
  if (n < min || n > max) return fallback;
  return n;
}

// Reads the whole store, in pages, and reports how much it read.
//
// This was `getListings({ limit: 1000 })`, once, and said nothing about it --
// the identical bug the auction calendar had. Every count below (median
// opening bid, the propType tally, the per-source tallies) is a statistic over
// the pool, so a 1,000-row slice is not a neighborhood profile, it is an
// anecdote with a number attached. Fixed here rather than in a shared helper
// because each route decides its own scan budget; the invariant both now keep
// is `truncated` is true whenever `scanned < availableTotal`.
//
// `sort: 'date'` makes offset paging safe: every Postgres sort in db/client.js
// ends in `id ASC`, so the order is total and no row can be skipped or repeated
// across page boundaries.
const SCAN_PAGE_SIZE = 1000;
const SCAN_MAX_ROWS = 200_000;

async function loadPool(database = db, filters = {}) {
  const rows = [];
  let offset = 0;
  let availableTotal = null;

  for (;;) {
    const page = await database.getListings({
      limit: SCAN_PAGE_SIZE,
      offset,
      sort: 'date',
      ...filters
    });
    const batch = Array.isArray(page?.listings) ? page.listings : [];
    const reported = Number(page?.total);
    if (Number.isFinite(reported)) availableTotal = reported;

    rows.push(...batch);
    offset += batch.length;

    if (batch.length === 0) break;
    if (batch.length < SCAN_PAGE_SIZE) break;
    if (availableTotal !== null && rows.length >= availableTotal) break;
    if (rows.length >= SCAN_MAX_ROWS) break;
  }

  return { pool: rows, availableTotal, scanned: rows.length };
}

function parseKey(remaining) {
  // The key is everything after /api/neighborhoods/. Two shapes:
  //   zip:12345      → { kind: 'zip', key: '12345' }
  //   city:tx:houston → { kind: 'city', key: 'TX::houston' }
  if (!remaining || !remaining.includes(':')) return null;
  const [kind, ...rest] = remaining.split(':');
  if (kind === 'zip') return { kind: 'zip', key: rest.join(':') };
  if (kind === 'city' && rest.length === 2) {
    return { kind: 'city', key: `${rest[0].toUpperCase()}::${rest[1].toLowerCase()}` };
  }
  return null;
}

function serializeBucket(bucket) {
  return {
    kind: bucket.kind,
    key: bucket.key,
    label: bucket.label,
    count: bucket.count,
    medianOpeningBid: bucket.medianOpeningBid === null ? null : Number(bucket.medianOpeningBid.toFixed(2)),
    meanOpeningBid: bucket.meanOpeningBid,
    medianSqft: bucket.medianSqft === null ? null : Number(bucket.medianSqft.toFixed(0)),
    medianDealScore: bucket.medianDealScore,
    medianDiscount: bucket.medianDiscount,
    sources: bucket.sources,
    propTypes: bucket.propTypes
  };
}

function createNeighborhoodsHandler(dependencies = {}) {
  const database = dependencies.database || db;
  const now = typeof dependencies.now === 'function'
    ? dependencies.now
    : (dependencies.now ? () => dependencies.now : () => Date.now());

  return async function handleNeighborhoods(req, res, urlInput) {
    if (String(req?.method || '').toUpperCase() !== 'GET') {
      res.statusCode = 405;
      res.setHeader('Allow', 'GET');
      return res.json({ error: 'method_not_allowed' });
    }

    const url = urlInput instanceof URL ? urlInput : new URL(req.url, 'http://localhost');
    const segments = url.pathname.split('/').filter(Boolean);
    // Path shapes:
    //   /api/neighborhoods
    //   /api/neighborhoods/{kind}/{key...}     (key may itself contain a colon)
    const remaining = segments.slice(2).join('/');

    const maxAgeDays = boundedInt(url.searchParams.get('maxAgeDays'), 365, 1, 730);
    const limit = boundedInt(url.searchParams.get('limit'), 100, 1, 500);
    const stateFilter = typeof url.searchParams.get('state') === 'string'
      ? url.searchParams.get('state').toUpperCase()
      : null;

    const filters = {};
    if (stateFilter) filters.state = stateFilter;
    const { pool, availableTotal, scanned } = await loadPool(database, filters);

    if (!remaining) {
      const stats = computeNeighborhoodStats(pool, { maxAgeDays, nowMs: now() });
      const buckets = stats.slice(0, limit).map(serializeBucket);
      res.setHeader('Cache-Control', 'no-store');
      return res.json({
        schema: 'property-crawl.neighborhoods/v1',
        count: buckets.length,
        maxAgeDays,
        state: stateFilter,
        // What the medians and tallies above were computed from. `count` is the
        // number of neighborhoods returned after `limit`, not the number of
        // listings read, so neither figure alone tells you the coverage.
        scanned,
        availableTotal,
        truncated: availableTotal === null ? false : scanned < availableTotal,
        neighborhoods: buckets
      });
    }

    const parsed = parseKey(remaining);
    if (!parsed) {
      return res.status(400).json({ error: 'invalid_neighborhood_key', remaining });
    }
    const bucket = getNeighborhoodStats(`${parsed.kind}:${parsed.key}`, pool, { maxAgeDays, nowMs: now() });
    if (!bucket) {
      return res.status(404).json({ error: 'neighborhood_not_found', key: `${parsed.kind}:${parsed.key}` });
    }
    res.setHeader('Cache-Control', 'no-store');
    return res.json({
      schema: 'property-crawl.neighborhoods/v1',
      maxAgeDays,
      // Same disclosure as the list form: these medians describe the pool that
      // was read, and the pool is only the whole store if truncated is false.
      scanned,
      availableTotal,
      truncated: availableTotal === null ? false : scanned < availableTotal,
      neighborhood: serializeBucket(bucket)
    });
  };
}

module.exports = {
  createNeighborhoodsHandler,
  parseKey,
  serializeBucket
};