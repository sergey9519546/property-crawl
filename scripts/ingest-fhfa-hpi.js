#!/usr/bin/env node
'use strict';

/**
 * scripts/ingest-fhfa-hpi.js
 *
 * Fetches the FHFA public state House Price Index summary CSV and writes a
 * provenance-bearing snapshot (embedded raw CSV + sha256 + retrievedAt) to
 * server/enrichment/data/fhfa-state-hpi.json.
 *
 * The snapshot is the observed input for server/enrichment/fhfa-state-hpi.js.
 * The runtime re-hashes the embedded bytes on read, so the served per-state
 * percent changes are provably the publisher's own bytes.
 *
 * Usage:
 *   node scripts/ingest-fhfa-hpi.js
 *   node scripts/ingest-fhfa-hpi.js --url=https://www.fhfa.gov/hpi-state/csv --out=path.json
 *
 * No network fallback is invented: if the publisher is unreachable the run
 * fails and nothing is written.
 */

const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');

const {
  SOURCE_URL,
  DEFAULT_SNAPSHOT_PATH,
  MAX_CSV_BYTES,
  buildStateHpiSnapshot,
  isObservedStateHpiSnapshot,
  parseStateHpiCsv,
} = require('../server/enrichment/fhfa-state-hpi');

function parseArgs(argv) {
  const options = { url: SOURCE_URL, out: DEFAULT_SNAPSHOT_PATH };
  for (const flag of argv) {
    if (flag.startsWith('--url=')) options.url = flag.slice('--url='.length);
    else if (flag.startsWith('--out=')) options.out = flag.slice('--out='.length);
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

async function run() {
  const options = parseArgs(process.argv.slice(2));
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

module.exports = { parseArgs, sanitizeSourceUrl, fetchText, run };
