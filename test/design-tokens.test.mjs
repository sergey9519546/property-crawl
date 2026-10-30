// Design-token guard (docs/DESIGN_SYSTEM.md, section "Governance").
//
// Locks in the palette 02 rollout. Buyer-facing code speaks tokens (text-ink,
// bg-catch-wash, ...), never raw Tailwind hues or the old slate hexes, and the
// hand-sized type and radius debt can only shrink. Each rule has a control
// check so the guard can't pass by matching nothing.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const ROOT = path.resolve(import.meta.dirname, '..');

// Not migrated on purpose: the shadcn library (themed through CSS variables in
// globals.css), the hero and its map (kept by the owner), and staff-only tools.
const LEGACY = [
  /^src\/components\/ui\//,
  /^src\/components\/site\/hero\.tsx$/,
  /^src\/components\/site\/deal-discovery-map\.tsx$/,
  /^src\/components\/(research|sources|documents|activity)\//,
  /^src\/components\/workspace\/(review-split-pane|operator-unlock-form)\.tsx$/,
  /^src\/app\/(workspace|research)\//,
];

// Lower these when the debt shrinks; never raise them. Use text-display/title/
// lead/body/meta/label and rounded-card/control/full instead.
const BASELINE = { pxType: 395, pxRadius: 16 };

const OLD_PALETTE = /\b(?:bg|text|border|ring|fill|stroke|from|via|to|divide|outline|decoration|accent|placeholder|caret)-(?:slate|gray|zinc|neutral|stone|amber|emerald|indigo|green|red|blue|sky|violet|rose|orange|yellow|purple|teal|cyan|lime|fuchsia|pink)-\d{2,3}\b|#(?:0F172A|111827|1E293B|E2E8F0|F8FAFC|64748B|475569|334155)\b/gi;
const SOLID_WHITE = /\bbg-white(?![/\w-])/g;
const PX_TYPE = /\btext-\[\d+(?:\.\d+)?px\]/g;
const PX_RADIUS = /\brounded-\[\d+px\]/g;
const CLASS_STRINGS = /className=(?:"[^"]*"|\{`[^`]*`\})/g;

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(tsx|ts)$/.test(entry.name)) out.push(path.relative(ROOT, full).split(path.sep).join('/'));
  }
  return out;
}

const files = ['src/app', 'src/components', 'src/lib']
  .flatMap((dir) => walk(path.join(ROOT, dir)))
  .filter((file) => !LEGACY.some((re) => re.test(file)));
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const count = (re) => files.reduce((n, file) => n + (read(file).match(re) || []).length, 0);

test('the guard scans the real buyer-facing surface', () => {
  assert.ok(files.length > 100, `only ${files.length} files in scope`);
  for (const must of ['src/app/listings/[id]/page.tsx', 'src/components/site/storyteller.tsx', 'src/components/terminal/interactive-terminal.tsx']) {
    assert.ok(files.includes(must), `${must} must be in scope`);
  }
});

test('buyer-facing code uses palette tokens, not raw Tailwind hues or old slate hexes', () => {
  // Control: the pattern does catch the old palette, and not its look-alikes.
  for (const bad of ['bg-slate-100', 'text-emerald-700', 'border-amber-200', 'ring-[#0F172A]']) assert.match(bad, new RegExp(OLD_PALETTE.source, 'i'), bad);
  for (const ok of ['-translate-x-1/2', 'text-catch-ink', 'bg-go-wash', 'text-ink-3']) assert.doesNotMatch(ok, new RegExp(OLD_PALETTE.source, 'i'), ok);

  const offenders = files.flatMap((file) => {
    const hits = read(file).match(OLD_PALETTE);
    return hits ? [`${file}: ${[...new Set(hits)].slice(0, 5).join(', ')}`] : [];
  });
  assert.deepEqual(offenders, [], 'Use the tokens in docs/DESIGN_SYSTEM.md section 4 (pick by meaning: catch, yours, go, ink).');
});

test('surfaces use bg-card, not bg-white (translucent white on dark is fine)', () => {
  assert.match('bg-white', SOLID_WHITE);
  assert.doesNotMatch('bg-white/10', new RegExp(SOLID_WHITE.source));
  const offenders = files.filter((file) => new RegExp(SOLID_WHITE.source).test(read(file)));
  assert.deepEqual(offenders, []);
});

test('no white text on go-fill: that pair is 2.5:1 and fails AA', () => {
  const pairs = (src) => (src.match(CLASS_STRINGS) || []).filter((cls) => /\bbg-go-fill(?![/\w-])/.test(cls) && /\btext-white\b/.test(cls));
  assert.equal(pairs('<a className="bg-go-fill text-white">').length, 1, 'control');
  assert.equal(pairs('<a className="bg-go-fill/15 text-white">').length, 0, 'control: a tint is fine');
  const offenders = files.filter((file) => pairs(read(file)).length);
  assert.deepEqual(offenders, [], 'Use bg-go with white text, or bg-go-fill with text-ink.');
});

test('hand-sized type and radii only go down (ratchet)', () => {
  const pxType = count(PX_TYPE);
  const pxRadius = count(PX_RADIUS);
  assert.ok(pxType <= BASELINE.pxType, `text-[Npx] grew to ${pxType} (baseline ${BASELINE.pxType}). Use the type scale.`);
  assert.ok(pxRadius <= BASELINE.pxRadius, `rounded-[Npx] grew to ${pxRadius} (baseline ${BASELINE.pxRadius}). Use rounded-card/control/full.`);
});

test('shadcn semantic variables are mapped onto the palette', () => {
  const css = read('src/app/globals.css');
  const value = (name) => css.match(new RegExp(`\\n\\s*${name}:\\s*([^;]+);`))?.[1].trim();
  assert.equal(value('--primary'), '#181529', 'primary is ink');
  assert.equal(value('--destructive'), '#a92e14', 'errors borrow catch-ink');
  assert.equal(value('--ring'), '#4f6bf6', 'focus is periwinkle');
  // The bug this caught once: bg-card resolves through --card, so the two must agree.
  assert.equal(value('--card'), value('--color-card'), '--card must equal --color-card or bg-card drifts');
});
