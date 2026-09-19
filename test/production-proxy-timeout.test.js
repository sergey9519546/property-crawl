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
  assert.match(source, /64 \* 1024 \* 1024/);
  assert.match(source, /PROPERTY_LIVE_STORE_MAX_BYTES/);
});
