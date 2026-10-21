'use strict';

/**
 * scripts/ingest-macro-trends.js
 *
 * ETL ingestion pipeline for public housing macroeconomic trend feeds:
 * - Redfin Monthly County Market Tracker
 * - Zillow Single-Family Home Value Index (ZHVI)
 *
 * Generates/updates server/enrichment/data/county-market-benchmarks.json
 * for zero-cost runtime macro enrichment across all US counties.
 */

const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { normalizeCountyKey, classifyMarketTemperature } = require('../server/enrichment/macro-valuation-data');
const { isUsStateOrTerritoryCode } = require('../server/state-codes');

const OUTPUT_PATH = path.resolve(__dirname, '../server/enrichment/data/county-market-benchmarks.json');

/**
 * Parses a single Redfin or Zillow row into a standardized benchmark record.
 *
 * @param {Object} row - Key-value pair representation of the CSV row
 * @returns {Object|null}
 */
function parseMacroRecord(row) {
  if (!row || typeof row !== 'object') return null;

  let state = null;
  let county = null;
  let medianSalePrice = null;
  let yoyPct = null;
  let medianDom = null;

  // 1. Redfin format: region_name e.g. "Cuyahoga County, OH" or region = "Cuyahoga, OH"
  const region = String(row.region_name || row.region || row.RegionName || '').trim();
  const stateCol = String(row.state_code || row.state || row.State || '').trim().toUpperCase();

  if (region.includes(',')) {
    const parts = region.split(',');
    county = parts[0].trim().replace(/\s+(COUNTY|PARISH|BOROUGH|CENSUS\s+AREA)$/i, '');
    state = parts[1].trim().toUpperCase().slice(0, 2);
  } else if (stateCol && isUsStateOrTerritoryCode(stateCol)) {
    state = stateCol;
    county = region.replace(/\s+(COUNTY|PARISH|BOROUGH|CENSUS\s+AREA)$/i, '');
  }

  if (!state || !county || !isUsStateOrTerritoryCode(state)) {
    return null;
  }

  // Extract Price
  const rawPrice = row.median_sale_price || row.medianSalePrice || row.zhvi || row.price;
  if (rawPrice !== undefined && rawPrice !== null && rawPrice !== '') {
    const parsed = Number(String(rawPrice).replace(/[$,]/g, ''));
    if (Number.isFinite(parsed) && parsed > 0) {
      medianSalePrice = Math.round(parsed);
    }
  }

  // Extract YoY Change %
  const rawYoy = row.median_sale_price_yoy || row.yoy_price_change || row.yoy || row.yoyPriceChangePct;
  if (rawYoy !== undefined && rawYoy !== null && rawYoy !== '') {
    let parsedYoy = Number(String(rawYoy).replace(/[%]/g, ''));
    // If fractional decimal (e.g. 0.054 instead of 5.4%), convert to percentage
    if (Number.isFinite(parsedYoy)) {
      if (Math.abs(parsedYoy) > 0 && Math.abs(parsedYoy) < 0.5) {
        parsedYoy = parsedYoy * 100;
      }
      yoyPct = Math.round(parsedYoy * 10) / 10;
    }
  }

  // Extract Median Days on Market
  const rawDom = row.median_dom || row.medianDom || row.dom;
  if (rawDom !== undefined && rawDom !== null && rawDom !== '') {
    const parsedDom = Number(rawDom);
    if (Number.isFinite(parsedDom) && parsedDom >= 0) {
      medianDom = Math.round(parsedDom);
    }
  }

  const key = normalizeCountyKey(state, county);
  if (!key) return null;

  const marketTemperature = classifyMarketTemperature(yoyPct);
  const sign = (yoyPct || 0) >= 0 ? '+' : '';
  const domPart = medianDom !== null ? `, ${medianDom} median DOM` : '';
  const trendLabel = `${marketTemperature.toUpperCase()} Market (${sign}${yoyPct ?? 0}% YoY${domPart})`;

  return {
    key,
    state,
    county,
    medianSalePrice,
    yoyPriceChangePct: yoyPct,
    marketTemperature,
    medianDom,
    trendLabel,
  };
}

/**
 * Ingests an array of row objects and generates the county benchmarks map.
 *
 * @param {Array<Object>} rows
 * @param {Object} [options={}]
 * @returns {Object} map of normalized county keys to benchmark data
 */
function ingestMacroRecords(rows, options = {}) {
  const benchmarks = {};
  if (!Array.isArray(rows)) return benchmarks;

  for (const row of rows) {
    const record = parseMacroRecord(row);
    if (!record) continue;

    benchmarks[record.key] = {
      state: record.state,
      county: record.county,
      medianSalePrice: record.medianSalePrice,
      yoyPriceChangePct: record.yoyPriceChangePct,
      marketTemperature: record.marketTemperature,
      medianDom: record.medianDom,
      trendLabel: record.trendLabel,
    };
  }

  if (options.saveToFile !== false) {
    const outputPath = options.outputPath || OUTPUT_PATH;
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(benchmarks, null, 2), 'utf8');
  }

  return benchmarks;
}

/**
 * Streams a CSV file line by line with memory bounds.
 */
async function parseCsvStream(filePath) {
  const fileStream = fs.createReadStream(filePath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  let headers = null;
  const rows = [];

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const cells = trimmed.split(',').map((c) => c.replace(/^["']|["']$/g, '').trim());
    if (!headers) {
      headers = cells;
      continue;
    }

    const row = {};
    for (let i = 0; i < headers.length; i++) {
      row[headers[i]] = cells[i] !== undefined ? cells[i] : '';
    }
    rows.push(row);
  }

  return rows;
}

async function runCli() {
  const args = process.argv.slice(2);
  const fileArg = args.find((a) => a.startsWith('--file='));
  if (fileArg) {
    const filePath = fileArg.split('=')[1];
    console.log(`Ingesting macro trends from ${filePath}...`);
    const rows = await parseCsvStream(filePath);
    const benchmarks = ingestMacroRecords(rows);
    console.log(`Successfully ingested ${Object.keys(benchmarks).length} county benchmarks into ${OUTPUT_PATH}`);
  } else {
    console.log('Usage: node scripts/ingest-macro-trends.js --file=<path-to-csv>');
  }
}

if (require.main === module) {
  runCli().catch((err) => {
    console.error('ETL Ingest failed:', err);
    process.exit(1);
  });
}

module.exports = {
  parseMacroRecord,
  ingestMacroRecords,
  parseCsvStream,
  OUTPUT_PATH,
};
