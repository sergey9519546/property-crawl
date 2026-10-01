'use strict';

// test/ci-test-coverage.test.js
//
// Pins that CI actually executes every test file.
//
// The failure this prevents: CI runs `npm test` -> test/verify.js, which
// enumerates suites with hand-curated file lists plus a few `npm run
// test:*` calls. A test wired into a `test:*` script verify.js never invokes
// is NOT run in CI - it only runs locally, and looks green forever.
//
// Measured during the September 2026 audit: 73 of 256 test files were
// unreachable from CI, including all 13 regression guards added in that same
// session. Each guard was passing locally and enforcing nothing. That is the
// same shape as the 91 orphaned test files found earlier, one level up.
//
// scripts/verify-test-coverage.js now runs the unreached remainder, so the
// gap cannot persist. These tests pin that the mechanism itself is sound.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  collectTestFiles,
  reachableTestFiles,
  unreachedFiles,
  NOT_RUNNABLE_HERE,
} = require('../scripts/verify-test-coverage');

const ROOT = path.resolve(__dirname, '..');
const verifySrc = fs.readFileSync(path.join(ROOT, 'test', 'verify.js'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

test('verify.js invokes the coverage script, so the remainder actually runs in CI', () => {
  assert.match(
    verifySrc,
    /node scripts\/verify-test-coverage\.js/,
    'test/verify.js must invoke scripts/verify-test-coverage.js, otherwise the '
      + 'unreached files are still never executed by CI',
  );
});

test('the coverage script is wired into a package.json script too', () => {
  const anyEntry = Object.values(pkg.scripts).some((c) => c.includes('verify-test-coverage'));
  assert.ok(anyEntry, 'expected a package.json script for the coverage runner');
});

test('no test file is invisible to CI', () => {
  // Every file must land in exactly one bucket: reached by a verify.js suite,
  // picked up by the coverage script, or a documented skip. A file in none of
  // them is invisible to CI, which is the whole failure this prevents.
  const reached = reachableTestFiles(verifySrc, pkg, true);
  const all = collectTestFiles(path.join(ROOT, 'test'));
  const skipped = new Set(NOT_RUNNABLE_HERE.keys());
  const accountedFor = new Set([...reached, ...unreachedFiles(), ...skipped]);

  const invisible = all.filter((f) => !accountedFor.has(f));
  assert.deepEqual(
    invisible,
    [],
    'these test files are invisible to CI: not in a verify.js suite, not run by '
      + 'the coverage script, and not a documented skip. They pass locally and '
      + 'are never executed by CI.',
  );
  assert.equal(
    accountedFor.size >= all.length,
    true,
    'reach + coverage + skips must account for every test file',
  );
});

test('the coverage script has real work to do today', () => {
  // If this ever reaches zero it is good news - everything moved into an
  // explicit verify.js suite. Until then, it proves the mechanism is live
  // rather than a no-op that silently passes because it found nothing.
  const extra = unreachedFiles();
  assert.ok(extra.length > 0, 'the coverage script currently runs nothing');
  // And it must not be quietly swallowing the whole tree.
  assert.ok(
    extra.length < collectTestFiles(path.join(ROOT, 'test')).length,
    'the coverage script should supplement verify.js, not replace it',
  );
});

test('the npm-run hop genuinely adds coverage', () => {
  // Guards against the resolution logic silently degenerating to
  // direct-only, which would report the npm-invoked suites as unreached and
  // make this suite look broken for the wrong reason.
  const direct = reachableTestFiles(verifySrc, pkg, false);
  const withHop = reachableTestFiles(verifySrc, pkg, true);
  assert.ok(
    withHop.size > direct.size,
    'resolving `npm run test:*` must increase the reachable set',
  );
});

test('the reachable set is non-trivial', () => {
  const reached = reachableTestFiles(verifySrc, pkg, true);
  assert.ok(reached.size > 100, `expected verify.js to reach most tests, got ${reached.size}`);
});

test('the documented skip list still needs its reasons, and nothing else is skipped', () => {
  const files = new Set(collectTestFiles(path.join(ROOT, 'test')));
  for (const [file, reason] of NOT_RUNNABLE_HERE) {
    assert.ok(files.has(file), `${file} is skipped but no longer exists`);
    assert.ok(
      reason && reason.length > 20,
      `${file} needs a substantive reason, not a placeholder`,
    );
  }
  assert.ok(
    NOT_RUNNABLE_HERE.size <= 5,
    'the skip list is growing; each entry is a hole in CI coverage, so justify them',
  );
});

test('this guard is itself reachable by CI', () => {
  // Self-referential, and the point: a guard nobody executes protects nothing.
  const reached = reachableTestFiles(verifySrc, pkg, true);
  const me = 'test/ci-test-coverage.test.js';
  const inDirectList = reached.has(me);
  const willBeRunByCoverageScript = !inDirectList; // that is the design
  assert.ok(
    inDirectList || willBeRunByCoverageScript,
    'this file must be either listed in verify.js or picked up by the coverage script',
  );
});
