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

// How much of the store the calendar reads.
//
// This used to be `getListings({ limit: 1000 })`, once. Against the real store
// that is ~10% of the inventory, and nothing in the response said so: the
// `dropped` counters describe the rows that were read, not the rows that
// exist, so a reader saw "noDate: 866" as a fact about the inventory when it
// was a fact about page 1. Measured on the 9,831-row store, the endpoint
// reported 28 upcoming auctions against 3,417 actually in the window -- a 122x
// understatement. (It also mislabelled 866 rows as undated; only 2,270 of the
// 9,831 really have no sale date.)
//
// Read in pages to the end instead, and publish how much was read so the
// numbers can never be silently a slice again.
//
// Measured cost of the correctness: ~3.2s for a 60-day window on the
// 9,831-row store, against ~1.3s for the old single 1,000-row page. No page
// calls this yet (getAuctionCalendar in src/lib/intelligence-client.ts is
// exported but unused), so the price is not currently user-visible. If it ever
// is, cache the computed calendar for a short TTL and publish its age rather
// than reintroducing a row cap.
const SCAN_PAGE_SIZE = 1000;
// Backstop against a pathological store. If this ever bites, `truncated` goes
// true and the payload admits it.
const SCAN_MAX_ROWS = 200_000;

function boundedInt(raw, fallback, min, max) {
  if (raw === null || raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return fallback;
  if (n < min || n > max) return fallback;
  return n;
}

// Returns the whole pool plus what the backend said the pool's size was.
//
// `sort: 'date'` is not cosmetic. Offset paging is only safe when the sort is
// a total order; every Postgres sort in db/client.js ends in `id ASC`, so any
// of them qualifies, and 'date' is the natural order for a calendar.
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
    if (batch.length < SCAN_PAGE_SIZE) break;       // short page: end of stream
    if (availableTotal !== null && rows.length >= availableTotal) break;
    if (rows.length >= SCAN_MAX_ROWS) break;        // disclosed by truncated
  }

  return { pool: rows, availableTotal, scanned: rows.length };
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

    const { pool, availableTotal, scanned } = await loadPool(database);

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
      // What the week counts below were computed from. Without these the
      // calendar is a 1,000-row sample wearing the costume of a calendar.
      // availableTotal is null when the backend does not report a store size,
      // which means we read to end-of-stream rather than to a known total.
      scanned,
      availableTotal,
      truncated: availableTotal === null ? false : scanned < availableTotal,
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