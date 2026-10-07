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

test('no document pins the generated CONTEXT digest', () => {
  // This is deliberately NARROWER than the rule above, and the difference
  // matters.
  //
  // The rule above exempts "dated numbers as historical records", because
  // rewriting 2096 in a section headed "Scraper power guarantee (2026-09-18)"
  // would falsify what was true that day.
  //
  // A pinned digest has no such reading. A digest is a pointer to the CURRENT
  // generation of a generated file: it is meaningful for exactly one build of
  // CONTEXT.md and stale from the moment gen-context.js next runs. There is no
  // state in which quoting yesterday's digest is a historical record.
  //
  // Both copies of that pin have been removed -- memory/facts.md and
  // memory/facts-refresh-2026-09-20.md each carried
  // 5fe1c0c2599e5f9f29750963fe0c783adb7223a60b7297c2df759134c83a8f92, which a
  // live data refresh invalidated with no test watching for it.
  const offenders = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!entry.name.endsWith('.md')) continue;
      if (path.resolve(full) === path.join(ROOT, 'CONTEXT.md')) continue;
      const text = fs.readFileSync(full, 'utf8');
      const m = text.match(/digest\s*`[0-9a-f]{16,}`/i);
      if (m) offenders.push(`${path.relative(ROOT, full).split(path.sep).join('/')}: ${m[0]}`);
    }
  };
  walk(ROOT);
  assert.deepEqual(
    offenders, [],
    'these documents pin a CONTEXT.md digest. It is recomputed on every '
      + 'generation, so the copy is stale the next time data.js changes and no '
      + 'test catches it. Point at CONTEXT.md instead.',
  );
});
