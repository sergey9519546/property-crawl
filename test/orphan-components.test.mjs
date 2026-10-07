// test/orphan-components.test.mjs
//
// A component that nothing imports is not a bug. A feature whose entire stack
// is green and reachable-looking, and which no page mounts, is.
//
// The case that prompted this:
//   src/components/listings/enrichment-view.tsx
//     -> @/lib/enrichment-api
//     -> /api/enrichment/[...path]  (route exists)
//     -> server/intelligence/enrichment-gateway.js
//
// The gateway is covered by three passing test files. The route answers. The UI
// is complete with loading, error and refresh states. Nothing imports the
// component, so no page reaches it. Every test passes, and a reader concludes
// the feature is shipped.
//
// So the rule is not "no orphans" -- this project legitimately carries a
// shadcn component library, most of which is unused by design. The rule is
// that an orphan outside that library must SAY it is one, in its own file, in
// prose a human wrote. A new orphan then fails the build and has to be either
// mounted or acknowledged, which is the decision that was missing.
//
// A source-level guard, because this project has no DOM test runner.

import assert from 'node:assert/strict';
const { default: fs } = await import('node:fs');
const { default: path } = await import('node:path');
const { default: test } = await import('node:test');

const ROOT = path.resolve(import.meta.dirname, '..');
const COMPONENT_ROOT = path.join(ROOT, 'src', 'components');

/**
 * The acknowledgement must be an explicit marker, not prose.
 *
 * The first version matched words like "unused", "dead" and "orphan" anywhere in
 * the header. That was satisfied by accident: the file documenting this very
 * guard contains the word "orphan" in its explanation, so removing its import
 * did not turn the check red. A check that any passing mention can satisfy is
 * not a check.
 *
 * So the marker is a fixed token, and it must appear in the header. Prose about
 * why a component is or is not mounted still belongs in the file; the marker
 * only records that the decision was made deliberately.
 */
const ACK_MARKER = 'acknowledged-orphan';
const EXEMPT_DIRS = {
  'src/components/ui': 'shadcn/ui library. The generator emits the full primitive set; a project uses the subset it needs. These are a component library, not features.',
};

function walk(dir, out = []) {
  // A missing directory is not an error: this project has no root-level app/,
  // the routes live under src/app/. Scanning must not depend on which of the
  // two layouts a given checkout uses.
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.tsx')) out.push(full);
  }
  return out;
}

const rel = (f) => path.relative(ROOT, f).replace(/\\/g, '/');

/** Every source file's text, for import resolution. */
const allSources = walk(path.join(ROOT, 'src'))
  .concat(walk(path.join(ROOT, 'app')))
  .map((f) => ({ f, text: fs.readFileSync(f, 'utf8') }));

/**
 * A component is reachable if some other file imports it.
 *
 * Matching the import PATH against the file's kebab-case name is the whole
 * check, and it works. Three attempts were made to also require a real render,
 * so that a dangling import could not keep a deleted component alive, and all
 * three produced false positives rather than catching the hole:
 *
 *   - match a JSX usage of the FILENAME. Impossible: the file is
 *     `discovery-card.tsx` and the markup is `<DiscoveryCard>`, so this matched
 *     nothing and reported 58 live components as orphans.
 *   - derive the exported PascalCase name and match that. Correct in
 *     principle, but the import-path signal still fires for a dangling import,
 *     so the hole survived; keeping the import signal and requiring a render
 *     both means re-exports and dynamic imports have to be special-cased too,
 *     and every special case is another way to be wrong.
 *   - strip import lines and search the remainder. Same 58, from the other
 *     side: imports here are single-line, so stripping removed the only
 *     mention of 58 live components.
 *
 * So the hole stands, documented: an import left behind after the usage was
 * deleted will still read as mounted. That is a small miss, and it is cheaper
 * than the 58 false positives that every attempt to remove it produced. The
 * check that ships catches the case that actually happens -- a component nobody
 * imported at all -- which is how the enrichment view was found in the first
 * place.
 */
function isReferenced(name) {
  return allSources.some(
    ({ f: other, text }) => other !== name && new RegExp(`[/"']${name}["']`).test(text),
  );
}

/** Components nothing references. Route/layout/page files are entries, not leaves. */
function orphans() {
  const found = [];
  for (const f of walk(COMPONENT_ROOT)) {
    if (/(^|[\\/])(page|layout|route|template|loading|error|not-found|default)\.tsx$/.test(f)) continue;
    const name = path.basename(f, '.tsx');
    if (isReferenced(name)) continue;
    found.push(f);
  }
  return found;
}

