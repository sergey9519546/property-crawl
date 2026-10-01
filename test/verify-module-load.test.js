'use strict';

// test/verify-module-load.test.js
//
// Pins the module-load smoke that closes the "certified on code you never ran"
// gap.
//
// Measured against the tree, the runtime gate's fixed suites load 124 of 149
// server/ modules. The other 25 — server/public-records/*, server/crawlers/*,
// server/discovery/onboarding-pass.js, server/forms/store.js,
// server/audit/property-image-routing.js and others — are reached only through
// lazy requires inside request handlers. A change to one of those files was
// classified "runtime", the gate ran three suites, none of which loaded it, and
// the gate printed "All passed: true".
//
// scripts/verify-module-load.js requires the changed modules themselves.

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const {
  isCandidate,
  classifyLoadError,
  loadOne,
} = require('../scripts/verify-module-load');
const { getGate } = require('../scripts/verify-gate');

const ROOT = path.resolve(__dirname, '..');

// --- isCandidate: only project server code the gate can load alone ---

test('isCandidate: accepts server modules', () => {
  for (const f of [
    'server/server.js',
    'server/public-records/florida.js',
    'server/crawlers/onboarding-spider.js',
    'server/routes/parse.js',
  ]) {
    assert.equal(isCandidate(f), true, `${f} should be smoke-loaded`);
  }
});

test('isCandidate: skips Next.js sources, tests, and scripts', () => {
  for (const f of [
    'src/app/page.tsx',
    'src/lib/workspace-proxy.ts',
    'test/suite.test.js',
    'scripts/verify-gate.js',
    'README.md',
    '.dockerignore',
  ]) {
    assert.equal(isCandidate(f), false, `${f} must not be smoke-loaded`);
  }
});

// --- classifyLoadError: config gating must stay narrow ---

test('classifyLoadError: a missing required secret is config-gated, not a failure', () => {
  const r = classifyLoadError("Error: ZILLOW_MCP_API_KEY is required\n    at new ZillowMcpClient");
  assert.equal(r.configGated, true);
});

test('classifyLoadError: real load errors are not mistaken for config gating', () => {
  for (const stderr of [
    "Error: Cannot find module './does-not-exist'",
    "Error: boom at module scope",
    "SyntaxError: Unexpected token ';'",
    "ReferenceError: window is not defined",
  ]) {
    assert.equal(classifyLoadError(stderr).configGated, false, stderr);
  }
});

// --- loadOne: the three failure modes, against real modules ---

test('loadOne: a healthy server module loads', () => {
  const r = loadOne('server/public-records/florida.js');
  assert.equal(r.status, 'loaded');
});

test('loadOne: a module missing from disk fails with a resolution reason', () => {
  const r = loadOne('server/definitely-not-here.js');
  assert.equal(r.status, 'failed');
  assert.match(r.reason, /does not resolve/);
});

test('loadOne: a module requiring a credential reports config-gated', () => {
  // ZillowMcpClient constructs at import time and needs ZILLOW_MCP_API_KEY.
  // That is an environment gap, not a defect in the module.
  const r = loadOne('server/intelligence/zillow-mcp.js');
  assert.ok(
    r.status === 'config-gated' || r.status === 'loaded',
    `unexpected status ${r.status}`,
  );
});

// --- the smoke is actually wired into the gates that need it ---

test('the runtime gate smoke-loads the changed modules', () => {
  const cmds = getGate('runtime').suites.join('\n');
  assert.match(cmds, /verify-module-load\.js/);
});

test('the scraper gate smoke-loads the changed modules', () => {
  const cmds = getGate('scraper').suites.join('\n');
  assert.match(cmds, /verify-module-load\.js/);
});

test('the module-load script exists where the gates invoke it', () => {
  const script = path.join(ROOT, 'scripts', 'verify-module-load.js');
  assert.ok(
    require('node:fs').existsSync(script),
    'scripts/verify-module-load.js is referenced by the gates but does not exist',
  );
});
