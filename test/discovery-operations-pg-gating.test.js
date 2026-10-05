'use strict';

// test/discovery-operations-pg-gating.test.js
//
// `npm run test:discovery:operations` runs fourteen files, 100 tests, and
// ninety-eight of them need no database. Two are real PostgreSQL tests.
//
// discovery-job-fence.test.js called createIsolatedDatabase() with no guard, so
// with no DISCOVERY_TEST_DATABASE_URL it threw while the file was still
// loading. That failed the whole runner and took the other ninety-eight with
// it - and no workflow invoked the runner, so 100 tests ran nowhere at all.
//
// The repo already has the right convention: `{ skip: !configured }`, as in
// test/discovery-acceptance.test.js and test/discovery-promotion-evidence.test.js.
// The CI job is named "discovery suites skip without PG". job-fence was the one
// file not following it. This pins that, so the next database-gated test
// written by copying a bad example fails here instead of taking a runner down.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

// Files that construct an isolated PostgreSQL database. The list is asserted
// rather than hardcoded, so a new one has to be found. The guards themselves
// are excluded: they name createIsolatedDatabase in order to talk about it,
// and a guard that matches its own subject is worse than no guard.
const GUARDS_THAT_MENTION_IT = new Set([
  'test/discovery-operations-pg-gating.test.js',
  'test/discovery-operations-split.test.js',
]);
const CONSTRUCTS_DATABASE = /createIsolatedDatabase\s*\(/;
const filesThatNeedADatabase = () => {
  const dir = path.join(ROOT, 'test');
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    if (!/\.test\.[cm]?js$/.test(name)) continue;
    const rel = `test/${name}`;
    if (GUARDS_THAT_MENTION_IT.has(rel)) continue;
    const src = fs.readFileSync(path.join(dir, name), 'utf8');
    if (CONSTRUCTS_DATABASE.test(src)) out.push(rel);
  }
  return out.sort();
};

test('the discovery-operations runner exists and still holds all fourteen files', () => {
  const files = (pkg.scripts['test:discovery:operations'].match(/[\w./-]+\.test\.[cm]?js/g) || []);
  assert.equal(files.length, 14, `expected the full suite, found ${files.length}`);
  for (const f of files) {
    assert.ok(fs.existsSync(path.join(ROOT, f)), `${f} is listed but does not exist`);
  }
});

test('every file that builds a PostgreSQL database declares a skip guard', () => {
  // The file-level property is the one that matters: a file that constructs a
  // real database must have SOME guard keyed on the database being configured.
  // Checking every test() individually would flag files whose other tests need
  // no database, which is most of them.
  const offenders = filesThatNeedADatabase().filter((file) => {
    const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
    return !/skip\s*:\s*!/.test(src);
  });
  assert.deepEqual(
    offenders, [],
    `these construct a real database with no skip guard - one of them fails the whole runner and takes its database-independent siblings with it:\n  ${offenders.join('\n  ')}`
  );
});

test('the two known gated files are the ones that need one', () => {
  const gated = filesThatNeedADatabase();
  assert.ok(
    gated.includes('test/discovery-job-fence.test.js'),
    'job-fence is the file that was missing a guard'
  );
  for (const file of gated) {
    const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
    assert.match(src, /DISCOVERY_TEST_DATABASE_URL\s*\|\|\s*process\.env\.TEST_DATABASE_URL/,
      `${file} must key its guard on the database env chain every sibling uses`);
  }
});

// The runtime half of this - "the suite exits 0 and reports two skipped" - is
// NOT asserted here. node refuses to run a nested `node --test` inside a test
// file ("node:test run() is being called recursively within a test file"), and
// duplicating a fourteen-file run to prove it would be slow and brittle anyway.
//
// The evidence lives where it is cheap and real: `npm run test:discovery:operations`
// runs as one of the suites in the verification sweep and summarises
// "100 tests, 98 pass, 2 skipped, 0 fail". What this file pins is that each
// gated file declares the guard and keys it on the env chain every sibling
// uses, so those two skips stay skips rather than becoming crashes.

test('the gated tests still refuse to run on demo memory data', () => {
  // A skip must come from the guard, not from the database helper quietly
  // accepting in-memory data. If this stops throwing, the skip would be a lie.
  const { testDatabaseUrl } = require('../test/discovery-acceptance-db');
  const previous = { a: process.env.DISCOVERY_TEST_DATABASE_URL, b: process.env.TEST_DATABASE_URL };
  delete process.env.DISCOVERY_TEST_DATABASE_URL;
  delete process.env.TEST_DATABASE_URL;
  try {
    assert.throws(() => testDatabaseUrl(), /DISCOVERY_TEST_DATABASE_URL|cannot use demo memory data/);
  } finally {
    for (const [key, value] of [['DISCOVERY_TEST_DATABASE_URL', previous.a], ['TEST_DATABASE_URL', previous.b]]) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('CI runs the discovery-operations suite in the blocking job', () => {
  const ci = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
  assert.match(ci, /run:\s*npm run test:discovery:operations\s*$/m);
  // And the split it never needed must not linger as a dead CI step.
  assert.doesNotMatch(ci, /test:discovery:operations:pg/);
  assert.equal(pkg.scripts['test:discovery:operations:pg'], undefined,
    'the database-gated runner was an invention that only moved the problem');
});
