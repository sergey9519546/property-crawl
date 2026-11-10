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

const crypto = require('node:crypto');

function sha256Hex(text) {
  return crypto.createHash('sha256').update(String(text), 'utf8').digest('hex');
}

function isObservedSeries(series) {
  if (!series || series.version !== 1 || !series.values || typeof series.values !== 'object') return false;
  let url;
  try { url = new URL(series.sourceUrl); } catch { return false; }
  return url.protocol === 'https:' && ['www.fhfa.gov', 'fhfa.gov'].includes(url.hostname)
    && Number.isFinite(Date.parse(series.retrievedAt)) && /^[a-f0-9]{64}$/i.test(series.datasetSha256 || '');
}

/**
 * Compares two quarters in YYYYQq format chronologically.
 * Returns negative if a < b, 0 if a === b, positive if a > b.
 * Returns null if either quarter string is malformed.
 */
function compareQuarters(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return null;
  const matchA = a.match(/^(\d{4})Q([1-4])$/);
  const matchB = b.match(/^(\d{4})Q([1-4])$/);
  if (!matchA || !matchB) return null;
  const yearDiff = Number(matchA[1]) - Number(matchB[1]);
  if (yearDiff !== 0) return yearDiff;
  return Number(matchA[2]) - Number(matchB[2]);
}

/**
 * Returns the next chronological quarter string in YYYYQq format.
 * E.g., '2020Q1' -> '2020Q2', '2020Q4' -> '2021Q1'.
 * Returns null if the quarter string is malformed.
 */
function nextQuarter(quarter) {
  if (typeof quarter !== 'string') return null;
  const match = quarter.match(/^(\d{4})Q([1-4])$/);
  if (!match) return null;
  const year = Number(match[1]);
  const qtr = Number(match[2]);
  if (qtr === 4) return `${year + 1}Q1`;
  return `${year}Q${qtr + 1}`;
}

/**
 * Verifies that an array of quarters is in chronological order.
 * @param {string[]} quarters
 * @param {{ strictlyAscending?: boolean }} [options]
 * @returns {boolean}
 */
function areQuartersChronological(quarters, { strictlyAscending = false } = {}) {
  if (!Array.isArray(quarters) || quarters.length === 0) return false;
  for (let i = 0; i < quarters.length; i += 1) {
    if (typeof quarters[i] !== 'string' || !/^\d{4}Q[1-4]$/.test(quarters[i])) return false;
    if (i > 0) {
      const cmp = compareQuarters(quarters[i - 1], quarters[i]);
      if (cmp === null) return false;
      if (strictlyAscending ? cmp >= 0 : cmp > 0) return false;
    }
  }
  return true;
}

/**
 * Verifies that an array of quarters is strictly continuous (no missing quarters).
 * E.g., ['2020Q1', '2020Q2', '2020Q3', '2020Q4', '2021Q1'] is continuous.
 * E.g., ['2020Q1', '2020Q3'] has a gap and returns false.
 *
 * @param {string[]} quarters
 * @returns {boolean}
 */
function areQuartersContinuous(quarters) {
  if (!Array.isArray(quarters) || quarters.length === 0) return false;
  if (quarters.length === 1) return /^\d{4}Q[1-4]$/.test(quarters[0]);
  for (let i = 0; i < quarters.length; i += 1) {
    if (typeof quarters[i] !== 'string' || !/^\d{4}Q[1-4]$/.test(quarters[i])) return false;
    if (i > 0) {
      const expected = nextQuarter(quarters[i - 1]);
      if (quarters[i] !== expected) return false;
    }
  }
  return true;
}

/**
 * Sorts quarter strings chronologically ascending.
 * Non-quarter strings are discarded.
 */
function sortQuarters(quarters) {
  if (!Array.isArray(quarters)) return [];
  return quarters
    .filter((q) => typeof q === 'string' && /^\d{4}Q[1-4]$/.test(q))
    .sort((a, b) => compareQuarters(a, b));
}

