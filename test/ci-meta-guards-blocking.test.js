'use strict';
// test/ci-meta-guards-blocking.test.js
//
// Regression guard for the defect this file is named after: the gate that
// certifies "CI covers every test file" could not fail CI.
//
// .github/workflows/ci.yml had exactly one blocking job, unit-gate. That job
// never ran `npm test`, and so never reached test/verify.js, and so never ran
// verify-test-coverage.js -- the script whose own header says it exists because
// "a test file wired into a test:* script that verify.js never calls is NOT
// executed in CI".
//
// The one job that did run `npm test` was extended-suite, which carries
// continue-on-error: true. deploy.yml then gates on
// workflow_run.conclusion == 'success', which is satisfied even when
// extended-suite fails. Net effect: every meta-guard in the repo (test-wiring,
// no-vacuous-tests, ci-test-coverage, verify-gate-*, raw-payload-honesty,
// api-reachability, honest-empty-state) could fail and CI would stay green.
//
// This asserts the invariant structurally, against the workflow file, so the
// suite cannot be quietly demoted back to advisory by editing ci.yml.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const pkg = require('../package.json');

function readWorkflow(name) {
  return fs.readFileSync(path.join(ROOT, '.github', 'workflows', name), 'utf8');
}

/** Split a workflow into its jobs, keeping the body of each. */
function jobs(yaml) {
  const found = [];
  const re = /^  ([A-Za-z0-9_-]+):\s*$/gm;
  let match;
  const starts = [];
  while ((match = re.exec(yaml)) !== null) starts.push({ name: match[1], index: match.index });
  starts.forEach((entry, i) => {
    const end = i + 1 < starts.length ? starts[i + 1].index : yaml.length;
    found.push({ name: entry.name, body: yaml.slice(entry.index, end) });
  });
  return found;
}

/**
 * Drop YAML comment lines before asserting on job bodies.
 *
 * A comment explaining *why* the meta-guards are blocking naturally contains the
 * phrase "continue-on-error: true" -- the very thing being ruled out. Matching
 * raw text would make the explanatory comment fail its own guard.
 */
function withoutComments(body) {
  return body.split(/\r?\n/).filter(line => !/^\s*#/.test(line)).join('\n');
}

test('a blocking CI job runs the verification meta-guards', () => {
  const ci = readWorkflow('ci.yml');
  const all = jobs(ci);
  assert.ok(all.length > 0, 'could not parse any jobs out of ci.yml');

  const running = all.filter(j => /run:\s*npm run test:meta-guards/.test(withoutComments(j.body)));
  assert.ok(running.length > 0,
    'no CI job runs `npm run test:meta-guards`, so the guards about the guards are unobserved');

  for (const job of running) {
    assert.doesNotMatch(withoutComments(job.body), /continue-on-error:\s*true/,
      `job '${job.name}' runs test:meta-guards but is continue-on-error, so its failures are discarded`);
  }
});

test('the meta-guard runner exists and is wired to the CI job', () => {
  assert.ok(pkg.scripts['test:meta-guards'],
    'package.json is missing the test:meta-guards runner that ci.yml invokes');
  assert.match(pkg.scripts['test:meta-guards'], /^node --test /,
    'test:meta-guards must be a plain --test runner so its exit code is trustworthy');
});

test('the meta-guard runner covers the guards that audit the verification layer', () => {
  // If a guard is added to the repo but omitted here, it would be back to
  // running only in the advisory job. test-wiring.test.js proves each of these
  // is referenced by *some* runner; this proves the load-bearing ones are in
  // the blocking one.
  const runner = pkg.scripts['test:meta-guards'];
  const required = [
    'test/test-wiring.test.js',
    'test/no-vacuous-tests.test.js',
    'test/ci-test-coverage.test.js',
    'test/verify-gate-classify.test.js',
    'test/verify-gate-changed-files.test.js',
    'test/verify-gate-git-failure.test.js',
    'test/verify-module-load.test.js',
    'test/raw-payload-honesty.test.js',
    'test/api-reachability.test.js',
    'test/honest-empty-state.test.js',
  ];
  const missing = required.filter(f => !runner.includes(f));
  assert.deepEqual(missing, [],
    'these guards are absent from test:meta-guards, so a failure in them cannot block CI');
});

test('deploy does not treat an advisory failure as a successful workflow', () => {
  // documents that the deploy gate reads workflow_run.conclusion, which is the
  // value that made extended-suite failures invisible in the first place.
  const files = fs.readdirSync(path.join(ROOT, '.github', 'workflows'));
  const deploy = files.filter(f => f.startsWith('deploy'));
  assert.ok(deploy.length > 0, 'expected a deploy workflow');
  for (const f of deploy) {
    const body = readWorkflow(f);
    if (!/workflow_run/.test(body)) continue;
    assert.match(body, /conclusion/,
      `${f} gates on workflow_run but never inspects the conclusion`);
  }
});