'use strict';

// test/no-dead-duplicates.test.js
//
// The Next.js port (commit f515a5f) copied backend modules into src/lib/.
// server/ became canonical, and the copies were never removed. They sat there
// for months looking like maintained code:
//
//   src/lib/db/client.js       790-line fork, NINE exports behind the real one
//                              (no applyCrossSourceBakeOff, computeBakeOff,
//                              postgresReachable, postgresError, aiCacheStore,
//                              the workspace-store fields)
//   src/lib/security/validation.js  a DIVERGED second validator
//   src/lib/security/sanitizer.js   byte-identical duplicate
//   src/lib/ai/{cache,cost_tracker,model_router,bidding-simulator}.js
//
// Reachable by nothing in src/ or server/. And test/live-cache-refresh.test.js
// ran every case against both clients as a "parity" check, so the suite looked
// like it covered two maintained implementations when it covered one real
// client and one ghost.
//
// All of that is deleted. This test stops it coming back: any src/ module that
// duplicates a server/ module and is reachable by nothing is dead weight.
//
// src/lib/db/schema.sql and src/lib/db/migrations/* are deliberately NOT
// covered by this rule. They are unreachable by require too - they are a
// MIRROR, kept byte-identical by scripts/sync-schema-mirror.js and asserted by
// scripts/production-smoke.js. Unreachable is not the same as dead.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SKIP = new Set(['node_modules', '.git', '.next', '.cache', '.dsh-project-memory', '.kilo', 'worktrees']);

// The mirror, which is unreachable by require and must stay.
const MIRROR_EXEMPT = new Set(['src/lib/db/schema.sql']);

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const rel = (f) => path.relative(ROOT, f).split(path.sep).join('/');
const files = walk(ROOT);
const code = files.filter((f) => /\.(js|mjs|cjs|ts|tsx|jsx)$/.test(f));

