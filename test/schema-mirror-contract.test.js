'use strict';

// test/schema-mirror-contract.test.js
//
// server/db is canonical; src/lib/db is a mirror kept byte-identical by
// scripts/sync-schema-mirror.js. The guard once compared only schema.sql, so
// the migrations mirror drifted 9 files behind while --check still reported
// success. These tests pin the whole mirrored surface.
//
// Nothing reads the mirror at runtime, so this is a hygiene guard, not a
// production-path guard - which is exactly why it needed to exist: a mirror
// that is quietly wrong is worse than no mirror.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'sync-schema-mirror.js');
const { CANONICAL, MIRROR } = require('../scripts/sync-schema-mirror');

// Derived here rather than imported so the behavioural guards below fail on
// what --check *does*, not on the absence of a newer export. A guard that
// crashes before it reaches its assertion proves nothing.
const CANONICAL_MIGRATIONS = path.join(ROOT, 'server', 'db', 'migrations');
const MIRROR_MIGRATIONS = path.join(ROOT, 'src', 'lib', 'db', 'migrations');

function runCheck() {
  try {
    execFileSync(process.execPath, [SCRIPT, '--check'], { cwd: ROOT, stdio: 'pipe' });
    return { passed: true };
  } catch (error) {
    return { passed: false, output: `${error.stdout || ''}${error.stderr || ''}` };
  }
}

test('the mirror check script exports a diff over the migrations it covers', () => {
  // Structural: the smoke test and future tooling read this, so the surface
  // itself is part of the contract.
  const mirror = require('../scripts/sync-schema-mirror');
  assert.equal(typeof mirror.diffMigrations, 'function');
  const drift = mirror.diffMigrations();
  assert.ok(Array.isArray(drift.missing));
  assert.ok(Array.isArray(drift.stale));
  assert.ok(Array.isArray(drift.changed));
  assert.ok(drift.canonicalCount > 1, 'expected a real migrations directory, not one file');
});

test('the committed mirror is in sync with server/db right now', () => {
  const sql = (n) => fs.readdirSync(n).filter((f) => f.endsWith('.sql')).sort();
  const canonical = sql(CANONICAL_MIGRATIONS);
  const mirror = sql(MIRROR_MIGRATIONS);
  assert.deepEqual(
    mirror,
    canonical,
    `migrations in the mirror do not match server/db; missing: ${canonical.filter((f) => !mirror.includes(f)).join(', ')}`
  );
  for (const name of canonical) {
    assert.equal(
      fs.readFileSync(path.join(MIRROR_MIGRATIONS, name), 'utf8'),
      fs.readFileSync(path.join(CANONICAL_MIGRATIONS, name), 'utf8'),
      `${name} differs between server/db/migrations and src/lib/db/migrations`
    );
  }
  assert.equal(fs.readFileSync(MIRROR, 'utf8'), fs.readFileSync(CANONICAL, 'utf8'));
});

test('--check passes on a synced tree', () => {
  const result = runCheck();
  assert.ok(result.passed, result.output);
});

test('--check reports migrations as well as schema, not schema alone', () => {
  // The regression: the old guard only compared schema.sql, so it stayed green
  // with nine migrations absent. Remove one and the check must go red.
  const victim = '014_discovery_promotion_evidence.sql';
  const target = path.join(MIRROR_MIGRATIONS, victim);
  assert.ok(fs.existsSync(target), `fixture missing: ${victim} should exist in the mirror`);
  const original = fs.readFileSync(target);
  fs.rmSync(target);
  try {
    const result = runCheck();
    assert.equal(result.passed, false, '--check must fail when a mirror migration is missing');
    assert.match(result.output, /missing from the mirror/);
    assert.match(result.output, new RegExp(victim.replace(/\./g, '\\.')));
  } finally {
    fs.writeFileSync(target, original);
  }
  assert.ok(runCheck().passed, 'restoring the mirror must make --check pass again');
});

test('--check reports a mirror migration whose contents changed', () => {
  const target = path.join(MIRROR_MIGRATIONS, '015_status_contract.sql');
  const original = fs.readFileSync(target);
  fs.writeFileSync(target, `${original}\n-- local edit that upstream never saw\n`);
  try {
    const result = runCheck();
    assert.equal(result.passed, false, '--check must fail when a mirror migration is edited');
    assert.match(result.output, /differ from the mirror/);
  } finally {
    fs.writeFileSync(target, original);
  }
});

