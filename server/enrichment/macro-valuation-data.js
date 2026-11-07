'use strict';

/**
 * Macro Valuation Trends & Benchmarks
 *
 * Data sources (observed only):
 *  - County benchmarks: server/enrichment/data/county-market-benchmarks.json,
 *    produced by scripts/ingest-macro-trends.js from an operator-supplied
 *    publisher CSV (Redfin / Zillow). Never hardcoded in this module.
 *  - Statewide trend: the observed FHFA state HPI summary snapshot served by
 *    server/enrichment/fhfa-state-hpi.js (publisher percent changes with a
 *    verified sha256).
 *
 * Honesty invariants:
 *  - Macro trends are area context, never a per-property dollar value.
 *  - An unobserved trend is reported as null / 'unobserved', never as a
 *    fabricated default. The previous hand-written county table and the
 *    uniform fabricated statewide YoY are removed.
 */

const fs = require('node:fs');
const path = require('node:path');
const { isUsStateOrTerritoryCode } = require('../state-codes');
const { getStateHpiContext, getStateHpiYoy } = require('./fhfa-state-hpi');

let dynamicBenchmarksCache = null;
let lastDynamicCheck = 0;

function invalidateDynamicBenchmarksCache() {
  dynamicBenchmarksCache = null;
  lastDynamicCheck = 0;
}

function loadDynamicBenchmarks() {
  const now = Date.now();
  if (dynamicBenchmarksCache !== null && now - lastDynamicCheck < 60000) {
    return dynamicBenchmarksCache;
  }
  lastDynamicCheck = now;
  const jsonPath = process.env.COUNTY_BENCHMARKS_PATH
    ? path.resolve(process.env.COUNTY_BENCHMARKS_PATH)
    : path.resolve(__dirname, 'data/county-market-benchmarks.json');
  try {
    if (fs.existsSync(jsonPath)) {
      const parsed = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
      // Fail closed: serve benchmarks ONLY from a version-1 envelope whose
      // provenance is 'observed' with a valid sha256 and parseable
      // retrievedAt. Legacy flat maps, 'unverified_legacy' envelopes, and any
      // malformed or incomplete provenance yield an empty map so
      // getCountyMarketTrends falls back to the observed FHFA state trend.
      const provenance = parsed && typeof parsed === 'object' ? parsed.provenance : null;
      const provenanceOk = parsed !== null
        && typeof parsed === 'object'
        && parsed.version === 1
        && provenance !== null
        && typeof provenance === 'object'
        && provenance.status === 'observed'
        && typeof provenance.inputSha256 === 'string'
        && /^[a-f0-9]{64}$/i.test(provenance.inputSha256)
        && Number.isFinite(Date.parse(provenance.retrievedAt));
      if (provenanceOk && parsed.benchmarks && typeof parsed.benchmarks === 'object') {
        dynamicBenchmarksCache = parsed.benchmarks;
        return dynamicBenchmarksCache;
      }
    }
  } catch {}
  dynamicBenchmarksCache = {};
  return dynamicBenchmarksCache;
}

const DISCLAIMER = 'Macroeconomic market trends derived from published public benchmarks. Not an appraised value or individual property condition assessment.';

/**
 * Normalizes state and county strings into a registry key (e.g. "OH-CUYAHOGA").
 */
function normalizeCountyKey(state, county) {
  if (!state || !county) return null;
  const st = String(state).trim().toUpperCase();
  const co = String(county).trim().toUpperCase().replace(/\s+(COUNTY|PARISH)$/i, '');
  return `${st}-${co}`;
}

/**
 * Observed statewide 12-month HPI percent change for a state, or null when
 * the observed FHFA snapshot is absent or does not cover the state.
 */
function deriveStateHpiYoy(state) {
  if (!state) return null;
  const st = String(state).trim().toUpperCase();
  if (!isUsStateOrTerritoryCode(st)) return null;
  return getStateHpiYoy(st);
}

