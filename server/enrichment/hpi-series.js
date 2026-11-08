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
 * against the isObservedSeries contract in server/enrichment/hpi.js, and
 * exposed for consumption by e.g. public-benchmark-consensus (options.hpiSeries).
 *
 * PROVENANCE CAVEAT (explicit): datasetSha256 on the loaded series is
 * provenance metadata describing the operator's SOURCE DATASET only. Because
 * the file is operator-supplied, this module CANNOT self-verify the digest
 * against the parsed values — the sha is passed through as metadata, not as a
 * cryptographic guarantee of the contents.
 *
 * Fail-closed behavior: a missing file, malformed JSON, or a series failing
 * validation yields null (callers must treat the trajectory as unobserved).
 * Successful loads are cached for 60 seconds keyed by the resolved path;
 * invalidateHpiSeriesCache() forces the next load to re-read from disk.
 */

const fs = require('node:fs');
const path = require('node:path');
const { isObservedSeries } = require('./hpi');

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

function validateSeries(series) {
  if (!isObservedSeries(series)) return false;
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
  }
  return true;
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

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(seriesPath, 'utf8'));
  } catch {
    return null; // missing file, unreadable, or malformed JSON -> fail closed
  }

  if (!validateSeries(parsed)) return null;

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
};
