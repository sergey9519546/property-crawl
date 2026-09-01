'use strict';
/*
 * pre-completion.js — Hook handler for the PreCompletion/Stop event.
 * Runs the proportional verification gate (scripts/verify-gate.js) and
 * refuses to let the agent claim "done" without cited evidence.
 *
 * This makes "verify before done" mechanical, not advisory (T2.1/T3.1).
 *
 * The hook is invoked with the changed-file list on stdin (or via --files).
 * It exits 0 if the gate passes, 1 with an evidence block if it fails.
 *
 * Usage (standalone):
 *   node scripts/hooks/pre-completion.js [--files <csv>] [--json]
 *
 * Wiring (.kilo/hooks/pre-completion.json):
 *   { "event": "Stop", "command": "node scripts/hooks/pre-completion.js" }
 */
const { execSync } = require('child_process');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const { classifyChange, getChangedFiles } = require('../verify-gate.js');

function main() {
  const args = process.argv.slice(2);
  const asJson = args.includes('--json');
  const filesArg = args.find((a) => a.startsWith('--files'));
  const files = filesArg
    ? filesArg.split('=')[1].split(',').filter(Boolean)
    : getChangedFiles();

  // Classify the change — include agent-system files as a distinct type
  const hasAgentSystem = files.some((f) =>
    f.startsWith('.kilo/') ||
    f.startsWith('.agents/') ||
    f.startsWith('memory/') ||
    f.startsWith('scripts/hooks/') ||
    f.startsWith('scripts/skill-router') ||
    f.startsWith('scripts/gen-skills-index') ||
    f.startsWith('scripts/verify-gate')
  );

  let changeType = classifyChange(files);
  if (hasAgentSystem) {
    // Agent-system changes must pass the agent-system acceptance tests
    changeType = 'agent';
  }

  // Determine which suites to run
  let suites;
  let label;

  switch (changeType) {
    case 'agent':
      suites = [
        'node --test test/agent-system.test.js',
        'node --test test/commands.test.js',
        'node --test test/agents.test.js',
        'node scripts/gen-skills-index.js --check',
        'node scripts/gen-context.js --check'
      ];
      label = 'agent-system acceptance + drift gates';
      break;
    case 'trivial':
      suites = ['node test/suite.test.js'];
      label = 'fast unit suite';
      break;
    case 'scraper':
      suites = ['node test/scrapers.test.js', 'node test/suite.test.js', 'node test/telemetry.test.js'];
      label = 'scraper + unit + telemetry';
      break;
    case 'schema':
      suites = ['node --test test/sync.test.js', 'node --test test/context.test.js', 'node test/db.test.js'];
      label = 'sync + context drift + db contract';
      break;
    default:
      suites = ['node test/server.test.js', 'node test/suite.test.js', 'node test/hardening.test.js'];
      label = 'server + unit + hardening';
  }

  const results = [];
  let allPassed = true;

  for (const cmd of suites) {
    const start = Date.now();
    try {
      execSync(cmd, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000 });
      results.push({ cmd, passed: true, exitCode: 0, elapsedMs: Date.now() - start });
    } catch (err) {
      results.push({
        cmd,
        passed: false,
        exitCode: err.status || 1,
        elapsedMs: Date.now() - start,
        error: err.stderr ? err.stderr.toString().slice(0, 300) : err.message
      });
      allPassed = false;
    }
  }

  const block = {
    hook: 'pre-completion',
    changeType,
    gateLabel: label,
    filesChanged: files.length,
    suitesRun: results.length,
    allPassed,
    evidence: results.map((r) =>
      `  ${r.cmd}: ${r.passed ? 'PASS' : 'FAIL'} (exit ${r.exitCode}, ${r.elapsedMs}ms)`
    ).join('\n')
  };

  if (asJson) {
    console.log(JSON.stringify(block, null, 2));
  } else {
    console.log('=== PRE-COMPLETION HOOK ===');
    console.log(`Change type: ${block.changeType}`);
    console.log(`Gate: ${block.gateLabel}`);
    console.log(`Files changed: ${block.filesChanged}`);
    console.log(`Suites run: ${block.suitesRun}`);
    console.log(`All passed: ${block.allPassed}`);
    console.log(`\nEvidence:\n${block.evidence}`);
    console.log('\n=== END PRE-COMPLETION HOOK ===');

    if (!block.allPassed) {
      console.error('\n⛔ COMPLETION REFUSED: evidence gate failed. Fix failures before claiming "done".');
    } else {
      console.log('\n✅ COMPLETION CERTIFIED: all evidence gates passed.');
    }
  }

  process.exit(allPassed ? 0 : 1);
}

main();
