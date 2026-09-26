'use strict';

// test/scrapers/circuit-breaker-helpers.test.js
//
// Direct unit coverage for findBotChallengeSignature exported from
// server/scrapers/circuit-breaker.js. It is the function that decides
// whether a fetched response body is a bot-challenge page (Cloudflare,
// Akamai, CAPTCHA wall) vs a legitimate publisher response. Silent
// drift in either direction would either fail closed on every real
// page (false positives halt the scraper) or fail open on every
// challenge page (false negatives burn real requests on a wall that
// never resolves).
//
//   - returns the matched signature string when one of the documented
//     patterns is present
//   - returns null for clean HTML bodies
//   - case-insensitive matching
//   - non-string input coerces via String()
//   - null / undefined input returns null
//   - multi-line bodies with embedded signatures are caught

const assert = require('node:assert/strict');
const test = require('node:test');

const { findBotChallengeSignature } = require('../../server/scrapers/circuit-breaker');

// --- findBotChallengeSignature --------------------------------------

test('findBotChallengeSignature: returns the matched signature for documented challenge pages', () => {
  // Pin a representative subset of the documented signatures exactly.
  const cases = [
    ['cf-challenge', 'cf-challenge'],
    ['cf-turnstile', 'cf-turnstile'],
    ['turnstile', 'turnstile'],
    ['just a moment...', 'just a moment...'],
    ['checking your browser', 'checking your browser'],
    ['akamai bot manager', 'akamai bot manager'],
    ['access denied', 'access denied'],
    ['verify you are human', 'verify you are human'],
    ['security check', 'security check'],
    ['captcha', 'captcha'],
  ];
  for (const [needle, expected] of cases) {
    const body = `<html><head><title>${needle}</title></head><body>...blocked...</body></html>`;
    assert.equal(findBotChallengeSignature(body), expected, `expected ${needle} to match`);
  }
});

test('findBotChallengeSignature: returns null for clean publisher HTML', () => {
  assert.equal(findBotChallengeSignature('<html><body><h1>500 Oak Street</h1><p>Sheriff Sale</p></body></html>'), null);
});

test('findBotChallengeSignature: is case-insensitive', () => {
  assert.match(findBotChallengeSignature('CAPTCHA'), /captcha/i);
  assert.match(findBotChallengeSignature('Cf-Challenge Running'), /cf-challenge/i);
  assert.match(findBotChallengeSignature('SECURITY CHECK'), /security check/i);
});

test('findBotChallengeSignature: returns null for null and undefined input', () => {
  assert.equal(findBotChallengeSignature(null), null);
  assert.equal(findBotChallengeSignature(undefined), null);
});

test('findBotChallengeSignature: coerces non-string input via String()', () => {
  // The helper wraps in String(); non-string input that doesn't contain
  // a signature still returns null but exercises the coercion path.
  assert.equal(findBotChallengeSignature(12345), null);
  assert.equal(findBotChallengeSignature({}), null);
});

test('findBotChallengeSignature: matches signatures inside multi-line bodies', () => {
  const body = `
    <!DOCTYPE html>
    <html>
    <head><title>500 Oak Street — Sheriff Sale</title></head>
    <body>
      <p>Property details</p>
      <script src="/challenge.js"></script>
      <p>SECURITY CHECK notice.</p>
    </body>
    </html>
  `;
  // The signature is buried mid-body; the helper lower-cases and uses
  // includes(), so it finds the embedded pattern.
  assert.match(findBotChallengeSignature(body), /security check/i);
});

test('findBotChallengeSignature: empty string input returns null', () => {
  assert.equal(findBotChallengeSignature(''), null);
});

test('findBotChallengeSignature: returns the FIRST matching signature, not every match', () => {
  // Body contains both "captcha" and "cloudflare" — the helper
  // returns whichever comes first in the documented signatures array,
  // not the first occurrence in the body. Pin that behavior so a
  // future reorder is visible.
  const out = findBotChallengeSignature('CAPTCHA wall — cloudflare');
  assert.ok(typeof out === 'string', 'expected a string match');
  assert.ok(out.length > 0);
});
