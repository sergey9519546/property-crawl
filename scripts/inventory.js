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
//
// Two very different things land in this list and the first version conflated
// them, which is how 29 shadcn primitives ended up looking like 29 findings:
//
//   * src/components/ui/** -- a shadcn component library. The generator emits
//     the full primitive set and a project uses the subset it needs. Unused
//     ones are the normal state, not a defect.
//   * everything else -- an app component. Unused means a feature nothing can
//     reach, which is a real finding. src/components/listings/enrichment-view.tsx
//     is the one that matters: a complete, tested, unreachable feature.
//
// page/layout/route files are entries, not leaves, so they are not orphans.
const allSrc = files.filter((f) => CODE_EXT.test(f)).map((f) => ({ f, src: read(f) || '' }));
const componentFiles = allSrc.filter(({ f }) => /src[\\/]components[\\/].+\.tsx$/.test(f));
const UI_LIBRARY = 'src/components/ui/';
const orphanComponents = [];
const orphanLibrary = [];
for (const { f, src } of componentFiles) {
  const base = path.basename(f).replace(/\.tsx$/, '');
  const referenced = allSrc.some(({ f: other, src: otherSrc }) =>
    other !== f && new RegExp(`[/"']${base}["']`).test(otherSrc));
  const isEntry = /[\\/](page|layout|route|index)\.tsx$/.test(f);
  if (referenced || isEntry) continue;
  const r = rel(f);
  // An orphan that explains itself in its own file has been dealt with.
  const acknowledged = /\b(not rendered|unused|not imported|dead|deprecated|no longer|orphan)\b/i
    .test(src.slice(0, 900));
  (r.startsWith(UI_LIBRARY) ? orphanLibrary : orphanComponents)
    .push(acknowledged ? `${r}  (acknowledged in-file)` : r);
}
report.orphanComponents = orphanComponents.sort();
report.orphanLibraryComponents = orphanLibrary.sort();
report.orphanNote = 'src/components/ui/* is a shadcn library; unused primitives there are expected';

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
// History, because the shape of the bug is the point:
//   1. The first version listed 49 server/ files as untested. It was wrong.
//      Tests exercise routes by URL path, not by module filename, so a handler
//      can be thoroughly covered while its file name appears nowhere.
//   2. The second version matched `path.basename(f)` - WITH the .js extension -
//      against the test corpus. Tests require modules EXTENSIONLESS
//      (`require('../server/discovery/coverage-matrix')`), so that predicate was
//      incapable of matching a required module and could only ever fire on a
//      file no test mentions at all. It reported 48 files; 45 of them were
//      demonstrably referenced by a test, including coverage-matrix.js, which
//      test/coverage-matrix.test.js requires and test:ops runs.
//
// So: match the extensionless stem, and also count a test file named after the
// module. Measured on this tree that is 48 -> 3. The three that remain are
// genuinely unnamed by any test, which is what the label below claims.
//
// Treat this section as "no test names this file", never as "untested". The
// stem match is a substring match, so it can rescue a file whose stem happens
// to appear for unrelated reasons (e.g. "validation"). That makes the list
// shorter, never longer than the truth; a short list is a prompt, not a claim.
const testCorpus = files.filter((f) => rel(f).startsWith('test/'))
  .map((f) => read(f) || '').join('\n');
const testFileNames = new Set(files.filter((f) => rel(f).startsWith('test/')).map((f) => path.basename(f)));
const serverFiles = codeFiles.filter((f) => rel(f).startsWith('server/') && !rel(f).includes('/migrations/'));
const untestedServer = serverFiles.filter((f) => {
  const stem = path.basename(f).replace(/\.(js|mjs|cjs|ts|tsx)$/, '');
  if (testFileNames.has(`${stem}.test.js`) || testFileNames.has(`${stem}.test.mjs`)) return false;
  return !testCorpus.includes(stem);
}).map(rel);
report.untestedServerNote = 'no test NAMES this file; not a coverage measurement';
report.untestedServer = untestedServer.sort();

