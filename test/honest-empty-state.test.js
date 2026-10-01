'use strict';

// test/honest-empty-state.test.js
//
// The repo's stated principle is that unknown must stay unknown and must never
// be rendered as a confident answer. In the UI that principle has two concrete
// failure shapes, both of which present a broken feature as correct behaviour:
//
//   1. A 200 response missing its expected field coerced to [] — "you have no
//      saved searches" when the alerts feature is simply broken.
//   2. A failed load rendering the empty-state copy, telling the user to adjust
//      filters that were never the problem.
//
// Both were fixed in this pass. These tests pin the fixes so they cannot be
// reintroduced by a well-meaning "just return an empty array" edit.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const savedSearches = read('src/lib/saved-searches.ts');
const dataModeBanner = read('src/components/site/data-mode-banner.tsx');
const terminal = read('src/components/terminal/interactive-terminal.tsx');
const savedSearchesRoute = read('server/routes/saved-searches.js');

// --- 1. a malformed response must not read as an empty result -----------

test('listSavedSearches does not coerce a missing field to an empty array', () => {
  assert.ok(
    !/Array\.isArray\(data\.searches\)\s*\?\s*data\.searches\s*:\s*\[\]/.test(savedSearches),
    'a 200 without a "searches" array must surface as a broken alerts feature, '
      + 'not as a user with no saved searches',
  );
  assert.match(
    savedSearches,
    /function requireArray/,
    'expected a shared shape validator that throws on an unexpected body',
  );
});

test('listAlertMatches does not coerce a missing field to an empty array', () => {
  assert.ok(
    !/Array\.isArray\(data\.matches\)\s*\?\s*data\.matches\s*:\s*\[\]/.test(savedSearches),
    'a missing "matches" array drove the unread-alert badge to 0, presenting a '
      + 'broken alerts feature as a quiet user',
  );
  assert.match(savedSearches, /requireArray<AlertMatch>\(data\.matches/);
});

test('the shape validator explains that this is a fault, not an empty result', () => {
  const body = savedSearches.match(/function requireArray[\s\S]*?\n}/);
  assert.ok(body, 'expected the requireArray helper');
  assert.match(body[0], /is broken|not reporting/i);
});

// --- 2. a failed load must not render the empty-state copy -------------

test('the terminal empty state distinguishes a failed load from narrow filters', () => {
  assert.match(
    terminal,
    /syncStatus === "error"[\s\S]{0,400}Inventory could not be loaded/,
    'when syncStatus is error the copy must not tell the user to adjust filters',
  );
});

test('the narrow-filter copy survives for a genuinely empty result', () => {
  assert.match(terminal, /No properties match these underwriting criteria/);
});

// --- 3. the runtime-mode warning must survive a failed health probe -----

test('the data-mode banner distinguishes "not loaded" from "probe failed"', () => {
  assert.match(
    dataModeBanner,
    /useState<Health \| null \| undefined>\(undefined\)/,
    'the health state must be tri-state; collapsing not-loaded into null is what '
      + 'let a failed probe delete the banner',
  );
  assert.ok(
    !/if \(dismissed \|\| !health\) return null;/.test(dataModeBanner),
    'the !health guard removed the banner entirely on a failed probe',
  );
});

test('a failed health probe still renders a runtime-mode warning', () => {
  assert.match(dataModeBanner, /Runtime mode unverified/);
});

// --- 4. server-side caps on unbounded request arrays -------------------

test('saved-search filter arrays are capped in count, not just element length', () => {
  assert.match(
    savedSearchesRoute,
    /value\.length <= MAX_STRING_ARRAY_LENGTH/,
    'a 2MB body could hold ~30k keywords and persist them as jsonb unbounded',
  );
});

test('mark_read ids are capped and shape-checked before reaching the uuid cast', () => {
  assert.match(savedSearchesRoute, /MAX_MARK_READ_IDS/);
  assert.match(
    savedSearchesRoute,
    /UUID_PATTERN\.test\(v\)/,
    'ids reach id = ANY($2::uuid[]); one non-UUID string aborted the whole cast '
      + 'and returned a 500 instead of a 400',
  );
  assert.match(savedSearchesRoute, /too_many_match_ids/);
});
