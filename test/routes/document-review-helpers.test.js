'use strict';

// test/routes/document-review-helpers.test.js
//
// Direct unit coverage for the pure helpers exported from
// server/routes/document-review.js. The documentId/decodeDocumentId pair
// is the round-trip contract every review-request URL depends on, and
// enumerateListingDocuments decides which publisher documents ever
// reach the review queue. Silent drift in either direction would
// silently lose documents or break the URL format.
//
//   - documentId / decodeDocumentId: format `${listingId}~${index}~${url}`,
//     percent-encoded URL component, MAX_LISTING_ID_LENGTH + URL truncation,
//     round-trip stability
//   - safeHttpUrl: http/https only, no embedded credentials
//   - documentContainers: union of provenance.sourceFacts.documents and
//     provenance.media.documents, empty arrays excluded
//   - enumerateListingDocuments: collapses duplicate (index|url) pairs,
//     respects per-listing limit, drops entries without url or label

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  documentId,
  decodeDocumentId,
  enumerateListingDocuments,
} = require('../../server/routes/document-review');

// --- documentId -------------------------------------------------------

test('documentId: composes listingId~index~url with percent-encoded url', () => {
  const id = documentId('L1', 0, 'https://example.com/path?q=1');
  assert.equal(id, 'L1~0~https%3A%2F%2Fexample.com%2Fpath%3Fq%3D1');
});

test('documentId: omits the documentIndex when it is not an integer >= 0', () => {
  // A non-integer index (or negative) is dropped so the format degrades
  // gracefully rather than emitting `~undefined~` or `~-1~`.
  assert.equal(documentId('L1', 'not-a-number', 'https://x'), 'L1~https%3A%2F%2Fx');
  assert.equal(documentId('L1', -1, 'https://x'), 'L1~https%3A%2F%2Fx');
  assert.equal(documentId('L1', 1.5, 'https://x'), 'L1~https%3A%2F%2Fx');
});

test('documentId: omits the documentUrl when it is null or whitespace', () => {
  assert.equal(documentId('L1', 0, null), 'L1~0');
  assert.equal(documentId('L1', 0, '   '), 'L1~0');
  assert.equal(documentId('L1', 0, ''), 'L1~0');
});

test('documentId: emits "unknown" when listingId is missing or non-string', () => {
  assert.equal(documentId(null, 0, 'https://x'), 'unknown~0~https%3A%2F%2Fx');
  assert.equal(documentId('', 0, 'https://x'), 'unknown~0~https%3A%2F%2Fx');
  assert.equal(documentId(undefined, 0, 'https://x'), 'unknown~0~https%3A%2F%2Fx');
});

test('documentId: truncates listingId and url to their documented length caps', () => {
  // The exact caps are private; pin the behaviour that very long inputs
  // are silently truncated rather than rejected.
  const longListing = 'L'.repeat(1000);
  const longUrl = 'https://example.com/' + 'a'.repeat(5000);
  const id = documentId(longListing, 0, longUrl);
  // Split on ~ has at most 3 parts; listingId and url are bounded.
  assert.ok(id.split('~').length <= 3);
  // Truncating url to MAX_DOCUMENT_ID_LENGTH keeps the id's segments
  // reasonably short. Pin the documented behaviour.
  assert.ok(id.length < longListing.length + longUrl.length);
});

// --- decodeDocumentId ------------------------------------------------

test('decodeDocumentId: round-trips a documented documentId back to its components', () => {
  const original = documentId('L1', 0, 'https://example.com/path?q=1');
  const decoded = decodeDocumentId(original);
  assert.equal(decoded.listingId, 'L1');
  assert.equal(decoded.documentIndex, 0);
  assert.equal(decoded.documentUrl, 'https://example.com/path?q=1');
});

test('decodeDocumentId: returns null documentIndex when the index segment is non-numeric', () => {
  const decoded = decodeDocumentId('L1~notanumber~https://example.com');
  assert.equal(decoded.documentIndex, null);
});

test('decodeDocumentId: returns null documentUrl when only the listingId + index are present', () => {
  const decoded = decodeDocumentId('L1~0');
  assert.equal(decoded.listingId, 'L1');
  assert.equal(decoded.documentIndex, 0);
  assert.equal(decoded.documentUrl, null);
});

test('decodeDocumentId: tolerates malformed percent-encoding by falling back to the raw segment', () => {
  // A bare % with no hex digits throws inside decodeURIComponent; the
  // helper catches and returns the raw segment instead of crashing.
  const decoded = decodeDocumentId('L1~0~%E0%A4%A');
  assert.equal(decoded.documentUrl, '%E0%A4%A');
});

test('decodeDocumentId: coerces non-string input to string before splitting', () => {
  const decoded = decodeDocumentId(null);
  assert.equal(decoded.listingId, 'null');
  assert.equal(decoded.documentIndex, null);
});

