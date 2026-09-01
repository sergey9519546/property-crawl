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

function getChangedFiles() {
  try {
    const out = execSync('git diff --name-only HEAD', { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString().trim();
    if (out) return out.split('\n');
  } catch (_) {}
  // fall back to staged + unstaged
  try {
    const staged = execSync('git diff --cached --name-only', { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    const unstaged = execSync('git diff --name-only', { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    return [...new Set([...(staged ? staged.split('\n') : []), ...(unstaged ? unstaged.split('\n') : [])])].filter(Boolean);
  } catch (_) {
    return [];
  }
}

function classifyChange(files) {
  if (files.length === 0) return 'trivial';

  const hasSchema = files.some((f) =>
    f === 'data.js' ||
    f === 'server/db/schema.sql' ||
    f === 'server/db/client.js' ||
    f.endsWith('CONTEXT.md')
  );
  const hasScraper = files.some((f) =>
    f.startsWith('server/scrapers/') ||
    f.startsWith('server/ai/') ||
    f.startsWith('test/scrapers')
  );
  const hasServer = files.some((f) =>
    f.startsWith('server/routes/') ||
    f === 'server/server.js'
  );
  const hasUI = files.some((f) =>
    f.startsWith('src/') ||
    f === 'index.html' ||
    f === 'app.js'
  );

  if (hasSchema) return 'schema';
  if (hasScraper) return 'scraper';
  if (hasServer || hasUI) return 'runtime';
  // docs, config, tests-only, .kilo, .agents — trivial
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
      suites: ['node test/scrapers.test.js', 'node test/suite.test.js', 'node test/telemetry.test.js'],
      label: 'scraper + unit + telemetry',
      maxDuration: 30000
    },
    schema: {
      suites: ['node --test test/sync.test.js', 'node --test test/context.test.js', 'node test/db.test.js'],
      label: 'sync + context drift + db contract',
      maxDuration: 15000
    },
    runtime: {
      suites: ['node test/server.test.js', 'node test/suite.test.js', 'node test/hardening.test.js'],
      label: 'server + unit + hardening',
      maxDuration: 20000
    },
    full: {
      suites: ['node test/verify.js'],
      label: 'full verification gate',
      maxDuration: 120000
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

  const files = getChangedFiles();
  const detectedType = changeType || classifyChange(files);

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

module.exports = { classifyChange, getGate, runGate, getChangedFiles };
if (require.main === module) main();