test('--check reports a mirror migration that no longer exists upstream', () => {
  const ghost = path.join(MIRROR_MIGRATIONS, '999_not_a_real_migration.sql');
  fs.writeFileSync(ghost, '-- never existed in server/db\n');
  try {
    const result = runCheck();
    assert.equal(result.passed, false, '--check must fail on a mirror-only migration');
    assert.match(result.output, /no longer exist upstream/);
  } finally {
    fs.rmSync(ghost);
  }
});

test('the production smoke check is labelled for what it actually verifies', () => {
  // A guard that says "schema.sql matches" while checking 15 files teaches the
  // next reader to trust coverage that is not there.
  const source = fs.readFileSync(path.join(ROOT, 'scripts', 'production-smoke.js'), 'utf8');
  assert.ok(
    /migrations match server\/db/.test(source),
    'the schema-mirror-sync finding must name the migrations it now covers'
  );
  assert.ok(
    /sync-schema-mirror\.js[\s\S]{0,200}--check/.test(source),
    'production-smoke must still invoke the mirror check in --check mode'
  );
});

test('the mirror sync is idempotent', (t) => {
  const before = fs.readdirSync(MIRROR_MIGRATIONS).sort();
  execFileSync(process.execPath, [SCRIPT], { cwd: ROOT, stdio: 'pipe' });
  assert.deepEqual(fs.readdirSync(MIRROR_MIGRATIONS).sort(), before);
  assert.ok(runCheck().passed);
  t.diagnostic('re-running the sync changed nothing');
});

// Guard against the mirror silently reappearing as a divergent fork: a new
// migration added to server/db must be noticed by --check, not by a human.
test('a newly added upstream migration is detected immediately', () => {
  const probe = path.join(CANONICAL_MIGRATIONS, '998_mirror_probe.sql');
  const ghost = path.join(MIRROR_MIGRATIONS, '998_mirror_probe.sql');
  const restore = fs.existsSync(probe);
  const original = restore ? fs.readFileSync(probe) : null;
  fs.writeFileSync(probe, '-- probe\n');
  const ghostExisted = fs.existsSync(ghost);
  const ghostOriginal = ghostExisted ? fs.readFileSync(ghost) : null;
  try {
    if (ghostExisted) fs.rmSync(ghost);
    const result = runCheck();
    assert.equal(result.passed, false, 'a new upstream migration must fail the check until mirrored');
    assert.match(result.output, /998_mirror_probe\.sql/);
  } finally {
    if (ghostExisted) fs.writeFileSync(ghost, ghostOriginal);
    else if (fs.existsSync(ghost)) fs.rmSync(ghost);
    if (restore) fs.writeFileSync(probe, original);
    else fs.rmSync(probe);
  }
  assert.ok(runCheck().passed, 'cleanup must leave the tree synced');
});

test('the sync only ever writes inside the mirrored directories', () => {
  // The script copies and can delete; a wrong path here would rewrite or
  // remove something outside the mirror.
  const source = fs.readFileSync(SCRIPT, 'utf8');
  for (const dir of ['MIRROR', 'MIRROR_MIGRATIONS']) {
    assert.ok(source.includes(dir), `${dir} must be defined in the sync script`);
  }
  assert.ok(
    /writeFileSync\(MIRROR/.test(source) && /writeFileSync\(path\.join\(MIRROR_MIGRATIONS/.test(source),
    'writes must target the mirror paths, never the canonical ones'
  );
  assert.ok(
    !/writeFileSync\(CANONICAL/.test(source) && !/rmSync\(path\.join\(CANONICAL_MIGRATIONS/.test(source),
    'the sync must never write or delete inside server/db'
  );
  for (const p of [CANONICAL, MIRROR, CANONICAL_MIGRATIONS, MIRROR_MIGRATIONS]) {
    const rel = path.relative(ROOT, p);
    assert.ok(rel && !rel.startsWith('..') && !path.isAbsolute(rel), `${p} escapes the repo root`);
  }
});