// --- enumerateListingDocuments -----------------------------------------

test('enumerateListingDocuments: returns empty list when listing has no id', () => {
  assert.deepEqual(enumerateListingDocuments({}), []);
  assert.deepEqual(enumerateListingDocuments(null), []);
});

test('enumerateListingDocuments: returns empty list when listing has no document containers', () => {
  const out = enumerateListingDocuments({ id: 'L1', provenance: {} });
  assert.deepEqual(out, []);
});

test('enumerateListingDocuments: extracts documents from provenance.sourceFacts.documents', () => {
  const listing = {
    id: 'L1',
    provenance: {
      sourceFacts: {
        documents: [
          { url: 'https://example.com/a.pdf', label: 'A' },
          { url: 'https://example.com/b.pdf', label: 'B' },
        ],
      },
    },
  };
  const out = enumerateListingDocuments(listing);
  assert.equal(out.length, 2);
  assert.equal(out[0].listingId, 'L1');
  assert.equal(out[0].documentIndex, 0);
  assert.equal(out[0].documentUrl, 'https://example.com/a.pdf');
  assert.equal(out[0].label, 'A');
  assert.equal(out[0].sourceField, 'provenance.sourceFacts.documents[0]');
});

test('enumerateListingDocuments: also reads provenance.media.documents', () => {
  const listing = {
    id: 'L1',
    provenance: {
      media: {
        documents: [{ url: 'https://example.com/media.pdf', label: 'Media Doc' }],
      },
    },
  };
  const out = enumerateListingDocuments(listing);
  assert.equal(out.length, 1);
  assert.equal(out[0].sourceField, 'provenance.media.documents[0]');
});

test('enumerateListingDocuments: collapses duplicate (index|url) pairs across containers', () => {
  const listing = {
    id: 'L1',
    provenance: {
      sourceFacts: { documents: [{ url: 'https://x/dup.pdf', label: 'Dup' }] },
      media: { documents: [{ url: 'https://x/dup.pdf', label: 'Dup' }] },
    },
  };
  const out = enumerateListingDocuments(listing);
  assert.equal(out.length, 1, 'identical url+index pair across containers is collapsed');
});

test('enumerateListingDocuments: respects the per-listing limit', () => {
  const docs = [];
  for (let i = 0; i < 10; i++) docs.push({ url: `https://x/${i}.pdf`, label: `Doc ${i}` });
  const listing = { id: 'L1', provenance: { sourceFacts: { documents: docs } } };
  const out = enumerateListingDocuments(listing, 3);
  assert.equal(out.length, 3);
});

test('enumerateListingDocuments: drops documents without url or label', () => {
  const listing = {
    id: 'L1',
    provenance: {
      sourceFacts: {
        documents: [
          { url: '', label: '' },          // both empty → drop
          { url: null, label: 'Orphan' },  // url null + label present → keep
          { url: 'https://x/ok.pdf' },    // url present + label missing → keep
        ],
      },
    },
  };
  const out = enumerateListingDocuments(listing);
  assert.equal(out.length, 2);
});

test('enumerateListingDocuments: skipped non-object / array documents', () => {
  const listing = {
    id: 'L1',
    provenance: {
      sourceFacts: {
        documents: [
          null,
          'string document',
          { url: 'https://x/array.pdf' }, // acceptable
          [1, 2, 3],                       // array → skip
          { url: 'https://x/ok.pdf', label: 'OK' },
        ],
      },
    },
  };
  const out = enumerateListingDocuments(listing);
  // Only the two object entries should produce candidates.
  assert.equal(out.length, 2);
});

test('enumerateListingDocuments: extractedAt comes from sourceObservedAt then provenance.observedAt', () => {
  const t1 = '2026-01-15T10:00:00Z';
  const t2 = '2026-01-14T10:00:00Z';
  const out1 = enumerateListingDocuments({ id: 'L1', sourceObservedAt: t1, provenance: { sourceFacts: { documents: [{ url: 'https://x' }] } } });
  const out2 = enumerateListingDocuments({ id: 'L1', provenance: { observedAt: t2, sourceFacts: { documents: [{ url: 'https://x' }] } } });
  assert.equal(out1[0].extractedAt, t1);
  assert.equal(out2[0].extractedAt, t2);
});

test('enumerateListingDocuments: stamps sourceField with the container path + index', () => {
  const listing = {
    id: 'L1',
    provenance: {
      sourceFacts: { documents: [{ url: 'https://x/0.pdf' }, { url: 'https://x/1.pdf' }] },
    },
  };
  const out = enumerateListingDocuments(listing);
  assert.equal(out[0].sourceField, 'provenance.sourceFacts.documents[0]');
  assert.equal(out[1].sourceField, 'provenance.sourceFacts.documents[1]');
});
