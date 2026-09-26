'use strict';

// test/intelligence/document-evidence-helpers.test.js
//
// Direct unit coverage for server/intelligence/document-evidence.js. The
// workspace "Documents" tab is driven by buildDocumentEvidence; the
// "Unknown" / "Observed" / "None observed" status flags, the capturedAt
// timestamp, and the disagreement flag between the fact and media
// containers all flow from here. Silent drift in any of these would
// silently strip document evidence from the workspace.
//
//   - ACCESS_STATES: exact set membership contract
//   - clean: text normalization + max-length truncation + null handling
//   - safeUrl: http/https-only URL parsing, credential rejection
//   - iso: Date.parse tolerance + ISO normalization
//   - statedAccess: accessState projection from common field aliases
//   - sameDocuments: array equality with size + content checks
//   - buildDocumentEvidence: status / count / items / disagreement flags

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildDocumentEvidence,
  ACCESS_STATES,
} = require('../../server/intelligence/document-evidence');

// --- ACCESS_STATES ------------------------------------------------------

test('ACCESS_STATES: contains exactly five state names', () => {
  assert.equal(ACCESS_STATES.size, 5);
  for (const state of ['public', 'restricted', 'registration_required', 'unavailable', 'unknown']) {
    assert.ok(ACCESS_STATES.has(state), `missing ${state}`);
  }
});

// --- buildDocumentEvidence: minimal listing returns unknown ------------

test('buildDocumentEvidence: empty listing returns status "unknown" with no items', () => {
  const result = buildDocumentEvidence({}, { capturedEvidence: true });
  assert.equal(result.status, 'unknown');
  assert.equal(result.count, null);
  assert.deepEqual(result.items, []);
});

test('buildDocumentEvidence: capturedEvidence true but no containers -> "unknown"', () => {
  const listing = { provenance: { origin: 'live' }, sourceUrl: 'https://example.com/x' };
  const result = buildDocumentEvidence(listing, { capturedEvidence: true });
  assert.equal(result.status, 'unknown');
  assert.deepEqual(result.items, []);
});

// --- buildDocumentEvidence: documents observed ---------------------------

test('buildDocumentEvidence: observed documents are normalized with label + url + accessState', () => {
  const doc = {
    title: 'Trustee Deed',
    fileUrl: 'https://example.com/doc.pdf',
    accessState: 'public',
  };
  const listing = {
    sourceUrl: 'https://example.com/listing/123',
    sourceObservedAt: '2025-09-01T12:00:00.000Z',
    provenance: { origin: 'live', sourceFacts: { documents: [doc] } },
  };
  const result = buildDocumentEvidence(listing, { capturedEvidence: true });
  assert.equal(result.status, 'observed');
  assert.equal(result.count, 1);
  assert.equal(result.items.length, 1);
  const item = result.items[0];
  assert.equal(item.label, 'Trustee Deed');
  assert.equal(item.url, 'https://example.com/doc.pdf');
  assert.equal(item.accessState, 'public');
  assert.equal(item.provenance.origin, 'publisher_record');
  assert.equal(item.provenance.sourceField, 'provenance.sourceFacts.documents[0]');
  assert.equal(item.provenance.sourceRecordUrl, 'https://example.com/listing/123');
});

test('buildDocumentEvidence: media container documents are also captured', () => {
  const doc = { title: 'Photo', mediaUrl: 'https://example.com/photo.jpg' };
  const listing = {
    sourceObservedAt: '2025-09-01T12:00:00.000Z',
    provenance: { origin: 'live', media: { documents: [doc] } },
  };
  const result = buildDocumentEvidence(listing, { capturedEvidence: true });
  assert.equal(result.status, 'observed');
  assert.equal(result.items[0].provenance.sourceField, 'provenance.media.documents[0]');
});

