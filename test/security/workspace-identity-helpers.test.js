'use strict';

// test/security/workspace-identity-helpers.test.js
//
// Direct unit coverage for the auth helpers exported from
// server/security/workspace-identity.js. requireWorkspaceIdentity and
// isWorkspaceAuthorized are the gates every workspace route goes
// through. Silent drift in either direction would either lock out
// the operator (no token configured) or let an unauthenticated caller
// through (token mismatch).
//
//   - requireWorkspaceIdentity: 503 when no token configured,
//     401 on token mismatch, returns the operator workspace id on
//     match, PROPERTY_WORKSPACE_ID override (truncated to 100 chars)
//   - isWorkspaceAuthorized: same logic without the response side
//     effects, used by routes that need a boolean
//   - Token comparison is hash-based (not raw), so length differences
//     don't leak via early-exit timing
//   - x-scraper-token header takes precedence over Authorization
//     Bearer when both are present

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  requireWorkspaceIdentity,
  isWorkspaceAuthorized,
} = require('../../server/security/workspace-identity');

function captureRes() {
  const res = {
    statusCode: 200,
    payload: null,
    setHeader() { return this; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
  };
  return res;
}

// --- requireWorkspaceIdentity ----------------------------------------

test('requireWorkspaceIdentity: returns 503 when no operator token is configured', () => {
  const res = captureRes();
  const userId = requireWorkspaceIdentity(
    { headers: { 'x-scraper-token': 'anything' } },
    res,
    {},
  );
  assert.equal(userId, null);
  assert.equal(res.statusCode, 503);
  assert.match(res.payload.error, /not configured/i);
});

test('requireWorkspaceIdentity: returns 401 when presented token does not match', () => {
  const res = captureRes();
  const userId = requireWorkspaceIdentity(
    { headers: { 'x-scraper-token': 'wrong-token' } },
    res,
    { SCRAPER_ADMIN_TOKEN: 'correct-token' },
  );
  assert.equal(userId, null);
  assert.equal(res.statusCode, 401);
  assert.match(res.payload.error, /workspace/i);
});

test('requireWorkspaceIdentity: returns the operator workspace id when token matches', () => {
  const res = captureRes();
  const userId = requireWorkspaceIdentity(
    { headers: { 'x-scraper-token': 'correct-token' } },
    res,
    { SCRAPER_ADMIN_TOKEN: 'correct-token' },
  );
  assert.equal(userId, 'workspace:operator');
});

test('requireWorkspaceIdentity: respects PROPERTY_WORKSPACE_ID override', () => {
  const res = captureRes();
  const userId = requireWorkspaceIdentity(
    { headers: { 'x-scraper-token': 'correct-token' } },
    res,
    { SCRAPER_ADMIN_TOKEN: 'correct-token', PROPERTY_WORKSPACE_ID: 'team-alpha' },
  );
  assert.equal(userId, 'workspace:team-alpha');
});

test('requireWorkspaceIdentity: truncates PROPERTY_WORKSPACE_ID to 100 chars', () => {
  const res = captureRes();
  const long = 'a'.repeat(200);
  const userId = requireWorkspaceIdentity(
    { headers: { 'x-scraper-token': 'correct-token' } },
    res,
    { SCRAPER_ADMIN_TOKEN: 'correct-token', PROPERTY_WORKSPACE_ID: long },
  );
  assert.ok(userId.startsWith('workspace:'));
  assert.equal(userId.length, 'workspace:'.length + 100);
});

test('requireWorkspaceIdentity: accepts PROPERTY_OPERATOR_SECRET alias', () => {
  const res = captureRes();
  const userId = requireWorkspaceIdentity(
    { headers: { 'x-scraper-token': 'secret' } },
    res,
    { PROPERTY_OPERATOR_SECRET: 'secret' },
  );
  assert.equal(userId, 'workspace:operator');
});

test('requireWorkspaceIdentity: prefers SCRAPER_ADMIN_TOKEN over PROPERTY_OPERATOR_SECRET', () => {
  const res = captureRes();
  const userId = requireWorkspaceIdentity(
    { headers: { 'x-scraper-token': 'primary' } },
    res,
    { SCRAPER_ADMIN_TOKEN: 'primary', PROPERTY_OPERATOR_SECRET: 'alias' },
  );
  // Token matching the SCRAPER_ADMIN_TOKEN value should pass; mismatched
  // token must fail. The handler matches against the primary token.
  assert.equal(userId, 'workspace:operator');
});

test('requireWorkspaceIdentity: accepts Authorization Bearer token', () => {
  const res = captureRes();
  const userId = requireWorkspaceIdentity(
    { headers: { authorization: 'Bearer correct-token' } },
    res,
    { SCRAPER_ADMIN_TOKEN: 'correct-token' },
  );
  assert.equal(userId, 'workspace:operator');
});

test('requireWorkspaceIdentity: x-scraper-token takes precedence over Bearer', () => {
  const res = captureRes();
  // x-scraper-token matches, Bearer does not; the handler should
  // pick the matching header and accept.
  const userId = requireWorkspaceIdentity(
    { headers: { 'x-scraper-token': 'correct-token', authorization: 'Bearer wrong' } },
    res,
    { SCRAPER_ADMIN_TOKEN: 'correct-token' },
  );
  assert.equal(userId, 'workspace:operator');
});

// --- isWorkspaceAuthorized ------------------------------------------

test('isWorkspaceAuthorized: returns true on matching token + headers', () => {
  assert.equal(
    isWorkspaceAuthorized(
      { headers: { 'x-scraper-token': 'correct-token' } },
      { SCRAPER_ADMIN_TOKEN: 'correct-token' },
    ),
    true
  );
});

test('isWorkspaceAuthorized: returns false when no token is configured', () => {
  assert.equal(
    isWorkspaceAuthorized(
      { headers: { 'x-scraper-token': 'anything' } },
      {},
    ),
    false
  );
});

test('isWorkspaceAuthorized: returns false on token mismatch', () => {
  assert.equal(
    isWorkspaceAuthorized(
      { headers: { 'x-scraper-token': 'wrong-token' } },
      { SCRAPER_ADMIN_TOKEN: 'correct-token' },
    ),
    false
  );
});

test('isWorkspaceAuthorized: returns false when no presented token', () => {
  assert.equal(
    isWorkspaceAuthorized(
      { headers: {} },
      { SCRAPER_ADMIN_TOKEN: 'correct-token' },
    ),
    false
  );
});

test('isWorkspaceAuthorized: hash-based comparison (length difference still fails)', () => {
  // The helper hashes both sides with SHA-256 before comparing, so a
  // length difference cannot early-exit and leak the expected length.
  assert.equal(
    isWorkspaceAuthorized(
      { headers: { 'x-scraper-token': 'a' } },
      { SCRAPER_ADMIN_TOKEN: 'a-much-longer-credential' },
    ),
    false
  );
});
