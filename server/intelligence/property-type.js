// server/intelligence/property-type.js
//
// One canonical bucket key for a listing's property type.
//
// Publishers do not agree on how to say "we don't know". civilview publishes
// the literal string "Unknown"; a listing with no propType at all used to
// become the lowercase placeholder "unknown". Every engine that tallied
// propType bucketed the raw value, so one fact split in two:
//
//   { "Unknown": 4, "unknown": 37 }
//
// Live against the real store both /api/auction-calendar and /api/neighborhoods
// published exactly that pair. Beyond looking like a bug, it is enough to make
// a consumer that folds case fail outright -- PowerShell's ConvertFrom-Json
// rejects the whole payload.
//
// Real types are left exactly as their publisher wrote them. "Single Family"
// and "Multi-Family" are genuinely different strings from different sources and
// reconciling them is a data-normalisation decision, not a display detail.
// Only the unknown case is folded, because "we don't know" is the same fact
// whoever says it.

'use strict';

const UNKNOWN = 'Unknown';

function canonicalPropType(raw) {
  if (typeof raw !== 'string') return UNKNOWN;
  const trimmed = raw.trim();
  if (!trimmed) return UNKNOWN;
  if (trimmed.toLowerCase() === 'unknown') return UNKNOWN;
  return trimmed;
}

module.exports = { canonicalPropType, UNKNOWN_PROP_TYPE: UNKNOWN };