'use strict';

// test/routes/scrapers-auth.test.js
//
// Direct unit coverage for the two pure auth helpers exported by
// server/routes/scrapers.js. They back the `requireWorkspaceIdentity` gate
// that fronts every workspace route, so silent behavior drift here
// (different header casing, different Bearer regex, token comparison that
// short-circuits on length) would silently let unauthorized callers
// through. Pin the contract.

const assert = require('node:assert/strict');
const test = require('node:test');

const scrapersRoute = require('../../server/routes/scrapers');
const { presentedRunToken, tokensMatch } = scrapersRoute;

// --- presentedRunToken ------------------------------------------------

test('presentedRunToken: reads from x-scraper-token header', () => {
  assert.equal(presentedRunToken({ headers: { 'x-scraper-token': 'abc123' } }), 'abc123');
});

test('presentedRunToken: returns trimmed value (whitespace stripped)', () => {
  assert.equal(presentedRunToken({ headers: { 'x-scraper-token': '   token   ' } }), 'token');
});

test('presentedRunToken: returns empty string when x-scraper-token is missing', () => {
  assert.equal(presentedRunToken({ headers: {} }), '');
});

test('presentedRunToken: returns empty string when x-scraper-token is whitespace-only', () => {
  assert.equal(presentedRunToken({ headers: { 'x-scraper-token': '   ' } }), '');
});

test('presentedRunToken: reads Bearer token from authorization header', () => {
  assert.equal(presentedRunToken({ headers: { authorization: 'Bearer secret-token-xyz' } }), 'secret-token-xyz');
});

test('presentedRunToken: Bearer regex is case-insensitive', () => {
  assert.equal(presentedRunToken({ headers: { authorization: 'bearer mixed-case' } }), 'mixed-case');
  assert.equal(presentedRunToken({ headers: { authorization: 'BEARER UPPER' } }), 'UPPER');
});

test('presentedRunToken: ignores non-Bearer authorization headers', () => {
  assert.equal(presentedRunToken({ headers: { authorization: 'Basic dXNlcjpwYXNz' } }), '');
  assert.equal(presentedRunToken({ headers: { authorization: 'token-without-scheme' } }), '');
});

test('presentedRunToken: x-scraper-token takes precedence over authorization', () => {
  assert.equal(
    presentedRunToken({ headers: { 'x-scraper-token': 'primary', authorization: 'Bearer secondary' } }),
    'primary'
  );
});

test('presentedRunToken: handles lowercase header key', () => {
  // Headers may come in as lowercase depending on the server; the helper
  // already case-insensitive-looks up the value via headerValue().
  assert.equal(presentedRunToken({ headers: { 'x-scraper-token': 'lowercase-key' } }), 'lowercase-key');
});

test('presentedRunToken: returns the first value when header is an array', () => {
  assert.equal(presentedRunToken({ headers: { 'x-scraper-token': ['first', 'second'] } }), 'first');
});

// --- tokensMatch ------------------------------------------------------

test('tokensMatch: returns false when either side is empty', () => {
  assert.equal(tokensMatch('', 'expected'), false);
  assert.equal(tokensMatch('presented', ''), false);
  assert.equal(tokensMatch('', ''), false);
  assert.equal(tokensMatch(null, 'expected'), false);
  assert.equal(tokensMatch('presented', undefined), false);
});

test('tokensMatch: returns true for identical tokens', () => {
  assert.equal(tokensMatch('abc123', 'abc123'), true);
});

test('tokensMatch: returns false for different tokens of the same length', () => {
  assert.equal(tokensMatch('abc123', 'abc124'), false);
  assert.equal(tokensMatch('a-token', 'b-token'), false);
});

test('tokensMatch: returns false for tokens of different lengths (hash, not raw, compare)', () => {
  // The helper SHA-256s both sides before comparing, so length differences
  // cannot early-return — both hashes are fixed-length and the comparison
  // runs end-to-end. A short token vs a long token must always fail.
  assert.equal(tokensMatch('short', 'a-much-longer-credential'), false);
});

test('tokensMatch: treats numeric-coerced strings consistently with the underlying hash', () => {
  // String coercion protects against numeric token types from headers.
  assert.equal(tokensMatch(12345, '12345'), true);
  assert.equal(tokensMatch(12345, 12345), true);
});