const aliases = [
  ['@/', path.resolve(ROOT, 'src')],
  ['@server/', path.resolve(ROOT, 'server')],
];
const SPEC = /(?:require\(\s*|import\s+[^'"]*from\s*|import\s*\(\s*)['"]([^'"]+)['"]/g;
const EXT = ['', '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '/index.js', '/index.ts', '/index.tsx'];

function resolveSpec(spec, fromFile) {
  let base = null;
  if (spec.startsWith('.')) base = path.resolve(path.dirname(fromFile), spec);
  else for (const [prefix, target] of aliases) {
    if (spec.startsWith(prefix)) { base = path.join(target, spec.slice(prefix.length)); break; }
  }
  if (!base) return null;
  for (const ext of EXT) {
    const cand = base + ext;
    try { if (fs.existsSync(cand) && fs.statSync(cand).isFile()) return cand; } catch (_) { /* keep looking */ }
  }
  return null;
}

// Resolve rather than text-match. `require('../db/client')` means
// server/db/client.js from server/ and src/lib/db/client.js from src/lib/ai/ -
// the same string, different files, and only resolution tells them apart.
const importers = new Map();
for (const f of code) {
  let text;
  try { text = fs.readFileSync(f, 'utf8'); } catch (_) { continue; }
  SPEC.lastIndex = 0;
  for (const m of text.matchAll(SPEC)) {
    const r = resolveSpec(m[1], f);
    if (!r) continue;
    if (!importers.has(r)) importers.set(r, new Set());
    importers.get(r).add(rel(f));
  }
}

test('no src/ module duplicates a server/ module while being unreachable', () => {
  const serverByStem = new Map();
  for (const f of files.filter((x) => rel(x).startsWith('server/') && /\.(js|mjs|cjs|ts)$/.test(x))) {
    const stem = path.basename(f).replace(/\.(js|mjs|cjs|ts)$/, '');
    if (!serverByStem.has(stem)) serverByStem.set(stem, []);
    serverByStem.get(stem).push(rel(f));
  }

  // Reachable only from a test that compares it to its own server twin is also
  // dead: legal-rules.js survived the first pass of this guard precisely
  // because a "mirror parity" test required it, and that test compared the two
  // files to each other when they were byte-identical apart from the @file
  // header. A test that keeps a ghost alive is not coverage of it.
  const onlyTestImporters = (abs) => {
    const users = [...(importers.get(abs) || [])].filter((u) => u !== rel(abs));
    return users.every((u) => u.startsWith('test/'));
  };

  const offenders = [];
  for (const f of files.filter((x) => rel(x).startsWith('src/'))) {
    const r = rel(f);
    if (MIRROR_EXEMPT.has(r)) continue;
    if (!/\.(js|mjs|cjs|ts)$/.test(f)) continue;
    const stem = path.basename(f).replace(/\.(js|mjs|cjs|ts)$/, '');
    if (!serverByStem.has(stem)) continue;                 // not a duplicate
    const users = [...(importers.get(f) || [])].filter((u) => u !== r);
    if (users.length === 0 || onlyTestImporters(f)) {
      offenders.push(`${r}  (duplicates ${serverByStem.get(stem).join(', ')}; importers: ${users.join(', ') || 'none'})`);
    }
  }

  assert.deepEqual(
    offenders, [],
    `src/ duplicates of server/ modules that no product code imports - delete them, or make the src copy the real one:\n  ${offenders.join('\n  ')}`
  );
});

test('the known dead copies are actually gone', () => {
  // Named explicitly so a reintroduction is caught by name, not just by shape.
  for (const gone of [
    'src/lib/db/client.js',
    'src/lib/ai/cache.js',
    'src/lib/ai/cost_tracker.js',
    'src/lib/ai/model_router.js',
    'src/lib/ai/bidding-simulator.js',
    'src/lib/ai/address-normalizer.js',
    'src/lib/ai/notice-parser.js',
    'src/lib/ai/legal-rules.js',
    'src/lib/security/validation.js',
    'src/lib/security/sanitizer.js',
    'src/lib/security/rate_limiter.js',
  ]) {
    assert.equal(fs.existsSync(path.join(ROOT, gone)), false, `${gone} is back`);
  }
});

test('no test keeps a src/ copy alive by comparing it to its own server twin', () => {
  const lcr = fs.readFileSync(path.join(ROOT, 'test', 'live-cache-refresh.test.js'), 'utf8');
  assert.doesNotMatch(lcr, /require\('\.\.\/src\/lib\/db\/client'\)/,
    'live-cache-refresh must test the one real client, not a fork beside it');
  assert.doesNotMatch(lcr, /nextClient/, 'the phantom next-client parity check is back');

  const rules = fs.readFileSync(path.join(ROOT, 'test', 'legal-rules-truth.test.js'), 'utf8');
  assert.doesNotMatch(rules, /require\('\.\.\/src\/lib\/ai\/legal-rules'\)/,
    'legal-rules-truth must test the module production loads');
  assert.doesNotMatch(rules, /nextRules/, 'the phantom legal-rules parity check is back');
});

test('the deliberate schema mirror is still present and still mirrored', () => {
  // The mirror is exempt above because unreachable is not dead for it. Prove it
  // is still being maintained, so the exemption cannot quietly become an
  // unexamined hole.
  assert.ok(fs.existsSync(path.join(ROOT, 'src/lib/db/schema.sql')));
  assert.ok(fs.existsSync(path.join(ROOT, 'src/lib/db/migrations')));
  assert.ok(
    fs.readFileSync(path.join(ROOT, 'src/lib/db/schema.sql'), 'utf8')
      === fs.readFileSync(path.join(ROOT, 'server/db/schema.sql'), 'utf8'),
    'the schema mirror has drifted - run node scripts/sync-schema-mirror.js'
  );
});

test('no production or config code reads a src/ file that does not exist', () => {
  // The require-resolution above cannot see a file read by PATH rather than by
  // module id. test/db.test.js read src/lib/db/client.js with fs.readFileSync
  // and asserted over both copies - the same ghost, reached a way the resolver
  // missed, and it only surfaced when the suite ran.
  //
  // Scoped to server/, scripts/, src/ and .github/. Test files are excluded
  // because they legitimately build src/lib/... paths inside a throwaway tree
  // (schema-mirror-contract does exactly that), and a scanner cannot tell such
  // a path from a repo-relative one. The duplicate checks above still cover
  // test/ for the case that matters.
  const dangling = [];
  // This file has to name the deleted paths as literals to assert they stay
  // gone, so it cannot also be scanned for references to them. Fifth time in
  // one session a guard has matched its own content.
  const SELF = 'test/no-dead-duplicates.test.js';
  const SCANNED = (f) => /^(server|scripts|src)\//.test(f) || f.startsWith('.github/');
  for (const f of code.filter((x) => rel(x).startsWith('.github/') || SCANNED(rel(x)))) {
    if (rel(f) === SELF) continue;
    let text;
    try { text = fs.readFileSync(f, 'utf8'); } catch (_) { continue; }
    // Strip comments: files now name the deleted ones in prose explaining the
    // deletion, and a guard must not read its own history.
    const codeOnly = text
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split(/\r?\n/)
      .map((l) => l.replace(/^\s*\/\/.*$/, ''))
      .join('\n');
    for (const m of codeOnly.matchAll(/['"`](src\/lib\/[A-Za-z0-9._/-]+)['"`]/g)) {
      const target = m[1];
      if (!fs.existsSync(path.join(ROOT, target))) {
        dangling.push(`${rel(f)} references ${target}, which does not exist`);
      }
    }
  }
  assert.deepEqual(dangling, [], `dangling src/ path references:\n  ${dangling.join('\n  ')}`);
});
