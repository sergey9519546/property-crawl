'use strict';

const path = require('node:path');
const fs = require('node:fs');

let benchmarksCache = null;

function hydrateBenchmarks(raw) {
  if (!raw || typeof raw !== 'object') return {};
  if (raw.zips && typeof raw.zips === 'object' && Array.isArray(raw.areas)) {
    const map = {};
    for (const [zip, tuple] of Object.entries(raw.zips)) {
      if (!Array.isArray(tuple) || tuple.length < 6) continue;
      const areaIdx = Number(tuple[0]);
      map[zip] = {
        area: Number.isInteger(areaIdx) && raw.areas[areaIdx] ? raw.areas[areaIdx] : 'HUD Metropolitan FMR Area',
        rents: tuple.slice(1, 6),
      };
    }
    if (raw.meta && typeof raw.meta === 'object') {
      Object.defineProperty(map, '__meta', { value: raw.meta, enumerable: false });
    }
    return map;
  }
  return raw;
}

function loadBenchmarks() {
  if (benchmarksCache) return benchmarksCache;
  try {
    const jsonPath = path.resolve(__dirname, 'data/hud-safmr-benchmarks.json');
    if (fs.existsSync(jsonPath)) {
      benchmarksCache = hydrateBenchmarks(JSON.parse(fs.readFileSync(jsonPath, 'utf8')));
    } else {
      benchmarksCache = {};
    }
  } catch {
    benchmarksCache = {};
  }
  return benchmarksCache;
}

function resolveZipRecord(data, cleanZip) {
  if (!data || typeof data !== 'object') return { entry: null, meta: null };
  // Compact deduplicated format passed directly (e.g. injected benchmarksData in tests)
  if (data.zips && typeof data.zips === 'object' && Array.isArray(data.areas)) {
    const tuple = Object.prototype.hasOwnProperty.call(data.zips, cleanZip) ? data.zips[cleanZip] : null;
    if (!Array.isArray(tuple) || tuple.length < 6) {
      return { entry: null, meta: data.meta || null };
    }
    const areaIdx = Number(tuple[0]);
    const areaName = Number.isInteger(areaIdx) && data.areas[areaIdx]
      ? data.areas[areaIdx]
      : 'HUD Metropolitan FMR Area';
    return {
      entry: {
        area: areaName,
        rents: tuple.slice(1, 6),
      },
      meta: data.meta || null,
    };
  }

  // Hydrated or legacy map format: { [zip]: { area, rents } }
  const entry = Object.prototype.hasOwnProperty.call(data, cleanZip) ? data[cleanZip] : null;
  return { entry, meta: data.__meta || null };
}

/**
 * Returns the statutory HUD Section 8 Small Area Fair Market Rent (SAFMR) baseline for a ZIP.
 *
 * Invariant: Never fabricate or estimate a market rent. Return only published HUD statutory figures.
 *
 * @param {Object} params
 * @param {string|number} params.zip - 5-digit ZIP code
 * @param {number} [params.bedrooms=2] - Bedroom count (0=Efficiency, 1=1BR, 2=2BR, 3=3BR, 4=4BR)
 * @param {Object} [params.benchmarksData] - Optional injected SAFMR dataset for isolated tests
 * @returns {Object|null}
 */
function getHudSafmrBenchmark({ zip, bedrooms = 2, benchmarksData = null } = {}) {
  if (!zip) return null;
  const rawZip = String(zip).trim().split(/[\s-]+/)[0] || '';
  const cleanZip = /^\d{1,5}$/.test(rawZip) ? rawZip.padStart(5, '0') : '';
  if (!/^\d{5}$/.test(cleanZip)) return null;

  const data = benchmarksData || loadBenchmarks();
  const { entry, meta } = resolveZipRecord(data, cleanZip);
  if (!entry || !Array.isArray(entry.rents)) {
    return null;
  }

  const parsedBed = Number(bedrooms);
  const bedIdx = Number.isFinite(parsedBed) ? Math.max(0, Math.min(4, Math.floor(parsedBed))) : 2;
  const fmr = Number(entry.rents[bedIdx]);
  if (entry.rents[bedIdx] === null || entry.rents[bedIdx] === undefined || !Number.isFinite(fmr)) {
    return null;
  }

  const paymentStandard90Pct = Math.round(fmr * 0.90);
  const paymentStandard110Pct = Math.round(fmr * 1.10);
  const rawSource = String(meta?.source || '');
  const source = /HUD FY2025/i.test(rawSource)
    ? rawSource
    : 'HUD FY2025 Small Area Fair Market Rents (SAFMR)';

  return {
    zip: cleanZip,
    bedrooms: bedIdx,
    fairMarketRent: fmr,
    paymentStandard90Pct,
    paymentStandard110Pct,
    hudAreaName: entry.area || 'HUD Metropolitan FMR Area',
    bedroomRents: Object.freeze(entry.rents.map(Number)),
    source,
    asOfFiscalYear: meta?.asOfFiscalYear || 'FY2025',
    historical: true,
    sourceUrl: meta?.sourceUrl || 'https://www.huduser.gov/portal/datasets/fmr.html',
    disclaimer: 'Historical program benchmark; not guaranteed rental income.',
  };
}

function computeSafmrCeilingFromRent(rentMonthly) {
  const safmrRent = Number(rentMonthly);
  if (!Number.isFinite(safmrRent) || safmrRent <= 0) return null;
  const expenseRatio = 0.35;
  const targetDscr = 1.20;
  const monthlyRate = (7.25 / 100) / 12;
  const totalMonths = 360;
  const noiMonthly = safmrRent * (1 - expenseRatio);
  const maxMonthlyDebt = noiMonthly / targetDscr;
  const factor = Math.pow(1 + monthlyRate, totalMonths);
  if (!Number.isFinite(factor) || factor <= 1) return null;
  const maxLoan = maxMonthlyDebt * ((factor - 1) / (monthlyRate * factor));
  if (!Number.isFinite(maxLoan) || maxLoan < 0) return null;
  return Math.max(0, Math.floor(maxLoan / 0.75));
}

function resolveListingSafmrRentFloor(listing = {}) {
  const directRent = Number(listing?.hudSafmr?.fairMarketRent);
  if (Number.isFinite(directRent) && directRent > 0) {
    return {
      rent: directRent,
      rentFloor: computeSafmrCeilingFromRent(directRent),
      zip: listing.hudSafmr.zip || listing.zip || null,
      bedrooms: listing.hudSafmr.bedrooms ?? (Number.isFinite(Number(listing.beds)) ? Number(listing.beds) : 2),
      source: listing.hudSafmr.source || 'HUD FY2025 Small Area Fair Market Rents (SAFMR)',
    };
  }
  const zip = listing?.zip || listing?.provenance?.derivedFields?.hudSafmr?.zip || null;
  if (!zip) return null;
  const beds = Number.isFinite(Number(listing?.beds)) && Number(listing.beds) >= 0 ? Number(listing.beds) : 2;
  const bench = getHudSafmrBenchmark({ zip, bedrooms: beds });
  if (!bench || !Number.isFinite(Number(bench.fairMarketRent)) || bench.fairMarketRent <= 0) return null;
  return {
    rent: Number(bench.fairMarketRent),
    rentFloor: computeSafmrCeilingFromRent(bench.fairMarketRent),
    zip: bench.zip,
    bedrooms: bench.bedrooms,
    source: bench.source,
  };
}

module.exports = {
  getHudSafmrBenchmark,
  computeSafmrCeilingFromRent,
  resolveListingSafmrRentFloor,
  loadBenchmarks,
  resolveZipRecord,
  hydrateBenchmarks,
};
