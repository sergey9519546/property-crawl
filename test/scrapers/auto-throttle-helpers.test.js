'use strict';

// test/scrapers/auto-throttle-helpers.test.js
//
// Direct unit coverage for the pure helpers exported from
// server/scrapers/auto-throttle.js. parseRetryAfterMs parses the
// HTTP Retry-After header (numeric seconds OR HTTP-date) into ms and
// caps the result at 300_000ms; hostnameOf is the key the throttle
// uses to bucket requests. Silent drift in either would silently break
// the per-host throttle or let runaway Retry-After values block scrapes
// indefinitely.
//
//   - parseRetryAfterMs: numeric seconds, HTTP-date, null/undefined/''
//     input, 300_000ms ceiling, negative results clamped to 0
//   - hostnameOf: hostname extraction, unknown fallback on bad URL

const assert = require('node:assert/strict');
const test = require('node:test');

const { parseRetryAfterMs, hostnameOf } = require('../../server/scrapers/auto-throttle');

// --- parseRetryAfterMs -----------------------------------------------

test('parseRetryAfterMs: returns null for null / undefined / empty input', () => {
  assert.equal(parseRetryAfterMs(null), null);
  assert.equal(parseRetryAfterMs(undefined), null);
  assert.equal(parseRetryAfterMs(''), null);
});

test('parseRetryAfterMs: parses numeric seconds into ms', () => {
  assert.equal(parseRetryAfterMs('2'), 2000);
  assert.equal(parseRetryAfterMs('0'), 0);
  assert.equal(parseRetryAfterMs('60'), 60000);
});

test('parseRetryAfterMs: parses an HTTP-date into ms-from-now', () => {
  // Compute a date 30 seconds in the future and round-trip it. The result
  // should be roughly 30000ms, not exactly, but within a small tolerance.
  const future = new Date(Date.now() + 30000).toISOString();
  const out = parseRetryAfterMs(future);
  assert.ok(out >= 29000 && out <= 31000, `expected ~30000, got ${out}`);
});

test('parseRetryAfterMs: caps result at 300000ms (5 minutes)', () => {
  // The HTTP spec allows unbounded Retry-After; the scraper caps it so a
  // hostile publisher cannot block scrapes indefinitely.
  assert.equal(parseRetryAfterMs('999999'), 300000);
});

test('parseRetryAfterMs: returns null for non-numeric, non-date garbage', () => {
  assert.equal(parseRetryAfterMs('not-a-date'), null);
  assert.equal(parseRetryAfterMs('tomorrow'), null);
  assert.equal(parseRetryAfterMs('NaN'), null);
});

test('parseRetryAfterMs: HTTP-date in the past clamps to 0', () => {
  const past = new Date(Date.now() - 60000).toISOString();
  assert.equal(parseRetryAfterMs(past), 0);
});

test('parseRetryAfterMs: tolerates leading/trailing whitespace', () => {
  assert.equal(parseRetryAfterMs('  2  '), 2000);
});

test('parseRetryAfterMs: numeric strings > 300 are clamped (no overflow)', () => {
  // 999999s ≈ 11.5 days; must be capped at 5 minutes.
  assert.equal(parseRetryAfterMs('999999'), 300000);
});

// --- hostnameOf -------------------------------------------------------

test('hostnameOf: extracts the hostname from a full URL', () => {
  assert.equal(hostnameOf('https://api.example.gov/a'), 'api.example.gov');
  assert.equal(hostnameOf('http://localhost:3000/x'), 'localhost');
});

test('hostnameOf: returns "unknown" for a URL that fails to parse', () => {
  assert.equal(hostnameOf('not-a-url'), 'unknown');
  assert.equal(hostnameOf(''), 'unknown');
});

test('hostnameOf: coerces non-string input via String()', () => {
  // The helper wraps in String(); non-string input that doesn't produce
  // a valid URL still falls through to "unknown".
  assert.equal(hostnameOf(null), 'unknown');
  assert.equal(hostnameOf(undefined), 'unknown');
});
