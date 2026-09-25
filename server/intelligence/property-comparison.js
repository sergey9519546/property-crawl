// server/intelligence/property-comparison.js
//
// Side-by-side comparison of 2-4 listings. The "compare" affordance on
// Zillow/Redfin: pick a few listings, see the deltas at a glance.
//
// This module is a pure function: callers pass in the listings + a
// target listing (one of them) and the engine emits:
//   - normalized per-listing rows (so the UI can render a table)
//   - per-field deltas vs. the target (cheaper / newer / larger …)
//   - a "winner" pick per dimension (so the UI can star the cheapest
//     row, the largest, the highest deal score, etc.)
//
// All math is fail-closed: missing numeric fields never coerce to 0
// in a way that produces a false "cheapest" pick.

'use strict';

const MAX_LISTINGS = 4;

function finiteOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function isString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function lowerBetter(values) {
  // Returns the index of the lowest finite value, or -1 if none.
  let bestIdx = -1;
  let bestVal = Infinity;
  for (let i = 0; i < values.length; i += 1) {
    const v = values[i];
    if (!Number.isFinite(v)) continue;
    if (v < bestVal) {
      bestVal = v;
      bestIdx = i;
    }
  }
  return bestIdx;
}

function higherBetter(values) {
  let bestIdx = -1;
  let bestVal = -Infinity;
  for (let i = 0; i < values.length; i += 1) {
    const v = values[i];
    if (!Number.isFinite(v)) continue;
    if (v > bestVal) {
      bestVal = v;
      bestIdx = i;
    }
  }
  return bestIdx;
}

function discount(listing) {
  const opening = finiteOrNull(listing.openingBid);
  const mid = finiteOrNull(listing.mid);
  if (!Number.isFinite(opening) || !Number.isFinite(mid) || mid <= 0 || opening <= 0) return null;
  return 1 - (opening / mid);
}

const NUMERIC_FIELDS = [
  'sqft', 'year', 'openingBid', 'mid', 'estLow', 'estHigh', 'dealScore', 'lotSize'
];
const STRING_FIELDS = ['state', 'city', 'zip', 'propType', 'source', 'occupancy', 'status'];

// Normalize one listing into the shape the comparison table renders.
function normalizeRow(listing) {
  if (!listing || typeof listing !== 'object') return null;
  const row = { id: listing.id || null };
  for (const field of NUMERIC_FIELDS) {
    row[field] = finiteOrNull(listing[field]);
  }
  for (const field of STRING_FIELDS) {
    row[field] = isString(listing[field]) ? listing[field].trim() : null;
  }
  row.discount = discount(listing);
  return row;
}

// Compare a single field against the target. Returns:
//   { values: number[], deltas: (number|null)[], bestIndex: number }
// where `bestIndex` is the row that "wins" this dimension (lower or
// higher depending on the field). For "neutral" fields (sqft, year),
// the bigger number is better (more house, newer build).
//
// `deltas` always has the same length as `rows.slice(1)` — one entry
// per comparison row — so the UI can iterate without bookkeeping. Each
// entry is null when the delta can't be computed (target missing or
// comparison row missing).
function compareDimension(rows, field, direction) {
  const values = rows.map((row) => finiteOrNull(row?.[field]));
  const target = values[0];
  const targetFinite = target !== null && Number.isFinite(target);
  const deltas = values.slice(1).map((v) => {
    if (!targetFinite) return null;
    if (!Number.isFinite(v)) return null;
    return v - target;
  });
  let bestIndex = -1;
  if (direction === 'lower') bestIndex = lowerBetter(values);
  else if (direction === 'higher') bestIndex = higherBetter(values);
  return { values, deltas, bestIndex };
}

const DIRECTION_MAP = {
  sqft: 'higher',
  year: 'higher',
  openingBid: 'lower',
  mid: 'higher',
  estLow: 'higher',
  estHigh: 'higher',
  dealScore: 'higher',
  lotSize: 'higher',
  discount: 'higher'  // higher discount = bigger gap between bid and mid
};

// Public API. `listings` is an array of 2..4 listing records. The
// first entry is the target; subsequent entries are the comparisons.
// Returns:
//   {
//     schema: 'property-crawl.compare/v1',
//     targetId: <id>,
//     count: <n>,
//     rows: [<normalized row>, ...],
//     deltas: { field: { values, deltas, bestIndex } },
//     winnerByField: { field: <rowId> | null },
//     reason: 'listings_too_few' | 'listings_too_many' | 'target_missing' | null
//   }
function buildPropertyComparison(listings, options = {}) {
  const input = Array.isArray(listings) ? listings : [];
  if (input.length < 2) {
    return {
      schema: 'property-crawl.compare/v1',
      targetId: null,
      count: input.length,
      rows: [],
      deltas: {},
      winnerByField: {},
      reason: 'listings_too_few'
    };
  }
  if (input.length > MAX_LISTINGS) {
    return {
      schema: 'property-crawl.compare/v1',
      targetId: input[0]?.id || null,
      count: input.length,
      rows: [],
      deltas: {},
      winnerByField: {},
      reason: 'listings_too_many'
    };
  }

  const rows = input.map(normalizeRow);
  const targetId = rows[0]?.id || null;

  const deltas = {};
  const winnerByField = {};
  for (const field of NUMERIC_FIELDS) {
    const direction = DIRECTION_MAP[field] || 'higher';
    const result = compareDimension(rows, field, direction);
    deltas[field] = {
      values: result.values,
      deltas: result.deltas,
      bestIndex: result.bestIndex
    };
    winnerByField[field] = result.bestIndex >= 0 ? rows[result.bestIndex].id : null;
  }
  // discount is computed, not stored on rows. Compute it for deltas too.
  const discountValues = rows.map((r) => r.discount);
  const targetDiscount = discountValues[0];
  const targetDiscountFinite = targetDiscount !== null && Number.isFinite(targetDiscount);
  deltas.discount = {
    values: discountValues,
    deltas: discountValues.slice(1).map((v) => {
      if (!targetDiscountFinite) return null;
      if (!Number.isFinite(v)) return null;
      return v - targetDiscount;
    }),
    bestIndex: higherBetter(discountValues)
  };
  winnerByField.discount = deltas.discount.bestIndex >= 0 ? rows[deltas.discount.bestIndex].id : null;

  return {
    schema: 'property-crawl.compare/v1',
    targetId,
    count: rows.length,
    rows,
    deltas,
    winnerByField,
    reason: null
  };
}

module.exports = {
  buildPropertyComparison,
  normalizeRow,
  compareDimension,
  MAX_LISTINGS,
  // Internal helpers exposed for tests
  _internals: { discount, finiteOrNull, lowerBetter, higherBetter }
};