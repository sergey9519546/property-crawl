#!/usr/bin/env node
'use strict';

/**
 * scripts/ingest-fhfa-hpi.js
 *
 * Fetches the FHFA public state House Price Index summary CSV and writes a
 * provenance-bearing snapshot (embedded raw CSV + sha256 + retrievedAt) to
 * server/enrichment/data/fhfa-state-hpi.json.
 *
 * Also supports ingesting, normalizing, and validating an operator-supplied
 * versioned quarterly state HPI series (--series-in=path/to/series.json).
 *
 * The snapshot is the observed input for server/enrichment/fhfa-state-hpi.js.
 * The runtime re-hashes the embedded bytes on read, so the served per-state
 * percent changes are provably the publisher's own bytes.
 *
 * Usage:
 *   node scripts/ingest-fhfa-hpi.js
 *   node scripts/ingest-fhfa-hpi.js --url=https://www.fhfa.gov/hpi-state/csv --out=path.json
 *   node scripts/ingest-fhfa-hpi.js --series-in=path/to/series.json --out=.cache/fhfa-hpi-series.json
 *
 * No network fallback is invented: if the publisher is unreachable the run
 * fails and nothing is written.
 */

const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const crypto = require('node:crypto');

const {
  SOURCE_URL,
  DEFAULT_SNAPSHOT_PATH,
  MAX_CSV_BYTES,
  buildStateHpiSnapshot,
  isObservedStateHpiSnapshot,
  parseStateHpiCsv,
} = require('../server/enrichment/fhfa-state-hpi');
const {
  validateStateQuarterSeries,
  compareQuarters,
  areQuartersChronological,
} = require('../server/enrichment/hpi');
const {
  DEFAULT_SERIES_PATH,
} = require('../server/enrichment/hpi-series');

function sha256Hex(text) {
  return crypto.createHash('sha256').update(String(text), 'utf8').digest('hex');
}

function parseArgs(argv) {
  const options = {
    url: SOURCE_URL,
    out: DEFAULT_SNAPSHOT_PATH,
    seriesIn: null,
    seriesOut: null,
  };
  for (const flag of argv) {
    if (flag.startsWith('--url=')) options.url = flag.slice('--url='.length);
    else if (flag.startsWith('--out=')) options.out = flag.slice('--out='.length);
    else if (flag.startsWith('--series-in=')) options.seriesIn = flag.slice('--series-in='.length);
    else if (flag.startsWith('--series=')) options.seriesIn = flag.slice('--series='.length);
    else if (flag.startsWith('--series-out=')) options.seriesOut = flag.slice('--series-out='.length);
    else throw new Error(`Unknown option: ${flag}`);
  }
  return options;
}

function sanitizeSourceUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error(`Invalid URL: ${value}`); }
  if (url.protocol !== 'https:' || !['www.fhfa.gov', 'fhfa.gov'].includes(url.hostname)) {
    throw new Error('Source URL must be an https://www.fhfa.gov URL');
  }
  if (url.pathname !== '/hpi-state/csv') {
    throw new Error('Source URL must be the FHFA state HPI summary CSV (https://www.fhfa.gov/hpi-state/csv)');
  }
  return url.toString();
}

function fetchText(url, maxBytes) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { headers: { Accept: 'text/csv, text/plain;q=0.9, */*;q=0.1', 'User-Agent': 'property-crawl-fhfa-ingest/1.0' } }, (res) => {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.resume();
        reject(new Error(`Publisher returned HTTP ${res.statusCode} for ${url}`));
        return;
      }
      const chunks = [];
      let bytes = 0;
      res.on('data', (chunk) => {
        bytes += chunk.length;
        if (bytes > maxBytes) {
          request.destroy();
          reject(new Error(`Publisher response exceeded ${maxBytes} bytes`));
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
    request.on('error', reject);
    request.setTimeout(20000, () => { request.destroy(); reject(new Error('Publisher request timed out')); });
  });
}

/**
 * Builds a provenance-bearing snapshot for an observed state-quarter HPI series.
 */
function buildHpiSeriesSnapshot({
  sourceUrl = 'https://www.fhfa.gov/data/hpi',
  retrievedAt = new Date().toISOString(),
  values = {},
  rawJson,
  datasetSha256,
}) {
  const rawText = typeof rawJson === 'string' && rawJson.trim()
    ? rawJson
    : JSON.stringify(values, null, 2);
  const sha = datasetSha256 || sha256Hex(rawText);
  return {
    version: 1,
    sourceUrl,
    retrievedAt,
    datasetSha256: sha,
    values,
    rawJson: rawText,
  };
}

