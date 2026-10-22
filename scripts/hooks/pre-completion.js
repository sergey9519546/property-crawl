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
 * Wiring (.kilo/hooks/hooks.json):
 *   { "event": "Stop", "command": "node scripts/hooks/pre-completion.js" }
 */
const { classifyChange, discoverChangeType, getGate, runGate } = require('../verify-gate.js');

function main() {
  const args = process.argv.slice(2);
  const asJson = args.includes('--json');
  const filesArg = args.find((a) => a.startsWith('--files'));

  let files;
  let changeType;
  let gitFailed = false;

  if (filesArg) {
    files = filesArg.split('=')[1].split(',').filter(Boolean);
    changeType = classifyChange(files);
  } else {
    const discovered = discoverChangeType();
    files = discovered.files;
    changeType = discovered.type;
    gitFailed = Boolean(discovered.gitFailed);
  }

  const gate = getGate(changeType);
  const gateBlock = runGate(changeType);

  const block = {
    hook: 'pre-completion',
    changeType,
    gateLabel: gate.label,
    filesChanged: gitFailed ? null : files.length,
    gitFailed,
    suitesRun: gateBlock.suitesRun,
    allPassed: gateBlock.allPassed,
    evidence: gateBlock.results.map((r) =>
      `  ${r.cmd}: ${r.passed ? 'PASS' : 'FAIL'} (exit ${r.exitCode}, ${r.elapsedMs}ms)`
    ).join('\n')
  };

  if (asJson) {
    console.log(JSON.stringify(block, null, 2));
  } else {
    console.log('=== PRE-COMPLETION HOOK ===');
    console.log(`Change type: ${block.changeType}`);
    console.log(`Gate: ${block.gateLabel}`);
    console.log(`Files changed: ${block.filesChanged === null ? 'unknown (git unavailable)' : block.filesChanged}`);
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

  process.exit(block.allPassed ? 0 : 1);
}

main();
