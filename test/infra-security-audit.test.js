'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { resolveOperatorToken, operatorTokenConfigured } = require('../server/security/operator-token');
const { tokensMatch, presentedRunToken } = require('../server/routes/scrapers');
const { isPrivateOrLocalHost } = require('../server/scrapers/scrapling-bridge');
const { isBlockedSsrfHost, validatePublicHttpsUrl } = require('../server/scrapers/zyte-client');
const { buildContentSecurityPolicy, scriptSrcAllowsUnsafeInline } = require('../src/lib/security/content-security-policy');
const { resolveNodeOptions, detectAvailableMemoryMb } = require('../scripts/start-production');

test('Security & Auth: operator credentials resolve with fail-closed semantics', () => {
  // Empty or unset environment fails closed
  assert.equal(operatorTokenConfigured({}), false);
  assert.equal(operatorTokenConfigured({ SCRAPER_ADMIN_TOKEN: '' }), false);
  assert.equal(operatorTokenConfigured({ SCRAPER_ADMIN_TOKEN: '   ' }), false);
  assert.equal(operatorTokenConfigured({ PROPERTY_OPERATOR_SECRET: '' }), false);

  // Primary SCRAPER_ADMIN_TOKEN resolution
  assert.equal(resolveOperatorToken({ SCRAPER_ADMIN_TOKEN: 'primary-token' }), 'primary-token');

  // Alias PROPERTY_OPERATOR_SECRET resolution when primary is unset
  assert.equal(resolveOperatorToken({ PROPERTY_OPERATOR_SECRET: 'alias-token' }), 'alias-token');

  // Primary wins when both are provided
  assert.equal(resolveOperatorToken({ SCRAPER_ADMIN_TOKEN: 'pri', PROPERTY_OPERATOR_SECRET: 'alt' }), 'pri');

  // Timing safe equal check
  assert.equal(tokensMatch('secret-123', 'secret-123'), true);
  assert.equal(tokensMatch('secret-123', 'secret-456'), false);
  assert.equal(tokensMatch('', 'secret'), false);
  assert.equal(tokensMatch(null, 'secret'), false);
  assert.equal(tokensMatch('secret', undefined), false);
});

test('Security & Auth: presentedRunToken extracts Bearer and x-scraper-token headers safely', () => {
  assert.equal(presentedRunToken({ headers: { 'x-scraper-token': 'token-a' } }), 'token-a');
  assert.equal(presentedRunToken({ headers: { authorization: 'Bearer token-b' } }), 'token-b');
  assert.equal(presentedRunToken({ headers: { authorization: 'Basic xyz' } }), '');
  assert.equal(presentedRunToken({ headers: {} }), '');
});

test('Security & SSRF: scrapling-bridge isPrivateOrLocalHost rejects dot-trailing and IPv6 bypasses', () => {
  const blockedHosts = [
    'localhost',
    'localhost.',
    'sub.localhost',
    '127.0.0.1',
    '127.0.0.1.',
    '10.0.0.1',
    '172.16.0.1',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '::1',
    '::',
    '0.0.0.0',
    'printer.local',
    'metadata.internal',
    'test.arpa',
    'fc00::1',
    'fe80::1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '2002:7f00:1::',
  ];

  for (const host of blockedHosts) {
    assert.equal(isPrivateOrLocalHost(host), true, `Host "${host}" must be blocked as private/local`);
  }

  // Public hosts must be permitted
  const allowedHosts = [
    'example.com',
    'hudhomestore.gov',
    'treasury.gov',
    'irsauctions.gov',
    '8.8.8.8',
  ];

  for (const host of allowedHosts) {
    assert.equal(isPrivateOrLocalHost(host), false, `Public host "${host}" must be allowed`);
  }
});

test('Security & CSP: production Content-Security-Policy enforces nonce and strict-dynamic', () => {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const policy = buildContentSecurityPolicy({ nonce, isDev: false });

  // Must not allow unsafe-inline for scripts
  assert.equal(scriptSrcAllowsUnsafeInline(policy), false);

  // Must include the exact nonce and strict-dynamic
  assert.ok(policy.includes(`'nonce-${nonce}'`));
  assert.ok(policy.includes("'strict-dynamic'"));
  assert.ok(!policy.includes("'unsafe-eval'"));

  // Web workers and blobs allowed for MapLibre/GIS
  assert.ok(policy.includes("worker-src 'self' blob:"));
  assert.ok(policy.includes("child-src 'self' blob:"));
});

test('Infrastructure: resolveNodeOptions preserves custom heap limit and defaults to 4096', () => {
  // Default heap limit
  assert.equal(resolveNodeOptions(''), '--max-old-space-size=4096');
  assert.equal(resolveNodeOptions(undefined), '--max-old-space-size=4096');
  assert.equal(resolveNodeOptions('--trace-warnings'), '--trace-warnings --max-old-space-size=4096');

  // Custom limit on constrained hosts (Render 512MB free tier) is strictly preserved
  assert.equal(resolveNodeOptions('--max-old-space-size=512'), '--max-old-space-size=512');
  assert.equal(resolveNodeOptions('--max-old-space-size=384 --trace-warnings'), '--max-old-space-size=384 --trace-warnings');

  // Dynamic memory sizing is bounded safely between 256MB and 4096MB
  const detected = detectAvailableMemoryMb();
  assert.ok(typeof detected === 'number' && Number.isFinite(detected));
  assert.ok(detected >= 256 && detected <= 4096);
});

test('Infrastructure: package.json specifies engines node >=22.0.0', () => {
  const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf8'));
  assert.ok(pkg.engines, 'package.json must contain engines field');
  assert.ok(pkg.engines.node, 'package.json engines must specify node');
  assert.match(pkg.engines.node, />=\s*22/);
});
