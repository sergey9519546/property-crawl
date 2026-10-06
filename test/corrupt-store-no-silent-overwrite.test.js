'use strict';

// test/corrupt-store-no-silent-overwrite.test.js
//
// PP-01. Two stores can fail to load: the workspace store (saved searches and
// alert matches) and the document-review store. Until this was fixed, both
// caught the failure, logged "starting empty", and carried on.
//
// That is not only silent, it is DESTRUCTIVE. After a failed load the in-memory
// maps are empty, and the next write persists that emptiness over the file:
// one corrupt store plus one user action deletes every saved search, every
// alert match, or every review, with no error anywhere. The document-review
// store had a second route to the same place - a version this build does not
// understand loads as empty without even throwing.
//
// Two halves, both required:
//
//   PROTECTION   an unreadable store is MOVED ASIDE (.corrupt-<ts>) before
//                anything can overwrite it, so the bytes survive and a fresh
//                store may be written in its place. If the move itself fails,
//                writes are blocked outright - losing the ability to save is
//                strictly better than silently deleting what is saved.
//   VISIBILITY   the reason reaches the surfaces a user or operator actually
//                reads: /api/health, /api/saved-searches, and the
//                document-review list. A getter with no consumer is not
//                reporting anything.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

function tempStore(t, name, contents) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-store-guard-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, name);
  fs.writeFileSync(file, contents);
  return { dir, file };
}

const codeOf = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
  .split(/\r?\n/)
  .filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l))
  .join('\n');

// ---- protection: document-review store ------------------------------------

function reviewStore(t, contents) {
  const { file } = tempStore(t, 'document-review-store.json', contents);
  const { createDocumentReviewStore } = require('../server/intelligence/document-review-store');
  const store = createDocumentReviewStore({
    storePath: file,
    env: { ...process.env, PROPERTY_DOCUMENT_REVIEW_STORE_PATH: file },
  });
  store.load();
  return { store, file };
}

test('an unreadable review store is moved aside, not left to be overwritten', (t) => {
  const { store, file } = reviewStore(t, '{not-valid-json');
  assert.ok(store.loadError, 'the failure must be recorded');
  assert.ok(store.quarantined, 'the unreadable file must be moved aside');
  assert.equal(fs.existsSync(store.quarantined), true, 'the quarantined file must exist');
  assert.equal(fs.existsSync(file), false, 'the live path is free for a fresh store');
});

test('a version-mismatched review store holding real data is preserved', (t) => {
  // The non-destructive case: valid bytes, real reviews, a version this build
  // does not understand. It used to load empty and let the next write replace
  // it. The reviews must still be on disk afterwards.
  const payload = JSON.stringify({
    version: 99,
    updatedAt: 'x',
    reviews: { r1: { label: 'real-review-payload' } },
  });
  const { store } = reviewStore(t, payload);
  assert.ok(store.loadError, 'a version mismatch is a load failure too');
  assert.ok(store.quarantined, 'it must be moved aside for the same reason');
  assert.match(fs.readFileSync(store.quarantined, 'utf8'), /real-review-payload/,
    'the real reviews must survive; this is the data-loss case');
});

test('persist refuses when the unreadable store could not be moved aside', () => {
  // Guards the fallback: if quarantine fails, the original is the only copy, so
  // writing must be refused rather than allowed to destroy it.
  const code = codeOf('server/intelligence/document-review-store.js');
  assert.match(code, /persistBlocked\s*=\s*true/);
  assert.match(code, /if \(persistBlocked\)/);
  assert.match(code, /Persist refused/);
});

// ---- protection: workspace store ------------------------------------------

test('an unreadable workspace store is moved aside before any write', (t) => {
  const { file } = tempStore(t, 'workspace-store.json', '{not-valid-json');
  const { DatabaseClient } = require('../server/db/client');
  const db = new DatabaseClient({
    env: { NODE_ENV: 'test', PROPERTY_WORKSPACE_STORE_PATH: file },
    workspaceStorePath: file,
  });
  assert.ok(db.workspaceStoreError, 'the failure must be recorded');
  assert.ok(db.workspaceStoreQuarantined, 'the unreadable file must be moved aside');
  assert.equal(fs.existsSync(db.workspaceStoreQuarantined), true);
});

