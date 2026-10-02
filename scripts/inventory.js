'use strict';
// A measured inventory of what is left to do, rather than a remembered list.
// Everything here is computed from the repo, so each line is checkable.
//
//   node scripts/inventory.js            # human table
//   node scripts/inventory.js --json     # machine readable

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const JSON_OUT = process.argv.includes('--json');

const CODE_EXT = /\.(m|c)?[jt]sx?$/;
const SKIP_DIRS = new Set(['node_modules', '.git', '.next', '.next-verify', '.next-discovery-preview',
  '.next-sources-verify', '.kilo', 'coverage', 'artifacts', 'test-results']);

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') && SKIP_DIRS.has(entry.name)) continue;
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const files = walk(ROOT);
const rel = (f) => path.relative(ROOT, f).replace(/\\/g, '/');
const read = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return null; } };
const codeFiles = files.filter((f) => CODE_EXT.test(f) && !rel(f).startsWith('test/'));

const report = {};

// ---- 1. debt markers ------------------------------------------------------
const markers = [];
for (const f of codeFiles) {
  const src = read(f);
  if (!src) continue;
  for (const m of src.matchAll(/(?:^|\n)\s*(?:\/\/|\/\*|\*)\s*(TODO|FIXME|HACK|XXX|BUG):?\s*(.{0,90})/g)) {
    markers.push({ file: rel(f), kind: m[1], text: m[2].trim() });
  }
}
report.debtMarkers = markers.sort((a, b) => a.file.localeCompare(b.file));

// ---- 2. stray console noise in shipped client code ------------------------
const consoleNoise = [];
for (const f of files.filter((x) => x.includes(`${path.sep}src${path.sep}`) && CODE_EXT.test(x))) {
  const src = read(f);
  if (!src) continue;
  const n = (src.match(/console\.(log|debug)\(/g) || []).length;
  if (n) consoleNoise.push({ file: rel(f), count: n });
}
report.consoleNoise = consoleNoise.sort((a, b) => b.count - a.count);

// ---- 3. never-imported components ------------------------------------------
// A component file that nothing else references is either dead or dynamically
// loaded; both are worth knowing, and neither is currently recorded anywhere.
const allSrc = files.filter((f) => CODE_EXT.test(f)).map((f) => ({ f, src: read(f) || '' }));
const componentFiles = allSrc.filter(({ f }) => /src[\\/]components[\\/].+\.tsx$/.test(f));
const orphanComponents = [];
for (const { f } of componentFiles) {
  const base = path.basename(f).replace(/\.tsx$/, '');
  const referenced = allSrc.some(({ f: other, src }) =>
    other !== f && new RegExp(`[/"']${base}["']`).test(src));
  // page.tsx-style route files and index barrels are legitimately unreferenced.
  const isEntry = /[\\/](page|layout|route|index)\.tsx$/.test(f);
  if (!referenced && !isEntry) orphanComponents.push(rel(f));
}
report.orphanComponents = orphanComponents.sort();

// ---- 4. unused dependencies ------------------------------------------------
const pkg = JSON.parse(read(path.join(ROOT, 'package.json')));
const declared = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
const corpus = allSrc.map(({ src }) => src).join('\n');
const unusedDeps = declared.filter((d) => {
  if (d.startsWith('@types/')) return false;
  return !new RegExp(`[/"']${d.replace(/[/-]/g, '[-/]')}[/"']`).test(corpus)
    && !new RegExp(`require\\(\\s*["']${d}["']`).test(corpus);
});
report.unusedDeps = unusedDeps;

// ---- 5. source files no test file even mentions ---------------------------
// WEAK SIGNAL, kept only because it is a useful prompt for a human -- but read
// the warning before acting on it.
//
// The first version of this section listed 49 server/ files as untested. It was
// wrong. Tests exercise routes by URL path, not by module filename, so a
// handler can be thoroughly covered while its file name appears nowhere in the
// test corpus. Checked: the routes it flagged include property-image, export,
// enrichment and property-intelligence, and those paths appear 53 times across
// 11 test files.
//
// Treat this section as "no test names this file", never as "untested".
const testCorpus = files.filter((f) => rel(f).startsWith('test/'))
  .map((f) => read(f) || '').join('\n');
const serverFiles = codeFiles.filter((f) => rel(f).startsWith('server/') && !rel(f).includes('/migrations/'));
const untestedServer = serverFiles.filter((f) => {
  const base = path.basename(f);
  return !testCorpus.includes(base);
}).map(rel);
report.untestedServerNote = 'no test NAMES this file; not a coverage measurement';
report.untestedServer = untestedServer.sort();

// ---- output ---------------------------------------------------------------
if (JSON_OUT) { console.log(JSON.stringify(report, null, 2)); process.exit(0); }

const section = (title, rows, fmt) => {
  console.log(`\n=== ${title} (${rows.length}) ===`);
  rows.slice(0, 25).forEach((r) => console.log('  ' + fmt(r)));
  if (rows.length > 25) console.log(`  ... and ${rows.length - 25} more`);
};

section('Debt markers', report.debtMarkers, (r) => `${r.kind.padEnd(6)} ${r.file}  ${r.text.slice(0, 60)}`);
section('console.log/debug in src/', report.consoleNoise, (r) => `${String(r.count).padStart(3)}x ${r.file}`);
section('Components nothing imports', report.orphanComponents, (r) => `  ${r}`);
section('Dependencies no source mentions', report.unusedDeps, (r) => `  ${r}`);
section('server/ files no test NAMES (weak signal, not coverage)', report.untestedServer, (r) => `  ${r}`);
console.log('\n(scanned ' + codeFiles.length + ' code files)');
console.log('\nNOTE: the section above matches on file name only. Routes are tested by URL path,');
console.log('so a fully covered handler can appear "untested" here. Verified: property-image,');
console.log('export, enrichment and property-intelligence paths occur 53x across 11 test files.');
console.log('Use this to prompt a look, never as a coverage claim.');
