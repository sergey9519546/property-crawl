'use strict';

/**
 * server/enrichment/hpi-series.js
 *
 * Loader for an operator-supplied observed quarterly state HPI index series.
 *
 * FHFA's public endpoints publish only percent-change summaries; per-quarter
 * state index levels are NOT publicly served. This module therefore never
 * ingests or fabricates a series: an operator must configure one (see
 * SERIES_PATH_ENV / DEFAULT_SERIES_PATH) and it is loaded from disk, validated
 * against the isObservedSeries and validateStateQuarterSeries contract in
 * server/enrichment/hpi.js, and exposed for consumption by e.g.
 * public-benchmark-consensus (options.hpiSeries).
 *
 * Fail-closed behavior: a missing file, malformed JSON, unchronological quarters,
 * tampered payload sha256, or a series failing validation yields null (callers must
 * treat the trajectory as unobserved).
 * Successful loads are cached for 60 seconds keyed by the resolved path;
 * invalidateHpiSeriesCache() forces the next load to re-read from disk.
 */

const fs = require('node:fs');
const path = require('node:path');
const { isObservedSeries, validateStateQuarterSeries } = require('./hpi');

const SERIES_PATH_ENV = 'FHFA_HPI_SERIES_PATH';
const DEFAULT_SERIES_PATH = path.resolve(__dirname, '../../.cache/fhfa-hpi-series.json');

const CACHE_TTL_MS = 60 * 1000;
const cache = new Map(); // resolvedPath -> { series, loadedAtMs }

function resolveSeriesPath() {
  const fromEnv = process.env[SERIES_PATH_ENV];
  return fromEnv && String(fromEnv).trim() !== ''
    ? path.resolve(String(fromEnv).trim())
    : DEFAULT_SERIES_PATH;
}

function validateSeries(series, options = {}) {
  return validateStateQuarterSeries(series, options);
}

/**
 * Loads the operator-supplied observed HPI series from disk.
 * Returns the validated series, or null when the file is missing, malformed,
 * or the series fails validation. Result is cached for 60s per resolved path.
 */
function loadObservedHpiSeries() {
  const seriesPath = resolveSeriesPath();

  const cached = cache.get(seriesPath);
  if (cached && Date.now() - cached.loadedAtMs < CACHE_TTL_MS) {
    return cached.series;
  }

  let rawText;
  let parsed;
  try {
    rawText = fs.readFileSync(seriesPath, 'utf8');
    parsed = JSON.parse(rawText);
  } catch {
    return null; // missing file, unreadable, or malformed JSON -> fail closed
  }

  if (!validateStateQuarterSeries(parsed, { requireChronologicalKeys: true })) return null;

  cache.set(seriesPath, { series: parsed, loadedAtMs: Date.now() });
  return parsed;
}

/** Drops all cached loads; the next load re-reads from disk. */
function invalidateHpiSeriesCache() {
  cache.clear();
}

module.exports = {
  SERIES_PATH_ENV,
  DEFAULT_SERIES_PATH,
  loadObservedHpiSeries,
  invalidateHpiSeriesCache,
  validateSeries,
};
