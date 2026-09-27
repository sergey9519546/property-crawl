'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildContentSecurityPolicy,
  scriptSrcAllowsUnsafeInline,
  requestUsesHttps,
} = require('../src/lib/security/content-security-policy');

test('production script-src uses a nonce and not unsafe-inline', () => {
  const policy = buildContentSecurityPolicy({ nonce: 'abc123', isDev: false });
  assert.equal(scriptSrcAllowsUnsafeInline(policy), false);
  assert.match(policy, /script-src 'self' 'nonce-abc123' 'strict-dynamic'/);
  assert.doesNotMatch(policy, /script-src[^;]*'unsafe-eval'/);
  assert.doesNotMatch(policy, /upgrade-insecure-requests/);
  // Style ELEMENTS are nonce-gated in production; React style attributes are
  // scoped by style-src-attr. No bare 'unsafe-inline' style-src anymore.
  assert.match(policy, /style-src 'self' 'nonce-abc123' https:\/\/fonts\.googleapis\.com/);
  assert.doesNotMatch(policy, /style-src [^;]*'unsafe-inline'/);
  assert.match(policy, /style-src-attr 'unsafe-inline'/);
  assert.match(policy, /font-src 'self' https:\/\/fonts\.gstatic\.com/);
});

test('upgrade-insecure-requests is opt-in for HTTPS only', () => {
  const policy = buildContentSecurityPolicy({
    nonce: 'abc123',
    isDev: false,
    upgradeInsecureRequests: true,
  });
  assert.match(policy, /upgrade-insecure-requests/);
  assert.equal(requestUsesHttps({ nextUrl: { protocol: 'http:' } }), false);
  assert.equal(requestUsesHttps({ nextUrl: { protocol: 'https:' } }), true);
  assert.equal(requestUsesHttps({
    headers: { get: () => 'https' },
    nextUrl: { protocol: 'http:' },
  }), true);
  assert.equal(requestUsesHttps({
    headers: { get: () => 'http, https' },
    nextUrl: { protocol: 'https:' },
  }), false);
});

test('development script-src allows eval but not unsafe-inline', () => {
  const policy = buildContentSecurityPolicy({ nonce: 'devnonce', isDev: true });
  assert.equal(scriptSrcAllowsUnsafeInline(policy), false);
  assert.match(policy, /'unsafe-eval'/);
  assert.doesNotMatch(policy, /upgrade-insecure-requests/);
  // Dev tooling may inject style elements without a nonce, so dev keeps
  // 'unsafe-inline' in style-src; React style attrs stay allowed everywhere.
  assert.match(policy, /style-src 'self' 'unsafe-inline' https:\/\/fonts\.googleapis\.com/);
  assert.match(policy, /style-src-attr 'unsafe-inline'/);
});

test('a missing nonce is rejected', () => {
  assert.throws(() => buildContentSecurityPolicy({ isDev: false }), /nonce is required/);
});
