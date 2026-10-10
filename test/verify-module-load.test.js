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

// --- verify.js must not report "not run" as "passed" ---

// Same shape as the gap above, one layer up. verify.js counts suites by exit
// code, and a suite whose tests are all skipped exits 0 - so "50/50 Suites
// Passed (0 Failed)" was produced while roughly fifteen tests gated on
// DATABASE_URL never executed. A summary that cannot tell "verified" from
// "never ran" is a false all-clear.
// Assert the behaviour, not the text of the script. Checking that verify.js
// contains a particular sentence is the same mistake this file already
// documents one layer down: it passes while the sentence sits in a module the
// runner never reads. Require the helper instead, and assert it is the same one
// verify.js imports.
test('the verifier summary reports skipped tests instead of folding them into passes', () => {
  const { skippedIn, skippedNote } = require('../scripts/verify-summary');
  const verifySource = require('node:fs').readFileSync(path.join(ROOT, 'test', 'verify.js'), 'utf8');
  assert.match(
    verifySource,
    /require\('\.\.\/scripts\/verify-summary'\)/,
    'verify.js must use the shared summary helper rather than its own copy',
  );
  assert.match(
    verifySource,
    /skippedNote\(skippedSuites\)/,
    'verify.js must print the skip note in its summary',
  );
  // The parser itself is exercised against real reporter output in the next
  // test. It is not re-derived here by spawning a nested `node --test`: inside
  // the runner, a child test process reports differently and this assertion
  // would be testing the harness rather than the contract.
  const note = skippedNote([{ name: 'suite', skipped: 2 }]);
  assert.match(note, /not a passing test/);
  assert.match(note, /2 test\(s\) were SKIPPED/);
});

test('the skip counter reads the reporter line and ignores clean output', () => {
  const { skippedIn } = require('../scripts/verify-summary');
  const { spawnSync } = require('node:child_process');
  assert.equal(skippedIn('ℹ skipped 3\nℹ pass 10\n'), 3);
  assert.equal(skippedIn('# skipped 1\n# pass 4\n'), 1);
  assert.equal(skippedIn('ℹ pass 10\nℹ fail 0\n'), 0);
  assert.equal(skippedIn(undefined), 0);
  // Against a real gated run. NODE_TEST_CONTEXT is stripped because this file
  // is itself running under the runner, and a grandchild that inherits it
  // reports differently - the assertion would then be testing the harness.
  // The database env chain is stripped for the opposite reason: with a real
  // server configured the gated suite RUNS instead of skipping, and this
  // contract is about the default no-database configuration - the one CI and
  // every fresh checkout see.
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  delete env.DISCOVERY_TEST_DATABASE_URL;
  delete env.TEST_DATABASE_URL;
  delete env.DATABASE_URL;
  const run = spawnSync('node', ['--test', 'test/discovery-acceptance-restart.test.js'], { encoding: 'utf8', env });
  assert.ok(
    skippedIn(`${run.stdout || ''}\n${run.stderr || ''}`) > 0,
    'a suite gated on DATABASE_URL must register as skipped, not as a pass',
  );
});

test('the skip note is absent when nothing was skipped', () => {
  const { skippedNote } = require('../scripts/verify-summary');
  assert.equal(skippedNote([]), '');
  const note = skippedNote([{ name: '9. Some Suite', skipped: 2 }]);
  assert.match(note, /2 test\(s\) were SKIPPED/);
  assert.match(note, /9\. Some Suite \(2\)/);
  assert.match(note, /not a passing test/);
});
