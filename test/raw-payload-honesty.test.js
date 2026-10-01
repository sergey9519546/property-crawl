'use strict';

// test/raw-payload-honesty.test.js
//
// Pins the honesty contract for discovery_snapshots.raw_payload.
//
// raw_payload is the record of what the publisher actually returned. The
// scheduler used to guarantee the column was non-empty by falling back to the
// NORMALIZED listing whenever the raw notice was not parseable JSON:
//
//   const rawPayload = originalPublisherRecord || (() => {
//     try { return JSON.parse(validation.listing.raw); }
//     catch { return validation.listing; }
//   })();
//
// Only six scrapers implement getRawPublisherRecord(). Every other scheduled
// source stores a plain-text notice, so JSON.parse throws and the normalized
// listing landed in the raw column — derived data labelled publisher-observed,
// with the run still reporting success.
//
// The fix records null instead, which is why migration 016 makes the column
// nullable. These tests exist so the fallback cannot be reintroduced.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const schedulerSource = fs.readFileSync(
  path.join(ROOT, 'server', 'scrapers', 'scheduler.js'),
  'utf8',
);
const migration016 = fs.readFileSync(
  path.join(ROOT, 'server', 'db', 'migrations', '016_raw_payload_nullable.sql'),
  'utf8',
);

test('the scheduler no longer falls back to the normalized listing for raw_payload', () => {
  // The specific shape that corrupted the evidence chain.
  assert.ok(
    !/catch\{\s*return validation\.listing;\s*\}/.test(schedulerSource),
    'scheduler.js must not substitute the normalized listing for a missing publisher payload',
  );
});

test('the raw_payload fallback returns null, not a listing', () => {
  const match = schedulerSource.match(
    /rawPayload\s*=\s*originalPublisherRecord\s*\|\|\s*\(\(\)\s*=>\s*\{([\s\S]*?)\}\)\(\)/,
  );
  assert.ok(match, 'expected to find the rawPayload fallback expression');
  const body = match[1];
  assert.match(body, /JSON\.parse\(validation\.listing\.raw\)/, 'should still try the stored raw');
  assert.match(
    body,
    /catch\s*\{\s*return null;\s*\}/,
    'an unparseable raw must resolve to null (unknown), not to the normalized listing',
  );
  assert.ok(
    !/return validation\.listing/.test(body),
    'the fallback must never return the normalized listing',
  );
});

test('migration 016 exists and makes raw_payload nullable', () => {
  assert.match(
    migration016,
    /ALTER TABLE discovery_snapshots ALTER COLUMN raw_payload DROP NOT NULL/,
    'raw_payload must be nullable so the honest null can be recorded',
  );
});

test('the intent is documented at the fix site, not only in the migration', () => {
  const idx = schedulerSource.indexOf('rawPayload');
  assert.ok(idx > 0, 'expected a rawPayload assignment');
  const nearby = schedulerSource.slice(Math.max(0, idx - 700), idx);
  assert.match(
    nearby,
    /unknown/i,
    'the substitution is an honesty decision and should say so where it happens',
  );
});

test('the six scrapers that do capture a publisher record still take precedence', () => {
  // getRawPublisherRecord remains the preferred source; the null fallback only
  // applies when a scraper does not provide one.
  assert.match(schedulerSource, /originalPublisherRecord\s*\|\|/);
  const implementing = fs.readFileSync(
    path.join(ROOT, 'server', 'scrapers', 'hud-usps-vacancy.js'),
    'utf8',
  );
  assert.match(implementing, /getRawPublisherRecord/);
});
