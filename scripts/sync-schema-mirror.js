'use strict';

/**
 * Keep the Next.js mirrors byte-identical to their server/ originals.
 *
 * The mirror exists so the Next.js side of the repo can read the schema
 * without reaching into server/. It is a copy, not a source: server/ is
 * canonical and nothing should ever be edited in the mirror.
 *
 * Covered:
 *   - server/db/schema.sql        -> src/lib/db/schema.sql
 *   - server/db/migrations/*.sql  -> src/lib/db/migrations/*.sql
 *
 * The migrations mirror used to be copied by hand and never checked, so it
 * silently fell 9 files behind while `--check` still reported success because
 * it only ever compared schema.sql. A guard that covers one of two mirrored
 * paths is worse than none: it reads as coverage.
 *
 * Usage:
 *   node scripts/sync-schema-mirror.js          # copy server -> Next mirror
 *   node scripts/sync-schema-mirror.js --check  # fail if mirrors drift
 *   node scripts/sync-schema-mirror.js --root <dir> [--check]
 *
 * --root exists so the drift tests can exercise every branch against a
 * throwaway tree. `node --test` runs test files in parallel, and these tests
 * used to mutate the real mirror; while they did, production-smoke-health
 * could run the mirror check mid-drift and fail for reasons of its own.
 */

const fs = require('node:fs');
const path = require('node:path');

const rootFlagIndex = process.argv.indexOf('--root');
const ROOT = rootFlagIndex !== -1 && process.argv[rootFlagIndex + 1]
  ? path.resolve(process.argv[rootFlagIndex + 1])
  : path.resolve(__dirname, '..');
const CANONICAL = path.join(ROOT, 'server/db/schema.sql');
const MIRROR = path.join(ROOT, 'src/lib/db/schema.sql');
const CANONICAL_MIGRATIONS = path.join(ROOT, 'server/db/migrations');
const MIRROR_MIGRATIONS = path.join(ROOT, 'src/lib/db/migrations');

function read(pathname) {
  return fs.readFileSync(pathname, 'utf8');
}

// name -> bytes, for a migrations directory. Returns a sorted name list and a
// map so a missing file and a changed file are distinguishable in the report.
function readMigrations(directory) {
  if (!fs.existsSync(directory)) return { names: [], files: new Map() };
  const names = fs
    .readdirSync(directory)
    .filter((name) => name.endsWith('.sql'))
    .sort();
  return { names, files: new Map(names.map((name) => [name, read(path.join(directory, name))])) };
}

function diffMigrations() {
  const canonical = readMigrations(CANONICAL_MIGRATIONS);
  const mirror = readMigrations(MIRROR_MIGRATIONS);
  const missing = canonical.names.filter((name) => !mirror.files.has(name));
  const stale = mirror.names.filter((name) => !canonical.files.has(name));
  const changed = canonical.names.filter(
    (name) => mirror.files.has(name) && mirror.files.get(name) !== canonical.files.get(name)
  );
  return { missing, stale, changed, canonicalCount: canonical.names.length, mirrorCount: mirror.names.length };
}

function main() {
  const check = process.argv.includes('--check');
  if (!fs.existsSync(CANONICAL)) {
    console.error(`Missing canonical schema: ${CANONICAL}`);
    process.exit(1);
  }
  const canonical = read(CANONICAL);
  const mirror = fs.existsSync(MIRROR) ? read(MIRROR) : null;
  const drift = diffMigrations();

  if (check) {
    const schemaDrifted = mirror !== canonical;
    const migrationsDrifted = drift.missing.length || drift.stale.length || drift.changed.length;
    if (!schemaDrifted && !migrationsDrifted) {
      console.log(
        `schema and ${drift.canonicalCount} migration(s) mirror${drift.canonicalCount === 1 ? '' : 's'} are identical`
      );
      process.exit(0);
    }
    console.error('SCHEMA MIRROR DRIFT');
    console.error(`  canonical: ${CANONICAL}`);
    console.error(`  mirror:    ${MIRROR}`);
    if (schemaDrifted) console.error('  - schema.sql differs from its mirror');
    if (drift.missing.length) {
      console.error(`  - ${drift.missing.length} migration(s) missing from the mirror: ${drift.missing.join(', ')}`);
    }
    if (drift.changed.length) {
      console.error(`  - ${drift.changed.length} migration(s) differ from the mirror: ${drift.changed.join(', ')}`);
    }
    if (drift.stale.length) {
      console.error(`  - ${drift.stale.length} migration(s) in the mirror no longer exist upstream: ${drift.stale.join(', ')}`);
    }
    console.error('Fix: node scripts/sync-schema-mirror.js');
    process.exit(1);
  }

  fs.mkdirSync(path.dirname(MIRROR), { recursive: true });
  fs.writeFileSync(MIRROR, canonical);
  console.log(`synced ${MIRROR} from ${CANONICAL} (${canonical.length} bytes)`);

  const source = readMigrations(CANONICAL_MIGRATIONS);
  fs.mkdirSync(MIRROR_MIGRATIONS, { recursive: true });
  let written = 0;
  for (const name of source.names) {
    fs.writeFileSync(path.join(MIRROR_MIGRATIONS, name), source.files.get(name));
    written += 1;
  }
  let removed = 0;
  for (const name of drift.stale) {
    fs.rmSync(path.join(MIRROR_MIGRATIONS, name));
    removed += 1;
  }
  console.log(
    `synced ${written} migration(s) to ${MIRROR_MIGRATIONS}` + (removed ? `, removed ${removed} stale` : '')
  );
}

if (require.main === module) main();
module.exports = { CANONICAL, MIRROR, CANONICAL_MIGRATIONS, MIRROR_MIGRATIONS, diffMigrations };
