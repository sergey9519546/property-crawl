'use strict';

/**
 * server/enrichment/hpi.js
 *
 * Bridge and re-export for FHFA House Price Index benchmarks.
 */

// The national-weight model is not an observed state-quarter series.
const DEFAULT_CURRENT_PERIOD = '2026Q1';
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
module.exports = { DEFAULT_CURRENT_PERIOD, isObservedSeries, getHpiIndex, getAppreciationMultiplier };
