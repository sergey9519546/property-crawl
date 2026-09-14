const assert = require('node:assert/strict');
const test = require('node:test');
const {
  REVIEW_STATES,
  REVIEW_STATES_SET,
  MAX_NOTE_LENGTH,
  MAX_REVIEWER_LENGTH,
  cleanNote,
  cleanReviewer,
  validateReviewInput,
  applyReview,
  normalizeReview,
  createPendingReview,
  filterByStatus,
  summarizeReviews,
} = require('../server/intelligence/document-review');

test('REVIEW_STATES exposes the four-state vocabulary', () => {
  assert.deepEqual(
    Object.values(REVIEW_STATES).sort(),
    ['approved', 'needs_more', 'pending', 'rejected'].sort(),
  );
  assert.equal(REVIEW_STATES_SET.size, 4);
});

test('cleanNote trims, collapses whitespace, and caps length', () => {
  assert.equal(cleanNote('  hello   world  '), 'hello world');
  assert.equal(cleanNote(null), null);
  assert.equal(cleanNote(undefined), null);
  assert.equal(cleanNote(42), null);
  assert.equal(cleanNote(''), null);
  assert.equal(cleanNote('   '), null);
  const long = 'a'.repeat(MAX_NOTE_LENGTH + 200);
  assert.equal(cleanNote(long).length, MAX_NOTE_LENGTH);
  const internalWhitespace = 'multi\n\n\tline\n\nvalue';
  assert.equal(cleanNote(internalWhitespace), 'multi line value');
});

test('cleanReviewer trims and caps length but preserves case', () => {
  assert.equal(cleanReviewer('  operator-7  '), 'operator-7');
  assert.equal(cleanReviewer('Operator-7'), 'Operator-7');
  assert.equal(cleanReviewer(''), null);
  assert.equal(cleanReviewer('   '), null);
  const long = 'r'.repeat(MAX_REVIEWER_LENGTH + 50);
  assert.equal(cleanReviewer(long).length, MAX_REVIEWER_LENGTH);
});

