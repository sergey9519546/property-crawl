'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const {
  queryLocalParcelIndex,
  closeLocalParcelDb,
  DEFAULT_LOCAL_PARCEL_DB_PATH
} = require('../server/enrichment/local-parcel-index');

test('local parcel index fails open when env var is unset or file missing', () => {
  delete process.env.PROPERTY_LOCAL_PARCEL_DB;
  delete process.env.PROPERTY_OFFLINE_PARCEL_DB;
  closeLocalParcelDb();

  assert.equal(queryLocalParcelIndex(), null);
  assert.equal(queryLocalParcelIndex({ apn: '123-456' }), null);
});

test('DEFAULT_LOCAL_PARCEL_DB_PATH points to cache directory', () => {
  assert.ok(DEFAULT_LOCAL_PARCEL_DB_PATH.endsWith(path.join('.cache', 'local-parcels.db')));
});

test('local parcel index resolves hit from configured SQLite database', () => {
  const tmpDbPath = path.resolve(__dirname, 'temp_parcel_index.db');
  if (fs.existsSync(tmpDbPath)) fs.unlinkSync(tmpDbPath);

  const db = new DatabaseSync(tmpDbPath);
  db.exec(`
    CREATE TABLE parcels (
      county_fips TEXT,
      clean_apn TEXT,
      raw_apn TEXT,
      state TEXT,
      county TEXT,
      situs_address TEXT,
      assessed_total REAL,
      assessed_land REAL,
      assessed_imprv REAL,
      land_use TEXT,
      legal_description TEXT,
      tax_year INTEGER
    );
    CREATE INDEX idx_parcels_fips_apn ON parcels(county_fips, clean_apn);
    CREATE INDEX idx_parcels_state_county_apn ON parcels(state, county, clean_apn);
  `);

  const insert = db.prepare(`
    INSERT INTO parcels VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insert.run(
    '12011',
    '494212030010',
    '4942-12-03-0010',
    'FL',
    'BROWARD',
    '100 LAS OLAS BLVD',
    450000,
    120000,
    330000,
    'SINGLE_FAMILY',
    'LOT 1 BLK 3 LAS OLAS',
    2026
  );
  db.close();

  process.env.PROPERTY_LOCAL_PARCEL_DB = tmpDbPath;
  closeLocalParcelDb();

  try {
    const miss = queryLocalParcelIndex({ apn: '999-999-999', countyFips: '12011' });
    assert.equal(miss, null);

    const hitByFips = queryLocalParcelIndex({ apn: '4942-12-03-0010', countyFips: '12011' });
    assert.ok(hitByFips !== null);
    assert.equal(hitByFips.canonicalApn, '494212030010');
    assert.equal(hitByFips.assessedTotal, 450000);
    assert.equal(hitByFips.assessedLand, 120000);
    assert.equal(hitByFips.assessedImprv, 330000);
    assert.equal(hitByFips.assessedValue?.total, 450000);
    assert.equal(hitByFips.taxYear, 2026);
    assert.equal(hitByFips.source, 'local_cadastral_offline_index');

    const hitByStateCounty = queryLocalParcelIndex({ apn: '4942-12-03-0010', state: 'FL', county: 'Broward' });
    assert.ok(hitByStateCounty !== null);
    assert.equal(hitByStateCounty.canonicalApn, '494212030010');
  } finally {
    closeLocalParcelDb();
    delete process.env.PROPERTY_LOCAL_PARCEL_DB;
    if (fs.existsSync(tmpDbPath)) fs.unlinkSync(tmpDbPath);
  }
});

test('local parcel index switches db when PROPERTY_LOCAL_PARCEL_DB changes', () => {
  const tmpDb1 = path.resolve(__dirname, 'temp_parcel_1.db');
  const tmpDb2 = path.resolve(__dirname, 'temp_parcel_2.db');
  if (fs.existsSync(tmpDb1)) fs.unlinkSync(tmpDb1);
  if (fs.existsSync(tmpDb2)) fs.unlinkSync(tmpDb2);

  const db1 = new DatabaseSync(tmpDb1);
  db1.exec(`
    CREATE TABLE parcels (county_fips TEXT, clean_apn TEXT, raw_apn TEXT, state TEXT, county TEXT, situs_address TEXT, assessed_total REAL, assessed_land REAL, assessed_imprv REAL, land_use TEXT, legal_description TEXT, tax_year INTEGER);
    INSERT INTO parcels VALUES ('11111', 'APN1', 'APN-1', 'FL', 'DADE', '123 MAIN', 100000, 20000, 80000, 'RES', 'LOT 1', 2025);
  `);
  db1.close();

  const db2 = new DatabaseSync(tmpDb2);
  db2.exec(`
    CREATE TABLE parcels (county_fips TEXT, clean_apn TEXT, raw_apn TEXT, state TEXT, county TEXT, situs_address TEXT, assessed_total REAL, assessed_land REAL, assessed_imprv REAL, land_use TEXT, legal_description TEXT, tax_year INTEGER);
    INSERT INTO parcels VALUES ('22222', 'APN2', 'APN-2', 'TX', 'BEXAR', '456 OAK', 200000, 50000, 150000, 'COM', 'LOT 2', 2026);
  `);
  db2.close();

  try {
    process.env.PROPERTY_LOCAL_PARCEL_DB = tmpDb1;
    const hit1 = queryLocalParcelIndex({ apn: 'APN-1', countyFips: '11111' });
    assert.ok(hit1);
    assert.equal(hit1.canonicalApn, 'APN1');
    assert.equal(hit1.assessedTotal, 100000);
    assert.equal(hit1.assessedValue?.total, 100000);

    // Switch env var to db2 without calling closeLocalParcelDb manually:
    process.env.PROPERTY_LOCAL_PARCEL_DB = tmpDb2;
    const hit2 = queryLocalParcelIndex({ apn: 'APN-2', countyFips: '22222' });
    assert.ok(hit2);
    assert.equal(hit2.canonicalApn, 'APN2');
    assert.equal(hit2.assessedTotal, 200000);

    // Verify db1 is no longer queried
    const missOld = queryLocalParcelIndex({ apn: 'APN-1', countyFips: '11111' });
    assert.equal(missOld, null);
  } finally {
    closeLocalParcelDb();
    delete process.env.PROPERTY_LOCAL_PARCEL_DB;
    if (fs.existsSync(tmpDb1)) fs.unlinkSync(tmpDb1);
    if (fs.existsSync(tmpDb2)) fs.unlinkSync(tmpDb2);
  }
});
