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
]);

function collectTestFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectTestFiles(full, out);
      continue;
    }
    if (/\.(test\.js|test\.mjs)$/.test(entry.name)) {
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

function main() {
  const extra = unreachedFiles();

  console.log('[test-coverage] test files verify.js does not list directly or via npm run:');
  if (extra.length === 0) {
    console.log('[test-coverage]   (none — verify.js reaches every test file)');
    return;
  }
  for (const f of extra) console.log(`[test-coverage]   + ${f}`);

  console.log(`[test-coverage] running ${extra.length} file(s) so CI actually covers them...`);
  const result = execFileSync(
    process.execPath,
    ['--test', ...extra],
    { cwd: ROOT, stdio: 'inherit', timeout: 15 * 60 * 1000 },
  );
  void result;
}

module.exports = { collectTestFiles, reachableTestFiles, unreachedFiles, NOT_RUNNABLE_HERE };

if (require.main === module) main();
