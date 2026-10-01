'use strict';
// test/quality-gate-classify.test.js
//
// Regression guard: the quality gate laundered real failures as "env skipped".
//
// scripts/quality-gate-report.js classified a failing suite with
//
//     const envMissing = Boolean(suite.envRequired) && !process.env[suite.envRequired];
//     status: envMissing ? 'skip_env' : 'fail'
//
// That asks the ENVIRONMENT, never the error. Three suites carry an
// envRequired: db-pg (DATABASE_URL), discovery-backend and discovery-ops
// (DISCOVERY_TEST_DATABASE_URL). In CI none of those is set, so every failure in
// those suites -- a real broken assertion in discovery-worker.test.js, a failing
// db.test.js round-trip -- was relabelled skip_env, counted into `skip`, left
// `fail` at 0, and the gate exited 0. The `reason` string was computed and
// printed, and nothing acted on it.
//
// This is the same shape as every other defect in this repo: a mechanism
// reporting success on a path it never exercised.

const assert = require('node:assert/strict');
const test = require('node:test');

const { classifySuiteFailure, reportedTestFailure, SUITES } = require('../scripts/quality-gate-report');

// Real node:test output shapes, captured from actual runs in this repo.
const CLEAN_WITH_SKIP = `
✔ some passing test (1.2ms)
﹣ promotion requires durable scope evidence (0.4ms) # SKIP
ℹ tests 20
ℹ pass 19
ℹ fail 0
ℹ skipped 1
`;

const REAL_FAILURE = `
✔ some passing test (1.2ms)
✖ worker rejects stores that expose only the legacy contract (3.1ms)
  AssertionError [ERR_ASSERTION]: expected 'ok' to equal 'nope'
ℹ tests 20
ℹ pass 19
ℹ fail 1
ℹ skipped 0
`;

const TAP_FAILURE = `
# tests 3
# pass 2
# fail 1
not ok 1 - the thing it promised
  ---
  error:
    code: 'ERR_ASSERTION'
`;

test('a suite reporting failed tests is a failure, even with the env var unset', () => {
  // The regression. DATABASE_URL is unset in CI, so this returned skip_env and
  // the gate exited 0 on a genuinely broken suite.
  assert.equal(classifySuiteFailure(REAL_FAILURE, 'DATABASE_URL', undefined), 'fail',
    'a real test failure must never be relabelled as an env skip');
  assert.equal(classifySuiteFailure(REAL_FAILURE, 'DISCOVERY_TEST_DATABASE_URL', ''), 'fail',
    'an empty-string env var is still "unset" and must not excuse a real failure');
});

test('a suite that cleanly skipped remains an env skip', () => {
  // The behaviour that must be preserved: discovery-ops really does report
  // "fail 0, skipped 1" with DISCOVERY_TEST_DATABASE_URL unset, and must stay a
  // skip rather than becoming a spurious failure.
  assert.equal(classifySuiteFailure(CLEAN_WITH_SKIP, 'DISCOVERY_TEST_DATABASE_URL', undefined), 'skip_env');
});

test('TAP-style failure counts are detected', () => {
  assert.equal(reportedTestFailure(TAP_FAILURE), true, 'a "# fail 1" summary is a failure');
  assert.equal(classifySuiteFailure(TAP_FAILURE, 'DATABASE_URL', undefined), 'fail');
});

test('a clean run with the env present is not a failure', () => {
  assert.equal(reportedTestFailure(CLEAN_WITH_SKIP), false, 'fail 0 is not a failure');
  assert.equal(classifySuiteFailure(CLEAN_WITH_SKIP, 'DATABASE_URL', 'postgres://x'), 'fail',
    'a suite that exits non-zero without a recognisable summary is still a failure');
});

test('every env-gated suite in SUITES is one this rule can misjudge', () => {
  // Documents the blast radius. If a new envRequired suite is added, it
  // inherits the same exposure, so this fails loudly rather than silently.
  const envGated = SUITES.filter(s => s.envRequired).map(s => s.id);
  assert.ok(envGated.length > 0, 'expected at least one env-gated suite');
  for (const id of envGated) {
    assert.equal(classifySuiteFailure(REAL_FAILURE, 'SOME_UNSET_VAR', undefined), 'fail',
      `suite '${id}' would have its failures hidden when its env var is unset`);
  }
});
