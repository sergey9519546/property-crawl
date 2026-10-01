'use strict';

// test/db/migration-mirror.test.js
//
// Every migration under src/lib/db/migrations/ must be byte-identical to its
// server/db/migrations/ counterpart.
//
// The mirror is not read at runtime — it is a parity copy so the Next-side
// schema history stays visible. That is precisely why it drifts: nothing
// executes it, so a hand-edited server migration silently leaves the mirror
// stale, and the only signal is whichever files the existing spot-check in
// test/db.test.js happens to name. That check covers 003 and 004; the rest are
// unguarded.
//
// This was not hypothetical. Editing 003 and 004 to drop a nested
// BEGIN/COMMIT broke test/db.test.js only because those two happen to be
// pinned. The same edit to 006-014 would have shipped undetected.
//
// The check is generalised rather than extended by name, so a future
// migration is covered the moment it is mirrored, with nothing to remember.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..', '..');
const SERVER_MIGRATIONS = path.join(ROOT, 'server', 'db', 'migrations');
const MIRROR_MIGRATIONS = path.join(ROOT, 'src', 'lib', 'db', 'migrations');

function migrationFiles(dir) {
  return fs
    .readdirSync(dir)
    .filter((name) => /^\d+.*\.sql$/.test(name))
    .sort();
}

const serverFiles = migrationFiles(SERVER_MIGRATIONS);
const mirrorFiles = migrationFiles(MIRROR_MIGRATIONS);

test('the server migration directory is not empty', () => {
  assert.ok(serverFiles.length > 0, 'expected migrations to exist');
  assert.ok(serverFiles.length >= 10, `expected a real migration chain, got ${serverFiles.length}`);
});

test('every mirrored migration is byte-identical to its server counterpart', () => {
  const drifted = [];
  for (const name of mirrorFiles) {
    const serverPath = path.join(SERVER_MIGRATIONS, name);
    if (!fs.existsSync(serverPath)) {
      drifted.push(`${name}: mirrored but missing from server/db/migrations`);
      continue;
    }
    const a = fs.readFileSync(serverPath);
    const b = fs.readFileSync(path.join(MIRROR_MIGRATIONS, name));
    if (!a.equals(b)) {
      drifted.push(
        `${name}: mirror is stale (server ${a.length} bytes, mirror ${b.length} bytes)`,
      );
    }
  }
  assert.deepEqual(
    drifted,
    [],
    'mirrored migrations drifted from the server copy. Nothing executes the mirror, '
      + 'so it rots silently — run: copy the server file over the mirror.',
  );
});

test('the mirror has no migration that the server does not have', () => {
  const orphans = mirrorFiles.filter((name) => !fs.existsSync(path.join(SERVER_MIGRATIONS, name)));
  assert.deepEqual(orphans, [], 'mirror contains files the server migration chain does not');
});

test('the spot-check in db.test.js is a subset of the mirrored set', () => {
  // If someone narrows the mirror, this fails rather than silently reducing
  // coverage to nothing.
  for (const name of ['003_nullable_source_values.sql', '004_listing_precision_and_cash_details.sql']) {
    assert.ok(mirrorFiles.includes(name), `${name} is pinned by db.test.js and must stay mirrored`);
  }
});

test('the schema mirror is still byte-identical to server/db/schema.sql', () => {
  const server = fs.readFileSync(path.join(ROOT, 'server', 'db', 'schema.sql'));
  const mirror = fs.readFileSync(path.join(ROOT, 'src', 'lib', 'db', 'schema.sql'));
  assert.ok(
    server.equals(mirror),
    'server/db/schema.sql and src/lib/db/schema.sql must stay byte-equivalent',
  );
});
