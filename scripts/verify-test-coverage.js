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

// Any path-like token ending in a testable extension, in any language. The
// prefix class is a CHARACTER class -- `[\s'"` + backtick + `(\[,]` -- because
// writing it as an alternation of `\s'` and `"` means "whitespace followed by a
// quote", which silently matches nothing in `node test/foo.test.js`.
//
// Bare basenames count as well as full paths, because run-ui-suite.js refers to
// its Python suites by bare name in a `path.join('test', suite)` call.
const TEST_FILE_TOKEN = /(?:^|[\s'"`(\[,])((?:[\w.-]+\/)*[\w.-]+\.(?:py|js|mjs|cjs|ts))/g;

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

function namesIn(src) {
  const found = new Set();
  for (const m of src.matchAll(TEST_FILE_TOKEN)) {
    const full = m[1];
    const base = full.split('/').pop();
    if (!base) continue;
    // Reuse the repo's own naming convention rather than a second regex: a
    // token is a test if its basename looks like one, or if it sits under
    // test/. run-ui-suite.js is neither, and must not be mistaken for a suite.
    if (!ANY_TEST.test(base) && !full.startsWith('test/')) continue;
    found.add(base);
    if (full.includes('/')) found.add(full);
  }
  return found;
}

// Read a script the gate invokes, so a suite that SPAWNS another test file is
// recognised as reaching it. Gate suite 11 runs `node test/run-ui-suite.js`,
// which spawns two Python suites; without this hop both were reported as
// "nothing in CI executes" while CI was executing them.
function readIfPresent(relPath) {
  const full = path.join(ROOT, relPath);
  try {
    return fs.readFileSync(full, 'utf8');
  } catch {
    return '';
  }
}

// Resolve harvested tokens to real paths under test/.
//
// This is where the basename shortcut has to die. test/api-rate-policy.test.js
// and test/security/api-rate-policy.test.js share a basename; matching by
// basename alone let the first vouch for the second, and the second is wired
// only to `npm run test:evidence-truth`, which the gate never calls. A guard
// that covers nothing is worse than one that reports too much, because it
// retires the very report it exists to produce.
//
// So: an exact path token resolves to itself, an UNAMBIGUOUS basename resolves
// to its one file, and an ambiguous basename resolves to nothing -- because
// "some file with this name is run" is not evidence that this file is.
function resolveToFiles(tokens) {
  const known = collectTestFiles(TEST_DIR);
  const byBase = new Map();
  for (const f of known) {
    const b = path.basename(f);
    if (!byBase.has(b)) byBase.set(b, []);
    byBase.get(b).push(f);
  }

  const resolved = new Set();
  for (const token of tokens) {
    if (known.includes(token)) { resolved.add(token); continue; }
    const candidates = byBase.get(path.basename(token));
    if (candidates && candidates.length === 1) resolved.add(candidates[0]);
    else if (!candidates) resolved.add(token);
    // candidates.length > 1 -> ambiguous, claim nothing
  }
  return resolved;
}

// Test files CI reaches, resolving `npm run <script>` into package.json and
// then one more hop into any script that script or the gate invokes. Two hops,
// because that is the deepest the repository actually nests.
function reachableTestFiles(verifySrc, pkg, resolveNpmRuns = true) {
  const tokens = new Set();

  const absorb = (src) => {
    for (const name of namesIn(src)) tokens.add(name);
  };

  absorb(verifySrc);

  // Hop 1: every script the gate's own suite commands name.
  //
  // This file is itself one of those scripts -- the gate runs it -- so reading
  // it back would absorb every test name that appears in its own comments and
  // skip lists. That silently marked test/scrapling_parser_test.py as reached:
  // this script TALKS about that file, it does not run it, and the npm script
  // that does run it is not in the gate. A coverage tool that counts its own
  // prose as coverage is worse than one that reports too much.
  const SELF = 'scripts/verify-test-coverage.js';
  for (const m of verifySrc.matchAll(/[\w./-]+\.(?:js|mjs|cjs)(?=['"\s,)])/g)) {
    const rel = m[0];
    if (rel === SELF) continue;
    if (rel.includes('/') && !rel.includes('.test.')) absorb(readIfPresent(rel));
  }

  if (!resolveNpmRuns) return resolveToFiles(tokens);

  const scripts = verifySrc.match(/npm run [a-z0-9:.-]+/g) || [];
  for (const call of scripts) {
    const name = call.replace('npm run ', '').trim();
    const command = pkg.scripts[name];
    if (!command) continue;
    absorb(command);
    // Hop 2: that script's own script -- test:scrapling-parser runs a .js
    // wrapper which names the .py suite it spawns.
    for (const m of command.matchAll(/[\w./-]+\.(?:js|mjs|cjs)/g)) {
      if (m[0].includes('/')) absorb(readIfPresent(m[0]));
    }
  }
  return resolveToFiles(tokens);
}

function unreachedFiles({ resolveNpmRuns = true, skip = NOT_RUNNABLE_HERE } = {}) {
  const verifySrc = fs.readFileSync(VERIFY, 'utf8');
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const reached = reachableTestFiles(verifySrc, pkg, resolveNpmRuns);
  // reached holds resolved paths, so an exact comparison is correct here and
  // a basename fallback is not -- that fallback is what let one file vouch for
  // a different file that shares its name.
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
    //
    // The wording matters. An earlier version of this block said "nothing in
    // CI executes" about every one of them, which was false: the gate does run
    // two of these, by spawning them from run-ui-suite.js. A test nobody runs
    // looking like a passing test is the failure this file exists to catch;
    // so is a coverage report that cries wolf about suites CI is running,
    // because the fix that invites -- wiring them again -- is the wrong one.
    console.log('');
    console.log('[test-coverage] NON-JS test files the gate does not execute (reported, not run):');
    for (const f of other) console.log(`[test-coverage]   ! ${f}`);
    console.log('[test-coverage]   node --test cannot execute these, so they are surfaced rather');
    console.log('[test-coverage]   than run. Suites CI does reach them through another runner');
    console.log('[test-coverage]   are resolved above and do not appear here. For each entry,');
    console.log('[test-coverage]   either a gate suite or an npm script must run it, or the');
    console.log('[test-coverage]   reason it is not run has to be recorded in');
    console.log('[test-coverage]   scripts/verify-test-coverage.js NOT_RUNNABLE_HERE.');
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