test('createPendingReview initializes the right default state', () => {
  const review = createPendingReview();
  assert.equal(review.status, REVIEW_STATES.PENDING);
  assert.equal(review.notes, null);
  assert.equal(review.reviewer, null);
  assert.equal(review.reviewedAt, null);
  assert.equal(review.revision, 0);
  assert.equal(review.priorStatus, null);
  assert.match(review.extractedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test('createPendingReview respects extractedAt when provided', () => {
  const review = createPendingReview({ extractedAt: '2025-09-12T12:00:00.000Z' });
  assert.equal(review.extractedAt, '2025-09-12T12:00:00.000Z');
});

test('normalizeReview maps unknown statuses to pending', () => {
  const pending = normalizeReview({ status: 'something-else', notes: 'note' });
  assert.equal(pending.status, REVIEW_STATES.PENDING);
  assert.equal(pending.notes, 'note');
});

test('normalizeReview handles null, undefined, arrays, and primitives', () => {
  assert.equal(normalizeReview(null).status, REVIEW_STATES.PENDING);
  assert.equal(normalizeReview(undefined).status, REVIEW_STATES.PENDING);
  assert.equal(normalizeReview('not-an-object').status, REVIEW_STATES.PENDING);
  assert.equal(normalizeReview([]).status, REVIEW_STATES.PENDING);
  assert.equal(normalizeReview(42).status, REVIEW_STATES.PENDING);
});

test('validateReviewInput rejects non-object inputs', () => {
  assert.deepEqual(validateReviewInput(null), ['shape: review input must be an object']);
  assert.deepEqual(validateReviewInput(undefined), ['shape: review input must be an object']);
  assert.deepEqual(validateReviewInput([]), ['shape: review input must be an object']);
  assert.deepEqual(validateReviewInput('not-an-object'), ['shape: review input must be an object']);
  assert.deepEqual(validateReviewInput(42), ['shape: review input must be an object']);
});

test('validateReviewInput requires a known status', () => {
  assert.deepEqual(validateReviewInput({}), ['state: status is required']);
  const errors = validateReviewInput({ status: 'garbage' });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /^state:/);
  assert.match(errors[0], /must be one of/);
});

test('validateReviewInput rejects terminal reviews without a note', () => {
  const rejectedErrors = validateReviewInput({ status: 'rejected', reviewer: 'operator-7' });
  assert.ok(rejectedErrors.some(e => e.startsWith('note:')));
  const needsMoreErrors = validateReviewInput({ status: 'needs_more', reviewer: 'operator-7' });
  assert.ok(needsMoreErrors.some(e => e.startsWith('note:')));
});

test('validateReviewInput accepts rejected and needs_more with notes', () => {
  assert.deepEqual(
    validateReviewInput({ status: 'rejected', reviewer: 'op-7', notes: 'link is dead' }),
    [],
  );
  assert.deepEqual(
    validateReviewInput({ status: 'needs_more', reviewer: 'op-7', notes: 'need the legal description' }),
    [],
  );
});

test('validateReviewInput rejects terminal reviews without a reviewer', () => {
  const approvedErrors = validateReviewInput({ status: 'approved', notes: 'looks fine' });
  assert.ok(approvedErrors.some(e => e.startsWith('reviewer:')));
  const rejectedErrors = validateReviewInput({ status: 'rejected', notes: 'wrong doc' });
  assert.ok(rejectedErrors.some(e => e.startsWith('reviewer:')));
});

test('validateReviewInput accepts pending reviews with no reviewer and no notes', () => {
  assert.deepEqual(validateReviewInput({ status: 'pending' }), []);
});

test('validateReviewInput honours the custom maxNoteLength option', () => {
  const long = 'x'.repeat(250);
  const noCap = validateReviewInput({ status: 'rejected', reviewer: 'op-7', notes: long }, { maxNoteLength: 500 });
  assert.deepEqual(noCap, []);
  const capped = validateReviewInput({ status: 'rejected', reviewer: 'op-7', notes: long }, { maxNoteLength: 100 });
  assert.ok(capped.some(e => /^note:/.test(e)));
});

test('applyReview returns an errors object when input is invalid', () => {
  const result = applyReview(null, { status: 'approved' });
  assert.ok(Array.isArray(result.errors));
  assert.ok(result.errors.length > 0);
});

test('applyReview advances pending to approved with reviewer + notes', () => {
  const before = createPendingReview();
  const result = applyReview(before, { status: 'approved', reviewer: 'op-7', notes: 'verified the deed' });
  assert.equal(result.status, REVIEW_STATES.APPROVED);
  assert.equal(result.reviewer, 'op-7');
  assert.equal(result.notes, 'verified the deed');
  assert.equal(result.priorStatus, REVIEW_STATES.PENDING);
  assert.equal(result.revision, 1);
  assert.match(result.reviewedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test('applyReview advances approved to rejected (revision increments)', () => {
  const approved = {
    status: REVIEW_STATES.APPROVED,
    reviewer: 'op-7',
    notes: 'looks fine',
    reviewedAt: '2025-09-10T10:00:00.000Z',
    revision: 2,
    priorStatus: REVIEW_STATES.PENDING,
  };
  const result = applyReview(approved, { status: 'rejected', reviewer: 'op-7', notes: 'actually the link is dead' });
  assert.equal(result.status, REVIEW_STATES.REJECTED);
  assert.equal(result.priorStatus, REVIEW_STATES.APPROVED);
  assert.equal(result.revision, 3);
});

test('applyReview preserves reviewedAt when the status does not change', () => {
  const approved = {
    status: REVIEW_STATES.APPROVED,
    reviewer: 'op-7',
    notes: 'looks fine',
    reviewedAt: '2025-09-10T10:00:00.000Z',
    revision: 1,
    priorStatus: REVIEW_STATES.PENDING,
  };
  const result = applyReview(approved, { status: 'approved', reviewer: 'op-7', notes: 're-confirmed' });
  assert.equal(result.reviewedAt, '2025-09-10T10:00:00.000Z');
  assert.equal(result.revision, 1);
  assert.equal(result.priorStatus, REVIEW_STATES.PENDING);
});

test('applyReview accepts a custom now option for deterministic timestamps', () => {
  const before = createPendingReview();
  const result = applyReview(
    before,
    { status: 'approved', reviewer: 'op-7', notes: 'ok' },
    { now: '2025-09-12T15:30:00.000Z' },
  );
  assert.equal(result.reviewedAt, '2025-09-12T15:30:00.000Z');
});

test('applyReview ignores an unparseable now option and uses wall clock', () => {
  const before = createPendingReview();
  const result = applyReview(before, { status: 'approved', reviewer: 'op-7', notes: 'ok' }, { now: 'not a date' });
  assert.match(result.reviewedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test('applyReview accepts Date objects as the now option', () => {
  const before = createPendingReview();
  const fixed = new Date('2025-09-12T20:00:00.000Z');
  const result = applyReview(before, { status: 'approved', reviewer: 'op-7', notes: 'ok' }, { now: fixed });
  assert.equal(result.reviewedAt, '2025-09-12T20:00:00.000Z');
});

test('applyReview accepts epoch milliseconds as the now option', () => {
  const before = createPendingReview();
  const epoch = Date.parse('2025-09-12T20:00:00.000Z');
  const result = applyReview(before, { status: 'approved', reviewer: 'op-7', notes: 'ok' }, { now: epoch });
  assert.equal(result.reviewedAt, '2025-09-12T20:00:00.000Z');
});

test('applyReview result is frozen', () => {
  const before = createPendingReview();
  const result = applyReview(before, { status: 'approved', reviewer: 'op-7', notes: 'ok' });
  assert.equal(Object.isFrozen(result), true);
});

test('applyReview with invalid input returns frozen errors object', () => {
  const result = applyReview(null, { status: 'approved' });
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.errors), true);
});

test('filterByStatus returns the input unchanged when status is undefined', () => {
  const reviews = [
    { status: REVIEW_STATES.PENDING, reviewer: null, notes: null, reviewedAt: null, revision: 0, priorStatus: null },
    { status: REVIEW_STATES.APPROVED, reviewer: 'op-7', notes: 'ok', reviewedAt: '2025-09-12T00:00:00.000Z', revision: 1, priorStatus: REVIEW_STATES.PENDING },
  ];
  const out = filterByStatus(reviews, undefined);
  assert.deepEqual(out, reviews);
  assert.notEqual(out, reviews);
});

test('filterByStatus filters by pending', () => {
  const reviews = [
    { status: REVIEW_STATES.PENDING, reviewer: null, notes: null, reviewedAt: null, revision: 0, priorStatus: null },
    { status: REVIEW_STATES.APPROVED, reviewer: 'op-7', notes: 'ok', reviewedAt: '2025-09-12T00:00:00.000Z', revision: 1, priorStatus: REVIEW_STATES.PENDING },
  ];
  const out = filterByStatus(reviews, REVIEW_STATES.PENDING);
  assert.equal(out.length, 1);
  assert.equal(out[0].status, REVIEW_STATES.PENDING);
});

test('filterByStatus filters by approved', () => {
  const reviews = [
    { status: REVIEW_STATES.PENDING, reviewer: null, notes: null, reviewedAt: null, revision: 0, priorStatus: null },
    { status: REVIEW_STATES.APPROVED, reviewer: 'op-7', notes: 'ok', reviewedAt: '2025-09-12T00:00:00.000Z', revision: 1, priorStatus: REVIEW_STATES.PENDING },
    { status: REVIEW_STATES.REJECTED, reviewer: 'op-7', notes: 'bad', reviewedAt: '2025-09-12T00:00:00.000Z', revision: 1, priorStatus: REVIEW_STATES.PENDING },
  ];
  const out = filterByStatus(reviews, REVIEW_STATES.APPROVED);
  assert.equal(out.length, 1);
  assert.equal(out[0].status, REVIEW_STATES.APPROVED);
});

test('filterByStatus returns empty array for unknown status', () => {
  const reviews = [{ status: REVIEW_STATES.PENDING, reviewer: null, notes: null, reviewedAt: null, revision: 0, priorStatus: null }];
  assert.deepEqual(filterByStatus(reviews, 'unknown'), []);
  assert.deepEqual(filterByStatus(reviews, ''), []);
});

test('filterByStatus handles non-array input safely', () => {
  assert.deepEqual(filterByStatus(null, REVIEW_STATES.PENDING), []);
  assert.deepEqual(filterByStatus(undefined, REVIEW_STATES.PENDING), []);
  assert.deepEqual(filterByStatus('not-array', REVIEW_STATES.PENDING), []);
});

test('summarizeReviews counts per state and total', () => {
  const reviews = [
    { status: REVIEW_STATES.PENDING, reviewer: null, notes: null, reviewedAt: null, revision: 0, priorStatus: null },
    { status: REVIEW_STATES.PENDING, reviewer: null, notes: null, reviewedAt: null, revision: 0, priorStatus: null },
    { status: REVIEW_STATES.APPROVED, reviewer: 'op-7', notes: 'ok', reviewedAt: '2025-09-12T00:00:00.000Z', revision: 1, priorStatus: REVIEW_STATES.PENDING },
    { status: REVIEW_STATES.REJECTED, reviewer: 'op-7', notes: 'bad', reviewedAt: '2025-09-12T00:00:00.000Z', revision: 1, priorStatus: REVIEW_STATES.PENDING },
    { status: REVIEW_STATES.NEEDS_MORE, reviewer: 'op-7', notes: 'need legal', reviewedAt: '2025-09-12T00:00:00.000Z', revision: 1, priorStatus: REVIEW_STATES.PENDING },
  ];
  const summary = summarizeReviews(reviews);
  assert.equal(summary.total, 5);
  assert.equal(summary.byStatus.pending, 2);
  assert.equal(summary.byStatus.approved, 1);
  assert.equal(summary.byStatus.rejected, 1);
  assert.equal(summary.byStatus.needs_more, 1);
});

test('summarizeReviews treats unknown statuses as pending', () => {
  const reviews = [
    { status: 'unknown-state', reviewer: null, notes: null, reviewedAt: null, revision: 0, priorStatus: null },
  ];
  const summary = summarizeReviews(reviews);
  assert.equal(summary.byStatus.pending, 1);
  assert.equal(summary.byStatus.approved, 0);
});

test('summarizeReviews handles empty and non-array input', () => {
  const empty = summarizeReviews([]);
  assert.equal(empty.total, 0);
  assert.equal(empty.byStatus.pending, 0);
  assert.deepEqual(summarizeReviews(null), { total: 0, byStatus: summarizeReviews([]).byStatus });
  assert.deepEqual(summarizeReviews(undefined), { total: 0, byStatus: summarizeReviews([]).byStatus });
});
