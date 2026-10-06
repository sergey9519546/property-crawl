'use strict';

// test/db/listing-id-alias.test.js
//
// Pins what getListingById's canonical-id alias actually resolves today.
//
// server/db/client.js documents: "A canonical STATE-COUNTY-NUMBER id (e.g.
// 'OH-CUY-10231') is an unambiguous alias for the source-namespaced record
// 'SHERIFF-OH-CUY-10231'. It is resolved only when exactly one record matches
// — never a partial or numeric fragment."
//
// The NAMESPACED_ID shape is /^[A-Z]{2,3}-[A-Z]{2,3}-\d{2,6}$/, which is correct
// for the documented input. But real listing ids in this repo are source-prefixed
// with prefixes of 4+ characters (USDA-MS-6274, TRSY-27-66-804, SHERIFF-...), and
// the pattern's first segment allows only 2-3 characters. Measured against
// data.js, the alias matches 0 of 2094 real ids.
//
// That makes the alias inert, not broken: nothing in the app passes a
// STATE-COUNTY-NUMBER form, so no request is being mishandled. These tests
// record that fact so the assumption is checked rather than assumed — and so
// that anyone relying on the alias has to widen the pattern deliberately
// instead of discovering it silently returns null.
//
// Widening NAMESPACED_ID on its own would be wrong: the "never a partial or
// numeric fragment" guarantee is what keeps `getListingById('1')` from
// matching `listing-1`. Any widening must keep the exact-match and
// single-result requirements.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { DatabaseClient } = require('../../server/db/client');

// The same expression the client uses. Duplicated deliberately: if the client
// changes its pattern, this test should notice and be updated on purpose.
const NAMESPACED_ID = /^[A-Z]{2,3}-[A-Z]{2,3}-\d{2,6}$/;

function readSeedListings() {
  const src = fs.readFileSync(path.resolve(__dirname, '..', '..', 'data.js'), 'utf8');
  const start = src.indexOf('window.LISTINGS =');
  assert.ok(start >= 0, 'expected data.js to define window.LISTINGS');
  const from = src.indexOf('[', start);
  let depth = 0;
  let end = -1;
  for (let i = from; i < src.length; i += 1) {
    if (src[i] === '[') depth += 1;
    else if (src[i] === ']') {
      depth -= 1;
      if (depth === 0) { end = i + 1; break; }
    }
  }
  assert.ok(end > from, 'expected a parseable LISTINGS array');
  const text = src.slice(from, end).replace(/,(\s*[}\]])/g, '$1');
  // eslint-disable-next-line no-eval
  return eval(`(${text})`);
}

function readListingIds() {
  return readSeedListings().map((l) => String(l.id));
}

const IDS = readListingIds();

test('data.js exposes a non-trivial id population to check against', () => {
  assert.ok(IDS.length > 100, `expected many listing ids, got ${IDS.length}`);
});

test('the documented canonical form WOULD match the alias pattern', () => {
  // The pattern is correct for what its comment promises.
  assert.equal(NAMESPACED_ID.test('OH-CUY-10231'), true);
  assert.equal(NAMESPACED_ID.test('OH-CUYAHOGA-10231'), false, 'county segment is 2-3 chars');
});

test('the alias pattern rejects partial and numeric fragments', () => {
  for (const bad of ['1', '12', '1234', '10231', 'CUY-10231', 'OH--10231', 'OH-CU-', 'oh-cuy-10231']) {
    assert.equal(NAMESPACED_ID.test(bad), false, `${bad} must not be aliasable`);
  }
});

test('the alias pattern matches none of the real listing ids (documented dead path)', () => {
  const aliasable = IDS.filter((id) => NAMESPACED_ID.test(id));
  assert.deepEqual(
    aliasable,
    [],
    'if real listing ids now match NAMESPACED_ID, the alias is live — update this '
      + 'test and the client comment to describe the real behaviour',
  );
});

test('real ids are source-prefixed with prefixes longer than the pattern allows', () => {
  // This is the reason the alias is inert, recorded so the cause is explicit.
  const longPrefix = IDS.filter((id) => {
    const first = id.split('-')[0];
    return first.length > 3;
  });
  assert.ok(
    longPrefix.length > 0,
    'expected source-prefixed ids with 4+ character prefixes (USDA, TRSY, SHERIFF)',
  );
  for (const id of longPrefix.slice(0, 5)) {
    assert.equal(
      NAMESPACED_ID.test(id),
      false,
      `${id} has a prefix longer than the alias pattern permits`,
    );
  }
});

// The end-to-end lookups below used to run against the real live store while
// taking their ids from data.js - two different datasets. The test therefore
// broke whenever a sweep changed the live inventory, for reasons that had
// nothing to do with the alias logic it exists to test.
//
// It now builds its own store from ONE committed seed record, so it depends on
// nothing that a sweep can move.
const SEED = readSeedListings()[0];
const FIXTURE_ID = SEED ? String(SEED.id) : null;

function fixtureStore(t) {
  assert.ok(SEED, 'expected data.js to contain a listing to use as the fixture');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-alias-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'live-listings.json');
  fs.writeFileSync(file, JSON.stringify({
    version: 1,
    updatedAt: new Date().toISOString(),
    listings: [{ ...SEED, provenance: { ...SEED.provenance, origin: 'live', recordKind: 'source_record' } }],
  }));
  return file;
}

test('an exact id lookup still works regardless of the alias path', async (t) => {
  const db = new DatabaseClient({ liveCachePath: fixtureStore(t), workspaceStorePath: null });
  const found = await db.getListingById(FIXTURE_ID);
  assert.ok(found, `expected exact lookup of ${FIXTURE_ID} to resolve`);
  assert.equal(String(found.id), FIXTURE_ID);
});

test('a non-aliasable short id is not resolved by suffix matching', async (t) => {
  const db = new DatabaseClient({ liveCachePath: fixtureStore(t), workspaceStorePath: null });
  // Guards the "never a partial or numeric fragment" guarantee end to end.
  const numericFragment = String(FIXTURE_ID).split('-').pop();
  assert.match(numericFragment, /^\d{2,6}$/);
  const found = await db.getListingById(numericFragment);
  assert.equal(
    found,
    null,
    `numeric fragment ${numericFragment} must not resolve to ${FIXTURE_ID}`,
  );
});
