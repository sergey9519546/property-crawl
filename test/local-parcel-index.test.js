'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { queryLocalParcelIndex, closeLocalParcelDb } = require('../server/enrichment/local-parcel-index');

test('local parcel index fails open when env var is unset or file missing', () => {
  delete process.env.PROPERTY_LOCAL_PARCEL_DB;
  delete process.env.PROPERTY_OFFLINE_PARCEL_DB;
  closeLocalParcelDb();

  assert.equal(queryLocalParcelIndex(), null);
  assert.equal(queryLocalParcelIndex({ apn: '123-456' }), null);
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
