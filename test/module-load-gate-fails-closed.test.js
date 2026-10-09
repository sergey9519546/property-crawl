'use strict';

// test/module-load-gate-fails-closed.test.js
//
// verify-module-load.js exists because the runtime gate loads 124 of 149
// server modules, so a change to the other 25 was certified "all passed" by
// suites that never loaded them. Its own docstring names the case it is for: "a
// new server module with a syntax error ... appears in no git diff".
//
// That case depends entirely on `git ls-files --others`. The changed-file
// helper used to swallow git failures with `catch (_) { return []; }`, so with
// git absent all three queries returned empty, the candidate list was empty,
// and the gate printed "no loadable server modules among the changed files" and
// exited 0.
//
// A gate that cannot determine its input must not report success.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'verify-module-load.js');
const NODE = process.execPath;

function runGate(args, env) {
  return spawnSync(NODE, [SCRIPT, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

// A PATH with no git in it. Node is invoked by absolute path, so only git
// disappears - which is exactly the failure mode being simulated (git missing,
// wrong container, detached volume).
const NO_GIT_PATH = { PATH: 'C:\\Windows\\System32' };

function hasGitOnPath() {
  return spawnSync('git', ['--version'], { cwd: ROOT, shell: false }).status === 0;
}

test('with git available, a broken server module fails the gate', (t) => {
  if (!hasGitOnPath()) return t.skip('git is not on PATH in this environment');
  const probe = path.join(ROOT, 'server', '_failclosed-probe.js');
  fs.writeFileSync(probe, 'module.exports = {\n');
  t.after(() => { try { fs.rmSync(probe); } catch (_) { /* already gone */ } });
  const result = runGate(['--changed']);
  assert.equal(result.status, 1, 'an untracked module with a syntax error must fail the gate');
  assert.match(result.stdout, /_failclosed-probe\.js/);
});

test('without git, the gate fails closed instead of reporting nothing to load', (t) => {
  if (!hasGitOnPath()) return t.skip('cannot simulate a git failure when git is already absent');
  const result = runGate(['--changed'], NO_GIT_PATH);
  assert.equal(
    result.status,
    1,
    'git being unavailable must fail the gate; exiting 0 here is the bug this test pins'
  );
  assert.match(result.stderr, /SKIPPED, not passed/);
  assert.doesNotMatch(
    result.stdout + result.stderr,
    /no loadable server modules among the changed files/,
    'a git failure must not be reported as "nothing to check"'
  );
});

test('the failure names the cause and points at a real alternative', () => {
  if (!hasGitOnPath()) return;
  const result = runGate(['--changed'], NO_GIT_PATH);
  assert.match(result.stderr, /git .* failed/);
  assert.match(result.stderr, /--all/, 'the message must offer the full-scan alternative');
});

test('the changed-file helper no longer swallows git errors', () => {
  const source = fs.readFileSync(SCRIPT, 'utf8');
  // Strip comments first. The fix is explained in a comment that quotes the old
  // code verbatim, so scanning the raw file matches the prose - the guard
  // flagging the note that documents the bug. This is about executable code.
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*\/\/.*$/, ''))
    .join('\n');
  assert.doesNotMatch(
    code,
    /catch\s*\(_\)\s*\{\s*return \[\];\s*\}/,
    'a swallowed git error is indistinguishable from an unchanged tree'
  );
  assert.match(code, /gitUnavailable/);
  assert.match(source, /SKIPPED, not passed/);
});

test('an explicit file list with no server modules still passes', (t) => {
  if (!hasGitOnPath()) return t.skip('git is not on PATH in this environment');
  // A genuine no-op must stay a pass; the fix is about failure modes, not
  // about making the gate noisy.
  const result = runGate(['test/context.test.js']);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /no loadable server modules/);
});

test('the gate still requires the module to actually load when git is fine', (t) => {
  if (!hasGitOnPath()) return t.skip('git is not on PATH in this environment');
  const relative = 'server/_failclosed-good.js';
  fs.writeFileSync(path.join(ROOT, relative), 'module.exports = { ok: true };\n');
  t.after(() => { try { fs.rmSync(path.join(ROOT, relative)); } catch (_) { /* already gone */ } });
  // A repo-relative path: isCandidate() only considers files under server/,
  // and an absolute path does not start with "server/".
  const result = runGate([relative]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /ok\s+server\/_failclosed-good\.js/);
});
