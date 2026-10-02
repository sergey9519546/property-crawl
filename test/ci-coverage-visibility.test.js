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
  assert.match(out, /NON-JS test files not reached/);
  assert.match(out, /scrapling_parser_test\.py/);
  // It must also still say something true about the JS half.
  assert.match(out, /\[test-coverage\]/);
});
