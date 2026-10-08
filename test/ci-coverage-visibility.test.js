'use strict';

// test/ci-coverage-visibility.test.js
//
// scripts/verify-test-coverage.js exists because a test file wired into
// nothing looks exactly like a passing test. Its collector matched only
// *.test.js / *.test.mjs, so every non-JS test in test/ was invisible to it -
// including test/scrapling_parser_test.py, the only direct test of the
// Scrapling parser, which is unwired and fails when run with the wrong
// interpreter. A coverage tool that cannot see a language cannot report on it.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'verify-test-coverage.js');
const { collectTestFiles, partitionUnreached } = require('../scripts/verify-test-coverage');
const verifySrc = fs.readFileSync(path.join(ROOT, 'test', 'verify.js'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

test('the collector sees Python test files', () => {
  const found = collectTestFiles(path.join(ROOT, 'test'));
  // Assembled from fragments: this file lives in the test/ tree the collector
  // scans, and a literal here would make the assertion partly self-fulfilling.
  const target = ['scrapling', 'parser', 'test.py'].join('_');
  assert.ok(
    found.includes(`test/${target}`),
    `the collector must find test/${target}; it only found ${found.length} test files`
  );
});

test('the collector sees the Playwright and UI suites too', () => {
  const found = collectTestFiles(path.join(ROOT, 'test'));
  for (const name of [['playwright', 'test.py'], ['next', 'ui', 'e2e', 'test.py'], ['discovery', 'ui', 'regression', 'test.py']]) {
    const file = name.join('_');
    assert.ok(found.includes(`test/${file}`), `the collector must find test/${file}`);
  }
});

test('the collector still finds every JS test it used to', () => {
  const found = collectTestFiles(path.join(ROOT, 'test'));
  for (const name of ['coverage-matrix.test.js', 'schema-mirror-contract.test.js', 'no-vacuous-tests.test.js']) {
    assert.ok(found.includes(`test/${name}`), `the collector must still find test/${name}`);
  }
  assert.ok(found.length > 150, `expected the full JS suite plus the others, saw ${found.length}`);
});

test('non-JS tests are reported rather than handed to node --test', () => {
  // `node --test test/foo.py` fails for the wrong reason, which is a worse lie
  // than saying nothing. They must be surfaced, not executed.
  const { runnable, other } = partitionUnreached();
  assert.ok(runnable.length > 0);
  for (const f of runnable) assert.match(f, /\.(js|mjs|cjs)$/, `${f} would be passed to node --test`);
  for (const f of other) assert.doesNotMatch(f, /\.(js|mjs|cjs)$/);
  assert.ok(
    other.some((f) => f.endsWith('.py')),
    'the Python suites must appear in the reported-only list'
  );
});

test('the script prints the non-JS list instead of silently dropping it', () => {
  const out = execFileSync(process.execPath, [SCRIPT], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  assert.match(out, /NON-JS test files the gate does not execute/);
  assert.match(out, /scrapling_parser_test\.py/);
  // It must also still say something true about the JS half.
  assert.match(out, /\[test-coverage\]/);
});

test('the report does not claim CI runs none of them', () => {
  // It used to print "These are tests that nothing in CI executes" about every
  // entry, which was false: gate suite 11 runs two of them by spawning them
  // from run-ui-suite.js. A report that cries wolf about suites CI is running
  // invites the wrong fix -- wiring them a second time -- and hides the one
  // entry that genuinely is orphaned.
  const out = execFileSync(process.execPath, [SCRIPT], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  assert.doesNotMatch(
    out,
    /nothing in CI executes/i,
    'the report must not assert CI runs none of these when it runs two of them',
  );
});

test('a suite the gate spawns is not reported as unwired', () => {
  // Gate suite 11 is `node test/run-ui-suite.js`, which spawns two Python
  // suites by bare name. Resolving only `*.test.mjs` one hop deep reported
  // both as "not reached by verify.js" while CI was executing them.
  const { other } = partitionUnreached();
  for (const suite of ['next_ui_e2e_test.py', 'detail_media_recovery_e2e_test.py']) {
    assert.ok(
      !other.includes(`test/${suite}`),
      `${suite} is spawned by test/run-ui-suite.js, which gate suite 11 runs; `
        + 'reporting it as unwired is false',
    );
  }
});

test('a file this script only NAMES is still reported as unwired', () => {
  // verify-test-coverage.js runs as part of the gate, so a naive second hop
  // reads its own source and absorbs every test name in its comments -- which
  // marked test/scrapling_parser_test.py as covered. This script talks about
  // that file; it does not run it, and `npm run test:scrapling-parser` is not
  // in verify.js. Counting its own prose as coverage would hide a real gap.
  const { other } = partitionUnreached();
  assert.ok(
    other.includes('test/scrapling_parser_test.py'),
    'scrapling_parser_test.py is wired to an npm script the gate never calls; '
      + 'it must keep being reported',
  );
});

test('reachableTestFiles resolves names to real paths and refuses ambiguous ones', () => {
  // Regression: the extractor once matched only the `.test.js` SUFFIX, so it
  // returned "test.js" for `node test/server.test.js` and reached nothing.
  const { reachableTestFiles } = require('../scripts/verify-test-coverage');
  const reached = reachableTestFiles("{ name: 'x', cmd: 'node --test test/server.test.js' }", pkg);
  assert.ok(reached.has('test/server.test.js'), 'the full path must resolve');
  assert.ok(
    !reached.has('server.test.js'),
    'the resolved set must hold real paths, not bare basenames -- a basename left '
      + 'in place is what let one file vouch for a different file of the same name',
  );

  // An unambiguous bare name still resolves: run-ui-suite.js spawns its Python
  // suites by bare name, and those ARE run by gate suite 11.
  const bare = reachableTestFiles("spawn('detail_media_recovery_e2e_test.py')", pkg);
  assert.ok(
    bare.has('test/detail_media_recovery_e2e_test.py'),
    'an unambiguous bare basename must resolve to its file',
  );

  // An ambiguous bare name resolves to nothing. validation.test.js exists both
  // under test/scrapers/ and test/security/; "some file with this name is run"
  // is not evidence that a given one is.
  const ambiguous = reachableTestFiles("'validation.test.js'", pkg);
  assert.equal(ambiguous.size, 0, 'an ambiguous basename must claim no file at all, not guess');

  // And a runner is not a suite.
  const { other } = partitionUnreached();
  assert.ok(!other.includes('test/run-ui-suite.js'),
    'run-ui-suite.js is a runner, not a suite, and must not be listed as a test');
});

test('a file sharing a basename with a reached one is not marked covered by it', () => {
  // test/api-rate-policy.test.js is in a gate script;
  // test/security/api-rate-policy.test.js is only in npm run test:evidence-truth,
  // which the gate never calls. Basename matching made the first vouch for the
  // second and quietly retired it from CI.
  const { reachableTestFiles, unreachedFiles } = require('../scripts/verify-test-coverage');
  const reached = reachableTestFiles(verifySrc, pkg, true);
  const unreached = unreachedFiles();
  const twin = 'test/security/api-rate-policy.test.js';

  assert.ok(!reached.has(twin) || !unreached.includes(twin),
    `${twin} cannot be both reached and unreached`);
  assert.ok(
    unreached.includes(twin),
    `${twin} is wired only to npm run test:evidence-truth, which the gate never `
      + 'calls, so it must stay in the set the coverage script executes',
  );
});
