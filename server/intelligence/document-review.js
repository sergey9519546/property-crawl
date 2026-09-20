'use strict';

/**
 * Document Content Review
 * ======================
 *
 * The build-data extraction pipeline (server/intelligence/document-evidence.js)
 * classifies each captured document as observed / unknown / none_observed. The
 * extracted items are then queued for human review before they are surfaced
 * through the workspace UI. This module is the pure, persistence-free layer
 * for that review state machine.
 *
 * States
 * ------
 *   pending    - default; the document was extracted and is awaiting review
 *   approved   - a human reviewer accepted the captured evidence as genuine
 *   rejected   - a human reviewer rejected the evidence (wrong doc, link
 *                dead, not actually publisher-provided, etc.)
 *   needs_more - the document exists but the reviewer needs additional
 *                information (note carries the open question)
 *
 * The state machine forbids skipping review (cannot go pending -> approved
 * without notes when reviewer is unknown) and forbids silent rejection
 * (every rejected review must carry notes).
 *
 * No I/O happens here. The caller is responsible for storage.
 */

const REVIEW_STATES = Object.freeze({
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  NEEDS_MORE: 'needs_more',
});

const REVIEW_STATES_SET = new Set(Object.values(REVIEW_STATES));

const MAX_NOTE_LENGTH = 2000;
const MAX_REVIEWER_LENGTH = 200;

/**
 * Clean a free-text note. Trims, collapses whitespace, drops empties.
 * Caps at MAX_NOTE_LENGTH. Returns null for empty input.
 */
function cleanNote(value) {
  if (typeof value !== 'string') return null;
  const collapsed = value.replace(/\s+/g, ' ').trim();
  if (!collapsed) return null;
  return collapsed.slice(0, MAX_NOTE_LENGTH);
}

/**
 * Clean a reviewer identifier (a workspace session id, an operator name,
 * an automated reviewer's tag, etc.). Returns null for empty input.
 */
function cleanReviewer(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, MAX_REVIEWER_LENGTH);
}

/**
 * Allowed review transitions (strict). Terminal reviews may be re-confirmed
 * with the same status (notes/reviewer refresh) but cannot silently reopen.
 * pending -> any terminal is allowed.
 * needs_more / rejected / approved -> pending is forbidden.
 */
const ALLOWED_TRANSITIONS = {
  pending: new Set(['pending', 'approved', 'rejected', 'needs_more']),
  approved: new Set(['approved', 'rejected', 'needs_more']),
  rejected: new Set(['rejected', 'approved', 'needs_more']),
  needs_more: new Set(['needs_more', 'approved', 'rejected']),
};

function validateReviewInput(input, options = {}) {
  const errors = [];
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return ['shape: review input must be an object'];
  }

  const nextStatus = cleanNote(input.status)?.toLowerCase();
  if (!nextStatus) {
    errors.push('state: status is required');
  } else if (!REVIEW_STATES_SET.has(nextStatus)) {
    errors.push(`state: status must be one of ${[...REVIEW_STATES_SET].join(', ')}`);
  }

  const currentStatus = normalizeReview(options.current).status;
  if (nextStatus && REVIEW_STATES_SET.has(nextStatus) && currentStatus) {
    const allowed = ALLOWED_TRANSITIONS[currentStatus] || new Set([currentStatus]);
    if (!allowed.has(nextStatus)) {
      errors.push(`state: transition ${currentStatus} -> ${nextStatus} is not allowed`);
    }
  }

  // Optional optimistic concurrency: when expectedRevision is provided it
  // must match the current revision (callers that omit it keep legacy behavior).
  const expectedRevision = options.expectedRevision;
  if (expectedRevision !== undefined && expectedRevision !== null) {
    const currentRevision = normalizeReview(options.current).revision;
    const expected = Number(expectedRevision);
    if (!Number.isFinite(expected) || expected !== currentRevision) {
      errors.push(`state: revision mismatch (expected ${expectedRevision}, current ${currentRevision})`);
    }
  }

  const note = cleanNote(input.notes ?? input.note);
  const reviewer = cleanReviewer(input.reviewer);

  const requiresNote = nextStatus === REVIEW_STATES.REJECTED || nextStatus === REVIEW_STATES.NEEDS_MORE;
  if (requiresNote && !note) {
    errors.push('note: rejected and needs_more reviews require a note');
  }

  const requiresReviewer = nextStatus === REVIEW_STATES.APPROVED
    || nextStatus === REVIEW_STATES.REJECTED
    || nextStatus === REVIEW_STATES.NEEDS_MORE;
  if (requiresReviewer && !reviewer) {
    errors.push('reviewer: terminal reviews require a reviewer identifier');
  }

  const cap = Number(options.maxNoteLength);
  if (Number.isInteger(cap) && cap > 0 && note && note.length > cap) {
    errors.push(`note: exceeds ${cap} characters after cleaning`);
  }

  return errors;
}

