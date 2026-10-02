'use strict';

// test/verify-gate-reports-git-failure.test.js
//
// verify-gate.js was fixed earlier to degrade to the FULL gate when git fails.
// That fix was incomplete in two ways, both found by reading the whole file
// rather than the one function:
//
//   1. The explicit `--change-type` branch kept its own
//      `catch (_) { return []; }` and hard-coded `gitFailed: false`, so a git
//      failure printed "Files changed: 0" - a confident zero for an unknown.
//   2. `gitFailed` was assigned in three places and read in none, and never
//      reached the completion block. The flag the earlier fix added was dead:
//      nothing a consumer reads could tell a git failure from an empty change.
//
// The caller's change-type still wins - that decision legitimately must not
// depend on git. What must not happen is reporting an unknown count as zero.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'verify-gate.js');

// Node is invoked by absolute path, so only git disappears.
const NO_GIT_PATH = { PATH: 'C:\\Windows\\System32' };

function runGate(args, env) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: ROOT, encoding: 'utf8', env: { ...process.env, ...env }, maxBuffer: 32 * 1024 * 1024,
  });
}

function gitWorks() {
  return spawnSync('git', ['--version'], { cwd: ROOT, shell: true }).status === 0;
}

test('with git working, the gate reports a real file count', (t) => {
  if (!gitWorks()) return t.skip('git is not on PATH in this environment');
  const out = runGate(['--change-type=trivial']);
  assert.match(out.stdout, /Files changed: \d+/);
  assert.doesNotMatch(out.stdout, /unknown \(git unavailable\)/);
});

test('without git, the gate does not claim zero files changed', (t) => {
  if (!gitWorks()) return t.skip('cannot simulate a git failure when git is already absent');
  const out = runGate(['--change-type=trivial'], NO_GIT_PATH);
  assert.doesNotMatch(
    out.stdout,
    /Files changed: 0/,
    'a git failure must not be reported as a confident zero'
  );
  assert.match(out.stdout, /Files changed: unknown \(git unavailable\)/);
  assert.match(out.stderr, /git could not report changed files/);
});

test("the caller's change type still wins when git is unavailable", (t) => {
  if (!gitWorks()) return t.skip('cannot simulate a git failure when git is already absent');
  // The explicit decision must survive: degrading here would override a choice
  // the caller already made, which is a different bug from hiding a count.
  const out = runGate(['--change-type=trivial'], NO_GIT_PATH);
  assert.match(out.stdout, /Change type: trivial/);
});

test('the JSON completion block reports gitFailed and a null count', (t) => {
  if (!gitWorks()) return t.skip('cannot simulate a git failure when git is already absent');
  const out = runGate(['--change-type=trivial', '--json'], NO_GIT_PATH);
  let block;
  try {
    block = JSON.parse(out.stdout);
  } catch (_) {
    assert.fail(`gate did not emit valid JSON: ${out.stdout.slice(0, 200)} || ${out.stderr.slice(0, 200)}`);
  }
  assert.equal(block.gitFailed, true, 'gitFailed must survive into the artefact consumers read');
  assert.equal(block.filesChanged, null, 'an unknown count must be null, not 0');
});

test('the JSON block reports gitFailed false when git is fine', (t) => {
  if (!gitWorks()) return t.skip('git is not on PATH in this environment');
  const out = runGate(['--change-type=trivial', '--json']);
  const block = JSON.parse(out.stdout);
  assert.equal(block.gitFailed, false);
  assert.equal(typeof block.filesChanged, 'number');
});

test('no branch of verify-gate swallows a git error into an empty file list', () => {
  const raw = fs.readFileSync(SCRIPT, 'utf8');
  // Strip comments: the fix quotes the old line, and a guard that matches its
  // own documentation flags the note rather than the code. Third time today.
  const code = raw
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*\/\/.*$/, ''))
    .join('\n');
  assert.doesNotMatch(code, /catch\s*\(\s*_?\s*\)\s*\{\s*return\s*\[\]\s*;\s*\}/);
  // And the flag must not be write-only any more.
  assert.match(code, /gitFailed\s*:/);
  assert.match(code, /block\.gitFailed\s*=/);
});