/**
 * Classifies market temperature into 'hot' | 'balanced' | 'cold' based on the
 * observed YoY price change. Returns null (unknown) when no observed YoY
 * exists — an unknown trend is never reported as 'balanced'.
 *
 * @param {number|null} yoyPct
 * @returns {'hot' | 'balanced' | 'cold' | null}
 */
function classifyMarketTemperature(yoyPct) {
  if (yoyPct === null || typeof yoyPct !== 'number' || Number.isNaN(yoyPct)) {
    return null;
  }
  if (yoyPct >= 4.8) return 'hot';
  if (yoyPct <= 1.0) return 'cold';
  return 'balanced';
}

/**
 * Retrieves macroeconomic market trends for a county.
 *
 * County-level metrics come only from the operator-run ETL file; everything
 * else falls back to the observed statewide FHFA HPI summary. When neither is
 * observed the trend fields are null and `observed` is false.
 *
 * @param {string} state - Two-letter state code (e.g. 'OH')
 * @param {string} county - County or parish name (e.g. 'Cuyahoga')
 * @returns {Object}
 */
function getCountyMarketTrends(state, county) {
  const normState = state ? String(state).trim().toUpperCase() : 'UNKNOWN';
  const normCounty = county ? String(county).trim().replace(/\s+(COUNTY|PARISH)$/i, '') : 'Unknown';

  const key = normalizeCountyKey(state, county);
  const dynamicBenchmarks = loadDynamicBenchmarks();
  const benchmark = key ? dynamicBenchmarks[key] : null;

  if (benchmark) {
    return {
      state: normState,
      county: benchmark.county,
      medianSalePrice: benchmark.medianSalePrice ?? null,
      yoyPriceChangePct: benchmark.yoyPriceChangePct ?? null,
      marketTemperature: benchmark.marketTemperature ?? null,
      trendLabel: benchmark.trendLabel ?? null,
      source: 'PUBLIC_COUNTY_BENCHMARKS',
      observed: true,
      retrievedAt: null,
      disclaimer: DISCLAIMER,
    };
  }

  const context = getStateHpiContext(normState);
  const stateYoy = context && Number.isFinite(context.yoyPct) ? context.yoyPct : null;
  const observed = stateYoy !== null;
  const marketTemp = classifyMarketTemperature(stateYoy);
  let trendLabel = 'Statewide FHFA trend unobserved';

  if (observed) {
    const sign = stateYoy >= 0 ? '+' : '';
    trendLabel = `Statewide FHFA HPI Trend (${sign}${stateYoy}% YoY)`;
  }

  return {
    state: normState,
    county: normCounty,
    medianSalePrice: null,
    yoyPriceChangePct: stateYoy,
    marketTemperature: marketTemp,
    trendLabel,
    source: observed ? 'FHFA_STATE_HPI_SUMMARY' : null,
    observed,
    retrievedAt: observed ? context.retrievedAt : null,
    disclaimer: DISCLAIMER,
  };
}

/**
 * Safely enriches a listing with macroTrends without overwriting or fabricating estLow or estHigh.
 * Preserves strict honesty invariants.
 *
 * @param {Object} listing
 * @returns {Object} enriched listing
 */
function enrichListingWithMacroTrends(listing) {
  if (!listing || typeof listing !== 'object') {
    return listing;
  }

  const trends = getCountyMarketTrends(listing.state, listing.county);

  const enriched = {
    ...listing,
    macroTrends: trends
  };

  // Strictly preserve original estLow and estHigh; never fabricate or overwrite them
  if (listing.estLow !== undefined) {
    enriched.estLow = listing.estLow;
  } else {
    delete enriched.estLow;
  }

  if (listing.estHigh !== undefined) {
    enriched.estHigh = listing.estHigh;
  } else {
    delete enriched.estHigh;
  }

  return enriched;
}

module.exports = {
  DISCLAIMER,
  normalizeCountyKey,
  deriveStateHpiYoy,
  classifyMarketTemperature,
  getCountyMarketTrends,
  enrichListingWithMacroTrends,
  loadDynamicBenchmarks,
  invalidateDynamicBenchmarksCache
};
