'use strict';
// test/verify-gate-git-failure.test.js
//
// The proportional gate's central claim is that it cannot certify a change it
// did not look at. scripts/verify-gate.js used to break that claim in the most
// expensive way possible.
//
// gitLines() caught every git error and returned []. All three discovery
// sources (diff HEAD, diff --cached, ls-files -o) call it, so any git failure
// collapsed ALL of them to empty at once. classifyChange([]) returns 'trivial'.
// The trivial gate runs one fast suite and exits 0, and main() prints
// "All passed: true".
//
// The trigger needs no exotic environment: git absent from PATH, a checkout with
// no HEAD, or safe.directory refusing a repo it considers "dubious ownership".
// In every one of those the gate certified the entire change as trivial while
// verifying one suite.
//
// The fix propagates the git error and degrades to the full gate. These tests
// drive that for real by running discoverChangeType() in a child process with
// git removed from PATH, rather than trusting the source text.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { execFileSync } = require('node:child_process');

const gate = require('../scripts/verify-gate');

const ROOT = path.resolve(__dirname, '..');

/**
 * Run discoverChangeType() in a child process, optionally with git unreachable.
 * Uses execFileSync on the node executable (absolute path, so it survives an
 * emptied PATH) and prints the result as JSON.
 */
function discoverInChild({ withGit }) {
  const script = `
    const g = require(${JSON.stringify(path.join(ROOT, 'scripts', 'verify-gate.js'))});
    const d = g.discoverChangeType();
    process.stdout.write(JSON.stringify({ type: d.type, gitFailed: d.gitFailed, files: d.files.length }));
  `;
  const env = { ...process.env };
  if (!withGit) {
    // An empty directory as PATH makes `git` genuinely unresolvable.
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'no-git-here-'));
    env.PATH = empty;
    env.Path = empty;
  }
  const out = execFileSync(process.execPath, ['-e', script], {
    cwd: ROOT, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  });
  return JSON.parse(out);
}

test('an empty change set is still classified trivial', () => {
  // The distinction the fix turns on: empty means trivial when git actually ran
  // and genuinely reported no changes.
  assert.equal(gate.classifyChange([]), 'trivial');
});

test('a git failure never resolves to the trivial gate', () => {
  const discovered = discoverInChild({ withGit: false });

  assert.equal(discovered.gitFailed, true,
    'git should have been unreachable in the child process');
  assert.equal(discovered.type, 'full',
    `a gate that cannot see the change must fall back to 'full', got '${discovered.type}'`);
  assert.notEqual(discovered.type, 'trivial',
    'this is the regression: an empty file list used to be read as "nothing to verify"');
});

test('the fallback is the maximal gate, not another small one', () => {
  // 'full' must map to the whole verification suite. getGate also falls back to
  // gates.full for unknown type names, so assert the concrete suite rather than
  // trusting the label.
  assert.deepEqual(gate.getGate('full').suites, ['node test/verify.js']);
  assert.notDeepEqual(gate.getGate('full').suites, gate.getGate('trivial').suites);
});

test('when git works the gate still classifies normally', () => {
  // Negative control. Without it, the test above would also pass if
  // discoverChangeType() returned 'full' unconditionally -- which would be a
  // new defect: every change paying for the full gate.
  const discovered = discoverInChild({ withGit: true });

  assert.equal(discovered.gitFailed, false, 'git should be reachable here');
  assert.notEqual(discovered.type, 'full',
    'a normal working tree must not fall back to the full gate');
  assert.ok(gate.getGate(discovered.type), `unknown gate type '${discovered.type}'`);
});

test('gitLines source no longer contains a swallow-everything catch', () => {
  // A source-level invariant so the regression cannot be reintroduced quietly
  // by someone adding a try/catch for an unrelated reason.
  const source = fs.readFileSync(path.join(ROOT, 'scripts', 'verify-gate.js'), 'utf8');
  const start = source.indexOf('function gitLines');
  const body = source.slice(start, source.indexOf('function getChangedFiles'));
  assert.ok(start >= 0 && body.length > 0, 'could not locate gitLines in verify-gate.js');
  assert.doesNotMatch(body, /catch\s*\([^)]*\)\s*\{\s*return\s*\[\]/,
    'gitLines must not convert a git failure into an empty file list');
});