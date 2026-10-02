'use strict';

// test/inventory-signal.test.js
//
// scripts/inventory.js prints a "server/ files no test NAMES" section meant to
// be a prompt for a human. It is a report, not a gate, so the only thing worth
// pinning is that the prompt is still worth reading.
//
// It once matched path.basename(f) WITH the .js extension against the test
// corpus. Tests require modules extensionless, so that predicate could never
// match a required module: it reported 48 files and 45 of them were in fact
// referenced by a test. A prompt that is 94% noise gets ignored, and then it
// is worse than not existing.
//
// These assertions are about the signal being usable, not about a coverage
// claim. A loose count ceiling is deliberate: pinning an exact number turns a
// prompt into a brittle gate that fails whenever an unrelated file is added.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'inventory.js');

function runInventory() {
  return execFileSync(process.execPath, [SCRIPT], { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
}

// Pull the flagged file names out of the report's own section header.
function parseUntested(output) {
  const match = output.match(/no test NAMES \(weak signal, not coverage\) \((\d+)\)/);
  if (!match) return null;
  const count = Number(match[1]);
  const start = output.indexOf(match[0]);
  const rest = output.slice(start);
  const end = rest.indexOf('\n\n');
  const files = rest
    .slice(0, end === -1 ? undefined : end)
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('server/'))
    .map((l) => l.replace(/ and \d+ more$/, '').trim());
  return { count, files };
}

test('the report emits a parseable untested-names section', () => {
  const section = parseUntested(runInventory());
  assert.ok(section, 'inventory.js must still print its "no test NAMES" section with a count');
  assert.ok(Number.isInteger(section.count));
  assert.ok(section.count >= 0);
});

test('a module that a wired test requires is not reported as unnamed', () => {
  // The path is assembled from fragments on purpose. The tool matches by
  // substring against the whole test corpus, so writing this module's path out
  // in full here would put it in the corpus and make the old matcher rescue it
  // - the guard would silence the very regression it exists to catch. That is
  // not hypothetical: the first draft of this file did exactly that, and the
  // report's count silently moved from 48 to 47 because of it.
  const modulePath = ['server/discovery/coverage-', 'matrix.js'].join('');
  const testPath = ['test/coverage-', 'matrix.test.js'].join('');
  const source = fs.readFileSync(path.join(ROOT, ...testPath.split('/')), 'utf8');
  assert.match(source, /server\/discovery\/coverage-matrix/, 'fixture assumption: this test requires the module');

  const section = parseUntested(runInventory());
  assert.ok(
    !section.files.includes(modulePath),
    `a required module was reported as unnamed: ${section.files.join(', ')}`
  );
});

test('the flagged list is short enough for a human to read', () => {
  // Not a coverage gate. If this number climbs back toward its old 48, the
  // matcher has regressed and the section has stopped being a prompt.
  const section = parseUntested(runInventory());
  assert.ok(
    section.count <= 10,
    `${section.count} files reported as unnamed by any test; the signal has probably regressed. Flagged: ${section.files.join(', ')}`
  );
});

test('the report still carries the caveat that this is not a coverage measurement', () => {
  const output = runInventory();
  // Two things have to survive any future edit: the section is labelled a
  // weak signal, and it is explicitly not to be read as a coverage claim.
  assert.match(output, /weak signal/i);
  assert.match(output, /never as a coverage claim|not a coverage claim|not a coverage measurement/i);
});
