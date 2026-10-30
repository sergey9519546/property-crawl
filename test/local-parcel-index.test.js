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


test('presentListing bridges unparsed legal description to official cadastral situsAddress via APN', () => {
  const { presentListing, isLegalDescriptionAddress } = require('../server/routes/listings');
  const { resolveCadastralParcelIdentity } = require('../server/enrichment/arcgis-parcels');

  assert.equal(isLegalDescriptionAddress('LOT 12 BLOCK 3 PARADISE VALLEY'), true);
  assert.equal(isLegalDescriptionAddress('PARCEL 4 SUBD OAK GROVE'), true);
  assert.equal(isLegalDescriptionAddress('SEC 14 TWP 2N RNG 3E'), true);
  assert.equal(isLegalDescriptionAddress('123 Main St'), false);
  assert.equal(isLegalDescriptionAddress('88 Market Street'), false);

  const tmpDb = path.resolve(__dirname, 'temp_bridge_test.db');
  if (fs.existsSync(tmpDb)) fs.unlinkSync(tmpDb);

  const db = new DatabaseSync(tmpDb);
  db.exec(`
    CREATE TABLE parcels (county_fips TEXT, clean_apn TEXT, raw_apn TEXT, state TEXT, county TEXT, situs_address TEXT, assessed_total REAL, assessed_land REAL, assessed_imprv REAL, land_use TEXT, legal_description TEXT, tax_year INTEGER);
    INSERT INTO parcels VALUES ('12095', '292215000000012', '29-22-15-0000-00-012', 'FL', 'ORANGE', '7420 UNIVERSAL BLVD', 320000, 80000, 240000, 'SINGLE_FAMILY', 'LOT 12 BLK 3 PARADISE VALLEY', 2026);
  `);
  db.close();

  try {
    process.env.PROPERTY_LOCAL_PARCEL_DB = tmpDb;
    closeLocalParcelDb();

    const rawListing = {
      id: 'FL-TAX-2026-991',
      address: 'LOT 12 BLOCK 3 PARADISE VALLEY',
      city: 'Orlando',
      state: 'FL',
      county: 'Orange',
      countyFips: '12095',
      apn: '29-22-15-0000-00-012',
      openingBid: 45000,
      source: 'countytaxsale',
      provenance: {
        origin: 'live',
        sourceFacts: {
          apn: '29-22-15-0000-00-012'
        }
      }
    };

    const presented = presentListing(rawListing);
    assert.equal(presented.address, '7420 UNIVERSAL BLVD');
    assert.equal(presented.situsAddress, '7420 UNIVERSAL BLVD');
    assert.equal(presented.legalDescription, 'LOT 12 BLOCK 3 PARADISE VALLEY');
    assert.ok(presented.cadastralMatch);
    assert.equal(presented.cadastralMatch.matchBasis, 'cadastral_apn_lookup');
    assert.equal(presented.cadastralMatch.parcelKey, '12095-292215000000012');
    assert.equal(presented.provenance.addressResolution.resolvedFrom, 'cadastral_apn_lookup');
    assert.equal(presented.provenance.addressResolution.originalAddress, 'LOT 12 BLOCK 3 PARADISE VALLEY');
  } finally {
    closeLocalParcelDb();
    delete process.env.PROPERTY_LOCAL_PARCEL_DB;
    if (fs.existsSync(tmpDb)) fs.unlinkSync(tmpDb);
  }
});
