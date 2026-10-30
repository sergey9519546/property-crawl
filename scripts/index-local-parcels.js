'use strict';

/**
 * @file scripts/index-local-parcels.js
 * High-performance, zero-dependency offline local cadastral parcel indexer.
 * Uses Node's built-in `node:sqlite` (DatabaseSync) and streaming gzip/readline
 * to ingest county assessment tax rolls into SQLite for sub-millisecond parcel lookups.
 */

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const readline = require('node:readline');
const { DEFAULT_LOCAL_PARCEL_DB_PATH } = require('../server/enrichment/local-parcel-index');

let DatabaseSync;
try {
  DatabaseSync = require('node:sqlite').DatabaseSync;
} catch {
  DatabaseSync = null;
}

function initParcelSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS parcels (
      clean_apn TEXT NOT NULL,
      county_fips TEXT,
      state TEXT,
      county TEXT,
      raw_apn TEXT,
      situs_address TEXT,
      assessed_total REAL,
      assessed_land REAL,
      assessed_imprv REAL,
      land_use TEXT,
      legal_description TEXT,
      tax_year INTEGER,
      PRIMARY KEY (clean_apn, county_fips)
    );
    CREATE INDEX IF NOT EXISTS idx_parcels_fips_apn ON parcels (county_fips, clean_apn);
    CREATE INDEX IF NOT EXISTS idx_parcels_state_county_apn ON parcels (state, county, clean_apn);
  `);
}

function normalizeCleanApn(raw) {
  if (!raw) return null;
  const clean = String(raw).trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  return clean || null;
}

/**
 * Batch-inserts normalized parcel records inside a single SQLite transaction.
 *
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {Array<Object>} rows
 * @returns {number} Inserted or updated count
 */
function insertParcelBatch(db, rows = []) {
  if (!rows.length) return 0;
  const stmt = db.prepare(`
    INSERT INTO parcels (
      clean_apn, county_fips, state, county, raw_apn,
      situs_address, assessed_total, assessed_land, assessed_imprv,
      land_use, legal_description, tax_year
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(clean_apn, county_fips) DO UPDATE SET
      situs_address = COALESCE(excluded.situs_address, parcels.situs_address),
      assessed_total = COALESCE(excluded.assessed_total, parcels.assessed_total),
      assessed_land = COALESCE(excluded.assessed_land, parcels.assessed_land),
      assessed_imprv = COALESCE(excluded.assessed_imprv, parcels.assessed_imprv),
      land_use = COALESCE(excluded.land_use, parcels.land_use),
      legal_description = COALESCE(excluded.legal_description, parcels.legal_description),
      tax_year = COALESCE(excluded.tax_year, parcels.tax_year)
  `);

  db.exec('BEGIN TRANSACTION');
  let inserted = 0;
  try {
    for (const r of rows) {
      const cleanApn = normalizeCleanApn(r.cleanApn || r.clean_apn || r.rawApn || r.apn || r.parcelId);
      if (!cleanApn) continue;
      const fips = r.countyFips || r.county_fips || '';
      stmt.run(
        cleanApn,
        fips,
        r.state ? String(r.state).toUpperCase() : null,
        r.county ? String(r.county).toUpperCase() : null,
        r.rawApn || r.apn || cleanApn,
        r.situsAddress || r.situs_address || r.address || null,
        Number.isFinite(Number(r.assessedTotal ?? r.assessed_total)) ? Number(r.assessedTotal ?? r.assessed_total) : null,
        Number.isFinite(Number(r.assessedLand ?? r.assessed_land)) ? Number(r.assessedLand ?? r.assessed_land) : null,
        Number.isFinite(Number(r.assessedImprv ?? r.assessed_imprv)) ? Number(r.assessedImprv ?? r.assessed_imprv) : null,
        r.landUse || r.land_use || null,
        r.legalDescription || r.legal_description || null,
        Number.isFinite(Number(r.taxYear ?? r.tax_year)) ? Number(r.taxYear ?? r.tax_year) : null
      );
      inserted++;
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return inserted;
}

/**
 * Streams and indexes a county parcel roll file into SQLite.
 * Supports `.jsonl`, `.jsonl.gz`, or raw JSON array.
 */
async function indexParcelFile({
  inputPath,
  dbPath = DEFAULT_LOCAL_PARCEL_DB_PATH,
  countyFips = '',
  state = '',
  county = '',
  limit = Infinity,
  batchSize = 2000,
  onProgress = null
} = {}) {
  if (!DatabaseSync) {
    throw new Error('node:sqlite DatabaseSync is not supported in this Node.js runtime.');
  }
  if (!inputPath || !fs.existsSync(inputPath)) {
    throw new Error(`Input file not found: ${inputPath}`);
  }

  const resolvedDbDir = path.dirname(dbPath);
  if (!fs.existsSync(resolvedDbDir)) {
    fs.mkdirSync(resolvedDbDir, { recursive: true });
  }

  const db = new DatabaseSync(dbPath);
  initParcelSchema(db);

  let totalProcessed = 0;
  let totalIndexed = 0;
  let batch = [];

  const flushBatch = () => {
    if (batch.length > 0) {
      const count = insertParcelBatch(db, batch);
      totalIndexed += count;
      batch = [];
      if (typeof onProgress === 'function') {
        onProgress({ processed: totalProcessed, indexed: totalIndexed });
      }
    }
  };

  const isGzip = inputPath.endsWith('.gz');
  const fileStream = fs.createReadStream(inputPath);
  const inputStream = isGzip ? fileStream.pipe(zlib.createGunzip()) : fileStream;
  const rl = readline.createInterface({ input: inputStream, crlfDelay: Infinity });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed || trimmed === '[' || trimmed === ']') continue;
    const cleanLine = trimmed.endsWith(',') ? trimmed.slice(0, -1) : trimmed;

    try {
      const record = JSON.parse(cleanLine);
      const row = {
        cleanApn: record.clean_apn || record.apn || record.parcel_id || record.parcelId || record.pin || record.PARCELID || record.TMK,
        rawApn: record.raw_apn || record.apn || record.parcel_id || record.parcelId || record.pin || record.PARCELID || record.TMK,
        countyFips: record.county_fips || countyFips,
        state: record.state || state,
        county: record.county || county,
        situsAddress: record.situs_address || record.situs || record.address || record.SITE_ADDR || record.PHYADDR1,
        assessedTotal: record.assessed_total ?? record.just_value ?? record.total_value ?? record.assessedValue ?? record.JV ?? record.TOTAL_VAL,
        assessedLand: record.assessed_land ?? record.land_value ?? record.LAND_VAL,
        assessedImprv: record.assessed_imprv ?? record.building_value ?? record.BLDG_VAL,
        landUse: record.land_use ?? record.dor_uc ?? record.use_code ?? record.USE_CODE,
        legalDescription: record.legal_description ?? record.legal ?? record.LEGAL,
        taxYear: record.tax_year ?? record.taxYear ?? record.year
      };

      if (row.cleanApn) {
        batch.push(row);
        totalProcessed++;
        if (batch.length >= batchSize) {
          flushBatch();
        }
      }
    } catch {
      // Skip unparseable lines
    }

    if (totalProcessed >= limit) break;
  }

  flushBatch();
  db.close();

  return {
    processed: totalProcessed,
    indexed: totalIndexed,
    dbPath
  };
}

async function main() {
  const args = process.argv.slice(2);
  const getArg = (flag) => {
    const idx = args.indexOf(flag);
    return idx >= 0 && args[idx + 1] ? args[idx + 1] : null;
  };

  const inputPath = getArg('--input');
  if (!inputPath) {
    console.log(`
Usage: node scripts/index-local-parcels.js --input <file> [options]

Options:
  --input <path>     Path to .jsonl or .jsonl.gz county assessment taxroll
  --db <path>        Target SQLite file (default: .cache/local-parcels.db)
  --fips <code >     County FIPS code (e.g. 12011 for Broward County FL)
  --state <st>       Two-letter state (e.g. FL)
  --county <name>    County name (e.g. BROWARD)
  --limit <n>        Limit number of records to ingest
  --batch-size <n>   Batch size for SQLite transactions (default: 2000)
    `);
    process.exit(0);
  }

  const dbPath = getArg('--db') || DEFAULT_LOCAL_PARCEL_DB_PATH;
  const countyFips = getArg('--fips') || '';
  const state = getArg('--state') || '';
  const county = getArg('--county') || '';
  const limit = getArg('--limit') ? parseInt(getArg('--limit'), 10) : Infinity;

  console.log(`Starting parcel indexing from ${inputPath}...`);
  console.log(`Target database: ${dbPath}`);

  const start = Date.now();
  const result = await indexParcelFile({
    inputPath,
    dbPath,
    countyFips,
    state,
    county,
    limit,
    onProgress: ({ processed, indexed }) => {
      process.stdout.write(`\rProcessed ${processed.toLocaleString()} records (${indexed.toLocaleString()} indexed)...`);
    }
  });

  const durationSec = ((Date.now() - start) / 1000).toFixed(2);
  console.log(`\nIndexing complete! Ingested ${result.indexed.toLocaleString()} parcels in ${durationSec}s into ${result.dbPath}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Fatal error during parcel indexing:', err);
    process.exit(1);
  });
}

module.exports = {
  initParcelSchema,
  insertParcelBatch,
  indexParcelFile
};
