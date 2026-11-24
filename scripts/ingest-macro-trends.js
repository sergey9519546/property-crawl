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
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { normalizeCountyKey, classifyMarketTemperature } = require('../server/enrichment/macro-valuation-data');
const { isUsStateOrTerritoryCode } = require('../server/state-codes');

const OUTPUT_PATH = path.resolve(__dirname, '../server/enrichment/data/county-market-benchmarks.json');
const FHFA_COUNTY_XLSX_URL = 'https://www.fhfa.gov/hpi/download/annually/hpi_at_county.xlsx';

function decodeXmlEntities(text) {
  return String(text || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function excelColToIndex(colLetters) {
  let idx = 0;
  for (let i = 0; i < colLetters.length; i++) {
    idx = idx * 26 + (colLetters.charCodeAt(i) - 64);
  }
  return idx - 1;
}

/**
 * Pure-Node ZIP entry extractor for .xlsx archives (supports STORE and DEFLATE).
 * @param {Buffer} zipBuffer
 * @returns {Map<string, Buffer>}
 */
function extractZipEntries(zipBuffer) {
  let eocdOffset = -1;
  const minOffset = Math.max(0, zipBuffer.length - 65557);
  for (let i = zipBuffer.length - 22; i >= minOffset; i--) {
    if (zipBuffer.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset < 0) throw new Error('Invalid XLSX/ZIP archive: missing EOCD');
  const cdSize = zipBuffer.readUInt32LE(eocdOffset + 12);
  const cdOffset = zipBuffer.readUInt32LE(eocdOffset + 16);
  const entries = new Map();
  let ptr = cdOffset;
  const cdEnd = cdOffset + cdSize;
  while (ptr < cdEnd) {
    if (zipBuffer.readUInt32LE(ptr) !== 0x02014b50) break;
    const method = zipBuffer.readUInt16LE(ptr + 10);
    const compSize = zipBuffer.readUInt32LE(ptr + 20);
    const nameLen = zipBuffer.readUInt16LE(ptr + 28);
    const extraLen = zipBuffer.readUInt16LE(ptr + 30);
    const commentLen = zipBuffer.readUInt16LE(ptr + 32);
    const localHeaderOffset = zipBuffer.readUInt32LE(ptr + 42);
    const name = zipBuffer.toString('utf8', ptr + 46, ptr + 46 + nameLen);
    ptr += 46 + nameLen + extraLen + commentLen;

    if (!name.endsWith('.xml')) continue;
    const lfhNameLen = zipBuffer.readUInt16LE(localHeaderOffset + 26);
    const lfhExtraLen = zipBuffer.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + lfhNameLen + lfhExtraLen;
    const compData = zipBuffer.subarray(dataStart, dataStart + compSize);
    if (method === 0) entries.set(name, compData);
    else if (method === 8) entries.set(name, zlib.inflateRawSync(compData));
    else throw new Error(`Unsupported ZIP compression method ${method} for ${name}`);
  }
  return entries;
}

/**
 * Parses rows from xl/worksheets/sheet1.xml inside an .xlsx buffer, preserving
 * sparse cell column positions (so blank cells do not shift later columns).
 * @param {Buffer} xlsxBuffer
 * @returns {string[][]}
 */
function readXlsxSheetRows(xlsxBuffer) {
  const entries = extractZipEntries(xlsxBuffer);
  const sharedStringsXml = entries.get('xl/sharedStrings.xml')?.toString('utf8') || '';
  const sharedStrings = [];
  if (sharedStringsXml) {
    const siRe = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
    const tRe = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
    let siMatch;
    while ((siMatch = siRe.exec(sharedStringsXml)) !== null) {
      let text = '';
      let tMatch;
      tRe.lastIndex = 0;
      while ((tMatch = tRe.exec(siMatch[1])) !== null) {
        text += decodeXmlEntities(tMatch[1]);
      }
      sharedStrings.push(text);
    }
  }

  const sheetXml = entries.get('xl/worksheets/sheet1.xml')?.toString('utf8');
  if (!sheetXml) throw new Error('Invalid XLSX archive: missing xl/worksheets/sheet1.xml');

  const rows = [];
  const rowRe = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
  const cellRe = /<c\b([^>]*)>([\s\S]*?)<\/c>/g;
  let rowMatch;
  while ((rowMatch = rowRe.exec(sheetXml)) !== null) {
    const rowArr = [];
    let cellMatch;
    cellRe.lastIndex = 0;
    while ((cellMatch = cellRe.exec(rowMatch[1])) !== null) {
      const attrs = cellMatch[1];
      const inner = cellMatch[2];
      const refMatch = attrs.match(/\br="([A-Z]+)\d+"/);
      if (!refMatch) continue;
      const colIdx = excelColToIndex(refMatch[1]);
      const typeMatch = attrs.match(/\bt="([^"]+)"/);
      const cellType = typeMatch ? typeMatch[1] : 'n';
      let value = '';
      if (cellType === 'inlineStr') {
        const isMatch = inner.match(/<t\b[^>]*>([\s\S]*?)<\/t>/);
        value = isMatch ? decodeXmlEntities(isMatch[1]) : '';
      } else {
        const vMatch = inner.match(/<v\b[^>]*>([\s\S]*?)<\/v>/);
        if (vMatch) {
          value = cellType === 's' ? (sharedStrings[Number(vMatch[1])] ?? '') : decodeXmlEntities(vMatch[1]);
        }
      }
      while (rowArr.length <= colIdx) rowArr.push('');
      rowArr[colIdx] = value;
    }
    if (rowArr.some((v) => v !== '')) rows.push(rowArr);
  }
  return rows;
}

/**
 * Extracts latest observed YoY change per US county from FHFA annual county HPI rows.
 * Strict Zero-Fabrication: leaves medianSalePrice and medianDom explicitly null.
 * @param {string[][]} rows
 * @returns {Object<string, Object>}
 */
function parseFhfaCountyRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return {};
  let headerIdx = -1;
  let colMap = null;
  for (let i = 0; i < Math.min(rows.length, 25); i++) {
    const normalized = (rows[i] || []).map((c) => String(c || '').trim().toLowerCase());
    const stateIdx = normalized.indexOf('state');
    const countyIdx = normalized.indexOf('county');
    const yearIdx = normalized.indexOf('year');
    const changeIdx = normalized.findIndex((c) => c.includes('annual change'));
    const fipsIdx = normalized.findIndex((c) => c.includes('fips'));
    if (stateIdx >= 0 && countyIdx >= 0 && yearIdx >= 0 && changeIdx >= 0) {
      headerIdx = i;
      colMap = { stateIdx, countyIdx, yearIdx, changeIdx, fipsIdx };
      break;
    }
  }
  if (headerIdx < 0 || !colMap) {
    throw new Error('FHFA county HPI header row not found');
  }

  const bestByKey = new Map();
  for (let r = headerIdx + 1; r < rows.length; r++) {
    const row = rows[r];
    if (!Array.isArray(row)) continue;
    const state = String(row[colMap.stateIdx] || '').trim().toUpperCase();
    const rawCounty = String(row[colMap.countyIdx] || '').trim();
    const key = isUsStateOrTerritoryCode(state) ? normalizeCountyKey(state, rawCounty) : null;
    if (!key) continue;

    const year = Number(row[colMap.yearIdx]);
    if (!Number.isInteger(year) || year < 1900 || year > 2100) continue;

    const rawChange = String(row[colMap.changeIdx] || '').trim();
    if (!rawChange || rawChange === '.') continue;
    const parsedChange = Number(rawChange);
    if (!Number.isFinite(parsedChange)) continue;

    const yoyPriceChangePct = Math.round(parsedChange * 100) / 100;
    const prev = bestByKey.get(key);
    if (prev && prev.asOfYear >= year) continue;

    const fipsRaw = colMap.fipsIdx >= 0 ? String(row[colMap.fipsIdx] || '').replace(/\D/g, '') : '';
    const fips = fipsRaw ? fipsRaw.padStart(5, '0').slice(0, 5) : null;
    const county = rawCounty.replace(/\s+(COUNTY|PARISH|BOROUGH|CENSUS\s+AREA)$/i, '').trim();
    const marketTemperature = classifyMarketTemperature(yoyPriceChangePct);
    const sign = yoyPriceChangePct >= 0 ? '+' : '';
    const trendLabel = `${marketTemperature.toUpperCase()} Market (${sign}${yoyPriceChangePct}% YoY, FHFA ${year} County HPI)`;

    bestByKey.set(key, {
      state,
      county,
      fips,
      asOfYear: year,
      medianSalePrice: null,
      yoyPriceChangePct,
      marketTemperature,
      medianDom: null,
      trendLabel,
    });
  }

  const sorted = {};
  for (const key of Array.from(bestByKey.keys()).sort()) {
    sorted[key] = bestByKey.get(key);
  }
  return sorted;
}

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
  const trendLabel = yoyPct === null
    ? `YoY Unobserved Market${domPart}`
    : `${marketTemperature.toUpperCase()} Market (${sign}${yoyPct}% YoY${domPart})`;

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

const SHA256_HEX_RE = /^[a-f0-9]{64}$/i;

/**
 * Builds the provenance block for the output envelope. Status is 'observed'
 * ONLY when both a 64-hex inputSha256 and a parseable retrievedAt are
 * supplied; anything else is honestly recorded as 'unverified_legacy' so the
 * runtime loader's fail-closed rule can reject it.
 *
 * @param {Object} [options={}]
 * @returns {Object} provenance block
 */
function buildProvenance(options = {}) {
  const inputSha256 = typeof options.inputSha256 === 'string' && SHA256_HEX_RE.test(options.inputSha256)
    ? options.inputSha256
    : null;
  const retrievedAt = typeof options.retrievedAt === 'string' && Number.isFinite(Date.parse(options.retrievedAt))
    ? options.retrievedAt
    : null;
  const observed = inputSha256 !== null && retrievedAt !== null;
  return {
    status: observed ? 'observed' : 'unverified_legacy',
    sourceLabel: typeof options.sourceLabel === 'string' && options.sourceLabel.trim() !== ''
      ? options.sourceLabel
      : null,
    inputSha256,
    retrievedAt,
  };
}

/**
 * Ingests an array of row objects and generates the county benchmarks map.
 *
 * @param {Array<Object>} rows
 * @param {Object} [options={}] - optional provenance inputs: sourceLabel, inputSha256, retrievedAt
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
    const envelope = {
      version: 1,
      generator: 'scripts/ingest-macro-trends.js',
      generatedAt: new Date().toISOString(),
      provenance: buildProvenance(options),
      benchmarks,
    };
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(
      outputPath,
      options.compact ? JSON.stringify(envelope) : JSON.stringify(envelope, null, 2),
      'utf8',
    );
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

async function ingestFromFhfaCountyXlsx(options = {}) {
  const xlsxPathArg = options.xlsxPath || null;
  const sourceUrl = options.sourceUrl || FHFA_COUNTY_XLSX_URL;
  let inputBytes;
  if (xlsxPathArg) {
    inputBytes = fs.readFileSync(path.resolve(xlsxPathArg));
  } else {
    const res = await fetch(sourceUrl, {
      headers: { 'User-Agent': 'PerfectPropertyMacroIngest/1.0' },
      signal: AbortSignal.timeout(45_000),
    });
    if (!res.ok) {
      throw new Error(`FHFA download failed: HTTP ${res.status}`);
    }
    inputBytes = Buffer.from(await res.arrayBuffer());
  }
  const inputSha256 = crypto.createHash('sha256').update(inputBytes).digest('hex');
  const retrievedAt = new Date().toISOString();
  const sheetRows = readXlsxSheetRows(inputBytes);
  const benchmarks = parseFhfaCountyRows(sheetRows);

  const outputPath = options.outputPath || OUTPUT_PATH;
  if (options.saveToFile !== false) {
    const envelope = {
      version: 1,
      generator: 'scripts/ingest-macro-trends.js',
      generatedAt: retrievedAt,
      provenance: {
        ...buildProvenance({
          inputSha256,
          retrievedAt,
          sourceLabel: 'FHFA Annual County House Price Index (hpi_at_county.xlsx)',
        }),
        sourceUrl,
      },
      benchmarks,
    };
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(envelope), 'utf8');
  }
  return { count: Object.keys(benchmarks).length, inputSha256, retrievedAt, outputPath, benchmarks };
}

async function runCli() {
  const args = process.argv.slice(2);
  const fileArg = args.find((a) => a.startsWith('--file='));
  const fromFhfa = args.includes('--from-fhfa-county');
  const xlsxArg = args.find((a) => a.startsWith('--fhfa-xlsx='));
  const urlArg = args.find((a) => a.startsWith('--fhfa-url='));
  if (fromFhfa || xlsxArg) {
    const summary = await ingestFromFhfaCountyXlsx({
      xlsxPath: xlsxArg ? xlsxArg.split('=')[1] : null,
      sourceUrl: urlArg ? urlArg.split('=')[1] : FHFA_COUNTY_XLSX_URL,
    });
    console.log(`Successfully ingested ${summary.count} FHFA county HPI benchmarks (sha256=${summary.inputSha256}) into ${summary.outputPath}`);
  } else if (fileArg) {
    const filePath = fileArg.split('=')[1];
    console.log(`Ingesting macro trends from ${filePath}...`);
    const inputBytes = fs.readFileSync(filePath);
    const inputSha256 = crypto.createHash('sha256').update(inputBytes).digest('hex');
    const rows = await parseCsvStream(filePath);
    const benchmarks = ingestMacroRecords(rows, {
      inputSha256,
      retrievedAt: new Date().toISOString(),
      sourceLabel: `operator CSV ingest: ${path.basename(filePath)}`,
      compact: true,
    });
    console.log(`Successfully ingested ${Object.keys(benchmarks).length} county benchmarks into ${OUTPUT_PATH}`);
  } else {
    console.log('Usage: node scripts/ingest-macro-trends.js --from-fhfa-county | --file=<path-to-csv>');
  }
}

if (require.main === module) {
  runCli().catch((err) => {
    console.error('ETL Ingest failed:', err);
    process.exit(1);
  });
}

module.exports = {
  FHFA_COUNTY_XLSX_URL,
  parseMacroRecord,
  ingestMacroRecords,
  parseCsvStream,
  buildProvenance,
  readXlsxSheetRows,
  parseFhfaCountyRows,
  ingestFromFhfaCountyXlsx,
  OUTPUT_PATH,
};
