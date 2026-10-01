'use strict';

// test/verify-gate-changed-files.test.js
//
// Pins how verify-gate discovers the working-tree change set.
//
// The original implementation used `git diff --name-only HEAD` and, only if
// that was empty, fell back to staged + unstaged diffs. Untracked files appear
// in *no* diff, so a brand-new server module was invisible to the gate. The
// gate would classify the change from whatever else happened to be dirty,
// smoke-load (or not) the wrong set, and print "All passed: true" — for a file
// that could not even be parsed.
//
// That is the worst failure mode for a gate: it certifies the new code without
// reading it, and new code is exactly where a load error is most likely.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { getChangedFiles, classifyChange } = require('../scripts/verify-gate');

const ROOT = path.resolve(__dirname, '..');

test('getChangedFiles: includes untracked files, not just diffs', () => {
  const probe = path.join(ROOT, 'server', 'security', '__wiring-probe-untracked.js');
  fs.writeFileSync(probe, '// probe\n');
  try {
    const files = getChangedFiles();
    const rel = 'server/security/__wiring-probe-untracked.js';
    assert.ok(
      files.includes(rel),
      'a newly created, untracked file must appear in the change set; '
        + 'otherwise the gate certifies new code it never reads',
    );
    assert.ok(
      classifyChange(files) !== 'trivial',
      'a change touching server/ must not be classified trivial',
    );
  } finally {
    fs.unlinkSync(probe);
  }
});

test('getChangedFiles: de-duplicates a file that is both modified and staged', () => {
  const files = getChangedFiles();
  assert.equal(new Set(files).size, files.length, 'change set must not repeat a path');
});

test('getChangedFiles: returns an array of forward-slash relative paths', () => {
  const files = getChangedFiles();
  assert.ok(Array.isArray(files));
  for (const f of files) {
    assert.equal(typeof f, 'string');
    assert.ok(!f.includes('\\'), `${f} should use forward slashes`);
    assert.ok(!path.isAbsolute(f), `${f} should be relative to the repo root`);
  }
});