test('every orphaned component is either exempt or says so in its own file', () => {
  const undocumented = [];
  for (const f of orphans()) {
    const r = rel(f);
    if (Object.keys(EXEMPT_DIRS).some((dir) => r.startsWith(dir + '/'))) continue;
    const head = fs.readFileSync(f, 'utf8').slice(0, 900);
    const acknowledged = head.includes(ACK_MARKER);
    if (!acknowledged) undocumented.push(r);
  }
  assert.deepEqual(undocumented, [],
    `these components are imported by nothing and do not say so. Either mount them or ` +
    `record why they are unused, in the file: ${undocumented.join(', ')}`);
});

test('every exemption carries a written reason', () => {
  for (const [dir, reason] of Object.entries(EXEMPT_DIRS)) {
    assert.ok(reason && reason.length > 20,
      `${dir} is exempt with no real reason; an unexplained exemption is where code goes to disappear`);
  }
});

test('the detector can actually find an orphan', () => {
  // Prove the scan works, so a passing run means "no unacknowledged orphans"
  // and not "the scan quietly found nothing".
  const fake = { f: path.join(COMPONENT_ROOT, 'ghost-widget.tsx'), text: '' };
  const name = 'ghost-widget';
  const foundByScan = allSources.some(({ f, text }) => f !== fake.f && new RegExp(`[/"']${name}["']`).test(text));
  assert.equal(foundByScan, false, 'an unreferenced name must not appear to be imported');
  assert.ok(allSources.length > 50, 'the corpus being scanned should be substantial');
});

// --- src/lib is a second orphan surface ---------------------------------
//
// The component scan above only walks .tsx under src/components, which is how
// intelligence-client.ts got through: it is a .ts module, it exports three
// typed and tested functions, and nothing imports it. The file reads as a
// client, the three routes read as features, the proxy forwards to them --
// and no user can reach any of it.
//
// Same rule applies: a module nothing imports must SAY so, in its own file.
// Two differences from the component case:
//
//   - a lib module may legitimately be used by scripts/ or test/ rather than
//     by the UI, so "imported" is checked against all three corpora. A module
//     used only by a CLI is not an orphan.
//   - .d.ts files are ambient declarations by definition and are never
//     imported. Requiring a marker from them would be noise, so they are
//     excluded outright rather than acknowledged.

const LIB_ROOT = path.join(ROOT, 'src', 'lib');
const ACK_HEAD_BYTES = 900;

function walkAll(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkAll(full, out);
    else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) out.push(full);
  }
  return out;
}

const libModules = walkAll(LIB_ROOT);

// The import corpus must include every source extension, not just .tsx. The
// component scan above reuses the .tsx-only walker because components are
// .tsx; a first attempt here reused it too and reported six orphans, four of
// which are src/app/api/*/route.ts files that import the lib module they use.
// Those are .ts, and a .tsx-only corpus cannot see them.
function walkSource(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkSource(full, out);
    else if (/\.(ts|tsx|js|mjs)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) out.push(full);
  }
  return out;
}

function walkTestFiles(dir = path.join(ROOT, 'test'), out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkTestFiles(full, out);
    else if (/\.(ts|tsx|mjs|js)$/.test(entry.name)) out.push(full);
  }
  return out;
}

// src + app, plus scripts and test: a lib module consumed only by a CLI or a
// test is used, not orphaned.
const nonUiCorpus = walkSource(path.join(ROOT, 'src'))
  .concat(walkSource(path.join(ROOT, 'app')))
  .concat(walkTestFiles())
  .map((f) => ({ f, text: fs.readFileSync(f, 'utf8') }));

function libIsReferenced(file) {
  const base = path.basename(file).replace(/\.(ts|tsx)$/, '');
  return nonUiCorpus.some((o) => o.f !== file && new RegExp(`[/"']${base}["']`).test(o.text));
}

test('every unimported src/lib module is either exempt or says so in its own file', () => {
  const undocumented = [];
  for (const f of libModules) {
    if (libIsReferenced(f)) continue;
    const head = fs.readFileSync(f, 'utf8').slice(0, ACK_HEAD_BYTES);
    if (!head.includes(ACK_MARKER)) undocumented.push(rel(f));
  }
  assert.deepEqual(undocumented, [],
    `these src/lib modules are imported by nothing -- not by src, scripts or tests -- and `
    + `do not say so. Either use them or record why they are unused, in the file: `
    + `${undocumented.join(', ')}`);
});

test('the lib detector can actually find an unimported module', () => {
  // Same self-test discipline as the component scan: prove the corpus is real
  // and that the reference check is not trivially true for everything.
  assert.ok(libModules.length > 5, 'the corpus being scanned should be substantial');
  assert.equal(libModules.some((f) => f.endsWith('.d.ts')), false,
    '.d.ts files are ambient declarations and are never imported; they are excluded, not acknowledged');
  const unreferenced = libModules.filter((f) => !libIsReferenced(f));
  assert.ok(unreferenced.length >= 1,
    'expected at least intelligence-client.ts to be unreferenced; if none are, the reference '
    + 'check is matching too loosely to be useful');
});
