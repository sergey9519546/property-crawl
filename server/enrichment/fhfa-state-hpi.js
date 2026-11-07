'use strict';

/**
 * server/enrichment/fhfa-state-hpi.js
 *
 * Observed FHFA state House Price Index summary (area context only).
 *
 * The publisher's public state summary endpoint
 * (https://www.fhfa.gov/hpi-state/csv) reports, per state, seasonally-adjusted
 * HPI percent changes for the current release ("1 Quarter", "1 Year",
 * "5 Year", "Since 1991"). It publishes NO per-quarter index levels: the legacy
 * DataTools per-(state, period) file is retired and returns 404.
 *
 * This module serves those observed percent changes as area context and as the
 * statewide trend input. It never produces a per-property dollar value
 * (docs/COMPLETION_CHECKLIST.md: an index is not a per-house dollar band).
 *
 * Provenance & fail-closed:
 *   - The snapshot embeds the raw publisher CSV and its sha256.
 *   - The loader re-hashes the embedded bytes on read, so a hand-edited value
 *     cannot be served as observed.
 *   - Any missing or invalid snapshot returns null. Callers must treat that as
 *     "unobserved" and must not invent a trend.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { isUsStateOrTerritoryCode } = require('../state-codes');

const SOURCE_URL = 'https://www.fhfa.gov/hpi-state/csv';
const SNAPSHOT_PATH_ENV = 'FHFA_STATE_HPI_PATH';
const DEFAULT_SNAPSHOT_PATH = path.resolve(__dirname, 'data/fhfa-state-hpi.json');
const INDEX_TYPE = 'SA';
const MAX_CSV_BYTES = 262144; // 256 KB hard cap on the embedded publisher CSV
const MIN_STATE_ROWS = 50;
const CACHE_TTL_MS = 60000;

// Static reference data: USPS code by publisher state name. Not a value.
const STATE_NAME_TO_CODE = Object.freeze({
  Alabama: 'AL', Alaska: 'AK', Arizona: 'AZ', Arkansas: 'AR', California: 'CA',
  Colorado: 'CO', Connecticut: 'CT', Delaware: 'DE', Florida: 'FL', Georgia: 'GA',
  Hawaii: 'HI', Idaho: 'ID', Illinois: 'IL', Indiana: 'IN', Iowa: 'IA',
  Kansas: 'KS', Kentucky: 'KY', Louisiana: 'LA', Maine: 'ME', Maryland: 'MD',
  Massachusetts: 'MA', Michigan: 'MI', Minnesota: 'MN', Mississippi: 'MS', Missouri: 'MO',
  Montana: 'MT', Nebraska: 'NE', Nevada: 'NV', 'New Hampshire': 'NH', 'New Jersey': 'NJ',
  'New Mexico': 'NM', 'New York': 'NY', 'North Carolina': 'NC', 'North Dakota': 'ND',
  Ohio: 'OH', Oklahoma: 'OK', Oregon: 'OR', Pennsylvania: 'PA', 'Rhode Island': 'RI',
  'South Carolina': 'SC', 'South Dakota': 'SD', Tennessee: 'TN', Texas: 'TX', Utah: 'UT',
  Vermont: 'VT', Virginia: 'VA', Washington: 'WA', 'West Virginia': 'WV',
  Wisconsin: 'WI', Wyoming: 'WY', 'District of Columbia': 'DC', 'Puerto Rico': 'PR',
});

const METRIC_COLUMNS = Object.freeze({
  quarterPct: '1 quarter',
  yoyPct: '1 year',
  fiveYearPct: '5 year',
  since1991Pct: 'since 1991',
});

let cache = null;
let cacheCheckedAt = 0;

function sha256Hex(text) {
  return crypto.createHash('sha256').update(String(text), 'utf8').digest('hex');
}

function invalidateStateHpiCache() {
  cache = null;
  cacheCheckedAt = 0;
}

// Minimal RFC 4180 subset: quoted fields with embedded commas / escaped quotes.
function parseCsvRows(text) {
  const rows = [];
  let field = '';
  let row = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 1; } else { inQuotes = false; }
      } else {
        field += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(field); field = '';
    } else if (char === '\r') {
      // handled with \n
    } else if (char === '\n') {
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else {
      field += char;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    if (row.length > 1 || row[0] !== '') rows.push(row);
  }
  return rows;
}

/**
 * Parses the publisher state summary CSV into observed per-state metrics.
 *
 * @param {string} text
 * @returns {{ hasMetrics: boolean, states: Object, rowCount: number }}
 */
