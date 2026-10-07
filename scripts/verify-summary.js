'use strict';

/**
 * Reading the verifier's own output.
 *
 * verify.js counts suites by exit code, and a suite whose tests are all skipped
 * exits 0. That produced "50/50 Suites Passed (0 Failed)" while roughly fifteen
 * tests gated on DATABASE_URL had never executed - a summary that cannot tell
 * "verified" from "never ran" is a false all-clear. node's test reporter prints
 * a `skipped N` summary line per run, which is enough to tell the two apart.
 */

/** Total tests a run reported as skipped. Tolerant of the `ℹ` and `#` forms. */
function skippedIn(output) {
  let total = 0;
  for (const match of String(output || '').matchAll(/^\s*[ℹ#]\s*skipped\s+(\d+)\s*$/gim)) {
    total += Number(match[1]);
  }
  return total;
}

/** The note appended to the summary when anything was skipped. */
function skippedNote(skippedSuites) {
  if (!skippedSuites.length) return '';
  const total = skippedSuites.reduce((sum, entry) => sum + entry.skipped, 0);
  return [
    `NOTE: ${total} test(s) were SKIPPED and did not execute. A skipped test is not a passing test.`,
    ...skippedSuites.map((entry) => `  skipped: ${entry.name} (${entry.skipped})`),
  ].join('\n');
}

module.exports = { skippedIn, skippedNote };