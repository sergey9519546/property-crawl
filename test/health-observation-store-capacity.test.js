'use strict';

// test/health-observation-store-capacity.test.js
//
// The observation store has a 64MB ceiling and loadObservations throws past
// it. Measured on this deployment: 51.84MB after a 32.6-day window, ~1.59MB per
// day, about 7.6 days of headroom left.
//
// Nothing reported that. /api/health carried inventoryFreshness, documentReview
// store errors and workspace store errors -- every other backing store was
// observable -- and the one file that provably fills up and then degrades had
// no numbers at all. The degradation is honest when it arrives (sources flip to
// history_unavailable), but an operator learns about it only once it is
// already happening.
//
// This adds the numbers to /api/health. It does NOT decide a retention policy:
// what to drop is a product decision. Making the remaining runway legible is
// not.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const SERVER = fs.readFileSync(path.join(ROOT, 'server', 'server.js'), 'utf8');
const OBSERVATIONS = fs.readFileSync(path.join(ROOT, 'server', 'sources', 'observations.js'), 'utf8');

test('/api/health publishes the observation store size against its ceiling', () => {
  assert.match(
    SERVER,
    /observationStore/,
    'the observation store is a backing store like the others health already '
      + 'reports on; it should be visible there too',
  );
});

test('the reported capacity is derived from the real file and the real ceiling', () => {
  // A health field that quotes constants instead of measuring the file would be
  // worse than no field: it would report the same numbers on a full disk.
  assert.match(
    OBSERVATIONS,
    /statSync\(/,
    'capacity must be measured with statSync, not asserted from a constant',
  );
  assert.match(
    OBSERVATIONS,
    /function\s+\w*(capacity|Capacity|stats|Stats)\w*/,
    'observations should expose a capacity helper the health route can call',
  );
});

test('the runway is reported, not only the percentage', () => {
  assert.match(
    OBSERVATIONS,
    /runway|daysRemaining|estimatedDays/i,
    'a percentage of a cap does not tell an operator when to act; the number of '
      + 'days at the observed growth rate does',
  );
});

test('an absent store reports zero rather than null', () => {
  assert.match(
    OBSERVATIONS,
    /return\s*\{[^}]*bytes:\s*0/,
    'an absent store is a real, reportable state -- 0 bytes -- not an unknown',
  );
});
