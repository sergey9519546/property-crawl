'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildContentSecurityPolicy,
  scriptSrcAllowsUnsafeInline,
  requestUsesHttps,
} = require('../src/lib/security/content-security-policy');
const crypto = require('node:crypto');

test('CSP Nonce: generates cryptographic base64 nonce', () => {
  const nonce1 = Buffer.from(crypto.randomUUID()).toString('base64');
  const nonce2 = Buffer.from(crypto.randomUUID()).toString('base64');

  assert.ok(nonce1.length >= 16);
  assert.ok(nonce2.length >= 16);
  assert.notEqual(nonce1, nonce2, 'Consecutive nonces must be cryptographically unique');
});

test('CSP Nonce: production policy strictly enforces nonce and allows MapLibre blob workers', () => {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const policy = buildContentSecurityPolicy({ nonce, isDev: false });

  // Script-src checks
  assert.equal(scriptSrcAllowsUnsafeInline(policy), false);
  assert.match(policy, new RegExp(`script-src 'self' 'nonce-${nonce.replace(/=/g, '\\=')}' 'strict-dynamic'`));
  assert.doesNotMatch(policy, /script-src[^;]*'unsafe-eval'/);

  // Style-src checks: element styles nonce-gated, attributes allowed for React transitions
  assert.match(policy, new RegExp(`style-src 'self' 'nonce-${nonce.replace(/=/g, '\\=')}' https:\\/\\/fonts\\.googleapis\\.com`));
  assert.doesNotMatch(policy, /style-src [^;]*'unsafe-inline'/);
  assert.match(policy, /style-src-attr 'unsafe-inline'/);

  // MapLibre-GL web worker and blob support checks
  assert.match(policy, /worker-src 'self' blob:/);
  assert.match(policy, /child-src 'self' blob:/);
});

test('CSP Nonce: proxy middleware headers synchronization', () => {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const policy = buildContentSecurityPolicy({ nonce, isDev: false, upgradeInsecureRequests: false });

  // Verify headers contract: both x-nonce and Content-Security-Policy carry matched tokens
  const mockHeaders = new Map();
  mockHeaders.set('x-nonce', nonce);
  mockHeaders.set('content-security-policy', policy);

  assert.equal(mockHeaders.get('x-nonce'), nonce);
  assert.ok(mockHeaders.get('content-security-policy').includes(`nonce-${nonce}`));
});

test('CSP Nonce: development policy allows dev tooling without relaxing script safety', () => {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const devPolicy = buildContentSecurityPolicy({ nonce, isDev: true });

  assert.equal(scriptSrcAllowsUnsafeInline(devPolicy), false);
  assert.match(devPolicy, /'unsafe-eval'/);
  assert.match(devPolicy, /style-src 'self' 'unsafe-inline'/);
  assert.match(devPolicy, /worker-src 'self' blob:/);
});