/**
 * Ingests and validates an operator-supplied quarterly state HPI series.
 * Enforces Zero-Fabrication invariants:
 *   - version 1
 *   - https fhfa.gov source URL
 *   - valid retrievedAt timestamp
 *   - verified sha256 digest
 *   - chronological quarter ordering
 *   - positive finite values per state-quarter
 *   - fail-closed when absent or invalid
 */
function ingestHpiSeries({ seriesFile, outPath = DEFAULT_SERIES_PATH, rawText = null, seriesData = null } = {}) {
  let content = rawText;
  if (!content && seriesFile) {
    if (!fs.existsSync(seriesFile)) {
      throw new Error(`Series source file not found: ${seriesFile}`);
    }
    content = fs.readFileSync(seriesFile, 'utf8');
  }
  if (!content && !seriesData) {
    throw new Error('No series data or file supplied; fail closed');
  }

  let parsed = seriesData;
  if (content && !parsed) {
    try {
      parsed = JSON.parse(content);
    } catch (err) {
      throw new Error(`Failed to parse series JSON: ${err.message}`);
    }
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Invalid series payload; fail closed');
  }

  // Ensure quarters in values are chronologically ordered
  const normalizedValues = {};
  for (const [state, periods] of Object.entries(parsed.values || {})) {
    if (!periods || typeof periods !== 'object' || Array.isArray(periods)) {
      throw new Error(`Invalid periods for state ${state}; fail closed`);
    }
    const qKeys = Object.keys(periods);
    const sorted = qKeys.slice().sort(compareQuarters);
    if (!areQuartersChronological(sorted, { strictlyAscending: true })) {
      throw new Error(`Non-chronological or invalid quarter keys for state ${state}; fail closed`);
    }
    normalizedValues[state] = {};
    for (const q of sorted) {
      normalizedValues[state][q] = periods[q];
    }
  }

  const rawJson = typeof parsed.rawJson === 'string' && parsed.rawJson.trim()
    ? parsed.rawJson
    : (content || JSON.stringify(normalizedValues, null, 2));

  const datasetSha256 = (parsed.datasetSha256 && /^[a-f0-9]{64}$/i.test(parsed.datasetSha256))
    ? parsed.datasetSha256
    : sha256Hex(rawJson);

  const snapshot = {
    version: 1,
    sourceUrl: parsed.sourceUrl || 'https://www.fhfa.gov/data/hpi',
    retrievedAt: parsed.retrievedAt || new Date().toISOString(),
    datasetSha256,
    values: normalizedValues,
    rawJson,
  };

  if (!validateStateQuarterSeries(snapshot, { rawPayload: rawJson })) {
    throw new Error('Series validation failed; fail closed');
  }

  if (outPath) {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(snapshot, null, 2), 'utf8');
    console.log(`Wrote ${outPath}`);
    console.log(`  states: ${Object.keys(snapshot.values).length}, sha256: ${snapshot.datasetSha256}`);
    console.log(`  retrievedAt: ${snapshot.retrievedAt}`);
  }

  return snapshot;
}

async function run(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.seriesIn) {
    const targetOut = options.seriesOut || (options.out !== DEFAULT_SNAPSHOT_PATH ? options.out : DEFAULT_SERIES_PATH);
    return ingestHpiSeries({ seriesFile: options.seriesIn, outPath: targetOut });
  }
  const sourceUrl = sanitizeSourceUrl(options.url);
  const csvText = await fetchText(sourceUrl, MAX_CSV_BYTES);
  const snapshot = buildStateHpiSnapshot({ sourceUrl, retrievedAt: new Date().toISOString(), csvText });
  if (!isObservedStateHpiSnapshot(snapshot)) {
    throw new Error('Fetched payload failed observed-snapshot validation; nothing written');
  }
  const parsed = parseStateHpiCsv(csvText);
  fs.mkdirSync(path.dirname(options.out), { recursive: true });
  fs.writeFileSync(options.out, JSON.stringify(snapshot, null, 2), 'utf8');
  console.log(`Wrote ${options.out}`);
  console.log(`  states: ${parsed.rowCount}, sha256: ${snapshot.datasetSha256}`);
  console.log(`  retrievedAt: ${snapshot.retrievedAt}`);
  return snapshot;
}

if (require.main === module) {
  run().catch((error) => {
    console.error('[ingest-fhfa-hpi]', error.message);
    process.exit(1);
  });
}

module.exports = {
  parseArgs,
  sanitizeSourceUrl,
  fetchText,
  buildHpiSeriesSnapshot,
  ingestHpiSeries,
  run,
};
