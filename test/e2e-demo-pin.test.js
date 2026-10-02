'use strict';

// test/e2e-demo-pin.test.js
//
// run-production-e2e.js says it "pins demo mode" on the default path, and it
// did so by `delete env.DATABASE_URL`. That never worked on a developer
// machine.
//
// start-production.js calls loadLocalEnvFiles(process.env), which fills in
// only keys ABSENT from process.env (`if (!key || key in merged) continue`)
// so cloud secret injection is never clobbered. Deleting a key is the one
// thing that invites the local file back in: with DATABASE_URL gone, .env.local
// supplied whatever Postgres the developer had configured, and the run booted
// against it. The "health demo-pin" check then failed for a reason that had
// nothing to do with the code under test.
//
// CI never saw it, because its .env.local is generated without a DATABASE_URL.
// That is the signature of this whole class of defect: the guard was green
// exactly where nobody was looking.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const E2E = path.join(ROOT, 'scripts', 'run-production-e2e.js');
const ENV = path.join(ROOT, 'scripts', 'production-env.js');

test('loadLocalEnvFiles keeps a key that is present but empty', () => {
  // The mechanism the fix depends on. If this ever changes, so must the fix.
  const { loadLocalEnvFiles } = require('../scripts/production-env');
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'pp-env-'));
  try {
    fs.writeFileSync(path.join(dir, '.env.local'), 'DATABASE_URL=postgres://real/db\n');
    const merged = loadLocalEnvFiles({ DATABASE_URL: '' }, ['.env.local'], dir);
    assert.equal(merged.DATABASE_URL, '', 'an explicitly empty value must win over the file');
    assert.equal(Boolean(merged.DATABASE_URL), false, 'and must read as "no database"');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the e2e pins demo mode by assigning empty, not by deleting', () => {
  // Strip line comments before scanning. The fix's own comment quotes the old
  // line, so a raw scan matches the prose rather than the code.
  //
  // Deliberately NOT a /\/\*[\s\S]*?\*\// pass: a "/*" occurring inside a
  // string or a regex earlier in the file makes that match run across the
  // assignments and silently delete the code under test. The first version of
  // this test did exactly that and reported the opposite of the truth.
  const src = fs.readFileSync(E2E, 'utf8')
    .split(/\r?\n/)
    .filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l))
    .join('\n');
  // Plain substring checks, not a constructed regex. A template-built pattern
  // here proved needlessly finicky, and the property being pinned is a
  // literal assignment, not a pattern.
  assert.equal(
    src.includes("env.DATABASE_URL = ''"),
    true,
    'DATABASE_URL must be assigned an empty string, not deleted'
  );
  assert.equal(src.includes("env.DISCOVERY_MODE = ''"), true, 'DISCOVERY_MODE must be assigned empty');
  assert.equal(
    src.includes("env.DISCOVERY_TEST_DATABASE_URL = ''"),
    true,
    'DISCOVERY_TEST_DATABASE_URL must be assigned empty'
  );
  for (const key of ['DATABASE_URL', 'DISCOVERY_MODE', 'DISCOVERY_TEST_DATABASE_URL']) {
    assert.equal(
      src.includes(`delete env.${key}`),
      false,
      `deleting ${key} lets .env.local put it back - that is the bug`
    );
  }
});

test('the demo pin only applies to the default path, never to --with-db', () => {
  const src = fs.readFileSync(E2E, 'utf8');
  const guarded = src.slice(src.indexOf('if (!args.withDb)'));
  assert.ok(guarded.length > 0, 'the assignments must stay inside the !withDb branch');
  assert.ok(
    guarded.slice(0, guarded.indexOf('}')).includes('env.DATABASE_URL'),
    'the demo pin must be conditional on the default path so --with-db still opts into PG'
  );
});

test('the orchestrator still loads .env.local for secrets', () => {
  // The e2e must not "fix" this by stopping the orchestrator from reading
  // .env.local: SCRAPER_ADMIN_TOKEN parity with Next depends on it.
  const startProd = fs.readFileSync(path.join(ROOT, 'scripts', 'start-production.js'), 'utf8');
  assert.match(startProd, /loadLocalEnvFiles\(process\.env\)/);
  const envSrc = fs.readFileSync(ENV, 'utf8');
  assert.match(envSrc, /key in merged/, 'process.env must keep winning over the file');
});
