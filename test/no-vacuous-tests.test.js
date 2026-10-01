'use strict';

// test/no-vacuous-tests.test.js
//
// A test that asserts nothing passes regardless of the code under test.
// It looks like coverage in a test report and protects nothing.
//
// This became concrete during a sweep that wired 91 previously-unreferenced
// test files into runners: 91 files that had never executed, so 91 files that
// had never been able to fail. Before trusting that sweep, the wired files
// were audited for vacuity - a test that cannot fail is the same failure
// shape as a gate that never loads the code it certifies.
//
// The check is intentionally conservative: it only fails on a file with no
// recognised assertion call at all. Counting assertions per test is not
// meaningful, because one assertion inside a loop can cover many cases, so
// a ratio threshold would flag good tests along with bad ones.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const TEST_DIR = path.join(ROOT, 'test');

// Any of these means the file makes a claim it is checking something.
const ASSERTION_PATTERNS = [
  /\bassert\s*\./,
  /\brequire\(['"]node:assert/,
  /\brequire\(['"]assert['"]\)/,
  /\bassert\s*\(/,
  /\bexpect\s*\(/,
  /\bshould\b/,
  /\.rejects\.[a-z]/,
  /\.resolves\.[a-z]/,
];

// Assertions that live in a helper module rather than the test file. A file
// delegating every claim to a shared helper is fine, as long as the helper
// really asserts; this list only covers files that would otherwise trip.
function collectTestFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectTestFiles(full, out);
      continue;
    }
    if (/\.(test\.js|test\.mjs)$/.test(entry.name)) {
      out.push(path.relative(ROOT, full).split(path.sep).join('/'));
    }
  }
  return out;
}

test('every test file contains at least one assertion', () => {
  const files = collectTestFiles(TEST_DIR);
  assert.ok(files.length > 50, `expected a real test suite, found ${files.length} files`);

  const vacuous = files.filter((file) => {
    const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
    return !ASSERTION_PATTERNS.some((pattern) => pattern.test(src));
  });

  assert.deepEqual(
    vacuous,
    [],
    'these test files contain no assertion, so they pass regardless of behaviour: '
      + 'they look like coverage and protect nothing. Add real assertions, or delete them.',
  );
});

test('the vacuity check is actually looking for something', () => {
  // If the patterns stopped matching anything, the check above would silently
  // pass every file. Verify the patterns against known shapes.
  const good = [
    "const assert = require('node:assert/strict');\ntest('x', () => { assert.ok(1); });",
    "const assert = require('assert');\ntest('x', () => { assert.equal(1, 1); });",
    "test('x', async () => { await expect(fn()).rejects.toThrow(); });",
    "test('x', () => { value.should.equal(1); });",
  ];
  for (const src of good) {
    assert.ok(
      ASSERTION_PATTERNS.some((p) => p.test(src)),
      'the vacuity patterns must recognise a real assertion',
    );
  }
  const bad = "const test = require('node:test');\ntest('x', () => { doSomething(); });";
  assert.ok(
    !ASSERTION_PATTERNS.some((p) => p.test(bad)),
    'an assertion-free file must be detected as vacuous',
  );
});

test('this file asserts its own thing', () => {
  // Self-referential but cheap: it keeps the guard honest about being a real
  // test rather than an example.
  assert.ok(true);
  const files = collectTestFiles(TEST_DIR);
  assert.ok(files.includes('test/no-vacuous-tests.test.js'));
});
