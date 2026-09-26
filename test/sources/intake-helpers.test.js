'use strict';

// test/sources/intake-helpers.test.js
//
// Pure-function coverage for the public helpers exported by
// server/sources/intake.js. The intake endpoint accepts untrusted user
// submissions, runs them through validateSubmission, and persists them
// in the evidence store. Silent drift in the validator would let
// malicious or malformed payloads through (sensitive-keyed data, bad
// timestamps, oversize payloads, non-JSON records, future-dated
// captures, etc.). Pin the contract.
//
//   - parseCapturedAt: Date / number / ISO string / non-string handling,
//     Z-suffix normalisation, NaN-on-invalid
//   - validateSubmission: required field validation, sourceId pattern,
//     kind allow-list, byte-size caps, sensitive-key rejection,
//     JSON-records compatibility, future-timestamp guard, source-catalog
//     lookup path, customSource fallback for uncatalogued sources

const assert = require('node:assert/strict');
const test = require('node:test');

const { parseCapturedAt, validateSubmission } = require('../../server/sources/intake');

// --- parseCapturedAt ---------------------------------------------------

test('parseCapturedAt: accepts Date instance and returns ms', () => {
  const d = new Date('2026-01-15T10:00:00Z');
  assert.equal(parseCapturedAt(d), d.getTime());
});

test('parseCapturedAt: accepts finite positive number and returns ms', () => {
  assert.equal(parseCapturedAt(1736935200000), 1736935200000);
});

test('parseCapturedAt: rejects negative numbers with NaN', () => {
  assert.ok(Number.isNaN(parseCapturedAt(-1)));
});

test('parseCapturedAt: rejects zero with NaN', () => {
  assert.ok(Number.isNaN(parseCapturedAt(0)));
});

test('parseCapturedAt: rejects non-finite numbers with NaN', () => {
  assert.ok(Number.isNaN(parseCapturedAt(Infinity)));
  assert.ok(Number.isNaN(parseCapturedAt(NaN)));
});

test('parseCapturedAt: returns NaN for non-string non-Date non-number', () => {
  assert.ok(Number.isNaN(parseCapturedAt(null)));
  assert.ok(Number.isNaN(parseCapturedAt(undefined)));
  assert.ok(Number.isNaN(parseCapturedAt({})));
  assert.ok(Number.isNaN(parseCapturedAt([])));
});

test('parseCapturedAt: returns NaN for a non-ISO string', () => {
  assert.ok(Number.isNaN(parseCapturedAt('not-a-date')));
  assert.ok(Number.isNaN(parseCapturedAt('January 1, 2026')));
});

test('parseCapturedAt: accepts an ISO-8601 string with Z suffix', () => {
  const ms = parseCapturedAt('2026-01-15T10:00:00Z');
  assert.equal(ms, Date.parse('2026-01-15T10:00:00Z'));
});

test('parseCapturedAt: accepts an ISO-8601 string without Z and normalises', () => {
  const ms = parseCapturedAt('2026-01-15T10:00:00');
  // Naive form gets "Z" appended so Date.parse doesn't fall back to local TZ.
  assert.equal(ms, Date.parse('2026-01-15T10:00:00Z'));
});

test('parseCapturedAt: accepts an ISO string with explicit offset', () => {
  const ms = parseCapturedAt('2026-01-15T10:00:00+05:00');
  assert.equal(ms, Date.parse('2026-01-15T10:00:00+05:00'));
});

test('parseCapturedAt: trims whitespace before parsing', () => {
  const ms = parseCapturedAt('   2026-01-15T10:00:00Z   ');
  assert.equal(ms, Date.parse('2026-01-15T10:00:00Z'));
});

// --- validateSubmission ------------------------------------------------

test('validateSubmission: rejects null/non-object input', () => {
  assert.equal(validateSubmission(null).isValid, false);
  assert.equal(validateSubmission(undefined).isValid, false);
  assert.equal(validateSubmission('a string').isValid, false);
  assert.equal(validateSubmission([1, 2, 3]).isValid, false);
  assert.match(validateSubmission(null).errors.join(' '), /must be an object/);
});

test('validateSubmission: rejects submissions with sensitive keys', () => {
  const r = validateSubmission({
    sourceId: 'civilview',
    kind: 'text',
    body: 'plain text body',
    password: 'leaked',
  });
  assert.equal(r.isValid, false);
  assert.match(r.errors.join(' '), /credential-like field/);
});

test('validateSubmission: rejects an invalid sourceId shape', () => {
  const r = validateSubmission({
    sourceId: 'NOT-LOWERCASE!',
    kind: 'text',
    body: 'plain text',
  });
  assert.equal(r.isValid, false);
  assert.match(r.errors.join(' '), /2-64 character lowercase source key/);
});

