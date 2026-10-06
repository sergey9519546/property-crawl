'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('Next proxy allows long scraper collection runs', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src/lib/property-api.ts'), 'utf8');
  assert.match(source, /180_000/);
  assert.match(source, /\/api\/scrapers/);
  assert.match(source, /timed out/);
});

test('live record store default limit absorbs multi-state HUD batches', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'server/db/live-record-store.js'), 'utf8');
  // The default is 128MB, raised from 64MB when pagination let a single
  // ServiceLink sweep discover 6,194 records: at ~7KB each the old ceiling
  // filled before the sweep could record what it had just found. It is still a
  // bound - the guard fails closed rather than growing without limit - and it
  // remains overridable per host.
  assert.match(source, /128 \* 1024 \* 1024/);
  assert.match(source, /PROPERTY_LIVE_STORE_MAX_BYTES/);
});
