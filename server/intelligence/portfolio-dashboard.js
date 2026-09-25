// server/intelligence/portfolio-dashboard.js
//
// Aggregates the user's saved watchlist into a single dashboard
// payload. The user's saved listings are the input; the output is
// the roll-up the property-management view in the app needs:
//
//   - count of saved listings + alerts metadata
//   - per-state, per-source, per-propType counts
//   - per-bucket median opening bid / mid / deal score
//   - upcoming sales (sorted ascending, within window)
//   - total estimated equity (sum of mid - openingBid when both present)
//   - median discount across the portfolio
//   - reasons when a listing can't be scored
//
// Pure-function: callers pass in the saved listings array. No DB
// access here. This matches the same pattern as the rest of
// server/intelligence/*.

'use strict';

const DEFAULT_UPCOMING_WINDOW_DAYS = 30;

function finiteOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) return (sorted[mid - 1] + sorted[mid]) / 2;
  return sorted[mid];
}

function sum(values) {
  let total = 0;
  for (const v of values) {
    if (Number.isFinite(v)) total += v;
  }
  return total;
}

function discount(listing) {
  const opening = finiteOrNull(listing.openingBid);
  const mid = finiteOrNull(listing.mid);
  if (!Number.isFinite(opening) || !Number.isFinite(mid) || mid <= 0 || opening <= 0) return null;
  return 1 - (opening / mid);
}

function parseDate(value) {
  if (!value) return null;
  const t = typeof value === 'number' ? value : Date.parse(String(value));
  return Number.isFinite(t) ? t : null;
}

function tallyBy(listings, getKey) {
  const out = {};
  for (const listing of listings) {
    const key = getKey(listing);
    if (key === null || key === undefined || key === '') continue;
    out[key] = (out[key] || 0) + 1;
  }
  return out;
}

function tallyReasons(listings) {
  const reasons = {};
  for (const listing of listings) {
    if (finiteOrNull(listing.openingBid) === null) reasons.missing_opening_bid = (reasons.missing_opening_bid || 0) + 1;
    if (finiteOrNull(listing.mid) === null) reasons.missing_mid = (reasons.missing_mid || 0) + 1;
    if (finiteOrNull(listing.dealScore) === null) reasons.missing_deal_score = (reasons.missing_deal_score || 0) + 1;
    if (parseDate(listing.saleDate) === null) reasons.missing_sale_date = (reasons.missing_sale_date || 0) + 1;
  }
  return reasons;
}

// Public API. Returns:
//   {
//     userId, count,
//     totalEstimatedValue: <sum of mid>,
//     totalEstimatedEquity: <sum of (mid - openingBid) when both finite>,
//     medianOpeningBid, medianMid, medianDealScore, medianDiscount,
//     perState: {state: count}, perSource: {s: count}, perPropType: {t: count},
//     upcomingSales: [<listings sorted by sale_date asc, capped to limit>],
//     missing: { reason: count },
//     generatedAt: <iso>
//   }
//
// `options` may carry:
//   - upcomingWindowDays: include sales within N days of now (default 30)
//   - upcomingLimit: cap on upcomingSales (default 5)
//   - nowMs: clock injection (default Date.now())
function computePortfolioDashboard(savedListings, options = {}) {
  const listings = Array.isArray(savedListings) ? savedListings : [];
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
  const upcomingWindowDays = Number.isFinite(options.upcomingWindowDays)
    ? Math.max(0, options.upcomingWindowDays)
    : DEFAULT_UPCOMING_WINDOW_DAYS;
  const upcomingLimit = Number.isFinite(options.upcomingLimit)
    ? Math.max(0, Math.min(50, options.upcomingLimit))
    : 5;

  const openings = listings.map((l) => finiteOrNull(l.openingBid)).filter(Number.isFinite);
  const mids = listings.map((l) => finiteOrNull(l.mid)).filter(Number.isFinite);
  const scores = listings.map((l) => finiteOrNull(l.dealScore)).filter(Number.isFinite);
  const discounts = listings.map(discount).filter(Number.isFinite);

  const upcomingSales = listings
    .map((listing) => ({ listing, saleTs: parseDate(listing.saleDate) }))
    .filter((entry) => entry.saleTs !== null)
    .filter((entry) => entry.saleTs >= nowMs && entry.saleTs <= nowMs + upcomingWindowDays * 86_400_000)
    .sort((a, b) => a.saleTs - b.saleTs)
    .slice(0, upcomingLimit)
    .map((entry) => entry.listing);

  return {
    userId: typeof options.userId === 'string' ? options.userId : null,
    count: listings.length,
    totalEstimatedValue: mids.length ? sum(mids) : null,
    totalEstimatedEquity: listings.reduce((acc, l) => {
      const opening = finiteOrNull(l.openingBid);
      const mid = finiteOrNull(l.mid);
      if (Number.isFinite(opening) && Number.isFinite(mid)) return acc + (mid - opening);
      return acc;
    }, 0),
    medianOpeningBid: median(openings),
    medianMid: median(mids),
    medianDealScore: median(scores),
    medianDiscount: discounts.length ? Number(median(discounts).toFixed(4)) : null,
    perState: tallyBy(listings, (l) => typeof l.state === 'string' ? l.state.trim().toUpperCase() : null),
    perSource: tallyBy(listings, (l) => typeof l.source === 'string' ? l.source.trim() : null),
    perPropType: tallyBy(listings, (l) => typeof l.propType === 'string' ? l.propType.trim() : null),
    upcomingSales,
    missing: tallyReasons(listings),
    generatedAt: new Date(nowMs).toISOString()
  };
}

module.exports = {
  computePortfolioDashboard,
  // Internal helpers exposed for tests
  _internals: { median, sum, discount, parseDate, tallyReasons }
};