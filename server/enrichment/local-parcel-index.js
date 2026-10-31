'use strict';

const path = require('node:path');
const fs = require('node:fs');

const DEFAULT_LOCAL_PARCEL_DB_PATH = path.resolve(__dirname, '../../.cache/local-parcels.db');

let dbInstance = null;
let currentDbPath = null;
let DatabaseSyncClass = null;

try {
  const sqlite = require('node:sqlite');
  DatabaseSyncClass = sqlite.DatabaseSync;
} catch {
  DatabaseSyncClass = null;
}

/**
 * Returns a handle to the local cadastral SQLite index if configured.
 * Configured via process.env.PROPERTY_LOCAL_PARCEL_DB, PROPERTY_OFFLINE_PARCEL_DB,
 * or default cache path.
 */
function getLocalParcelDb() {
  const dbPath = process.env.PROPERTY_LOCAL_PARCEL_DB || process.env.PROPERTY_OFFLINE_PARCEL_DB || DEFAULT_LOCAL_PARCEL_DB_PATH;
  if (!dbPath || !fs.existsSync(/*turbopackIgnore: true*/ dbPath) || !DatabaseSyncClass) {
    if (dbInstance) {
      try { dbInstance.close(); } catch {}
      dbInstance = null;
      currentDbPath = null;
    }
    return null;
  }
  if (dbInstance && currentDbPath === dbPath) return dbInstance;
  if (dbInstance) {
    try {
      dbInstance.close();
    } catch {}
    dbInstance = null;
    currentDbPath = null;
  }
  try {
    dbInstance = new DatabaseSyncClass(dbPath, { readOnly: true });
    currentDbPath = dbPath;
    return dbInstance;
  } catch {
    dbInstance = null;
    currentDbPath = null;
    return null;
  }
}

/**
 * Fast-path local parcel lookup by APN and County/FIPS.
 *
 * @param {Object} params
 * @param {string} params.apn - Raw or clean APN
 * @param {string} [params.countyFips] - 5-digit county FIPS
 * @param {string} [params.state] - 2-letter state code
 * @param {string} [params.county] - County name
 * @returns {Object|null} Normalized assessment and parcel facts, or null on cache miss
 */
function queryLocalParcelIndex({ apn, countyFips, state, county } = {}) {
  if (!apn) return null;
  const db = getLocalParcelDb();
  if (!db) return null;

  try {
    const cleanApn = String(apn).trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!cleanApn) return null;

    let row = null;
    if (countyFips) {
      const stmt = db.prepare('SELECT * FROM parcels WHERE county_fips = ? AND (clean_apn = ? OR UPPER(raw_apn) = ?) LIMIT 1');
      row = stmt.get(String(countyFips), cleanApn, String(apn).trim().toUpperCase());
    } else if (state && county) {
      const stmt = db.prepare('SELECT * FROM parcels WHERE state = ? AND UPPER(county) = ? AND (clean_apn = ? OR UPPER(raw_apn) = ?) LIMIT 1');
      row = stmt.get(String(state).toUpperCase(), String(county).toUpperCase(), cleanApn, String(apn).trim().toUpperCase());
    }

    if (!row) return null;

    const total = Number.isFinite(row.assessed_total) ? Number(row.assessed_total) : null;
    const land = Number.isFinite(row.assessed_land) ? Number(row.assessed_land) : null;
    const improvements = Number.isFinite(row.assessed_imprv) ? Number(row.assessed_imprv) : null;

    return {
      rawApn: row.raw_apn || apn,
      canonicalApn: row.clean_apn || cleanApn,
      countyFips: row.county_fips || countyFips || null,
      countyName: county || null,
      situsAddress: row.situs_address || null,
      assessedTotal: total,
      assessedLand: land,
      assessedImprv: improvements,
      assessedValue: {
        total,
        land,
        improvements
      },
      landUse: row.land_use || null,
      legalDescription: row.legal_description || null,
      taxYear: row.tax_year ? Number(row.tax_year) : null,
      source: 'local_cadastral_offline_index',
      matchedAt: new Date().toISOString()
    };
  } catch {
    return null;
  }
}

function closeLocalParcelDb() {
  if (dbInstance) {
    try {
      dbInstance.close();
    } catch {}
    dbInstance = null;
    currentDbPath = null;
  }
}

module.exports = {
  DEFAULT_LOCAL_PARCEL_DB_PATH,
  getLocalParcelDb,
  queryLocalParcelIndex,
  closeLocalParcelDb
};
