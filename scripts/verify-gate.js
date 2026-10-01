'use strict';
/*
 * verify-gate.js — proportional completion gate.
 * Detects the blast radius of the current working-tree change and runs the
 * proportionate verification suite, then emits a machine-readable completion
 * block. Refuses to certify "done" without cited evidence.
 *
 * Answers Adversary scenarios 2 (proportional verification) and 3
 * (evidence-cited completion).
 *
 * Usage:
 *   node scripts/verify-gate.js              # auto-detect from git diff
 *   node scripts/verify-gate.js --change-type trivial|scraper|schema|full
 *   node scripts/verify-gate.js --json
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function gitLines(args) {
  // A git failure is NOT the same as "git ran and reported nothing", and the
  // difference is the whole gate. Returning [] here made all three discovery
  // sources collapse to empty at once, classifyChange([]) returned 'trivial',
  // and the gate certified the change after a single fast suite with exit 0 --
  // in any environment where git is absent, has no HEAD, or refuses to run over
  // a "dubious ownership" repo. The gate reported success on a path it never
  // exercised, which is precisely the failure mode this gate exists to catch.
  //
  // Propagate the error. The caller degrades to the full gate, which is slower
  // but cannot be wrong.
  return execSync(`git ${args}`, { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] })
    .toString().split('\n').map((l) => l.trim()).filter(Boolean);
}

function getChangedFiles() {
  // Three sources, because any one alone is a blind spot:
  //   diff HEAD     - tracked files modified against the last commit
  //   diff --cached - staged additions and modifications
  //   ls-files -o   - untracked new files, which git diff never reports
  //
  // A brand-new server module with a syntax error used to be invisible here:
  // untracked files appear in no diff, so the gate classified the change from
  // whatever else happened to be dirty and certified it without ever loading
  // the broken file. New code is exactly where a load error is most likely.
  return [
    ...new Set([
      ...gitLines('diff --name-only HEAD'),
      ...gitLines('diff --cached --name-only'),
      ...gitLines('ls-files --others --exclude-standard'),
    ]),
  ];
}


// package.json is treated as schema-relevant deliberately: its scripts
// enumerate the verification surface and CONTEXT.md hashes it, so adding or
// removing a test runner is a change to what gets verified, not a cosmetic one.
const SCHEMA_RELEVANT = new Set([
  'package.json',
  'package-lock.json',
  'CONTEXT.md',
]);

// Files that decide what the container contains or how it is built. These do
// not change application behaviour, but a mistake here ships the wrong image —
// so they get the runtime gate rather than the fast one.
const DEPLOY_RELEVANT = new Set([
  '.dockerignore',
  'docker-compose.yml',
  'next.config.mjs',
  'tsconfig.json',
]);

const DEPLOY_RELEVANT_PREFIXES = [
  'Dockerfile',
  '.github/',
];

// Decide which gate to run. If git cannot tell us what changed, we must not
// assume the answer is "nothing" -- that is the defect this fixes. Degrade to
// the full verification gate instead: slower, but it cannot certify a change it
// never looked at.
function discoverChangeType() {
  let files;
  try {
    files = getChangedFiles();
  } catch (error) {
    const detail = String((error && (error.stderr || error.message)) || error)
      .split('\n').find((l) => l.trim()) || 'unknown git failure';
    console.warn(`[verify-gate] git could not report changed files (${detail.trim()}).`);
    console.warn('[verify-gate] Falling back to the FULL gate rather than assuming nothing changed.');
    return { type: 'full', files: [], gitFailed: true };
  }
  return { type: classifyChange(files), files, gitFailed: false };
}

function classifyChange(files) {
  if (files.length === 0) return 'trivial';

  const hasAgentSystem = files.some((f) =>
    f.startsWith('.kilo/') ||
    f.startsWith('.agents/') ||
    f.startsWith('memory/') ||
    f.startsWith('scripts/hooks/') ||
    f.startsWith('scripts/skill-router') ||
    f.startsWith('scripts/gen-skills-index') ||
    f.startsWith('scripts/capability-graph') ||
    f.startsWith('scripts/verify-gate')
  );

  // Every copy of the schema, the client that writes it, the generated
  // inventory, and the digest that verifies all of it.
  const hasSchema = files.some((f) =>
    f === 'data.js' ||
    f.endsWith('schema.sql') ||
    f.startsWith('server/db/') ||
    f.endsWith('CONTEXT.md') ||
    SCHEMA_RELEVANT.has(f)
  );

  const hasScraper = files.some((f) =>
    f.startsWith('server/scrapers/') ||
    f.startsWith('server/ai/') ||
    f.startsWith('test/scrapers')
  );

  // Any remaining server or UI code. Previously only server/routes and src/ were
  // recognised, so server/discovery, server/intelligence, server/security and
  // server/sources all fell through to "trivial" and were certified after
  // running only the fast unit suite — which is how real defects in exactly
  // those modules passed the gate unnoticed.
  const hasServerOrUi = files.some((f) =>
    f.startsWith('server/') ||
    f.startsWith('src/') ||
    f === 'index.html' ||
    f === 'app.js'
  );

  // Scripts that build or generate committed artifacts.
  const hasBuildOrDeploy = files.some((f) =>
    DEPLOY_RELEVANT.has(f) ||
    DEPLOY_RELEVANT_PREFIXES.some((p) => f.startsWith(p)) ||
    (f.startsWith('scripts/') && !f.startsWith('scripts/gen-context.js'))
  );

  if (hasAgentSystem) return 'agent';
  if (hasSchema) return 'schema';
  if (hasScraper) return 'scraper';
  if (hasServerOrUi || hasBuildOrDeploy) return 'runtime';
  // docs and test-only changes — trivial
  return 'trivial';
}

function getGate(changeType) {
  const gates = {
    trivial: {
      suites: ['node test/suite.test.js'],
      label: 'fast unit suite',
      maxDuration: 5000
    },
    scraper: {
      // Several scrapers (fdic, trustee, fhfa-hpi, fetch-strategy,
      // secondary-media-collector) are lazily required by the scheduler, so the
      // fixed suites do not execute them either. The smoke covers the change.
      suites: [
        'node scripts/verify-module-load.js --changed',
        'node test/scrapers.test.js',
        'node test/suite.test.js',
        'node test/telemetry.test.js',
      ],
      label: 'module load + scraper + unit + telemetry',
      maxDuration: 60000
    },
    schema: {
      suites: ['node --test test/sync.test.js', 'node --test test/context.test.js', 'node test/db.test.js'],
      label: 'sync + context drift + db contract',
      maxDuration: 15000
    },
    runtime: {
      // The first three suites cover most of the tree. The module-load smoke
      // covers the rest: 25 of 149 server/ modules (public-records, crawlers,
      // onboarding-pass, forms/store, audit routing, and others) are reached
      // only through lazy requires inside handlers, so no fixed suite loads
      // them. Without this, a change to one of those files was certified
      // "runtime, all passed" by suites that never executed it.
      suites: [
        'node scripts/verify-module-load.js --changed',
        'node test/server.test.js',
        'node test/suite.test.js',
        'node test/hardening.test.js',
      ],
      label: 'module load + server + unit + hardening',
      maxDuration: 60000
    },
    agent: {
      suites: [
        'node --test test/agent-system.test.js',
        'node --test test/commands.test.js',
        'node --test test/agents.test.js',
        'node --test test/capability-graph.test.js',
        'node scripts/gen-skills-index.js --check',
        'node scripts/gen-context.js --check'
      ],
      label: 'agent-system acceptance + drift gates',
      maxDuration: 30000
    },
    full: {
      suites: ['node test/verify.js'],
      label: 'full verification gate',
      maxDuration: 1_800_000
    }
  };
  return gates[changeType] || gates.full;
}

function runGate(changeType, opts) {
  opts = opts || {};
  const gate = getGate(changeType);
  const results = [];
  let allPassed = true;

  for (const cmd of gate.suites) {
    const start = Date.now();
    try {
      execSync(cmd, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], timeout: gate.maxDuration });
      const elapsed = Date.now() - start;
      results.push({ cmd, passed: true, exitCode: 0, elapsedMs: elapsed });
    } catch (err) {
      const elapsed = Date.now() - start;
      allPassed = false;
      const exitCode = err.status || 1;
      const stderr = err.stderr ? err.stderr.toString().slice(0, 500) : '';
      results.push({ cmd, passed: false, exitCode, elapsedMs: elapsed, error: stderr });
    }
  }

  const completionBlock = {
    changeType,
    gateLabel: gate.label,
    suitesRun: results.length,
    allPassed,
    results,
    evidence: results.map((r) =>
      `${r.cmd}: ${r.passed ? 'PASS' : 'FAIL'} (exit ${r.exitCode}, ${r.elapsedMs}ms)`
    ).join('\n  ')
  };

  return completionBlock;
}

function main() {
  const args = process.argv.slice(2);
  const asJson = args.includes('--json');
  const typeArg = args.find((a) => a.startsWith('--change-type'));
  const changeType = typeArg ? typeArg.split('=')[1] || args[args.indexOf(typeArg) + 1] : null;

  // An explicit --change-type means the caller already decided; do not make it
// depend on git working just to print a file count.
const discovered = changeType
  ? { type: changeType, files: (() => { try { return getChangedFiles(); } catch (_) { return []; } })(), gitFailed: false }
  : discoverChangeType();
const files = discovered.files;
const detectedType = changeType || discovered.type;

  const block = runGate(detectedType);

  if (asJson) {
    console.log(JSON.stringify(block, null, 2));
  } else {
    console.log('=== COMPLETION GATE ===');
    console.log(`Change type: ${block.changeType}`);
    console.log(`Gate: ${block.gateLabel}`);
    console.log(`Files changed: ${files.length}`);
    console.log(`Suites run: ${block.suitesRun}`);
    console.log(`All passed: ${block.allPassed}`);
    console.log(`\nEvidence:`);
    console.log(`  ${block.evidence}`);
    console.log('\n=== END COMPLETION GATE ===');
  }

  if (!block.allPassed) {
    process.exit(1);
  }
}

module.exports = { classifyChange, getGate, runGate, getChangedFiles, discoverChangeType };
if (require.main === module) main();
