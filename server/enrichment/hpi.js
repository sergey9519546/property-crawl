'use strict';

/**
 * server/enrichment/hpi.js
 *
 * Explicit observed FHFA state-quarter inputs; no national-weight fallback.
 *
 * A series counts as observed only when it carries version 1, an https
 * fhfa.gov sourceUrl, a parseable retrievedAt, a 64-hex datasetSha256, and
 * per-state quarterly index values. There is deliberately NO default "current
 * period": the current period is derived from the observed series itself
 * (getLatestObservedPeriod). Callers without an observed series get null and
 * must treat the trajectory as unobserved.
 */

function isObservedSeries(series) {
  if (!series || series.version !== 1 || !series.values || typeof series.values !== 'object') return false;
  let url;
  try { url = new URL(series.sourceUrl); } catch { return false; }
  return url.protocol === 'https:' && ['www.fhfa.gov', 'fhfa.gov'].includes(url.hostname)
    && Number.isFinite(Date.parse(series.retrievedAt)) && /^[a-f0-9]{64}$/i.test(series.datasetSha256 || '');
}

function getHpiIndex(state, period, series) {
  if (!isObservedSeries(series) || !/^[A-Z]{2}$/.test(state || '') || !/^\d{4}Q[1-4]$/.test(period || '')) return null;
  const value = series.values[state]?.[period];
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function getAppreciationMultiplier(state, baseline, current, series) {
  const past = getHpiIndex(state, baseline, series), present = getHpiIndex(state, current, series);
  return past !== null && present !== null ? present / past : null;
}

/**
 * Derives the latest observed period from the series data itself.
 * Returns null when the series is not observed or carries no valid periods.
 */
function getLatestObservedPeriod(series) {
  if (!isObservedSeries(series)) return null;
  let latest = null;
  for (const periods of Object.values(series.values)) {
    for (const period of Object.keys(periods || {})) {
      if (/^\d{4}Q[1-4]$/.test(period) && (latest === null || period > latest)) latest = period;
    }
  }
  return latest;
}

module.exports = { isObservedSeries, getHpiIndex, getAppreciationMultiplier, getLatestObservedPeriod };
