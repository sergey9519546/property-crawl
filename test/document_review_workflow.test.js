'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  applyReview,
  normalizeReview,
  createPendingReview,
  REVIEW_STATES,
  validateReviewInput
} = require('../server/intelligence/document-review');

const { createDocumentReviewStore } = require('../server/intelligence/document-review-store');

test('Document Review Workflow: validates review state transitions', () => {
  const pending = createPendingReview({ listingId: 'LISTING-101', extractedAt: '2026-10-01T00:00:00Z' });
  assert.equal(pending.status, 'pending');
  assert.equal(pending.revision, 0);

  // Transition: pending -> approved
  const approved = applyReview(pending, {
    status: 'approved',
    reviewer: 'operator-1',
    notes: 'Legal notice verified matching sheriff docket.'
  });

  assert.equal(approved.status, 'approved');
  assert.equal(approved.priorStatus, 'pending');
  assert.equal(approved.revision, 1);
  assert.equal(approved.reviewer, 'operator-1');

  // Transition: approved -> rejected (revision increments)
  const rejected = applyReview(approved, {
    status: 'rejected',
    reviewer: 'supervisor-2',
    notes: 'Notice is probate administration, not mortgage foreclosure.'
  });

  assert.equal(rejected.status, 'rejected');
  assert.equal(rejected.priorStatus, 'approved');
  assert.equal(rejected.revision, 2);
});

test('Document Review Workflow: rejects invalid status mutations', () => {
  const errors = validateReviewInput({ status: 'invalid_status' });
  assert.ok(errors.length > 0);
  assert.match(errors[0], /status must be one of/i);
});

test('Document Review Store: persists decisions atomically and survives corruption', () => {
  const tmpPath = path.resolve(__dirname, `../.cache/test-doc-review-${Date.now()}.json`);

  try {
    const store = createDocumentReviewStore({ storePath: tmpPath });
    const pending = createPendingReview({ listingId: 'TEST-PROP-1' });

    // Save item in store.map and persist
    store.map.set('DOC-1', pending);
    store.persist();

    const retrieved = store.map.get('DOC-1');
    assert.ok(retrieved);
    assert.equal(retrieved.status, 'pending');

    // Approve item and update store
    const approved = applyReview(retrieved, { status: 'approved', reviewer: 'op-jane' });
    store.map.set('DOC-1', approved);
    store.persist();

    // Reload from disk
    const reloadedStore = createDocumentReviewStore({ storePath: tmpPath });
    const reloaded = reloadedStore.map.get('DOC-1');
    assert.equal(reloaded.status, 'approved');
    assert.equal(reloaded.reviewer, 'op-jane');

    // Test Corruption Protection: corrupt the file on disk
    fs.writeFileSync(tmpPath, '{ corrupted_unparseable_json: [}', 'utf8');

    // Create a new store instance targeting the corrupted file
    const safeStore = createDocumentReviewStore({ storePath: tmpPath });
    // Safe store must move corrupted file aside and record lastLoadError without crashing
    assert.ok(safeStore.loadError);
    assert.ok(safeStore.quarantined);
    assert.equal(safeStore.map.size, 0);
  } finally {
    if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
  }
});
