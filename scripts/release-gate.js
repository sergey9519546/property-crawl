'use strict';

// PP-02: the release gate, run in order against one exact tree.
//
// Every gate records the tree SHA it ran against, so a pass is source-bound -
// a green tick that could belong to any commit is not evidence of anything
// (PP-05). A dirty working tree is reported and the run is marked not
// source-bound rather than silently presented as a release result.
//
// Usage:  node scripts/release-gate.js            # all gates
//         node scripts/release-gate.js --quick    # skip build + e2e
//
// Everything here must pass from the exact tree you intend to release.
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.resolve(__dirname, '..');
const r = (cmd, args, opts = {}) => spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts });

const sha = r('git', ['rev-parse', 'HEAD']).stdout.trim();
const dirty = r('git', ['status', '--porcelain']).stdout.trim();
const node = process.execPath;

console.log('='.repeat(72));
console.log(`PP-02 RELEASE GATE`);
console.log(`tree    : ${sha}`);
console.log(`working : ${dirty ? 'DIRTY (results are not source-bound)' : 'clean'}`);
console.log('='.repeat(72));

const quick = process.argv.includes('--quick');
const gates = [
  { id: 'typecheck', desc: 'tsc --noEmit', cmd: node, args: ['node_modules/typescript/bin/tsc', '--noEmit', '-p', 'tsconfig.json'] },
  { id: 'generated-context', desc: 'CONTEXT.md current', cmd: node, args: ['scripts/gen-context.js', '--check'] },
  { id: 'schema-mirrors', desc: 'src/lib/db mirrors byte-identical', cmd: node, args: ['scripts/sync-schema-mirror.js', '--check'] },
  { id: 'test-wiring', desc: 'every test file reachable from a runner', cmd: node, args: ['--test', 'test/test-wiring.test.js'] },
  { id: 'ops-suites', desc: 'meta/wiring/contract suites', cmd: node, args: ['--test', 'test/coverage-matrix.test.js', 'test/test-wiring.test.js', 'test/corrupt-store-no-silent-overwrite.test.js', 'test/db-seed-failure-is-reported.test.js', 'test/store-load-failures-are-reported.test.js', 'test/e2e-demo-pin.test.js', 'test/inventory-signal.test.js', 'test/gen-context-route-drift.test.js', 'test/no-dead-duplicates.test.js', 'test/hunt-document-identity-agreement.test.js', 'test/discovery-operations-pg-gating.test.js', 'test/schema-mirror-contract.test.js', 'test/module-load-gate-fails-closed.test.js', 'test/verify-gate-reports-git-failure.test.js', 'test/scrapling-parser-guarded.test.js', 'test/ci-coverage-visibility.test.js', 'test/discovery-operations-split.test.js'] },
  { id: 'scraper-parser', desc: 'Scrapling parser on the pinned runtime', cmd: node, args: ['scripts/run-scrapling-parser-tests.js'] },
  { id: 'production-smoke', desc: 'boot contract + guards without booting', cmd: node, args: ['scripts/production-smoke.js'] },
  // next's bin directly: `npm` is npm.cmd on Windows and spawnSync without a
  // shell never starts it, which failed in 2ms and read as a broken build.
  { id: 'next-build', desc: 'production bundle', cmd: node, args: ['node_modules/next/dist/bin/next', 'build'], slow: true },
  { id: 'production-e2e', desc: 'full stack, 25 checks, demo-pinned', cmd: node, args: ['scripts/run-production-e2e.js'], env: { ...process.env, DATABASE_URL: '', DISCOVERY_MODE: '' }, slow: true },
];

const selected = quick ? gates.filter((g) => !g.slow) : gates;

const results = [];
for (const g of selected) {
  const started = Date.now();
  const res = r(g.cmd, g.args, g.env ? { env: g.env } : {});
  const ms = Date.now() - started;
  const out = `${res.stdout || ''}${res.stderr || ''}`;
  const ok = res.status === 0;
  results.push({ ...g, ok, ms, code: res.status });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${g.id.padEnd(18)} ${String(ms).padStart(7)}ms  ${g.desc}`);
  if (!ok) {
    const tail = out.split(/\r?\n/).filter((l) => /error|fail|FAIL|✖|Error/.test(l)).slice(0, 6);
    for (const l of tail) console.log(`        ${l.slice(0, 130)}`);
  }
}

console.log('-'.repeat(72));
const failed = results.filter((x) => !x.ok);
console.log(`PP-02: ${results.length - failed.length}/${results.length} gates passed against ${sha.slice(0, 12)}${quick ? ' (--quick: build and e2e skipped, NOT a release result)' : ''}`);
if (dirty) console.log('WARNING: working tree was dirty; this run is not a source-bound release result.');
if (failed.length) console.log(`FAILED: ${failed.map((x) => x.id).join(', ')}`);

// PP-05 seed: a source-bound ledger of what actually ran.
const ledger = {
  tree: sha,
  dirty: Boolean(dirty),
  quick,
  when: new Date().toISOString(),
  gates: results.map(({ id, desc, ok, ms }) => ({ id, desc, ok, ms })),
};
const outFile = path.join(ROOT, 'reports', 'release-gate-ledger.json');
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, `${JSON.stringify(ledger, null, 2)}\n`);
console.log(`ledger: ${path.relative(ROOT, outFile)}`);
process.exit(failed.length ? 1 : 0);