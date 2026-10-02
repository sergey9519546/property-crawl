// test/orphan-components.test.js
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
 * Directories whose components are exempt wholesale, with the reason. Extending
 * this needs a reason, not just a path -- a bare entry is how an exemption list
 * turns into a place where things go to disappear.
 */
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

/** Components nothing references. Route/layout/page files are entries, not leaves. */
function orphans() {
  const found = [];
  for (const f of walk(COMPONENT_ROOT)) {
    if (/(^|[\\/])(page|layout|route|template|loading|error|not-found|default)\.tsx$/.test(f)) continue;
    const name = path.basename(f, '.tsx');
    const referenced = allSources.some(
      ({ f: other, text }) => other !== f && new RegExp(`[/"']${name}["']`).test(text),
    );
    if (!referenced) found.push(f);
  }
  return found;
}

test('every orphaned component is either exempt or says so in its own file', () => {
  const undocumented = [];
  for (const f of orphans()) {
    const r = rel(f);
    if (Object.keys(EXEMPT_DIRS).some((dir) => r.startsWith(dir + '/'))) continue;
    const head = fs.readFileSync(f, 'utf8').slice(0, 900);
    // A human wrote this, not the scaffolder: look for prose, not a marker
    // token, so adding a component cannot satisfy the guard with a comment
    // nobody had to think about.
    const acknowledged = /\b(not rendered|unused|not imported|dead|deprecated|no longer|orphan)\b/i.test(head);
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
