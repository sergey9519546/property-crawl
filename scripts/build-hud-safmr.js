#!/usr/bin/env node
'use strict';

/**
 * scripts/build-hud-safmr.js
 *
 * Converts official HUD Small Area Fair Market Rents (SAFMR) records—either from
 * a local JSON/CSV snapshot or directly from HUD's public ArcGIS FeatureServer
 * (`HUD_PDR_Small_Area_Fair_Market_Rents/FeatureServer/1`)—into a deduplicated
 * compact payload:
 *   { meta: { source, fiscalYear, sourceUrl, inputSha256, zipCount, generatedAt },
 *     areas: string[],
 *     zips: { [zip5]: [areaIdx, r0br, r1br, r2br, r3br, r4br] } }
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ARCGIS_SAFMR_TABLE_URL =
  'https://services.arcgis.com/VTyQ9soqVukalItT/ArcGIS/rest/services/HUD_PDR_Small_Area_Fair_Market_Rents/FeatureServer/1';
const HUD_SAFMR_PAGE_URL = 'https://www.huduser.gov/portal/datasets/fmr/smallarea/index.html';
const DEFAULT_OUTPUT = path.resolve(__dirname, '../server/enrichment/data/hud-safmr-benchmarks.json');

function normalizeZip5(raw) {
  if (raw === null || raw === undefined) return '';
  const digits = String(raw).trim().split(/[\s-]+/)[0] || '';
  if (!/^\d{1,5}$/.test(digits)) return '';
  return digits.padStart(5, '0');
}

function finiteRent(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
}

function compactSafmrEntries(records, metaOptions = {}) {
  const areaList = [];
  const areaIndexMap = new Map();
  const zips = Object.create(null);

  const entriesSorted = [...records].sort((a, b) => a.zip.localeCompare(b.zip));
  for (const entry of entriesSorted) {
    const zip = normalizeZip5(entry.zip);
    if (!/^\d{5}$/.test(zip)) continue;
    const rents = Array.isArray(entry.rents) ? entry.rents.slice(0, 5).map(finiteRent) : [];
    if (rents.length < 5 || rents.some((v) => v === null)) continue;
    if (Object.prototype.hasOwnProperty.call(zips, zip)) continue;

    const areaName = String(entry.area || 'HUD Metropolitan FMR Area').trim() || 'HUD Metropolitan FMR Area';
    let areaIdx = areaIndexMap.get(areaName);
    if (areaIdx === undefined) {
      areaIdx = areaList.length;
      areaList.push(areaName);
      areaIndexMap.set(areaName, areaIdx);
    }
    zips[zip] = [areaIdx, rents[0], rents[1], rents[2], rents[3], rents[4]];
  }

  return {
    meta: {
      format: 'compact-safmr-v1',
      source: metaOptions.source || 'HUD Small Area Fair Market Rents (SAFMR)',
      asOfFiscalYear: metaOptions.asOfFiscalYear || 'FY2025',
      sourceUrl: metaOptions.sourceUrl || HUD_SAFMR_PAGE_URL,
      inputSha256: metaOptions.inputSha256 || null,
      zipCount: Object.keys(zips).length,
      areaCount: areaList.length,
      generatedAt: metaOptions.generatedAt || new Date().toISOString(),
    },
    areas: areaList,
    zips,
  };
}

function parseInputRecords(rawText) {
  const trimmed = String(rawText || '').trim();
  if (!trimmed) return [];

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === 'object' && parsed.zips && Array.isArray(parsed.areas)) {
      return Object.entries(parsed.zips).map(([zip, tuple]) => ({
        zip,
        area: parsed.areas[tuple[0]] || 'HUD Metropolitan FMR Area',
        rents: tuple.slice(1, 6),
      }));
    }
    if (Array.isArray(parsed)) {
      return parsed
        .map((row) => ({
          zip: row.zip || row.ZIP || row.ID || row.zcta,
          area: row.area || row.FMR_NAME || row.hudAreaName,
          rents: Array.isArray(row.rents)
            ? row.rents
            : [row.SAFMR_0BR, row.SAFMR_1BR, row.SAFMR_2BR, row.SAFMR_3BR, row.SAFMR_4BR],
        }))
        .filter((r) => r.zip);
    }
    return Object.entries(parsed).map(([zip, entry]) => ({
      zip,
      area: entry?.area,
      rents: entry?.rents,
    }));
  }

  // CSV parser for official comma-separated SAFMR tables
  const lines = trimmed.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map((h) => h.trim().replace(/^"|"$/g, ''));
  const idx = (names) => names.map((n) => headers.indexOf(n)).find((i) => i >= 0) ?? -1;
  const zipCol = idx(['zip', 'ZIP', 'zcta', 'ZCTA', 'ID']);
  const areaCol = idx(['area', 'FMR_NAME', 'hud_area_name', 'Areaname25', 'Areaname26']);
  const rentCols = [
    idx(['r0', 'SAFMR_0BR', 'safmr_0br']),
    idx(['r1', 'SAFMR_1BR', 'safmr_1br']),
    idx(['r2', 'SAFMR_2BR', 'safmr_2br']),
    idx(['r3', 'SAFMR_3BR', 'safmr_3br']),
    idx(['r4', 'SAFMR_4BR', 'safmr_4br']),
  ];
  if (zipCol < 0 || rentCols.some((c) => c < 0)) return [];

  const records = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cols = lines[i].split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
    records.push({
      zip: cols[zipCol],
      area: areaCol >= 0 ? cols[areaCol] : 'HUD Metropolitan FMR Area',
      rents: rentCols.map((c) => finiteRent(cols[c])),
    });
  }
  return records;
}

async function fetchArcgisSafmrRecords(fetchImpl = globalThis.fetch) {
  const pageSize = 1000;
  let offset = 0;
  const allRows = [];
  const hasher = crypto.createHash('sha256');

  while (true) {
    const qs = new URLSearchParams({
      where: '1=1',
      outFields: 'ID,FMR_NAME,SAFMR_0BR,SAFMR_1BR,SAFMR_2BR,SAFMR_3BR,SAFMR_4BR',
      orderByFields: 'OBJECTID ASC',
      resultOffset: String(offset),
      resultRecordCount: String(pageSize),
      f: 'json',
    });
    const resp = await fetchImpl(`${ARCGIS_SAFMR_TABLE_URL}/query?${qs}`, {
      headers: { 'User-Agent': 'property-crawl-safmr-builder/1.0' },
      signal: AbortSignal.timeout(20_000),
    });
    if (!resp.ok) {
      throw new Error(`ArcGIS SAFMR query failed with HTTP ${resp.status} at offset ${offset}`);
    }
    const raw = await resp.text();
    hasher.update(raw);
    const data = JSON.parse(raw);
    const features = Array.isArray(data?.features) ? data.features : [];
    for (const f of features) {
      const a = f?.attributes || {};
      allRows.push({
        zip: a.ID,
        area: a.FMR_NAME,
        rents: [a.SAFMR_0BR, a.SAFMR_1BR, a.SAFMR_2BR, a.SAFMR_3BR, a.SAFMR_4BR],
      });
    }
    if (features.length < pageSize && !data?.exceededTransferLimit) break;
    offset += features.length;
    if (features.length === 0) break;
  }

  return { records: allRows, inputSha256: hasher.digest('hex') };
}

async function main() {
  const args = process.argv.slice(2);
  const fromArcgis = args.includes('--from-arcgis');
  const getArg = (flag) => {
    const i = args.indexOf(flag);
    return i >= 0 && i + 1 < args.length ? args[i + 1] : null;
  };
  const outputPath = path.resolve(getArg('--output') || DEFAULT_OUTPUT);

  let records;
  let inputSha256;
  let source = 'HUD Public SAFMR Dataset';
  let sourceUrl = HUD_SAFMR_PAGE_URL;

  if (fromArcgis) {
    const fetched = await fetchArcgisSafmrRecords();
    records = fetched.records;
    inputSha256 = fetched.inputSha256;
    source = 'HUD FY2025 Small Area Fair Market Rents (SAFMR, ArcGIS Open Data)';
    sourceUrl = ARCGIS_SAFMR_TABLE_URL;
  } else {
    const inputPath = path.resolve(getArg('--input') || DEFAULT_OUTPUT);
    const raw = fs.readFileSync(inputPath, 'utf8');
    inputSha256 = crypto.createHash('sha256').update(raw).digest('hex');
    records = parseInputRecords(raw);
  }

  const compact = compactSafmrEntries(records, {
    source,
    sourceUrl,
    inputSha256,
    asOfFiscalYear: 'FY2025',
  });
  const jsonText = JSON.stringify(compact);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, jsonText, 'utf8');
  console.log(
    `[build-hud-safmr] wrote ${compact.meta.zipCount} ZIPs across ${compact.meta.areaCount} areas (${jsonText.length} bytes) -> ${outputPath}`,
  );
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[build-hud-safmr] ERROR:', err);
    process.exit(1);
  });
}

module.exports = {
  ARCGIS_SAFMR_TABLE_URL,
  compactSafmrEntries,
  parseInputRecords,
  fetchArcgisSafmrRecords,
};