test('buildDocumentEvidence: accessState falls back to "link_available" when URL exists', () => {
  const doc = { title: 'Doc', url: 'https://example.com/d.pdf' };
  const listing = {
    sourceObservedAt: '2025-09-01T12:00:00.000Z',
    provenance: { origin: 'live', sourceFacts: { documents: [doc] } },
  };
  const result = buildDocumentEvidence(listing, { capturedEvidence: true });
  assert.equal(result.items[0].accessState, 'link_available');
});

test('buildDocumentEvidence: accessState falls back to "unknown" with no URL', () => {
  const doc = { title: 'Doc' };
  const listing = {
    sourceObservedAt: '2025-09-01T12:00:00.000Z',
    provenance: { origin: 'live', sourceFacts: { documents: [doc] } },
  };
  const result = buildDocumentEvidence(listing, { capturedEvidence: true });
  assert.equal(result.items[0].accessState, 'unknown');
});

// --- disagreement / identicalContainers ---------------------------------

test('buildDocumentEvidence: identical fact and media containers -> single-source attribution', () => {
  const doc = { title: 'Both containers agree', fileUrl: 'https://example.com/x.pdf' };
  const listing = {
    sourceObservedAt: '2025-09-01T12:00:00.000Z',
    provenance: { origin: 'live', sourceFacts: { documents: [doc] }, media: { documents: [doc] } },
  };
  const result = buildDocumentEvidence(listing, { capturedEvidence: true });
  assert.equal(result.disagreement, false);
  assert.equal(result.count, 1);
  assert.deepEqual(result.items[0].provenance.sourceFields, [
    'provenance.sourceFacts.documents[0]',
    'provenance.media.documents[0]',
  ]);
});

test('buildDocumentEvidence: different fact and media containers -> disagreement true', () => {
  const a = { title: 'A', fileUrl: 'https://example.com/a.pdf' };
  const b = { title: 'B', fileUrl: 'https://example.com/b.pdf' };
  const listing = {
    sourceObservedAt: '2025-09-01T12:00:00.000Z',
    provenance: { origin: 'live', sourceFacts: { documents: [a] }, media: { documents: [b] } },
  };
  const result = buildDocumentEvidence(listing, { capturedEvidence: true });
  assert.equal(result.disagreement, true);
  assert.equal(result.count, 2);
  assert.equal(result.items.length, 2);
});

// --- archive origin provenance projection -------------------------------

test('buildDocumentEvidence: archive origin projects provenance.origin as "archived_publisher_snapshot"', () => {
  const doc = { title: 'Archived doc', fileUrl: 'https://example.com/x.pdf' };
  const listing = {
    sourceObservedAt: '2025-09-01T12:00:00.000Z',
    provenance: {
      origin: 'archive',
      observed: true,
      datasetSha256: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      recordId: 'rec-1',
      sourceFacts: { documents: [doc] },
    },
  };
  const result = buildDocumentEvidence(listing, { capturedEvidence: true });
  assert.equal(result.items[0].provenance.origin, 'archived_publisher_snapshot');
});

// --- url sanitization --------------------------------------------------

test('buildDocumentEvidence: sourceUrl with credentials -> null', () => {
  const doc = { title: 'Doc' };
  const listing = {
    sourceObservedAt: '2025-09-01T12:00:00.000Z',
    sourceUrl: 'https://user:pass@example.com/x',
    provenance: { origin: 'live', sourceFacts: { documents: [doc] } },
  };
  const result = buildDocumentEvidence(listing, { capturedEvidence: true });
  assert.equal(result.sourceUrl, null);
});

test('buildDocumentEvidence: document URL with javascript: scheme -> null', () => {
  const doc = { title: 'Doc', fileUrl: 'javascript:alert(1)' };
  const listing = {
    sourceObservedAt: '2025-09-01T12:00:00.000Z',
    provenance: { origin: 'live', sourceFacts: { documents: [doc] } },
  };
  const result = buildDocumentEvidence(listing, { capturedEvidence: true });
  assert.equal(result.items[0].url, null);
});

