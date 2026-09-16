// server/intelligence/auction-calendar.js
//
// Auction calendar: groups listings by week of sale_date so the UI can
// show "this week: 12 auctions, median opening bid $84k" or "next 30
// days: 47 auctions across 6 sources". The engine is a pure function:
// callers pass in the live listing pool and a window; the engine emits
// a sorted array of weeks.
//
// Design notes:
//   - Week buckets are ISO-week (Monday-start) computed from UTC.
//     Consistent across server timezones — important for cron jobs
//     and CLI reports.
//   - Each listing must have a parseable sale_date. Records without one
//     are dropped (no inferred-bucket guesses; an "unknown" week would
//     be useless to a bidder).
//   - Listings outside the window are also dropped. Window defaults to
//     [now, now + 60d] which is the typical planning horizon for a
//     property-tax auction cycle.
//   - per-source counts and per-propType counts come along for free
//     since we already iterate the bucket.

'use strict';

const DEFAULT_WINDOW_DAYS = 60;

function finiteOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseDate(value) {
  if (!value) return null;
  const t = typeof value === 'number' ? value : Date.parse(String(value));
  if (!Number.isFinite(t)) return null;
  return t;
}

// Returns the Monday 00:00 UTC of the ISO week containing the input ms.
function isoWeekStart(ms) {
  const d = new Date(ms);
  // Date.getUTCDay: 0 (Sun) ... 6 (Sat). Shift so Monday = 0.
  const day = (d.getUTCDay() + 6) % 7;
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day));
  return monday.getTime();
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) return (sorted[mid - 1] + sorted[mid]) / 2;
  return sorted[mid];
}

function isWithinWindow(saleDate, startMs, endMs) {
  const t = parseDate(saleDate);
  if (t === null) return false;
  return t >= startMs && t <= endMs;
}

// Public API. Returns an array of week buckets, sorted ascending by date:
//   [{ weekStart: <iso>, weekLabel: 'Nov 3–9', count, medianOpeningBid,
//      medianDealScore, sources: {s:n}, propTypes: {t:n},
//      sample: [<up to 3 listings>] }]
//
// `sample` gives the UI three listings to preview per week without
// forcing the consumer to fetch the full pool again.
function buildAuctionCalendar(pool, options = {}) {
  if (!Array.isArray(pool)) pool = [];
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
  const windowDays = Number.isFinite(options.windowDays) ? Math.max(1, options.windowDays) : DEFAULT_WINDOW_DAYS;
  const startMs = Number.isFinite(options.startMs) ? options.startMs : nowMs;
  const endMs = Number.isFinite(options.endMs) ? options.endMs : (startMs + windowDays * 86_400_000);
  const maxStates = Array.isArray(options.states) ? new Set(options.states.map((s) => String(s).toUpperCase())) : null;
  const sampleSize = Number.isFinite(options.sampleSize) ? Math.max(1, Math.min(10, options.sampleSize)) : 3;

  const buckets = new Map();
  let droppedNoDate = 0;
  let droppedOutside = 0;
  let droppedState = 0;

  for (const listing of pool) {
    if (!listing || typeof listing !== 'object') continue;
    const saleDate = parseDate(listing.saleDate);
    if (saleDate === null) {
      droppedNoDate += 1;
      continue;
    }
    if (saleDate < startMs || saleDate > endMs) {
      droppedOutside += 1;
      continue;
    }
    if (maxStates && (typeof listing.state !== 'string' || !maxStates.has(listing.state.toUpperCase()))) {
      droppedState += 1;
      continue;
    }
    const weekKey = isoWeekStart(saleDate);
    if (!buckets.has(weekKey)) {
      buckets.set(weekKey, {
        weekStart: weekKey,
        listings: []
      });
    }
    buckets.get(weekKey).listings.push(listing);
  }

  const out = [];
  for (const bucket of buckets.values()) {
    const openings = bucket.listings.map((l) => finiteOrNull(l.openingBid)).filter(Number.isFinite);
    const scores = bucket.listings.map((l) => finiteOrNull(l.dealScore)).filter(Number.isFinite);
    const sources = {};
    const propTypes = {};
    for (const listing of bucket.listings) {
      const src = typeof listing.source === 'string' ? listing.source : 'unknown';
      sources[src] = (sources[src] || 0) + 1;
      const t = typeof listing.propType === 'string' ? listing.propType : 'unknown';
      propTypes[t] = (propTypes[t] || 0) + 1;
    }
    const sorted = [...bucket.listings].sort((a, b) => parseDate(a.saleDate) - parseDate(b.saleDate));
    out.push({
      weekStart: new Date(bucket.weekStart).toISOString(),
      weekLabel: formatWeekLabel(bucket.weekStart),
      count: bucket.listings.length,
      medianOpeningBid: median(openings),
      medianDealScore: median(scores),
      sources,
      propTypes,
      sample: sorted.slice(0, sampleSize).map(lightweightListing)
    });
  }
  out.sort((a, b) => Date.parse(a.weekStart) - Date.parse(b.weekStart));
  return { weeks: out, droppedNoDate, droppedOutside, droppedState, startMs, endMs };
}

function formatWeekLabel(mondayMs) {
  const start = new Date(mondayMs);
  const end = new Date(mondayMs + 6 * 86_400_000);
  const monthStart = start.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
  const monthEnd = end.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
  if (monthStart === monthEnd) {
    return `${monthStart} ${start.getUTCDate()}–${end.getUTCDate()}`;
  }
  return `${monthStart} ${start.getUTCDate()} – ${monthEnd} ${end.getUTCDate()}`;
}

function lightweightListing(listing) {
  return {
    id: listing.id,
    source: listing.source,
    state: listing.state,
    city: listing.city,
    address: listing.address,
    saleDate: listing.saleDate,
    openingBid: listing.openingBid,
    mid: listing.mid,
    dealScore: listing.dealScore,
    propType: listing.propType
  };
}

module.exports = {
  buildAuctionCalendar,
  isoWeekStart,
  // Internal helpers exposed for tests
  _internals: { median, parseDate, formatWeekLabel }
};