/**
 * Full validation of a versioned state-quarter HPI series.
 * Verifies FHFA provenance, sha256 integrity (when raw bytes are provided),
 * valid state keys (no national 'US' aggregate), valid quarters, positive index
 * values, and optional chronological ordering / continuity.
 *
 * @param {Object} series
 * @param {{ rawPayload?: string, requireChronologicalKeys?: boolean, requireContinuousQuarters?: boolean }} [options]
 * @returns {boolean}
 */
function validateStateQuarterSeries(series, options = {}) {
  if (!isObservedSeries(series)) return false;

  // Digest verification against raw payload when available
  const rawPayload = options.rawPayload || series.rawJson || series.rawCsv;
  if (typeof rawPayload === 'string') {
    const computedSha = sha256Hex(rawPayload);
    if (computedSha.toLowerCase() !== String(series.datasetSha256).toLowerCase()) {
      return false;
    }
  }

  const values = series.values;
  if (!values || typeof values !== 'object' || Array.isArray(values)) return false;
  const states = Object.keys(values);
  if (states.length === 0) return false;

  for (const state of states) {
    // Two uppercase letters, and never the national aggregate "US": a state
    // index series is keyed by actual states, not FHFA's US-level summary.
    if (!/^[A-Z]{2}$/.test(state) || state === 'US') return false;
    const periods = values[state];
    if (!periods || typeof periods !== 'object' || Array.isArray(periods)) return false;
    const keys = Object.keys(periods);
    if (keys.length === 0) return false;

    for (const period of keys) {
      if (!/^\d{4}Q[1-4]$/.test(period)) return false;
      const value = periods[period];
      if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return false;
    }

    if (options.requireChronologicalKeys && !areQuartersChronological(keys)) {
      return false;
    }
    if (options.requireContinuousQuarters && !areQuartersContinuous(keys)) {
      return false;
    }
  }
  return true;
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
 * Computes observed HPI appreciation metrics between baseline and current quarter for a state.
 * Enforces Zero-Fabrication rules: returns null if series is unobserved, quarters are
 * invalid/out-of-order, or indices are non-positive.
 *
 * @param {string} state - Two-letter USPS state code
 * @param {string} baseline - YYYYQn baseline period
 * @param {string} current - YYYYQn current period
 * @param {Object} series - Observed HPI series
 * @param {{ assessedValue?: number }} [options] - Optional assessed value to adjust
 * @returns {{ state: string, baselinePeriod: string, currentPeriod: string, baselineHpi: number, currentHpi: number, multiplier: number, appreciationPct: number, hpiAdjustedAssessedValue?: number } | null}
 */
function computeHpiAppreciation(state, baseline, current, series, options = {}) {
  if (!baseline || !current || compareQuarters(baseline, current) > 0) return null;
  const baselineHpi = getHpiIndex(state, baseline, series);
  const currentHpi = getHpiIndex(state, current, series);
  if (baselineHpi === null || currentHpi === null || baselineHpi <= 0 || currentHpi <= 0) return null;
  const multiplier = currentHpi / baselineHpi;
  const appreciationPct = Math.round((multiplier - 1.0) * 1000) / 10;
  const res = {
    state,
    baselinePeriod: baseline,
    currentPeriod: current,
    baselineHpi,
    currentHpi,
    multiplier,
    appreciationPct,
  };
  const assessedValue = Number(options.assessedValue);
  if (Number.isFinite(assessedValue) && assessedValue > 0) {
    res.hpiAdjustedAssessedValue = Math.round(assessedValue * multiplier);
  }
  return res;
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

module.exports = {
  isObservedSeries,
  getHpiIndex,
  getAppreciationMultiplier,
  computeHpiAppreciation,
  getLatestObservedPeriod,
  compareQuarters,
  nextQuarter,
  areQuartersChronological,
  areQuartersContinuous,
  sortQuarters,
  validateStateQuarterSeries,
};
