'use strict';

// test/schema-mirror-contract.test.js
//
// server/db is canonical; src/lib/db is a mirror kept byte-identical by
// scripts/sync-schema-mirror.js. The guard once compared only schema.sql, so
// the migrations mirror drifted 9 files behind while --check stayed green.
//
// NOTHING HERE MUTATES THE REAL TREE. `node --test` runs test files in
// parallel, and an earlier version of this file deleted and recreated mirror
// migrations in place. While it did, production-smoke-health ran the mirror
// check mid-drift and failed for reasons of its own - two guards flaking each
// other. Every drift case now runs against a throwaway tree via --root.
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
const CANONICAL_MIGRATIONS = path.join(ROOT, 'server', 'db', 'migrations');
const MIRROR_MIGRATIONS = path.join(ROOT, 'src', 'lib', 'db', 'migrations');

function run(args, cwd = ROOT) {
  try {
    execFileSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8', stdio: 'pipe' });
    return { passed: true, output: '' };
  } catch (error) {
    return { passed: false, output: `${error.stdout || ''}${error.stderr || ''}` };
  }
}

const sql = (dir) =>
  fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => n.endsWith('.sql')).sort() : [];

// A throwaway repo-shaped tree: server/db is canonical, src/lib/db mirrors it.
function tempTree(t, { migrations = ['001_base.sql', '002_more.sql'] } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-mirror-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const sub of ['server/db/migrations', 'src/lib/db/migrations']) {
    fs.mkdirSync(path.join(dir, sub), { recursive: true });
  }
  fs.writeFileSync(path.join(dir, 'server/db/schema.sql'), 'CREATE TABLE canonical();\n');
  for (const name of migrations) {
    fs.writeFileSync(path.join(dir, 'server/db/migrations', name), `-- ${name}\n`);
  }
  return dir;
}

test('the committed mirror is in sync with server/db right now', () => {
  // Read-only: the real tree is the one thing this file must never disturb.
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
  assert.equal(
    fs.readFileSync(path.join(ROOT, 'src', 'lib', 'db', 'schema.sql'), 'utf8'),
    fs.readFileSync(path.join(ROOT, 'server', 'db', 'schema.sql'), 'utf8')
  );
});

test('--check passes on the real tree', () => {
  const result = run(['--check']);
  assert.ok(result.passed, result.output);
});