test('validateSubmission: rejects a kind that is not in the allow-list', () => {
  const r = validateSubmission({
    sourceId: 'civilview',
    kind: 'binary',
    body: 'whatever',
    sourceUrl: 'https://example.com/x',
  });
  assert.equal(r.isValid, false);
  assert.match(r.errors.join(' '), /text, csv, or json/);
});

test('validateSubmission: text kind requires a non-empty body', () => {
  const r = validateSubmission({
    sourceId: 'civilview',
    kind: 'text',
    body: '   ',
    sourceUrl: 'https://example.com/x',
  });
  assert.equal(r.isValid, false);
  assert.match(r.errors.join(' '), /non-empty body/);
});

test('validateSubmission: rejects bodies that exceed the 512 KiB byte limit', () => {
  const big = 'x'.repeat(512 * 1024 + 1); // > 512 KiB (MAX_BODY_BYTES)
  const r = validateSubmission({
    sourceId: 'civilview',
    kind: 'text',
    body: big,
    sourceUrl: 'https://example.com/x',
  });
  assert.equal(r.isValid, false);
  assert.match(r.errors.join(' '), /byte body limit/);
});

test('validateSubmission: rejects text bodies that contain credential-like strings', () => {
  // SENSITIVE_TEXT matches "password=hunter2", "api_key=abc", etc.
  // AWS_SECRET_ACCESS_KEY=AKIA1234 alone does not match because the regex
  // requires the keyword to be exactly "password"/"api_key"/etc., not
  // a substring inside a longer identifier.
  const r = validateSubmission({
    sourceId: 'civilview',
    kind: 'text',
    body: 'api_key=abc123',
    sourceUrl: 'https://example.com/x',
  });
  assert.equal(r.isValid, false);
  assert.match(r.errors.join(' '), /appears to contain a credential/);
});

test('validateSubmission: rejects non-HTTPS sourceUrl', () => {
  const r = validateSubmission({
    sourceId: 'civilview',
    kind: 'text',
    body: 'plain text',
    sourceUrl: 'http://insecure.example.com/x',
  });
  assert.equal(r.isValid, false);
  assert.match(r.errors.join(' '), /sourceUrl/);
});

test('validateSubmission: rejects a capturedAt more than 10 minutes in the future', () => {
  const futureIso = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const r = validateSubmission({
    sourceId: 'civilview',
    kind: 'text',
    body: 'plain text',
    sourceUrl: 'https://example.com/x',
    capturedAt: futureIso,
  });
  assert.equal(r.isValid, false);
  assert.match(r.errors.join(' '), /cannot be in the future/);
});

test('validateSubmission: rejects an unparseable capturedAt', () => {
  const r = validateSubmission({
    sourceId: 'civilview',
    kind: 'text',
    body: 'plain text',
    sourceUrl: 'https://example.com/x',
    capturedAt: 'not a date',
  });
  assert.equal(r.isValid, false);
  assert.match(r.errors.join(' '), /ISO-8601 timestamp/);
});

test('validateSubmission: JSON kind rejects invalid JSON body', () => {
  const r = validateSubmission({
    sourceId: 'civilview',
    kind: 'json',
    body: '{not valid json',
    sourceUrl: 'https://example.com/x',
  });
  assert.equal(r.isValid, false);
  assert.match(r.errors.join(' '), /valid JSON/);
});

test('validateSubmission: JSON kind accepts a records array', () => {
  const r = validateSubmission({
    sourceId: 'civilview',
    kind: 'json',
    records: [{ a: 1 }, { b: 2 }],
    sourceUrl: 'https://example.com/x',
  });
  assert.equal(r.isValid, true);
  assert.equal(r.value.original.records.length, 2);
});

test('validateSubmission: JSON kind rejects records with non-finite values', () => {
  const r = validateSubmission({
    sourceId: 'civilview',
    kind: 'json',
    records: [{ big: Number.POSITIVE_INFINITY }],
    sourceUrl: 'https://example.com/x',
  });
  assert.equal(r.isValid, false);
  assert.match(r.errors.join(' '), /bounded, finite JSON values/);
});

test('validateSubmission: happy path for a minimal text submission', () => {
  // Use a real catalog source so the lookup succeeds without needing
  // customSource metadata.
  const r = validateSubmission({
    sourceId: 'civilview',
    kind: 'text',
    body: 'plain text evidence body',
    sourceUrl: 'https://example.com/x',
  });
  assert.equal(r.isValid, true);
  assert.deepEqual(r.errors, []);
  assert.ok(r.value.capturedAt);
});
