'use strict';
// Drift gate for CONTEXT.md (scenario 4): a change to data.js / server routes /
// package.json scripts must be followed by `node scripts/gen-context.js`, else
// this test fails. This is the generalized version of the existing
// `test/sync.test.js` v0<->v2 drift check, applied to the domain model.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { computeFacts, computeDigest, CONTEXT_PATH } = require('../scripts/gen-context.js');

test('CONTEXT.md exists and embeds a digest', () => {
  assert.ok(fs.existsSync(CONTEXT_PATH), 'CONTEXT.md must be generated (node scripts/gen-context.js)');
  const body = fs.readFileSync(CONTEXT_PATH, 'utf8');
  assert.match(body, /CONTEXT-DIGEST:\s*[0-9a-f]{64}/, 'digest marker present');
});

test('CONTEXT.md digest matches current sources (not stale)', () => {
  const facts = computeFacts();
  const liveDigest = computeDigest(facts);
  const body = fs.readFileSync(CONTEXT_PATH, 'utf8');
  const m = body.match(/CONTEXT-DIGEST:\s*([0-9a-f]{64})/);
  assert.ok(m, 'digest marker present');
  assert.strictEqual(m[1], liveDigest,
    'CONTEXT.md is stale vs data.js/server routes/package.json — run `node scripts/gen-context.js`');
});

test('CONTEXT.md reflects a non-empty SOURCES taxonomy', () => {
  const facts = computeFacts();
  assert.ok(facts.sourceCount > 0, 'SOURCES taxonomy must be non-empty');
  const body = fs.readFileSync(CONTEXT_PATH, 'utf8');
  // Wording changed deliberately: the section used to call data.js's 16 entries
  // "16 source types", which is exactly the confusion this section used to
  // cause. 16 is the v0 seed taxonomy; the catalog is the real one.
  assert.ok(
    body.includes(`\`SOURCES\` in data.js: ${facts.sourceCount} entries`),
    'the data.js seed taxonomy count must be rendered'
  );
  // And the number that actually answers "how many sources are there?".
  assert.ok(
    body.includes(`**${facts.catalogCount} catalog entries**`),
    'the authoritative catalog size must be rendered'
  );
  assert.ok(
    facts.catalogCount > facts.sourceCount,
    'fixture assumption: the catalog is larger than the data.js seed taxonomy'
  );
  assert.doesNotMatch(body, /## Data shape \(source of truth\)/);
});