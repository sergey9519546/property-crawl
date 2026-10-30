'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { initParcelSchema, insertParcelBatch, indexParcelFile } = require('../scripts/index-local-parcels');
const { queryLocalParcelIndex, closeLocalParcelDb } = require('../server/enrichment/local-parcel-index');

let DatabaseSync;
try {
  DatabaseSync = require('node:sqlite').DatabaseSync;
} catch {
  DatabaseSync = null;
}

test('Local Parcel Indexer: creates schema and executes batch inserts into SQLite', (t) => {
  if (!DatabaseSync) {
    t.skip('node:sqlite is not supported in this environment');
    return;
  }

  const tmpDbPath = path.join(os.tmpdir(), `test-parcels-${Date.now()}.db`);
  t.after(() => {
    closeLocalParcelDb();
    if (fs.existsSync(tmpDbPath)) {
      try { fs.unlinkSync(tmpDbPath); } catch {}
    }
  });

  const db = new DatabaseSync(tmpDbPath);
  initParcelSchema(db);

  const sampleRows = [
    {
      cleanApn: '120110010010',
      countyFips: '12011',
      state: 'FL',
      county: 'BROWARD',
      rawApn: '12-011-0010-010',
      situsAddress: '100 LAS OLAS BLVD',
      assessedTotal: 450000,
      assessedLand: 120000,
      assessedImprv: 330000,
      landUse: '0100',
      legalDescription: 'LOT 1 BLK 1 FORT LAUDERDALE',
      taxYear: 2025
    },
    {
      cleanApn: '390019990001',
      countyFips: '39035',
      state: 'OH',
      county: 'CUYAHOGA',
      rawApn: '390-01-999-0001',
      situsAddress: '1420 W 28TH ST',
      assessedTotal: 125000,
      assessedLand: 25000,
      assessedImprv: 100000,
      landUse: '510',
      legalDescription: 'ORIGINAL LOT 44',
      taxYear: 2025
    }
  ];

  const inserted = insertParcelBatch(db, sampleRows);
  assert.equal(inserted, 2);
  db.close();

  // Test query via queryLocalParcelIndex
  process.env.PROPERTY_LOCAL_PARCEL_DB = tmpDbPath;

  const foundBroward = queryLocalParcelIndex({ apn: '12-011-0010-010', countyFips: '12011' });
  assert.ok(foundBroward);
  assert.equal(foundBroward.canonicalApn, '120110010010');
  assert.equal(foundBroward.assessedTotal, 450000);
  assert.equal(foundBroward.situsAddress, '100 LAS OLAS BLVD');

  const foundCuyahoga = queryLocalParcelIndex({ apn: '390-01-999-0001', state: 'OH', county: 'CUYAHOGA' });
  assert.ok(foundCuyahoga);
  assert.equal(foundCuyahoga.canonicalApn, '390019990001');
  assert.equal(foundCuyahoga.assessedTotal, 125000);

  delete process.env.PROPERTY_LOCAL_PARCEL_DB;
});

test('Local Parcel Indexer: streams and indexes records from jsonl file', async (t) => {
  if (!DatabaseSync) {
    t.skip('node:sqlite is not supported in this environment');
    return;
  }

  const tmpDbPath = path.join(os.tmpdir(), `test-file-parcels-${Date.now()}.db`);
  const tmpJsonlPath = path.join(os.tmpdir(), `test-input-${Date.now()}.jsonl`);

  t.after(() => {
    closeLocalParcelDb();
    if (fs.existsSync(tmpDbPath)) {
      try { fs.unlinkSync(tmpDbPath); } catch {}
    }
    if (fs.existsSync(tmpJsonlPath)) {
      try { fs.unlinkSync(tmpJsonlPath); } catch {}
    }
  });

  const lines = [
    JSON.stringify({ apn: 'FL-001-222', situs: '500 Ocean Dr', just_value: 850000, state: 'FL', county: 'MIAMI-DADE' }),
    JSON.stringify({ apn: 'FL-001-333', situs: '502 Ocean Dr', just_value: 920000, state: 'FL', county: 'MIAMI-DADE' }),
    JSON.stringify({ apn: 'FL-001-444', situs: '504 Ocean Dr', just_value: 780000, state: 'FL', county: 'MIAMI-DADE' })
  ].join('\n');

  fs.writeFileSync(tmpJsonlPath, lines, 'utf8');

  const res = await indexParcelFile({
    inputPath: tmpJsonlPath,
    dbPath: tmpDbPath,
    countyFips: '12086',
    state: 'FL',
    county: 'MIAMI-DADE'
  });

  assert.equal(res.processed, 3);
  assert.equal(res.indexed, 3);

  process.env.PROPERTY_LOCAL_PARCEL_DB = tmpDbPath;
  const result = queryLocalParcelIndex({ apn: 'FL-001-333', countyFips: '12086' });
  assert.ok(result);
  assert.equal(result.canonicalApn, 'FL001333');
  assert.equal(result.assessedTotal, 920000);
  assert.equal(result.situsAddress, '502 Ocean Dr');

  delete process.env.PROPERTY_LOCAL_PARCEL_DB;
});