// ---- 6. API route handlers no client source calls -------------------------
// Run as a NEGATIVE RESULT, recorded so the sweep is not repeated.
//
// 39 route handlers; 4 have no reference anywhere under src/. All four were
// checked and all four are legitimate, so nothing is added to a guard. Matching
// is on the STATIC PREFIX -- the path up to the first dynamic segment --
// deliberately over-counts, so the failure mode is missing a real orphan rather
// than accusing a live route.
//
//   /api/health/ready                   infrastructure, not a browser route:
//                                      scripts/start-production.js:81 blocks
//                                      on it as the advanced-readiness gate
//   /api/source-network/unbrowse/status  scripts/e2e-user-workflow.js:154
//   /api/source-network/unbrowse/intake  HTTP-level coverage in
//                                      test/unbrowse-http.test.js
//   /api/sources                        test/server.test.js
//
// No guard is written for this, and that is the point. A check that needs a
// four-entry exemption list on its first run is not catching anything -- it is
// documenting the codebase. The exemption list is where code goes to disappear.
function apiRoutesWithoutClientCaller() {
  const apiDir = path.join(ROOT, 'src', 'app', 'api');
  if (!fs.existsSync(apiDir)) return { total: 0, orphans: [] };
  const handlers = [];
  (function collect(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) collect(full);
      else if (e.name === 'route.ts') handlers.push(full);
    }
  })(apiDir);

  const clientCorpus = files
    .filter((f) => !f.startsWith(apiDir) && CODE_EXT.test(f))
    .map((f) => read(f) || '').join('\n');

  const orphans = [];
  for (const f of handlers) {
    const url = '/' + rel(f).replace(/^src\/app\//, '').replace(/\/route\.ts$/, '');
    const staticPrefix = url.split('/').filter((seg) => !seg.startsWith('[')).join('/');
    const re = new RegExp(staticPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\w-])');
    if (!re.test(clientCorpus)) orphans.push({ url, staticPrefix });
  }
  return { total: handlers.length, orphans };
}
report.apiRoutesWithoutClientCaller = apiRoutesWithoutClientCaller();

// ---- output ---------------------------------------------------------------
if (JSON_OUT) { console.log(JSON.stringify(report, null, 2)); process.exit(0); }

const section = (title, rows, fmt) => {
  console.log(`\n=== ${title} (${rows.length}) ===`);
  rows.slice(0, 25).forEach((r) => console.log('  ' + fmt(r)));
  if (rows.length > 25) console.log(`  ... and ${rows.length - 25} more`);
};

section('Debt markers', report.debtMarkers, (r) => `${r.kind.padEnd(6)} ${r.file}  ${r.text.slice(0, 60)}`);
section('console.log/debug in src/', report.consoleNoise, (r) => `${String(r.count).padStart(3)}x ${r.file}`);
section('Unreferenced app components (real findings)', report.orphanComponents, (r) => `  ${r}`);
section('Unreferenced shadcn primitives (expected)', report.orphanLibraryComponents, (r) => `  ${r}`);
console.log(`  (${report.orphanLibraryComponents.length} of these are src/components/ui/*, a shadcn`);
console.log('   library the generator emits in full. Unused there is normal, not a defect.)');
section('Dependencies no source mentions', report.unusedDeps, (r) => `  ${r}`);
section('server/ files no test NAMES (weak signal, not coverage)', report.untestedServer, (r) => `  ${r}`);
console.log('\n(scanned ' + codeFiles.length + ' code files)');
console.log('\nNOTE: the section above matches on file name only. Routes are tested by URL path,');
console.log('so a fully covered handler can appear "untested" here. Verified: property-image,');
console.log('export, enrichment and property-intelligence paths occur 53x across 11 test files.');
console.log('Use this to prompt a look, never as a coverage claim.');

const apiOrphans = report.apiRoutesWithoutClientCaller;
console.log(`\n=== API route handlers with no client reference (${apiOrphans.total} total) ===`);
if (apiOrphans.orphans.length === 0) {
  console.log('  none -- every route handler is referenced from somewhere in the repo');
  console.log('');
  console.log('  Investigated 2026-10 and deliberately NOT guarded. A scan restricted to');
  console.log('  src/ flagged four, and all four turned out to have real callers outside it:');
  console.log('    /api/health/ready                    scripts/start-production.js:81 (boot gate)');
  console.log('    /api/source-network/unbrowse/status  scripts/e2e-user-workflow.js:154');
  console.log('    /api/source-network/unbrowse/intake  test/unbrowse-http.test.js');
  console.log('    /api/sources                         test/server.test.js');
  console.log('  A check needing a four-entry exemption list on its first run is not catching');
  console.log('  anything; it is documenting the codebase. Exemption lists are where code goes');
  console.log('  to disappear, so this stays a report and not a gate.');
} else {
  for (const o of apiOrphans.orphans) {
    console.log(`  ${o.url}`);
    console.log(`     static prefix: ${o.staticPrefix}`);
  }
  console.log('\n  Known and explained (not orphans, all verified 2026-10):');
  console.log('    /api/health/ready                    -> scripts/start-production.js:81 (boot gate)');
  console.log('    /api/source-network/unbrowse/status  -> scripts/e2e-user-workflow.js:154');
  console.log('    /api/source-network/unbrowse/intake  -> test/unbrowse-http.test.js');
  console.log('    /api/sources                         -> test/server.test.js');
  console.log('  Any route listed above those four is a NEW finding. Matching is on the static');
  console.log('  prefix and deliberately over-counts, so it misses rather than falsely accuses.');
}
