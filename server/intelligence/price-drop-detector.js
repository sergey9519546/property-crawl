// server/intelligence/price-drop-detector.js
//
// Detect price drops across the user's saved listings. Two surfaces:
//
//   1. detectPriceDrops({ current: <listing>, previous: <priorListing> },
//                        options)
//      Pure predicate: returns { dropped, currentBid, previousBid, delta,
//                                deltaPct, severity } for a single
//      (current, previous) pair. Severity is "minor" / "moderate" /
//      "major" / "extreme" based on the % delta.
//
//   2. summarizePriceDrops(drops)
//      Aggregate stats over many drop records: count by severity,
//      median delta, total savings, top 5 biggest drops.
//
// Both functions are pure; callers (the route, the alerts runner)
// pass in the listings. The route fetches the current snapshot from
// the DB and the prior snapshot from the listing-history table (or
// the in-memory cache when no history is available).
//
// "Price" here is openingBid — the field the user actually wants to
// track. We do not compare mid or estLow because those typically
// don't change for the same listing.

'use strict';

const SEVERITY_THRESHOLDS = [
  { name: 'extreme', minPct: 0.40 },
  { name: 'major', minPct: 0.20 },
  { name: 'moderate', minPct: 0.10 },
  { name: 'minor', minPct: 0.05 }
];

function finiteOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function severityForPct(pct) {
  const abs = Math.abs(pct);
  for (const threshold of SEVERITY_THRESHOLDS) {
    if (abs >= threshold.minPct) return threshold.name;
  }
  return 'none';
}

function detectPriceDrop({ current, previous }, options = {}) {
  if (!current || typeof current !== 'object') {
    return { dropped: false, reason: 'current_missing' };
  }
  if (!previous || typeof previous !== 'object') {
    return { dropped: false, reason: 'previous_missing' };
  }
  const currentBid = finiteOrNull(current.openingBid);
  const previousBid = finiteOrNull(previous.openingBid);
  if (!Number.isFinite(currentBid) || !Number.isFinite(previousBid)) {
    return { dropped: false, reason: 'opening_bid_missing' };
  }
  if (currentBid >= previousBid) {
    // Either no change or a price increase. The drop detector only
    // surfaces drops — increases go through a separate flow (or no flow).
    return {
      dropped: false,
      currentBid,
      previousBid,
      delta: currentBid - previousBid,
      deltaPct: 0,
      severity: 'none'
    };
  }

  const delta = currentBid - previousBid; // negative number
  const deltaPct = previousBid > 0 ? (delta / previousBid) : 0;
  const severity = severityForPct(deltaPct);
  return {
    dropped: true,
    currentBid,
    previousBid,
    delta,
    deltaPct: Number(deltaPct.toFixed(4)),
    severity
  };
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) return (sorted[mid - 1] + sorted[mid]) / 2;
  return sorted[mid];
}

function summarizePriceDrops(drops, options = {}) {
  if (!Array.isArray(drops)) drops = [];
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
  const droppedOnly = drops.filter((d) => d && d.dropped);

  const bySeverity = { minor: 0, moderate: 0, major: 0, extreme: 0, none: 0 };
  const totalSavings = droppedOnly.reduce((acc, d) => acc + (Number.isFinite(d.delta) ? -d.delta : 0), 0);
  const pctValues = droppedOnly.map((d) => finiteOrNull(d.deltaPct)).filter(Number.isFinite);
  const dollarValues = droppedOnly.map((d) => -finiteOrNull(d.delta)).filter(Number.isFinite);
  const topDrops = droppedOnly
    .filter((d) => Number.isFinite(d.deltaPct))
    .slice()
    .sort((a, b) => Math.abs(b.deltaPct) - Math.abs(a.deltaPct))
    .slice(0, 5);

  for (const drop of droppedOnly) {
    const severity = typeof drop.severity === 'string' ? drop.severity : 'none';
    bySeverity[severity] = (bySeverity[severity] || 0) + 1;
  }
  // The "none" bucket includes price increases + missing-input rejections;
  // surface those too so the summary stays honest about non-drops.
  for (const drop of drops) {
    if (!drop || drop.dropped) continue;
    const severity = typeof drop.severity === 'string' ? drop.severity : 'none';
    if (severity === 'none') bySeverity.none = (bySeverity.none || 0) + 1;
  }

  return {
    scanned: drops.length,
    dropped: droppedOnly.length,
    unchangedOrIncreased: drops.length - droppedOnly.length,
    totalSavings: Math.round(totalSavings),
    medianDeltaPct: pctValues.length ? Number(median(pctValues).toFixed(4)) : null,
    medianDollarSaving: dollarValues.length ? Math.round(median(dollarValues)) : null,
    bySeverity,
    topDrops: topDrops.map((d) => ({
      listingId: d.listingId || null,
      previousBid: d.previousBid,
      currentBid: d.currentBid,
      delta: d.delta,
      deltaPct: d.deltaPct,
      severity: d.severity
    })),
    generatedAt: new Date(nowMs).toISOString()
  };
}

module.exports = {
  detectPriceDrop,
  summarizePriceDrops,
  // Internal helpers exposed for tests
  _internals: { severityForPct, SEVERITY_THRESHOLDS }
};