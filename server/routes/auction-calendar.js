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
const { buildAuctionCalendar } = require('../intelligence/auction-calendar');

function boundedInt(raw, fallback, min, max) {
  if (raw === null || raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return fallback;
  if (n < min || n > max) return fallback;
  return n;
}

async function loadPool(database = db, filters = {}) {
  const inventory = await database.getListings({ limit: 1000, ...filters });
  return Array.isArray(inventory?.listings) ? inventory.listings : [];
}

function parseStates(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const list = raw.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
  return list.length ? list : null;
}

function createAuctionCalendarHandler(dependencies = {}) {
  const database = dependencies.database || db;
  const now = typeof dependencies.now === 'function'
    ? dependencies.now
    : (dependencies.now ? () => dependencies.now : () => Date.now());

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

    const pool = await loadPool(database);

    const result = buildAuctionCalendar(pool, {
      windowDays,
      sampleSize,
      states,
      startMs: Number.isFinite(startMs) ? startMs : undefined,
      nowMs: now()
    });

    res.setHeader('Cache-Control', 'no-store');
    return res.json({
      schema: 'property-crawl.auction-calendar/v1',
      windowDays,
      states: states || null,
      startMs: result.startMs,
      endMs: result.endMs,
      dropped: {
        noDate: result.droppedNoDate,
        outsideWindow: result.droppedOutside,
        stateFilter: result.droppedState
      },
      weeks: result.weeks
    });
  };
}

module.exports = {
  createAuctionCalendarHandler,
  parseStates
};