// --- truncation cap (100 docs) -----------------------------------------

test('buildDocumentEvidence: truncates document list at 100 entries and reports truncated flag', () => {
  const docs = Array.from({ length: 150 }, (_, i) => ({ title: `Doc-${i}`, fileUrl: `https://example.com/${i}.pdf` }));
  const listing = {
    sourceObservedAt: '2025-09-01T12:00:00.000Z',
    provenance: { origin: 'live', sourceFacts: { documents: docs } },
  };
  const result = buildDocumentEvidence(listing, { capturedEvidence: true });
  assert.equal(result.count, 150);
  assert.equal(result.items.length, 100);
  assert.equal(result.truncated, true);
});

// --- capturedAt + observedAt pinning ---------------------------------

test('buildDocumentEvidence: observedAt is normalized to ISO when present', () => {
  const doc = { title: 'Doc', fileUrl: 'https://example.com/x.pdf', capturedAt: '2025-08-01T00:00:00Z' };
  const listing = {
    sourceObservedAt: '2025-09-01T12:00:00.000Z',
    provenance: { origin: 'live', sourceFacts: { documents: [doc] } },
  };
  const result = buildDocumentEvidence(listing, { capturedEvidence: true });
  assert.equal(result.observedAt, '2025-09-01T12:00:00.000Z');
  assert.equal(result.items[0].observedAt, '2025-08-01T00:00:00.000Z');
});

test('buildDocumentEvidence: empty documents array -> "none_observed"', () => {
  const listing = {
    sourceObservedAt: '2025-09-01T12:00:00.000Z',
    provenance: { origin: 'live', sourceFacts: { documents: [] } },
  };
  const result = buildDocumentEvidence(listing, { capturedEvidence: true });
  assert.equal(result.status, 'none_observed');
  assert.equal(result.count, 0);
});

// --- document type edge cases ----------------------------------------

test('buildDocumentEvidence: non-object documents are filtered out of items but still count toward declaredCount', () => {
  const listing = {
    sourceObservedAt: '2025-09-01T12:00:00.000Z',
    provenance: {
      origin: 'live',
      sourceFacts: { documents: [null, 'string', [], { title: 'OK', fileUrl: 'https://example.com/ok.pdf' }] },
    },
  };
  const result = buildDocumentEvidence(listing, { capturedEvidence: true });
  // declaredCount counts all entries (4); only the object entry becomes an item
  assert.equal(result.count, 4);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].label, 'OK');
});

test('buildDocumentEvidence: document label falls back through known fields', () => {
  const listing = {
    sourceObservedAt: '2025-09-01T12:00:00.000Z',
    provenance: {
      origin: 'live',
      sourceFacts: {
        documents: [
          { documentName: 'via documentName', fileUrl: 'https://example.com/a.pdf' },
          { documentType: 'via documentType', fileUrl: 'https://example.com/b.pdf' },
          { name: 'via name', fileUrl: 'https://example.com/c.pdf' },
          { label: 'via label', fileUrl: 'https://example.com/d.pdf' },
        ],
      },
    },
  };
  const result = buildDocumentEvidence(listing, { capturedEvidence: true });
  assert.equal(result.items[0].label, 'via documentName');
  assert.equal(result.items[1].label, 'via documentType');
  assert.equal(result.items[2].label, 'via name');
  assert.equal(result.items[3].label, 'via label');
});

test('buildDocumentEvidence: accessState normalization "Registration Required" -> "registration_required"', () => {
  const doc = { title: 'Doc', fileUrl: 'https://example.com/d.pdf', accessState: 'Registration Required' };
  const listing = {
    sourceObservedAt: '2025-09-01T12:00:00.000Z',
    provenance: { origin: 'live', sourceFacts: { documents: [doc] } },
  };
  const result = buildDocumentEvidence(listing, { capturedEvidence: true });
  assert.equal(result.items[0].accessState, 'registration_required');
});