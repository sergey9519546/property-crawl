'use strict';

// test/store-load-failures-are-reported.test.js
//
// The same defect as seedError, one level down: a store that fails to load is
// presented as a store that is empty.
//
// The in-memory inventory fix (db-seed-failure-is-reported.test.js) established
// the pattern - record it on the client, surface it on the health payload, next
// to dataMode and postgresReachable. Leaving the optional stores silent while
// the inventory reports would itself be a new inconsistency, so they follow.
//
//   workspace store    "starting empty" on a load failure, with
//                      _workspaceStoreLoaded already true so there is no retry,
//                      and it appears in NO payload at all. The user's saved
//                      searches and alert matches are on disk and not loaded.
//   document-review    "starting empty" on a load failure, reviews.clear(),
//                      reported nowhere; the payload names the store location
//                      (documentReviewStore) but never whether it loaded.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const CLIENT = path.join(ROOT, 'server', 'db', 'client.js');
const SERVER = path.join(ROOT, 'server', 'server.js');
const REVIEW = path.join(ROOT, 'server', 'intelligence', 'document-review-store.js');

const codeOf = (p) => fs.readFileSync(p, 'utf8')
  .split(/\r?\n/)
  .filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l))
  .join('\n');

function withTempFile(t, name, contents) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-store-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, name);
  fs.writeFileSync(file, contents);
  return file;
}

test('a failed workspace-store load is recorded, not only warned about', () => {
  const code = codeOf(CLIENT);
  assert.match(code, /this\.workspaceStoreError\s*=/,
    'the load failure must be stored on the client');
  assert.doesNotMatch(
    code,
    /catch\s*\(err\)\s*\{\s*console\.warn\('\[DB\] Failed to load workspace store; starting empty:'[^\n]*\n\s*\}/,
    'a load failure that is only logged is the bug this file exists to stop'
  );
});

test('the health payload carries the workspace-store failure', () => {
  // It appears in no other payload, so health is where an operator will look.
  const code = codeOf(SERVER);
  assert.match(code, /workspaceStoreError:\s*db\.workspaceStoreError/);
});

test('the document-review store exposes its load failure', () => {
  const code = codeOf(REVIEW);
  assert.match(code, /lastLoadError\s*=/);
  assert.match(code, /get loadError\(\)/,
    'the store must expose the failure so its route can surface it');
});

test('a corrupt workspace store reports instead of reading as empty', (t) => {
  const file = withTempFile(t, 'workspace-store.json', '{not-json');
  const { DatabaseClient } = require('../server/db/client');
  const db = new DatabaseClient({
    env: { NODE_ENV: 'test', PROPERTY_WORKSPACE_STORE_PATH: file },
    workspaceStorePath: file,
  });
  assert.ok(
    db.workspaceStoreError,
    'a corrupt workspace store must leave a reason, not an empty-looking store'
  );
  assert.equal(db.inMemoryData.savedSearches.size, 0);
});

test('a healthy workspace store reports no error', () => {
  const { DatabaseClient } = require('../server/db/client');
  const db = new DatabaseClient({ env: { NODE_ENV: 'test' }, workspaceStorePath: null });
  assert.equal(db.workspaceStoreError, undefined,
    'the field must be absent when nothing went wrong, not falsy-but-present');
});
