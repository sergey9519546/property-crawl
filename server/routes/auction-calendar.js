'use strict';

// server/routes/auction-calendar.js
//
// GET /api/auction-calendar — bucket live listings by ISO-week of
// sale_date for the next 60 days. Read-only, public analytics; no
// auth. Calls server/intelligence/auction-calendar.js.
//
// Query params:
//   windowDays  — planning horizon (1..365, default 60)
//   startMs     — start of the window as Unix ms (default: now)
//   states      — comma-separated state filter (e.g. "TX,CA")
//   sampleSize  — listings per week to surface in `sample` (1..10, default 3)

const db = require('../db/client');
const { scanAllListings } = require('../db/listings-scan');
const { buildAuctionCalendar } = require('../intelligence/auction-calendar');

// DiscoveryCalendar in src/components/listings/discovery-workbench.tsx calls
// this endpoint whenever the user opens Calendar mode on /listings. Because a
// full-store scan takes ~3.2s on 9,831 rows, computed responses are cached for
// a short TTL (default 60s, configurable via AUCTION_CALENDAR_CACHE_MS; 0
// disables caching) and publish cachedAt + ageMs on every response.
const DEFAULT_CACHE_TTL_MS = 60_000;
const MAX_CACHE_ENTRIES = 50;

function resolveCacheTtlMs(overrideTtlMs, env = process.env) {
  if (overrideTtlMs !== undefined && overrideTtlMs !== null) {
    const n = Number(overrideTtlMs);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  if (env && env.AUCTION_CALENDAR_CACHE_MS !== undefined && env.AUCTION_CALENDAR_CACHE_MS !== '') {
    const n = Number(env.AUCTION_CALENDAR_CACHE_MS);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return DEFAULT_CACHE_TTL_MS;
}

function boundedInt(raw, fallback, min, max) {
  if (raw === null || raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return fallback;
  if (n < min || n > max) return fallback;
  return n;
}

function parseStates(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const list = raw.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
  return list.length ? list : null;
}

function createAuctionCalendarHandler(dependencies = {}) {
  const database = dependencies.database || db;
  const env = dependencies.env || process.env;
  const now = typeof dependencies.now === 'function'
    ? dependencies.now
    : (dependencies.now ? () => dependencies.now : () => Date.now());
  const cache = new Map();

  return async function handleAuctionCalendar(req, res, urlInput) {
    if (String(req?.method || '').toUpperCase() !== 'GET') {
      res.statusCode = 405;
      res.setHeader('Allow', 'GET');
      return res.json({ error: 'method_not_allowed' });
    }

    const url = urlInput instanceof URL ? urlInput : new URL(req.url, 'http://localhost');
    if (url.pathname !== '/api/auction-calendar') {
      return res.status(404).json({ error: 'not_found' });
    }

    const windowDays = boundedInt(url.searchParams.get('windowDays'), 60, 1, 365);
    const sampleSize = boundedInt(url.searchParams.get('sampleSize'), 3, 1, 10);
    const states = parseStates(url.searchParams.get('states'));
    const startMs = url.searchParams.get('startMs')
      ? Number(url.searchParams.get('startMs'))
      : null;

    const currentNow = now();
    const ttlMs = resolveCacheTtlMs(dependencies.cacheTtlMs, env);
    const statesKey = states ? [...states].sort().join(',') : '';
    const startKey = Number.isFinite(startMs) ? String(startMs) : 'now';
    const cacheKey = `${windowDays}|${sampleSize}|${statesKey}|${startKey}`;

    if (ttlMs > 0) {
      const hit = cache.get(cacheKey);
      if (hit && currentNow - hit.cachedAtMs >= 0 && currentNow - hit.cachedAtMs < ttlMs) {
        res.setHeader('Cache-Control', 'no-store');
        return res.json({
          ...hit.payload,
          cachedAt: new Date(hit.cachedAtMs).toISOString(),
          ageMs: Math.max(0, currentNow - hit.cachedAtMs)
        });
      }
    }

    let payload;
    if (database.isPg && typeof database.getAuctionCalendarNative === 'function') {
      const nativeResult = await database.getAuctionCalendarNative({
        windowDays,
        sampleSize,
        states,
        startMs: Number.isFinite(startMs) ? startMs : undefined,
        nowMs: currentNow
      });
      payload = {
        schema: 'property-crawl.auction-calendar/v1',
        windowDays,
        states: states || null,
        startMs: nativeResult.startMs,
        endMs: nativeResult.endMs,
        scanned: nativeResult.scanned,
        availableTotal: nativeResult.availableTotal,
        truncated: nativeResult.truncated,
        dropped: nativeResult.dropped,
        weeks: nativeResult.weeks
      };
    } else {
      const { pool, availableTotal, scanned, truncated } = await scanAllListings(database, { summary: true });

      const result = buildAuctionCalendar(pool, {
        windowDays,
        sampleSize,
        states,
        startMs: Number.isFinite(startMs) ? startMs : undefined,
        nowMs: currentNow
      });

      payload = {
        schema: 'property-crawl.auction-calendar/v1',
        windowDays,
        states: states || null,
        startMs: result.startMs,
        endMs: result.endMs,
        scanned,
        availableTotal,
        truncated,
        dropped: {
          noDate: result.droppedNoDate,
          outsideWindow: result.droppedOutside,
          stateFilter: result.droppedState
        },
        weeks: result.weeks
      };
    }

    if (ttlMs > 0) {
      if (cache.size >= MAX_CACHE_ENTRIES) {
        const oldestKey = cache.keys().next().value;
        if (oldestKey !== undefined) cache.delete(oldestKey);
      }
      cache.set(cacheKey, { cachedAtMs: currentNow, payload });
    }

    res.setHeader('Cache-Control', 'no-store');
    return res.json({
      ...payload,
      cachedAt: new Date(currentNow).toISOString(),
      ageMs: 0
    });
  };
}

module.exports = {
  createAuctionCalendarHandler,
  parseStates
};
