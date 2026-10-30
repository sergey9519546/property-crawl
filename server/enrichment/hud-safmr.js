'use strict';

const path = require('node:path');
const fs = require('node:fs');

let benchmarksCache = null;

function loadBenchmarks() {
  if (benchmarksCache) return benchmarksCache;
  try {
    const jsonPath = path.resolve(__dirname, 'data/hud-safmr-benchmarks.json');
    if (fs.existsSync(jsonPath)) {
      benchmarksCache = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    } else {
      benchmarksCache = {};
    }
  } catch {
    benchmarksCache = {};
  }
  return benchmarksCache;
}

/**
 * Returns the statutory HUD Section 8 Small Area Fair Market Rent (SAFMR) baseline for a ZIP.
 *
 * Invariant: Never fabricate or estimate a market rent. Return only published HUD statutory figures.
 *
 * @param {Object} params
 * @param {string|number} params.zip - 5-digit ZIP code
 * @param {number} [params.bedrooms=2] - Bedroom count (0=Efficiency, 1=1BR, 2=2BR, 3=3BR, 4=4BR)
 * @returns {Object|null}
 */
function getHudSafmrBenchmark({ zip, bedrooms = 2 } = {}) {
  if (!zip) return null;
  const cleanZip = String(zip).trim().padStart(5, '0').slice(0, 5);
  if (!/^\d{5}$/.test(cleanZip)) return null;

  const data = loadBenchmarks();
  const entry = data[cleanZip];
  if (!entry || !Array.isArray(entry.rents)) {
    return null;
  }

  const parsedBed = Number(bedrooms);
  const bedIdx = Number.isFinite(parsedBed) ? Math.max(0, Math.min(4, Math.floor(parsedBed))) : 2;
  const fmr = entry.rents[bedIdx];
  if (fmr === null || fmr === undefined || !Number.isFinite(fmr)) {
    return null;
  }

  const paymentStandard90Pct = Math.round(fmr * 0.90);
  const paymentStandard110Pct = Math.round(fmr * 1.10);

  return {
    zip: cleanZip,
    bedrooms: bedIdx,
    fairMarketRent: fmr,
    paymentStandard90Pct,
    paymentStandard110Pct,
    hudAreaName: entry.area || 'HUD Metropolitan FMR Area',
    bedroomRents: Object.freeze([...entry.rents]),
    source: 'HUD FY2025 Small Area Fair Market Rents (SAFMR)',
    asOfFiscalYear: 'FY2025'
  };
}

module.exports = {
  getHudSafmrBenchmark,
  loadBenchmarks
};