/**
 * Compute the next review record from the current review state and the
 * proposed action. Returns the new review object (status, notes, reviewer,
 * reviewedAt, priorStatus) or an { errors: [...] } object when validation
 * fails. Pure: does not mutate the input.
 */
function applyReview(currentReview, proposed, options = {}) {
  const previous = normalizeReview(currentReview);
  const errors = validateReviewInput(proposed, { ...options, current: previous });
  if (errors.length) {
    return Object.freeze({ errors: Object.freeze(errors.slice()) });
  }

  const nextStatus = cleanNote(proposed.status).toLowerCase();
  const note = cleanNote(proposed.notes ?? proposed.note);
  const reviewer = cleanReviewer(proposed.reviewer);
  const now = isoOrNull(options.now) || new Date().toISOString();

  const statusChanged = previous.status !== nextStatus;
  return Object.freeze({
    status: nextStatus,
    notes: note,
    reviewer,
    reviewedAt: statusChanged ? now : previous.reviewedAt,
    // When the status changes, the new prior is the previous current status.
    // When it doesn't change, the prior is preserved across the re-confirmation.
    priorStatus: statusChanged ? previous.status : previous.priorStatus,
    revision: previous.revision + (statusChanged ? 1 : 0),
  });
}

function isoOrNull(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
  }
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value.toISOString() : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value).toISOString();
  }
  return null;
}

/**
 * Normalize an existing review record (from storage, possibly malformed)
 * into a known-shape object. Unknown status is treated as 'pending'.
 */
function normalizeReview(review) {
  if (review === null || review === undefined) {
    return Object.freeze({ status: REVIEW_STATES.PENDING, notes: null, reviewer: null, reviewedAt: null, revision: 0, priorStatus: null });
  }
  if (typeof review !== 'object' || Array.isArray(review)) {
    return Object.freeze({ status: REVIEW_STATES.PENDING, notes: null, reviewer: null, reviewedAt: null, revision: 0, priorStatus: null });
  }
  const status = REVIEW_STATES_SET.has(review.status) ? review.status : REVIEW_STATES.PENDING;
  return Object.freeze({
    status,
    notes: cleanNote(review.notes ?? review.note),
    reviewer: cleanReviewer(review.reviewer),
    reviewedAt: isoOrNull(review.reviewedAt),
    revision: Number.isInteger(review.revision) && review.revision >= 0 ? review.revision : 0,
    priorStatus: REVIEW_STATES_SET.has(review.priorStatus) ? review.priorStatus : null,
  });
}

/**
 * Initial review state for a freshly extracted document. No reviewer, no
 * notes, no reviewedAt; the revision counter starts at 0.
 */
function createPendingReview(options = {}) {
  const extractedAt = isoOrNull(options.extractedAt) || new Date().toISOString();
  return Object.freeze({
    status: REVIEW_STATES.PENDING,
    notes: null,
    reviewer: null,
    reviewedAt: null,
    revision: 0,
    priorStatus: null,
    extractedAt,
  });
}

/**
 * Filter a list of review records to those matching the requested status.
 * If `status` is null or undefined, returns the input unchanged.
 * Unknown statuses produce an empty array (the input never matches).
 */
function filterByStatus(reviews, status) {
  if (!Array.isArray(reviews)) return [];
  if (status === null || status === undefined) return reviews.slice();
  const target = cleanNote(status)?.toLowerCase();
  if (!target || !REVIEW_STATES_SET.has(target)) return [];
  return reviews.filter((review) => normalizeReview(review).status === target);
}

/**
 * Summarize a list of review records into a status count map plus total.
 * Unknown statuses are bucketed under 'pending' (they're functionally
 * un-reviewed).
 */
function summarizeReviews(reviews) {
  const counts = {
    [REVIEW_STATES.PENDING]: 0,
    [REVIEW_STATES.APPROVED]: 0,
    [REVIEW_STATES.REJECTED]: 0,
    [REVIEW_STATES.NEEDS_MORE]: 0,
  };
  if (!Array.isArray(reviews)) {
    return Object.freeze({ total: 0, byStatus: Object.freeze({ ...counts }) });
  }
  for (const review of reviews) {
    const status = normalizeReview(review).status;
    counts[status] += 1;
  }
  return Object.freeze({
    total: reviews.length,
    byStatus: Object.freeze({ ...counts }),
  });
}

module.exports = {
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
};
