'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../..');
const pkg = require('../../package.json');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// The project holds one rule over data: never delete a record, report it and
// leave it intact. "Delisted" and "auction concluded" are publisher facts, not
// reasons to drop inventory.
//
// `db:import` was `db-import-live.js && db-prune-ended.js --apply`, so the
// command an operator reaches for to IMPORT data also deleted every record the
// prune classified as ended - and it did so under a name that promises the
// opposite. Worse, scripts/refresh-known-records.js tells the operator "Run
// `npm run db:import` to import them. Nothing was retired." while that command
// went on to retire records. The guidance was false in the same breath.
//
// Measured cost when this was caught: the live store held 1,593 records whose
// publisher no longer lists them. Running the obvious import command would have
// deleted the concluded population this project deliberately preserves.
test('the default import does not delete anything', () => {
  const importScript = pkg.scripts['db:import'];
  assert.ok(importScript, 'package.json must keep a db:import script');
  assert.match(importScript, /db-import-live\.js/,
    'db:import must actually import the live store');
  assert.doesNotMatch(importScript, /--apply|prune/i,
    'db:import must not delete records; a command named "import" that prunes is the hazard this guard exists for');
});

test('the destructive path is still available, but only by naming what it does', () => {
  const destructive = pkg.scripts['db:import:prune'];
  assert.ok(destructive, 'the combined import-and-prune path must remain reachable');
  assert.match(destructive, /db-import-live\.js/);
  assert.match(destructive, /db-prune-ended\.js --apply/,
    'the destructive variant must be the one that carries --apply');
  // db:prune stays a dry run by default: it prints what it would delete.
  assert.doesNotMatch(pkg.scripts['db:prune'], /--apply/,
    'db:prune must stay a dry run unless the operator passes --apply themselves');
});

test('the operator guidance points at a command that matches its promise', () => {
  const refresh = read('scripts/refresh-known-records.js');
  assert.match(refresh, /npm run db:import/,
    'refresh-known-records should still tell the operator how to import what it refreshed');
  const guidance = refresh.slice(refresh.indexOf('npm run db:import'));
  const promisedNothingRetired = /Nothing was retired/.test(guidance);
  if (promisedNothingRetired) {
    assert.doesNotMatch(pkg.scripts['db:import'], /--apply|prune/i,
      'this script promises "Nothing was retired" and then names a command that would have retired records');
  }
});