'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { validateReviewInput, applyReview, REVIEW_STATES } = require('../server/intelligence/document-review');

test('terminal review cannot silently reopen to pending', () => {
  const errors = validateReviewInput(
    { status: 'pending' },
    { current: { status: 'approved', revision: 1 } }
  );
  assert.ok(errors.some((e) => e.startsWith('state:') && /approved -> pending/.test(e)));
});

test('approved may move to rejected or needs_more with required fields', () => {
  const rejected = applyReview(
    { status: 'approved', revision: 1, notes: null, reviewer: 'a', reviewedAt: null, priorStatus: 'pending' },
    { status: 'rejected', reviewer: 'b', notes: 'changed' }
  );
  assert.equal(rejected.status, REVIEW_STATES.REJECTED);
  assert.equal(rejected.revision, 2);

  const pendingToApproved = applyReview(
    { status: 'pending', revision: 0, notes: null, reviewer: null, reviewedAt: null, priorStatus: null },
    { status: 'approved', reviewer: 'b', notes: 'ok' }
  );
  assert.equal(pendingToApproved.status, REVIEW_STATES.APPROVED);
});

test('revision mismatch is rejected when expectedRevision is supplied', () => {
  const result = applyReview(
    { status: 'approved', revision: 3, notes: 'x', reviewer: 'a', reviewedAt: '2026-01-01T00:00:00.000Z', priorStatus: 'pending' },
    { status: 'rejected', reviewer: 'b', notes: 'nope' },
    { expectedRevision: 2, current: { status: 'approved', revision: 3 } }
  );
  assert.ok(Array.isArray(result.errors));
  assert.ok(result.errors.some((e) => /revision mismatch/.test(e)));
});

test('same-status re-confirmation remains allowed for terminal states', () => {
  const result = applyReview(
    { status: 'approved', revision: 2, notes: 'old', reviewer: 'a', reviewedAt: '2026-01-01T00:00:00.000Z', priorStatus: 'pending' },
    { status: 'approved', reviewer: 'a', notes: 'reconfirmed' }
  );
  assert.equal(result.status, REVIEW_STATES.APPROVED);
  assert.equal(result.revision, 2);
  assert.equal(result.notes, 'reconfirmed');
});
