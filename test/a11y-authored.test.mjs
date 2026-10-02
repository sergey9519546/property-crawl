// test/a11y-authored.test.js
//
// Accessibility guard for what the source can be held to.
//
// Measured first, and the measurement is the point. Lighthouse returns an empty
// report in this environment, so a CDP audit was written instead and run against
// a real production build with the full stack:
//
//     /  /listings  /hunts  /sources  /research  /workspace
//     /sign-in  /register
//     /listings/CIV-NJ-10-2129335075  /listings/CIV-NJ-10-2129335092
//     -> 0 violations across 10 routes
//
// The two listing detail pages were audited in a second pass, with ids pulled
// from the live API rather than guessed, after the first pass turned out to have
// skipped them.
//
// /research/[id] is not in the dynamic list, and the split is worth being
// precise about rather than calling it a flat gap:
//
//   AUTHORED MARKUP -- covered. This guard walks all 133 .tsx files under src/,
//   which includes src/app/research/[id]/page.tsx (and every other route page).
//   That file has no <img> and no literal tabIndex, so it passes both rules.
//   The earlier claim that it was "not covered" came from a probe of mine that
//   compared forward-slash paths against Windows backslash ones -- the guard was
//   scanning it the whole time.
//
//   RUNTIME CONTENT -- not covered. The page renders a research case fetched
//   from /api/workspace/cases, which is behind the operator key (401 without
//   it). Markup produced from that data is invisible here and to the dynamic
//   audit. Using the deployment's own key to seed a QA run is a call for the
//   owner to make, not one to make quietly inside an audit.
//
// That zero was then CONTROLLED rather than trusted. Lighthouse's empty report
// in this same environment is a standing reminder that a checker reporting
// nothing may be reporting nothing because it is broken. One element carrying a
// deliberate violation of every class below was injected into a live page, and
// the audit was re-run: it caught all seven. So the zero is a measurement.
//
// This guard covers the subset decidable from source, which is the subset that
// can run in CI in a second. It cannot see markup produced at runtime, so it is
// a floor, not the whole picture -- the dynamic audit above is the other half.
//
// A duplicate-id check was written here and then removed. It flagged
// src/app/listings/[id]/page.tsx, and it was wrong to: `id="market-evidence"`
// appears on opposite branches of one ternary -- a <div> when evidence was
// captured, a <details> when it was not -- so exactly one renders and the
// anchor works either way. Deciding whether two ids are mutually exclusive
// needs control-flow analysis, not a regex, and a guard that fires on correct
// code gets switched off. The dynamic audit checks duplicate ids in the live
// DOM, where the question is decidable, and reports zero. That is the only
// place this check belongs.

import assert from 'node:assert/strict';
const { default: fs } = await import('node:fs');
const { default: path } = await import('node:path');
const { default: test } = await import('node:test');

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC = path.join(ROOT, 'src');

const SKIP = new Set(['node_modules', '.next', '.next-verify', '.next-sources-verify', '.kilo']);

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (/\.tsx$/.test(e.name)) out.push(full);
  }
  return out;
}

/** Comments are where the documentation lives, and a regex cannot tell prose from code. */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:\\])\/\/[^\n]*/g, '$1 ');
}

const files = walk(SRC).map((f) => ({ f, src: stripComments(fs.readFileSync(f, 'utf8')) }));
const rel = (f) => path.relative(ROOT, f).replace(/\\/g, '/');

test('every img in source carries an alt attribute', () => {
  const bad = [];
  for (const { f, src } of files) {
    for (const m of src.matchAll(/<img\b([^>]*)>/g)) {
      if (!/\balt\s*=/.test(m[1])) bad.push(`${rel(f)}  <img${m[1].slice(0, 40)}>`);
    }
  }
  assert.deepEqual(bad, [],
    'img without alt. Decorative images need alt="", meaningful ones need text: ' + bad.join(' | '));
});

test('no positive tabIndex -- it overrides the natural focus order', () => {
  const bad = [];
  for (const { f, src } of files) {
    for (const m of src.matchAll(/tabIndex\s*=\s*\{\s*(\d+)\s*\}/g)) {
      if (Number(m[1]) > 0) bad.push(`${rel(f)}  tabIndex={${m[1]}}`);
    }
  }
  assert.deepEqual(bad, [],
    'positive tabIndex breaks keyboard and screen-reader navigation: ' + bad.join(' | '));
});

test('every iframe carries a title', () => {
  const bad = [];
  for (const { f, src } of files) {
    for (const m of src.matchAll(/<iframe\b([^>]*)>/g)) {
      if (!/\btitle\s*=/.test(m[1])) bad.push(`${rel(f)}  <iframe${m[1].slice(0, 40)}>`);
    }
  }
  assert.deepEqual(bad, [], 'iframe without title: ' + bad.join(' | '));
});

test('the scanner can actually find each violation it claims to check', () => {
  // Prove the patterns fire, so a clean run means "clean" and not "the regex
  // silently matches nothing". Every guard in this repo has had that failure.
  const probe = `
    const img = <img src="a.png" />;
    const idx = <div tabIndex={4} />;
    const frame = <iframe src="about:blank" />;
    const ok = <img src="b.png" alt="a real description" />;
  `;
  const imgs = [...probe.matchAll(/<img\b([^>]*)>/g)];
  assert.equal(imgs.length, 2);
  assert.equal(imgs.filter((m) => /\balt\s*=/.test(m[1])).length, 1,
    'the alt check must distinguish the two images');
  assert.ok(/\btabIndex\s*=\s*\{\s*4\s*\}/.test(probe), 'positive tabIndex must be detectable');
  assert.ok(/<iframe\b(?![^>]*\btitle\s*=)/.test(probe), 'a titleless iframe must be detectable');
});
