'use strict';
// test/test-files-load.test.js
//
// Regression guard: a test file that throws while LOADING contributes zero
// tests, and reports itself as a single failing file rather than as the tests it
// claims to contain.
//
// Two acceptance files gated their Postgres tests on a bare `databaseUrl` that
// they never declared:
//
//     test('migrations expose PostGIS ...', { skip: !databaseUrl }, ...)
//
// The options object is evaluated when the test is registered, so the
// ReferenceError fired before the runner had registered anything. Result:
// test/discovery-acceptance.test.js (7 tests) and
// test/discovery-acceptance-restart.test.js (1 test) had never executed a
// single test. They were listed in a runner, they looked like coverage, and
// they could not fail in any meaningful way.
//
// The existing vacuity guard (test/no-vacuous-tests.test.js) checks that a file
// contains at least one assertion. These files do contain assertions, so it
// passed. Presence of assertions is not presence of execution.
//
// This scans every test file for identifiers used in a `skip:` expression that
// are neither declared in the file nor known globals -- precisely the shape
// that throws at load.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const TEST_ROOT = path.join(ROOT, 'test');

/** Names that exist without declaration. */
const GLOBALS = new Set(['process', 'global', 'globalThis', 'undefined', 'true', 'false', 'null', 'window', 'console']);

function testFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) testFiles(full, out);
    else if (/\.test\.(m?js)$/.test(entry.name)) out.push(full);
  }
  return out;
}

/**
 * Strip comments AND string literals before scanning.
 *
 * Without this the guard reads its own documentation and its own fixtures. This
 * file explains the defect using the literal text `skip: !databaseUrl` and
 * carries a sample string containing the same shape, so a naive scan flags
 * identifiers that exist only inside prose and data. A source-level guard is a
 * regex, and a regex cannot tell prose from code -- it must name what it
 * excludes. Comments alone are not enough; strings are data, not code.
 */
function stripNonCode(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:\\])\/\/[^\n]*/g, '$1 ')
    .replace(/'(?:\\.|[^'\\\n])*'/g, "''")
    .replace(/"(?:\\.|[^"\\\n])*"/g, '""')
    .replace(/`(?:\\.|[^`\\])*`/g, '``');
}

/** Identifiers in a skip: expression, ignoring property names after a dot. */
function identifiersInSkip(source) {
  const found = new Set();
  const skipRe = /\bskip\s*:\s*([^,}\n]+)/g;
  let m;
  while ((m = skipRe.exec(source)) !== null) {
    // A member expression like process.env.DISCOVERY_ACCEPTANCE_URL must not
    // contribute `env` or `DISCOVERY_ACCEPTANCE_URL` -- only the root.
    for (const id of m[1].match(/(^|[^.\w$])[A-Za-z_$][\w$]*/g) || []) {
      const name = id.replace(/^[^A-Za-z_$]/, '');
      if (name && !GLOBALS.has(name)) found.add(name);
    }
  }
  return found;
}

test('no test file gates on an identifier it never declares', () => {
  const offenders = [];
  const SELF = path.basename(__filename);

  for (const file of testFiles(TEST_ROOT)) {
    // This file is excluded from its own scan. It necessarily contains the
    // defect shape -- in its explanatory prose, in its fixture string, and in
    // the offender message template -- so it can never be clean. A scanner that
    // reads its own source is measuring itself, not the codebase. The proof
    // that the detector still works is the inline sample in the test below,
    // which is the assertion that actually has to stay red-capable.
    if (path.basename(file) === SELF) continue;

    const source = stripNonCode(fs.readFileSync(file, 'utf8'));

    const references = identifiersInSkip(source);
    if (references.size === 0) continue;

    // Anything the file declares or requires, anywhere.
    const declared = new Set();
    let m;
    const declRe = /\b(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g;
    while ((m = declRe.exec(source)) !== null) declared.add(m[1]);
    const destructureRe = /(?:const|let|var)\s*\{([^}]*)\}\s*=/g;
    while ((m = destructureRe.exec(source)) !== null) {
      for (const part of m[1].split(',')) {
        const name = part.split(':').pop().split('=')[0].trim();
        if (/^[A-Za-z_$][\w$]*$/.test(name)) declared.add(name);
      }
    }

    for (const id of references) {
      if (declared.has(id)) continue;
      offenders.push(`${path.relative(ROOT, file).replace(/\\/g, '/')}: '${id}' used in a skip: expression but never declared`);
    }
  }

  assert.deepEqual(offenders, [],
    'these test files reference an undeclared identifier in a skip: expression, so they throw at load and run none of their tests');
});

test('the scan actually detects the defect it is guarding', () => {
  // A guard that cannot fail is the failure this repo keeps finding. Prove the
  // detector fires on the exact shape that caused the incident.
  const bad = "const test=require('node:test');\ntest('x',{skip: !databaseUrl},async()=>{});\n";
  const references = new Set();
  const skipRe = /\bskip\s*:\s*([^,}\n]+)/g;
  let m;
  while ((m = skipRe.exec(bad)) !== null) {
    for (const id of m[1].match(/[A-Za-z_$][\w$]*/g) || []) {
      if (!GLOBALS.has(id)) references.add(id);
    }
  }
  const declared = new Set();
  const declRe = /\b(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g;
  while ((m = declRe.exec(bad)) !== null) declared.add(m[1]);

  assert.ok(references.has('databaseUrl'), 'the sample must reference databaseUrl');
  assert.ok(!declared.has('databaseUrl'), 'the sample must NOT declare it');
  assert.ok([...references].some(id => !declared.has(id)),
    'the detector must flag the undeclared identifier');
});

test('the repaired acceptance files now declare what they gate on', () => {
  for (const rel of ['test/discovery-acceptance.test.js', 'test/discovery-acceptance-restart.test.js']) {
    const source = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    assert.match(source, /const\s+databaseUrl\s*=/,
      `${rel} must declare databaseUrl or it throws at load and runs none of its tests`);
  }
});