test('--check reports migrations as well as schema, not schema alone', (t) => {
  // The regression: the old guard compared only schema.sql, so it stayed green
  // with nine migrations absent from the mirror.
  const dir = tempTree(t);
  fs.writeFileSync(path.join(dir, 'src/lib/db/schema.sql'), 'CREATE TABLE canonical();\n');
  fs.mkdirSync(path.join(dir, 'src/lib/db/migrations'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src/lib/db/migrations/001_base.sql'), '-- 001_base.sql\n');

  const result = run(['--check', '--root', dir]);
  assert.equal(result.passed, false, '--check must fail when a mirror migration is missing');
  assert.match(result.output, /missing from the mirror/);
  assert.match(result.output, /002_more\.sql/);
});

test('--check reports a mirror migration whose contents changed', (t) => {
  const dir = tempTree(t);
  fs.writeFileSync(path.join(dir, 'src/lib/db/schema.sql'), 'CREATE TABLE canonical();\n');
  fs.mkdirSync(path.join(dir, 'src/lib/db/migrations'), { recursive: true });
  for (const name of ['001_base.sql', '002_more.sql']) {
    fs.writeFileSync(path.join(dir, 'src/lib/db/migrations', name), `-- ${name}\n`);
  }
  fs.appendFileSync(path.join(dir, 'src/lib/db/migrations/002_more.sql'), '-- local edit\n');

  const result = run(['--check', '--root', dir]);
  assert.equal(result.passed, false, '--check must fail when a mirror migration is edited');
  assert.match(result.output, /differ from the mirror/);
  assert.match(result.output, /002_more\.sql/);
});

test('--check reports a mirror migration that no longer exists upstream', (t) => {
  const dir = tempTree(t);
  fs.writeFileSync(path.join(dir, 'src/lib/db/schema.sql'), 'CREATE TABLE canonical();\n');
  fs.mkdirSync(path.join(dir, 'src/lib/db/migrations'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src/lib/db/migrations/001_base.sql'), '-- 001_base.sql\n');
  fs.writeFileSync(path.join(dir, 'src/lib/db/migrations/999_ghost.sql'), '-- ghost\n');

  const result = run(['--check', '--root', dir]);
  assert.equal(result.passed, false, '--check must fail on a mirror-only migration');
  assert.match(result.output, /no longer exist upstream/);
  assert.match(result.output, /999_ghost\.sql/);
});

test('--check reports schema drift separately from migration drift', (t) => {
  const dir = tempTree(t);
  fs.writeFileSync(path.join(dir, 'src/lib/db/schema.sql'), 'CREATE TABLE something_else();\n');
  fs.mkdirSync(path.join(dir, 'src/lib/db/migrations'), { recursive: true });
  for (const name of ['001_base.sql', '002_more.sql']) {
    fs.writeFileSync(path.join(dir, 'src/lib/db/migrations', name), `-- ${name}\n`);
  }
  const result = run(['--check', '--root', dir]);
  assert.equal(result.passed, false);
  assert.match(result.output, /schema\.sql differs from its mirror/);
  assert.doesNotMatch(result.output, /missing from the mirror/);
});

test('syncing repairs a drifted tree and is idempotent', (t) => {
  const dir = tempTree(t);
  fs.writeFileSync(path.join(dir, 'src/lib/db/schema.sql'), 'CREATE TABLE stale();\n');
  fs.mkdirSync(path.join(dir, 'src/lib/db/migrations'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src/lib/db/migrations/999_ghost.sql'), '-- ghost\n');

  assert.ok(run(['--root', dir]).passed, 'the sync itself must succeed');
  assert.ok(run(['--check', '--root', dir]).passed, 'the tree must be synced afterwards');
  assert.deepEqual(
    sql(path.join(dir, 'src/lib/db/migrations')),
    ['001_base.sql', '002_more.sql'],
    'the sync must copy upstream migrations and drop mirror-only ones'
  );

  // Second sync changes nothing.
  const before = fs.readFileSync(path.join(dir, 'src/lib/db/schema.sql'), 'utf8');
  assert.ok(run(['--root', dir]).passed);
  assert.equal(fs.readFileSync(path.join(dir, 'src/lib/db/schema.sql'), 'utf8'), before);
  assert.ok(run(['--check', '--root', dir]).passed);
});

test('a new upstream migration is noticed immediately', (t) => {
  const dir = tempTree(t);
  fs.writeFileSync(path.join(dir, 'src/lib/db/schema.sql'), 'CREATE TABLE canonical();\n');
  fs.mkdirSync(path.join(dir, 'src/lib/db/migrations'), { recursive: true });
  for (const name of ['001_base.sql', '002_more.sql']) {
    fs.writeFileSync(path.join(dir, 'src/lib/db/migrations', name), `-- ${name}\n`);
  }
  assert.ok(run(['--check', '--root', dir]).passed);
  fs.writeFileSync(path.join(dir, 'server/db/migrations/003_new.sql'), '-- new\n');
  const result = run(['--check', '--root', dir]);
  assert.equal(result.passed, false, 'a new upstream migration must fail until mirrored');
  assert.match(result.output, /003_new\.sql/);
});

test('the sync refuses to write outside its mirror directories', (t) => {
  // The script copies and deletes; a wrong path would rewrite or remove
  // something in server/db. Run it on a temp tree and prove canonical is intact.
  const dir = tempTree(t);
  fs.writeFileSync(path.join(dir, 'src/lib/db/schema.sql'), 'CREATE TABLE stale();\n');
  const canonicalBefore = fs.readFileSync(path.join(dir, 'server/db/schema.sql'), 'utf8');
  const upstreamBefore = fs.readdirSync(path.join(dir, 'server/db/migrations')).sort();
  run(['--root', dir]);
  assert.equal(fs.readFileSync(path.join(dir, 'server/db/schema.sql'), 'utf8'), canonicalBefore);
  assert.deepEqual(fs.readdirSync(path.join(dir, 'server/db/migrations')).sort(), upstreamBefore);
});

test('the production smoke check is labelled for what it actually verifies', () => {
  // A guard that says "schema.sql matches" while checking 15 files teaches the
  // next reader to trust coverage that is not there.
  const source = fs.readFileSync(path.join(ROOT, 'scripts', 'production-smoke.js'), 'utf8');
  assert.match(source, /migrations match server\/db/);
  assert.match(source, /sync-schema-mirror\.js[\s\S]{0,200}--check/);
});

test('the advanced-readiness finding in production smoke verifies ordering', () => {
  // Same species of claim: a finding whose detail says "before" must compare
  // positions, not merely prove the string exists.
  const source = fs.readFileSync(path.join(ROOT, 'scripts', 'production-smoke.js'), 'utf8');
  assert.match(source, /readinessFailureAt\s*<\s*livenessFallbackAt/);
});