function parseStateHpiCsv(text) {
  if (typeof text !== 'string' || !text.trim()) return { hasMetrics: false, states: {}, rowCount: 0 };
  const rows = parseCsvRows(text.replace(/^\uFEFF/, ''));
  if (!rows.length) return { hasMetrics: false, states: {}, rowCount: 0 };
  const header = rows[0].map((value) => String(value || '').trim().toLowerCase());
  const hasMetrics = Object.values(METRIC_COLUMNS).every((label) => header.includes(label));
  const nameIndex = header.indexOf('state');
  const rankIndex = header.indexOf('rank');
  const indexOf = (label) => header.indexOf(label);
  const toNumber = (value) => {
    const parsed = Number(String(value ?? '').replace(/["$%,\s]/g, ''));
    return Number.isFinite(parsed) ? parsed : null;
  };
  const states = {};
  let rowCount = 0;
  if (nameIndex < 0) return { hasMetrics, states, rowCount };
  for (const row of rows.slice(1)) {
    const code = STATE_NAME_TO_CODE[String(row[nameIndex] || '').trim()];
    if (!code || !isUsStateOrTerritoryCode(code)) continue;
    states[code] = {
      rank: rankIndex >= 0 ? toNumber(row[rankIndex]) : null,
      quarterPct: toNumber(row[indexOf(METRIC_COLUMNS.quarterPct)]),
      yoyPct: toNumber(row[indexOf(METRIC_COLUMNS.yoyPct)]),
      fiveYearPct: toNumber(row[indexOf(METRIC_COLUMNS.fiveYearPct)]),
      since1991Pct: toNumber(row[indexOf(METRIC_COLUMNS.since1991Pct)]),
    };
    rowCount += 1;
  }
  return { hasMetrics, states, rowCount };
}

/**
 * Builds a provenance-bearing snapshot from the raw publisher CSV bytes.
 * The sha256 is computed over the exact bytes, so it is verifiable on read.
 */
function buildStateHpiSnapshot({ sourceUrl = SOURCE_URL, retrievedAt, csvText }) {
  const rawCsv = String(csvText ?? '');
  return {
    version: 1,
    sourceUrl,
    retrievedAt,
    indexType: INDEX_TYPE,
    mediaType: 'text/csv',
    datasetSha256: sha256Hex(rawCsv),
    rawCsv,
  };
}

function isObservedStateHpiSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || snapshot.version !== 1) return false;
  if (typeof snapshot.rawCsv !== 'string' || !snapshot.rawCsv.trim()) return false;
  if (Buffer.byteLength(snapshot.rawCsv, 'utf8') > MAX_CSV_BYTES) return false;
  let url;
  try { url = new URL(snapshot.sourceUrl); } catch { return false; }
  if (url.protocol !== 'https:' || !['www.fhfa.gov', 'fhfa.gov'].includes(url.hostname)) return false;
  if (!Number.isFinite(Date.parse(snapshot.retrievedAt))) return false;
  if (!/^[a-f0-9]{64}$/i.test(String(snapshot.datasetSha256 || ''))) return false;
  if (sha256Hex(snapshot.rawCsv).toLowerCase() !== String(snapshot.datasetSha256).toLowerCase()) return false;
  const parsed = parseStateHpiCsv(snapshot.rawCsv);
  return parsed.hasMetrics && parsed.rowCount >= MIN_STATE_ROWS;
}

function readSnapshotFromDisk() {
  const snapshotPath = process.env[SNAPSHOT_PATH_ENV] || DEFAULT_SNAPSHOT_PATH;
  try {
    if (!fs.existsSync(snapshotPath)) return null;
    const parsed = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
    return isObservedStateHpiSnapshot(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Loads and validates the observed snapshot. Returns null when absent/invalid.
 * @returns {{ snapshot: Object, parsed: Object }|null}
 */
function loadObservedStateHpi() {
  const now = Date.now();
  if (cache !== null && now - cacheCheckedAt < CACHE_TTL_MS) return cache || null;
  cacheCheckedAt = now;
  const snapshot = readSnapshotFromDisk();
  cache = snapshot ? { snapshot, parsed: parseStateHpiCsv(snapshot.rawCsv) } : false;
  return cache || null;
}

/**
 * Observed area context for a state, or null when unobserved.
 */
function getStateHpiContext(state) {
  if (!state) return null;
  const code = String(state).trim().toUpperCase();
  if (!isUsStateOrTerritoryCode(code)) return null;
  const loaded = loadObservedStateHpi();
  if (!loaded) return null;
  const row = loaded.parsed.states[code];
  if (!row) return null;
  return {
    state: code,
    sourceUrl: loaded.snapshot.sourceUrl,
    retrievedAt: loaded.snapshot.retrievedAt,
    indexType: loaded.snapshot.indexType,
    rank: row.rank,
    quarterPct: row.quarterPct,
    yoyPct: row.yoyPct,
    fiveYearPct: row.fiveYearPct,
    since1991Pct: row.since1991Pct,
  };
}

/**
 * Observed statewide 12-month HPI percent change, or null when unobserved.
 */
function getStateHpiYoy(state) {
  const context = getStateHpiContext(state);
  return context && Number.isFinite(context.yoyPct) ? context.yoyPct : null;
}

module.exports = {
  SOURCE_URL,
  SNAPSHOT_PATH_ENV,
  DEFAULT_SNAPSHOT_PATH,
  INDEX_TYPE,
  MIN_STATE_ROWS,
  MAX_CSV_BYTES,
  STATE_NAME_TO_CODE,
  METRIC_COLUMNS,
  sha256Hex,
  parseStateHpiCsv,
  buildStateHpiSnapshot,
  isObservedStateHpiSnapshot,
  loadObservedStateHpi,
  getStateHpiContext,
  getStateHpiYoy,
  invalidateStateHpiCache,
};
