'use strict';

// test/scrapling-parser-guarded.test.js
//
// test/scrapling_parser_test.py is the only direct test of
// scripts/crawlers/scrapling_extract.py. It ran nowhere: no test:* script, no
// CI step, nothing. A test nobody runs cannot catch the thing it was written
// to catch, and its presence in the tree reads as coverage that does not exist.
//
// It also only passes under the pinned interpreter. Run with whatever `python`
// is on PATH it fails on `engineVersion == 0.4.15` while the machine has 0.4.7
// - which reads like dependency drift and is not. Production resolves Scrapling
// through defaultPython(); the suite must run under the same answer.
//
// These tests pin the wiring, not the parser. The parser's own 16 tests are run
// by CI via `npm run test:scrapling-parser`.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const CI = path.join(ROOT, '.github', 'workflows', 'ci.yml');
const RUNNER = path.join(ROOT, 'scripts', 'run-scrapling-parser-tests.js');
const SUITE = path.join(ROOT, 'test', 'scrapling_parser_test.py');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

test('the parser suite is still on disk and still the only direct parser test', () => {
  assert.ok(fs.existsSync(SUITE), 'test/scrapling_parser_test.py must exist');
  // If another JS test starts covering scrapling_extract.py, this test is
  // redundant and should be revisited rather than left to rot.
  const others = spawnSync('git', ['grep', '-l', 'scrapling_extract', '--', 'test'], {
    cwd: ROOT, encoding: 'utf8',
  });
  const files = (others.stdout || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const js = files.filter((f) => /\.(test\.js|test\.mjs)$/.test(f));
  assert.deepEqual(js, [], `unexpected JS coverage of the parser: ${js.join(', ')}`);
});

test('there is an npm script that runs the parser suite', () => {
  assert.ok(pkg.scripts['test:scrapling-parser'], 'test:scrapling-parser must exist');
  assert.match(pkg.scripts['test:scrapling-parser'], /run-scrapling-parser-tests/);
});

// YAML comments routinely quote the very paths a guard searches for - this
// file's own comment mentions scripts/crawlers/requirements.txt before the
// step that installs it. Strip comment lines before any index arithmetic, or
// the guard measures its own prose. (Fourth time this has bitten in one
// session; the other three were JS comments and a test fixture name.)
function yamlWithoutComments(source) {
  return source
    .split(/\r?\n/)
    .filter((l) => !/^\s*#/.test(l))
    .join('\n');
}

test('CI runs the parser suite in the blocking job', () => {
  const ci = yamlWithoutComments(fs.readFileSync(CI, 'utf8'));
  assert.match(ci, /npm run test:scrapling-parser/,
    'CI must run the parser suite; it previously ran nowhere at all');
  // It must be in a job that is not advisory. The whole reason the repo's
  // guards were inert for months was that the only job running `npm test`
  // carried continue-on-error: true, and the deploy gate is satisfied anyway.
  const firstAdvisory = ci.indexOf('continue-on-error: true');
  const step = ci.indexOf('npm run test:scrapling-parser');
  assert.ok(step !== -1);
  assert.ok(
    firstAdvisory === -1 || step < firstAdvisory,
    'the parser suite must be in a blocking job, not one carrying continue-on-error'
  );
});

test('CI creates the pinned venv before running the suite', () => {
  const ci = yamlWithoutComments(fs.readFileSync(CI, 'utf8'));
  // Order matters: the suite fails closed when the runtime is absent, so the
  // venv has to exist first.
  const venvAt = ci.indexOf('python -m venv .cache/crawler-tools/venv');
  const installAt = ci.indexOf('pip install --quiet -r scripts/crawlers/requirements.txt');
  const runAt = ci.indexOf('npm run test:scrapling-parser');
  assert.ok(venvAt !== -1, 'CI must create .cache/crawler-tools/venv');
  assert.ok(installAt !== -1, 'CI must install the pinned requirements');
  assert.ok(venvAt < installAt, `venv (${venvAt}) must exist before the pinned install (${installAt})`);
  assert.ok(installAt < runAt, `the install (${installAt}) must precede the suite run (${runAt})`);
});

test('the runner asks defaultPython() rather than repeating its precedence', () => {
  // Two implementations of "which interpreter is the product's" would drift,
  // which is how a suite ends up green locally and red in production, or the
  // reverse. There must be one answer.
  const src = fs.readFileSync(RUNNER, 'utf8');
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*\/\/.*$/, ''))
    .join('\n');
  assert.match(code, /defaultPython\(\)/, 'the runner must resolve the interpreter through defaultPython()');
  assert.doesNotMatch(code, /\bspawnSync\(\s*['"`]python['"`]/,
    'the runner must not shell out to bare `python`');
  // Not "the file must not mention the venv path" - the setup hint in the
  // failure message names it on purpose, and that is fine. The property worth
  // pinning is that the spawn uses the value defaultPython() returned, so a
  // second path source could never creep in beside it.
  assert.match(code, /spawnSync\(\s*python\s*,/,
    'the suite must be spawned with the interpreter defaultPython() returned');
});

test('a missing pinned runtime fails the runner rather than skipping it', () => {
  const out = spawnSync(process.execPath, [RUNNER], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, SCRAPLING_PYTHON: path.join(ROOT, 'no-such-python.exe') },
  });
  assert.notEqual(out.status, 0, 'an unusable interpreter must fail, not skip');
  const text = `${out.stdout || ''}${out.stderr || ''}`;
  assert.match(text, /FAILED/, 'the failure must be stated, not silent');
});

test('the suite passes under the pinned runtime when it is available', (t) => {
  const { defaultPython } = require('../server/scrapers/scrapling-bridge');
  const python = defaultPython();
  if (!python) return t.skip('pinned Scrapling venv not present in this environment');
  const out = spawnSync(python, [SUITE], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(out.status, 0, `parser suite failed under the pinned runtime:\n${out.stderr || ''}`);
});

test('the observation store has real headroom and is overridable', () => {
  // The store sat at 39.7MB against a bare 40MB literal. Every route that
  // reads observation history would have failed together, about one collection
  // run from now, and before the historyUnavailable work one of them reported
  // the result as a confident negative finding.
  const src = fs.readFileSync(path.join(ROOT, 'server', 'sources', 'observations.js'), 'utf8');
  assert.doesNotMatch(src, /const MAX_BYTES = 40 \* 1024 \* 1024/,
    'the hard 40MB ceiling is back');
  assert.match(src, /PROPERTY_OBSERVATIONS_MAX_BYTES/,
    'the ceiling must be overridable, like the live-record store');
  assert.match(src, /64 \* 1024 \* 1024/, 'the default ceiling should give real headroom');

  // And if the store really is on disk, check it is not already over the line.
  const store = path.join(ROOT, '.cache', 'source-observations.json');
  if (!fs.existsSync(store)) return;
  const size = fs.statSync(store).size;
  const { loadObservations } = require('../server/sources/observations');
  const result = loadObservations({ filePath: store });
  assert.ok(result.records, 'the store must load');
  assert.ok(size < 64 * 1024 * 1024,
    `store is ${(size / 1024 / 1024).toFixed(1)}MB; it must load under the default ceiling`);
});
