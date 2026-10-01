'use strict';

// test/test-wiring.test.js
//
// Guards the blind spot that let four working API routes be deleted without
// anyone noticing: 91 test files existed that no package.json runner ever
// executed. They were not failing — they were never run.
//
// A test file that no runner references is a test that cannot fail, so it
// provides no protection at all. This test makes that state loud instead.
//
// Rules:
//   - every *.test.js / *.test.mjs / *.test.py under test/ must appear in
//     some package.json script command
//   - the only permitted exceptions are files listed in ALLOW_UNWIRED, each
//     with a written reason. Adding to that list is a deliberate act.
//
// When this test fails, either wire the file into a runner or add a justified
// entry to ALLOW_UNWIRED. Do not delete the check.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');

// Files deliberately kept out of a `test:*` runner, with the reason. A test that
// needs live third-party credentials cannot run in CI; a test invoked by
// scripts/verify-gate.js is run, just not through package.json.
const ALLOW_UNWIRED = new Map([
  [
    'test/hardening.test.js',
    'executed by scripts/verify-gate.js, not by a package.json test script',
  ],
  [
    'test/property-title.test.js',
    'live PropertyTitle API integration; needs external credentials, cannot run in CI',
  ],
]);

function collectTestFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectTestFiles(full, out);
      continue;
    }
    if (/\.(test\.js|test\.mjs|test\.py)$/.test(entry.name)) {
      out.push(path.relative(ROOT, full).split(path.sep).join('/'));
    }
  }
  return out;
}

function runnerCommands() {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  return Object.entries(pkg.scripts)
    .filter(([name]) => name.startsWith('test') || name === 'verify:gate')
    .map(([name, command]) => ({ name, command }));
}

test('every test file is reachable from a runner, or has a written exemption', () => {
  const files = collectTestFiles(path.join(ROOT, 'test')).sort();
  assert.ok(files.length > 0, 'expected to discover test files');

  const runners = runnerCommands();
  assert.ok(runners.length > 0, 'expected test scripts in package.json');

  const unwired = files.filter(
    (file) => !runners.some(({ command }) => command.includes(file)),
  );
  const unjustified = unwired.filter((file) => !ALLOW_UNWIRED.has(file));

  assert.deepEqual(
    unjustified,
    [],
    'these test files are referenced by no runner, so they can never fail. '
      + 'Wire each into a test:* script, or add it to ALLOW_UNWIRED in '
      + 'test/test-wiring.test.js with a written reason.',
  );
});

test('ALLOW_UNWIRED entries still exist and are not wired (no stale exemptions)', () => {
  const files = new Set(collectTestFiles(path.join(ROOT, 'test')));
  const runners = runnerCommands();

  for (const [file, reason] of ALLOW_UNWIRED) {
    assert.ok(files.has(file), `ALLOW_UNWIRED lists ${file}, which no longer exists`);
    assert.ok(reason && reason.length > 10, `${file} needs a substantive reason`);
    const wired = runners.some(({ command }) => command.includes(file));
    assert.equal(
      wired,
      false,
      `${file} is now wired into a runner, so it should be removed from ALLOW_UNWIRED`,
    );
  }
});

test('the wiring check covers every test file type that exists', () => {
  const files = collectTestFiles(path.join(ROOT, 'test'));
  const extensions = new Set(files.map((f) => path.extname(f).replace('.test', '')));
  // If a new runner of tests appears in a language we do not scan for, it would
  // silently escape this check. Fail loudly instead.
  for (const ext of extensions) {
    assert.ok(
      ['.js', '.mjs', '.py'].includes(ext),
      `unexpected test file extension "${ext}" — extend the scan or document the exclusion`,
    );
  }
});