test('workspace persist is blocked when quarantine could not move the file aside', () => {
  const code = codeOf('server/db/client.js');
  assert.match(code, /_workspaceStoreWriteBlocked/, 'the block flag must exist');
  assert.match(code, /_quarantineWorkspaceStore/);
  assert.match(code, /Persist refused/);
});

// ---- visibility: every surface has a consumer ---------------------------

test('the health payload reports both stores', () => {
  const code = codeOf('server/server.js');
  assert.match(code, /workspaceStoreError/);
  assert.match(code, /workspaceStoreQuarantinedTo/);
  assert.match(code, /workspaceStoreWritesBlocked/);
  assert.match(code, /documentReviewStoreError/);
  assert.match(code, /documentReviewStoreQuarantinedTo/);
  assert.match(code, /documentReviewStoreWritesBlocked/);
});

test('the saved-searches list tells the user their store failed to load', () => {
  // This is the response the UI reads. Without it, count: 0 is the same as
  // "you have no saved searches".
  const code = codeOf('server/routes/saved-searches.js');
  assert.match(code, /storeError:\s*database\.workspaceStoreError/);
  assert.match(code, /storeQuarantinedTo/);
  assert.match(code, /writesBlocked/);
});

test('the document-review list tells the user their store failed to load', () => {
  const code = codeOf('server/routes/document-review.js');
  assert.match(code, /storeError:\s*store\.loadError/);
  assert.match(code, /storeQuarantinedTo/);
  assert.match(code, /writesBlocked/);
});

test('loadError is read somewhere - a getter with no consumer is not a report', () => {
  // The regression this file exists to stop: loadError was added and nothing
  // read it, which is a field, not a report.
  const consumers = ['server/server.js', 'server/routes/document-review.js']
    .map((f) => ({ f, code: codeOf(f) }))
    .filter((x) => /loadError/.test(x.code))
    .map((x) => x.f);
  assert.ok(consumers.length > 0, 'loadError must be consumed, not merely exported');
});

test('the health payload evaluates - an undefined name there is a 503', () => {
  // Caught by test/api-rate-http.test.js the first time: the health handler
  // referenced `docReview`, which is a const declared 118 lines LATER, inside
  // the test-reset hook. The ReferenceError was caught by the outer handler
  // and turned into 503, which is what a readiness failure looks like - so a
  // typo in a reporting field was indistinguishable from the database being
  // down. Assert the route actually answers 200 with the fields present.
  const server = require('../server/server');
  const http = require('node:http');
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      http.get(`http://127.0.0.1:${port}/api/health`, (res) => {
        let body = '';
        res.on('data', (c) => { body += c; });
        res.on('end', () => {
          server.close(() => {
            try {
              assert.equal(res.statusCode, 200, `health returned ${res.statusCode}: ${body.slice(0, 200)}`);
              const parsed = JSON.parse(body);
              assert.equal(parsed.status, 'ok');
              // The canary used to be `seeded`, which existed only because a
              // failed demo seed could leave a healthy server serving zero
              // listings. There is no runtime seed any more, so the fields that
              // now carry that truth are dataMode and postgresReachable - and a
              // typo in either is the same 503-shaped bug this guard exists for.
              assert.equal(typeof parsed.dataMode, 'string', 'dataMode must be present');
              assert.ok(['postgres', 'memory', 'unavailable'].includes(parsed.dataMode),
                `dataMode must be one of the three honest values, got ${parsed.dataMode}`);
              assert.equal(typeof parsed.postgresReachable, 'boolean',
                'postgresReachable must be present');
              // When nothing is served, the payload must say why rather than
              // leaving the caller to guess between an outage and an empty DB.
              if (parsed.dataMode === 'unavailable') {
                assert.equal(typeof parsed.inventoryUnavailableReason, 'string',
                  'an unavailable inventory must carry a reason');
              }
              // Absent is correct when nothing failed; a boolean false is not.
              assert.ok(
                parsed.workspaceStoreError === undefined || typeof parsed.workspaceStoreError === 'string',
                'workspaceStoreError must be absent or a reason'
              );
              resolve();
            } catch (error) { reject(error); }
          });
        });
      }).on('error', reject);
    });
  });
});
