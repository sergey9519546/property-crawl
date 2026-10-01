'use strict';

// test/docs-no-hand-copied-counts.test.js
//
// A count copied by hand into a document rots silently. In this repo the
// listing count moved from 2093 to 2094 and AGENTS.md carried the stale
// number in three places, including a line whose whole purpose was to be
// the authoritative description of the data model. Nothing failed: the
// document simply became wrong, and a reader had no way to tell.
//
// CONTEXT.md is the generated, digest-checked authority
// (scripts/gen-context.js --check runs in CI via test/context.test.js).
// Documents should point at it, not restate it.
//
// The rule enforced here: AGENTS.md, the governing document, must not embed a
// bare four-digit listing count. Other files legitimately quote dated numbers as
// historical records, so they are out of scope.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const agentsMd = fs.readFileSync(path.join(ROOT, 'AGENTS.md'), 'utf8');

test('AGENTS.md points at CONTEXT.md instead of embedding a listing count', () => {
  // A bare four-digit count in a sentence about listings is a hand-copied
  // total. Note the pattern: two-digit century plus TWO more digits. Using
  // \d{3} here would require five digits and would never match a four-digit
  // year at all, which is how this check silently became vacuous once already.
  // The exception is a dated historical observation, which is labelled as such.
  const offending = agentsMd
    .split('\n')
    .map((line, index) => ({ line, number: index + 1 }))
    .filter(({ line }) => /\b(?:19|20)\d{2}\b/.test(line))
    .filter(({ line }) => /\b(listings?|records?|total=|LISTINGS)\b/i.test(line))
    .filter(({ line }) => !/as of|on that date|were committed|observed on/i.test(line));

  assert.deepEqual(
    offending.map(({ number, line }) => `AGENTS.md:${number} ${line.trim()}`),
    [],
    'AGENTS.md restates a listing total that will drift. Reference the generated '
      + 'CONTEXT.md instead, or label the figure as a dated historical observation.',
  );
});

test('AGENTS.md still tells a reader where the authoritative totals live', () => {
  assert.match(agentsMd, /CONTEXT\.md/);
  assert.match(agentsMd, /auto-generated, do not hand-edit|do not hand-edit/i);
});

test('the generated digest check exists and is wired into CI', () => {
  // The pointer above is only useful if CONTEXT.md is actually verified.
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const allScripts = Object.values(pkg.scripts).join('\n');
  assert.match(
    allScripts,
    /context\.test\.js/,
    'test/context.test.js must be reachable from a test runner or the digest is unverified',
  );
  const genContext = fs.readFileSync(path.join(ROOT, 'scripts', 'gen-context.js'), 'utf8');
  assert.match(genContext, /createHash|sha256/i, 'gen-context must hash its inputs');
});
