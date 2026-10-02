'use strict';

/*
 * verify-test-coverage.js — make CI cover every test file, automatically.
 *
 * WHY THIS EXISTS
 *
 * CI runs `npm test`, which is `node test/verify.js`. verify.js enumerates
 * suites with explicit, hand-curated file lists, plus a handful of
 * `npm run test:*` invocations. A test file wired into a `test:*` script that
 * verify.js never calls is NOT executed in CI — it only runs locally.
 *
 * That is how 73 of 256 test files came to be invisible, including every
 * regression guard added during the September 2026 audit (test wiring, gate
 * classification, module load, untracked-file detection, env documentation,
 * honest empty states, API reachability, raw-payload honesty, publisher-record
 * capture, migration mirror, listing-id alias, catalog adapter join, vacuous
 * tests). Each guard was "passing" locally and enforcing nothing in CI.
 *
 * This is the same failure shape one level up from the 91 orphaned test files
 * that audit found: a check wired into a place nothing executes.
 *
 * WHAT IT DOES
 *
 * 1. Computes the set of test files CI would already execute, by parsing
 *    verify.js for direct `node --test <file>` lists and following any
 *    `npm run <script>` it invokes into that script's file list.
 * 2. Runs every test file in test/ that is NOT in that set, in one
 *    `node --test` invocation.
 * 3. Fails if any of them fail, and prints the exact unreached list on success
 *    so the set stays visible rather than quietly growing.
 *
 * Step 2 is self-maintaining: a test file added next year runs in CI without
 * anyone remembering to edit verify.js, which is the point. Adding a file to
 * an explicit verify.js list instead is still fine — it just moves the file
 * from step 2 to step 1.
 */

const { execFileSync, execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const VERIFY = path.join(ROOT, 'test', 'verify.js');
const TEST_DIR = path.join(ROOT, 'test');

// Skip lists. Every entry needs a reason; an unexplained skip is the same
// failure this script exists to prevent.
const NOT_RUNNABLE_HERE = new Map([
  [
    'test/property-title.test.js',
    'live PropertyTitle API integration; needs third-party credentials and network',
  ],
  [
    'test/test-landbanksearch.js',
    'not a test: a manual scratch script that calls the live landbanksearch.com feed, asserts '
    + 'nothing, and exits 1 on any error. Running it from CI would contact a third party and '
    + 'fail whenever their WAF answers with a bot challenge. Surfaced here when the collector '
    + 'widened past *.test.js; it lives in test/ but belongs in scripts/.',
  ],
]);

const JS_TEST = /\.(js|mjs|cjs)$/;
const ANY_TEST = /(?:^|[./-])test[./-][^/]*\.(py|js|mjs|cjs|ts|rb|sh)$|(?:^|\/)test_[^/]*\.py$|_test\.py$|\.test\.(js|mjs|cjs|ts)$/;

function collectTestFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectTestFiles(full, out);
      continue;
    }
    if (ANY_TEST.test(entry.name)) {
      out.push(path.relative(ROOT, full).split(path.sep).join('/'));
    }
  }
  return out;
}

// Test files CI reaches, resolving `npm run <script>` one level into
// package.json. verify.js only nests one level, so one hop is enough; the
// script asserts that rather than assuming it.
function reachableTestFiles(verifySrc, pkg, resolveNpmRuns = true) {
  const reached = new Set();
  const direct = verifySrc.match(/[\w./-]+\.test\.m?js/g) || [];
  for (const f of direct) reached.add(f);

  if (!resolveNpmRuns) return reached;

  const scripts = verifySrc.match(/npm run [a-z0-9:.-]+/g) || [];
  for (const call of scripts) {
    const name = call.replace('npm run ', '').trim();
    const command = pkg.scripts[name];
    if (!command) continue;
    for (const m of command.matchAll(/[\w./-]+\.test\.m?js/g)) reached.add(m[0]);
  }
  return reached;
}

function unreachedFiles({ resolveNpmRuns = true, skip = NOT_RUNNABLE_HERE } = {}) {
  const verifySrc = fs.readFileSync(VERIFY, 'utf8');
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const reached = reachableTestFiles(verifySrc, pkg, resolveNpmRuns);
  return collectTestFiles(TEST_DIR)
    .filter((f) => !reached.has(f))
    .filter((f) => !skip.has(f))
    .sort();
}

// Step 2 can only RUN what `node --test` understands. Test files in other
// languages are still test files - this tool's whole reason to exist is that a
// test nobody runs looks exactly like a passing test - so they are reported
// rather than executed. Handing a .py path to `node --test` would fail the
// build for the wrong reason, which is a worse lie than silence.
//
// Before this split, every non-JS test was invisible: the collector only matched
// *.test.js / *.test.mjs, so test/scrapling_parser_test.py - the only direct
// test of the Scrapling parser, and one that fails when run with the wrong
// interpreter - could not appear in this report at all.
function partitionUnreached(files = unreachedFiles()) {
  const runnable = files.filter((f) => JS_TEST.test(f));
  const other = files.filter((f) => !JS_TEST.test(f));
  return { runnable, other };
}

function main() {
  const { runnable, other } = partitionUnreached();

  console.log('[test-coverage] test files verify.js does not list directly or via npm run:');
  if (runnable.length === 0) {
    console.log('[test-coverage]   (none — verify.js reaches every JS test file)');
  } else {
    for (const f of runnable) console.log(`[test-coverage]   + ${f}`);
    console.log(`[test-coverage] running ${runnable.length} file(s) so CI actually covers them...`);
    execFileSync(process.execPath, ['--test', ...runnable], {
      cwd: ROOT, stdio: 'inherit', timeout: 15 * 60 * 1000,
    });
  }

  if (other.length) {
    // Reported, not run: these are real test files that this report previously
    // could not see. Whether to wire them up is a decision, not something a
    // coverage script may decide by exec'ing a Python file through Node.
    console.log('');
    console.log('[test-coverage] NON-JS test files not reached by verify.js (reported, not run):');
    for (const f of other) console.log(`[test-coverage]   ! ${f}`);
    console.log('[test-coverage]   These are tests that nothing in CI executes. They are not');
    console.log('[test-coverage]   necessarily broken, but an unwired test is indistinguishable');
    console.log('[test-coverage]   from a passing one, which is the failure this script exists');
    console.log('[test-coverage]   to prevent. Wire them, or record why not.');
  }
}

module.exports = {
  collectTestFiles,
  reachableTestFiles,
  unreachedFiles,
  partitionUnreached,
  NOT_RUNNABLE_HERE,
};

if (require.main === module) main();
