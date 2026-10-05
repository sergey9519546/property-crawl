'use strict';

// test/discovery-operations-single-runner.test.js
//
// (This file was written as a guard for a split I then reverted. The reasoning
// is kept because the split is a tempting mistake and the reason it is wrong is
// not obvious.)
//
// `npm run test:discovery:operations` runs fourteen files, 100 tests, and only
// two of them need PostgreSQL. It is tempting to split it: put the two gated
// files in a `:pg` runner, the other twelve in the default one. That was done,
// and it was wrong for two reasons:
//
//   1. It introduced a failure. verify-test-coverage.js decides what CI already
//      runs by parsing test/verify.js and following `npm run <script>` one hop.
//      A brand-new runner that verify.js does not call is "unreached", so the
//      gated files landed in its step-2 fallback - which runs them - and
//      test:ci-coverage went red. The split moved the problem rather than
//      solving it.
//
//   2. It was unnecessary. The repo already had the convention: a
//      database-gated test carries `{ skip: !configured }`, as
//      test/discovery-acceptance.test.js and
//      test/discovery-promotion-evidence.test.js have always done. One file -
//      test/discovery-job-fence.test.js - was not following it, and that single
//      omission is what took 98 working tests down with it.
//
// So: one runner, fourteen files, and the two gated tests skip visibly. This
// file pins that outcome so the split is not reintroduced.
//
// The substantive guard for the skip convention is
// test/discovery-operations-pg-gating.test.js.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

test('the discovery-operations suite is a single runner of fourteen files', () => {
  const files = (pkg.scripts['test:discovery:operations'].match(/[\w./-]+\.test\.[cm]?js/g) || []);
  assert.equal(files.length, 14, `expected the full suite in one runner, found ${files.length}`);
  for (const f of files) {
    assert.ok(fs.existsSync(path.join(ROOT, f)), `${f} is listed but does not exist`);
  }
});

test('no separate database-gated runner exists', () => {
  // A `:pg` runner that verify.js does not call is worse than the problem it
  // was invented to solve: the files go to the step-2 fallback and run anyway.
  assert.equal(pkg.scripts['test:discovery:operations:pg'], undefined);
  const ci = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
  assert.doesNotMatch(ci, /test:discovery:operations:pg/);
});
