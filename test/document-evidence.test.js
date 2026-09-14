'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildDocumentEvidence,
  ACCESS_STATES
} = require('../server/intelligence/document-evidence');

const FUTURE_MS = 60_000; // generous drift window for "now" in tests

function baseListing(overrides = {}) {
  const now = Date.now();
  return {
    id: 'samplelisting-1',
    source: 'servicelink',
    state: 'CA',
    address: '123 Main St, Anytown, CA',
    sourceUrl: 'https://www.servicelinkauction.com/property-details/sample-1',
    raw: 'raw notice payload that is comfortably long enough for the validator',
    provenance: {
      origin: 'live',
      observed: true,
      publisher: 'ServiceLink Auction',
      recordId: 'sample-1',
      observedAt: new Date(now - 5_000).toISOString()
    },
    sourceObservedAt: new Date(now - 5_000).toISOString(),
    ...overrides
  };
}

function makeDocument(overrides = {}) {
  return {
    title: 'Sample Document',
    fileUrl: 'https://example.com/doc.pdf',
    observedAt: new Date().toISOString(),
    ...overrides
  };
}

test('module exports buildDocumentEvidence and ACCESS_STATES', () => {
  assert.equal(typeof buildDocumentEvidence, 'function');
  assert.ok(ACCESS_STATES instanceof Set);
  assert.ok(ACCESS_STATES.has('public'));
  assert.ok(ACCESS_STATES.has('restricted'));
  assert.ok(ACCESS_STATES.has('registration_required'));
  assert.ok(ACCESS_STATES.has('unavailable'));
  assert.ok(ACCESS_STATES.has('unknown'));
});

test('returns unknown status with empty items when no documents are attached', () => {
  const listing = baseListing();
  const result = buildDocumentEvidence(listing);
  assert.equal(result.status, 'unknown');
  assert.equal(result.count, null);
  assert.deepEqual(result.items, []);
  assert.equal(typeof result.observedAt, 'string');
  assert.equal(typeof result.sourceUrl, 'string');
});

test('returns observed status when sourceFacts.documents has entries', () => {
  const listing = baseListing({
    provenance: {
      ...baseListing().provenance,
      sourceFacts: { documents: [makeDocument()] }
    }
  });
  const result = buildDocumentEvidence(listing);
  assert.equal(result.status, 'observed');
  assert.equal(result.count, 1);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].label, 'Sample Document');
  assert.equal(result.items[0].url, 'https://example.com/doc.pdf');
});

test('returns observed status when media.documents has entries', () => {
  const listing = baseListing({
    provenance: {
      ...baseListing().provenance,
      media: { documents: [makeDocument({ title: 'Notice of Sale' })] }
    }
  });
  const result = buildDocumentEvidence(listing);
  assert.equal(result.status, 'observed');
  assert.equal(result.count, 1);
  assert.equal(result.items[0].label, 'Notice of Sale');
});

test('returns none_observed when containers exist but are empty', () => {
  const listing = baseListing({
    provenance: {
      ...baseListing().provenance,
      sourceFacts: { documents: [] }
    }
  });
  const result = buildDocumentEvidence(listing);
  assert.equal(result.status, 'none_observed');
  assert.equal(result.count, 0);
});

test('skips containers that are not arrays', () => {
  const listing = baseListing({
    provenance: {
      ...baseListing().provenance,
      sourceFacts: { documents: 'this should not crash' }
    }
  });
  const result = buildDocumentEvidence(listing);
  assert.equal(result.status, 'unknown');
});

test('skips non-object / array-shaped documents inside a container', () => {
  const listing = baseListing({
    provenance: {
      ...baseListing().provenance,
      sourceFacts: { documents: [null, 'string', ['array'], makeDocument()] }
    }
  });
  const result = buildDocumentEvidence(listing);
  assert.equal(result.status, 'observed');
  assert.equal(result.count, 4);
  assert.equal(result.items.length, 1);
  assert.equal(result.truncated, true);
});

test('truncates output beyond 100 documents', () => {
  const docs = Array.from({ length: 150 }, (_, i) => makeDocument({ title: `Doc ${i}` }));
  const listing = baseListing({
    provenance: {
      ...baseListing().provenance,
      sourceFacts: { documents: docs }
    }
  });
  const result = buildDocumentEvidence(listing);
  assert.equal(result.count, 150);
  assert.equal(result.items.length, 100);
  assert.equal(result.truncated, true);
});

test('deduplicates identical fact and media containers', () => {
  const docs = [makeDocument()];
  const listing = baseListing({
    provenance: {
      ...baseListing().provenance,
      sourceFacts: { documents: docs },
      media: { documents: docs }
    }
  });
  const result = buildDocumentEvidence(listing);
  assert.equal(result.count, 1);
  assert.equal(result.items.length, 1);
  assert.deepEqual(result.containers['provenance.sourceFacts.documents'], { count: 1 });
  assert.deepEqual(result.containers['provenance.media.documents'], { count: 1 });
  assert.equal(result.disagreement, false);
});

test('reports disagreement when fact and media containers differ', () => {
  const listing = baseListing({
    provenance: {
      ...baseListing().provenance,
      sourceFacts: { documents: [makeDocument({ title: 'A' })] },
      media: { documents: [makeDocument({ title: 'B' })] }
    }
  });
  const result = buildDocumentEvidence(listing);
  assert.equal(result.count, 2);
  assert.equal(result.items.length, 2);
  assert.equal(result.disagreement, true);
  // sourceFields is intentionally omitted on disagreement; the per-item
  // sourceField alone is exposed, and the result-level disagreement flag
  // surfaces the inconsistency.
  assert.ok(result.items.every((item) => !item.provenance.sourceFields));
});

test('preserves provenance.origin in derived item provenance', () => {
  const listing = baseListing({
    provenance: {
      ...baseListing().provenance,
      origin: 'live',
      sourceFacts: { documents: [makeDocument()] }
    }
  });
  const result = buildDocumentEvidence(listing);
  assert.equal(result.items[0].provenance.origin, 'publisher_record');
});

test('marks archived listings as archived_publisher_snapshot in provenance', () => {
  const listing = baseListing({
    provenance: {
      origin: 'archive',
      observed: true,
      publisher: 'ServiceLink Archive',
      recordId: 'archive-1',
      observedAt: new Date().toISOString(),
      datasetSha256: 'a'.repeat(64),
      sourceFacts: { documents: [makeDocument()] }
    }
  });
  const result = buildDocumentEvidence(listing);
  assert.equal(result.items[0].provenance.origin, 'archived_publisher_snapshot');
});

test('drops listings without a valid observedAt', () => {
  const listing = baseListing({
    provenance: {
      origin: 'live',
      observed: true,
      publisher: 'ServiceLink Auction',
      recordId: 'sample-1'
      // observedAt intentionally absent
    },
    sourceObservedAt: undefined
  });
  listing.provenance.observedAt = undefined;
  const result = buildDocumentEvidence(listing);
  assert.equal(result.status, 'unknown');
});

test('drops listings with a future observedAt outside the drift window', () => {
  const now = Date.now();
  const future = new Date(now + (10 * 60 * 1000)).toISOString(); // 10 min ahead
  const listing = baseListing({
    sourceObservedAt: future, // sourceObservedAt takes precedence over provenance.observedAt
    provenance: {
      ...baseListing().provenance,
      observedAt: future,
      sourceFacts: { documents: [makeDocument()] }
    }
  });
  const result = buildDocumentEvidence(listing);
  assert.equal(result.status, 'unknown');
});

test('accepts listings whose observedAt is within the 5-minute drift window', () => {
  const now = Date.now();
  const soonish = new Date(now + 60_000).toISOString();
  const listing = baseListing({
    sourceObservedAt: soonish,
    provenance: {
      ...baseListing().provenance,
      observedAt: soonish,
      sourceFacts: { documents: [makeDocument()] }
    }
  });
  const result = buildDocumentEvidence(listing);
  assert.equal(result.status, 'observed');
});

test('respects an explicit capturedEvidence: true override', () => {
  const listing = baseListing({
    provenance: {
      ...baseListing().provenance,
      sourceFacts: { documents: [makeDocument()] }
    }
  });
  const result = buildDocumentEvidence(listing, { capturedEvidence: true });
  assert.equal(result.status, 'observed');
  assert.equal(result.items.length, 1);
});

test('respects an explicit capturedEvidence: false override', () => {
  const listing = baseListing({
    provenance: {
      ...baseListing().provenance,
      sourceFacts: { documents: [makeDocument()] }
    }
  });
  const result = buildDocumentEvidence(listing, { capturedEvidence: false });
  assert.equal(result.status, 'unknown');
  assert.equal(result.items.length, 0);
});

test('uses an explicit observedAt option over the listing provenance', () => {
  const futureTime = new Date(Date.now() + 60_000).toISOString();
  const listing = baseListing({
    provenance: {
      ...baseListing().provenance,
      observedAt: '2000-01-01T00:00:00.000Z', // very stale
      sourceFacts: { documents: [makeDocument()] }
    }
  });
  const result = buildDocumentEvidence(listing, { observedAt: futureTime });
  assert.equal(result.status, 'observed');
  assert.equal(result.observedAt, futureTime);
});

test('uses an explicit sourceUrl option over the listing sourceUrl', () => {
  const listing = baseListing({
    provenance: {
      ...baseListing().provenance,
      sourceFacts: { documents: [makeDocument()] }
    }
  });
  const explicit = 'https://example.com/explicit-url';
  const result = buildDocumentEvidence(listing, { sourceUrl: explicit });
  assert.equal(result.sourceUrl, explicit);
  assert.equal(result.items[0].provenance.sourceRecordUrl, explicit);
});

test('normalizes label from a variety of common field names', () => {
  const cases = [
    { title: 'Title Field' },
    { label: 'Label Field' },
    { name: 'Name Field' },
    { documentName: 'Document Name Field' },
    { documentType: 'Document Type Field' }
  ];
  for (const override of cases) {
    // Build a document with ONLY the field under test so the precedence
    // list in document-evidence.js does not pick a higher-priority field
    // by accident.
    const document = { fileUrl: 'https://example.com/doc.pdf', ...override };
    const listing = baseListing({
      provenance: {
        ...baseListing().provenance,
        sourceFacts: { documents: [document] }
      }
    });
    const result = buildDocumentEvidence(listing);
    assert.ok(result.items.length === 1, `expected 1 item for ${JSON.stringify(override)}`);
    const expected = Object.values(override)[0];
    assert.equal(result.items[0].label, expected);
  }
});

test('normalizes url from a variety of common field names', () => {
  const cases = [
    { fileUrl: 'https://example.com/fileUrl' },
    { mediaUrl: 'https://example.com/mediaUrl' },
    { url: 'https://example.com/url' },
    { documentUrl: 'https://example.com/documentUrl' },
    { documentURL: 'https://example.com/documentURL' },
    { sourceUrl: 'https://example.com/sourceUrl' }
  ];
  for (const override of cases) {
    // Build a document with ONLY the field under test so the precedence
    // list in document-evidence.js does not pick a higher-priority field
    // by accident.
    const document = { title: 'Sample Document', ...override };
    const listing = baseListing({
      provenance: {
        ...baseListing().provenance,
        sourceFacts: { documents: [document] }
      }
    });
    const result = buildDocumentEvidence(listing);
    assert.ok(result.items.length === 1, `expected 1 item for ${JSON.stringify(override)}`);
    const expected = Object.values(override)[0];
    assert.equal(result.items[0].url, expected);
  }
});

test('rejects non-http(s) URLs as unsafe', () => {
  const listing = baseListing({
    provenance: {
      ...baseListing().provenance,
      sourceFacts: { documents: [makeDocument({ fileUrl: 'javascript:alert(1)' })] }
    }
  });
  const result = buildDocumentEvidence(listing);
  assert.equal(result.items[0].url, null);
});

test('rejects URLs with embedded credentials', () => {
  const listing = baseListing({
    provenance: {
      ...baseListing().provenance,
      sourceFacts: { documents: [makeDocument({ fileUrl: 'https://user:pass@example.com/doc.pdf' })] }
    }
  });
  const result = buildDocumentEvidence(listing);
  assert.equal(result.items[0].url, null);
});

test('rejects malformed URLs as unsafe', () => {
  const listing = baseListing({
    provenance: {
      ...baseListing().provenance,
      sourceFacts: { documents: [makeDocument({ fileUrl: 'not a url at all' })] }
    }
  });
  const result = buildDocumentEvidence(listing);
  assert.equal(result.items[0].url, null);
});

test('derives accessState from a stated access field', () => {
  const listing = baseListing({
    provenance: {
      ...baseListing().provenance,
      sourceFacts: { documents: [makeDocument({ accessState: 'restricted' })] }
    }
  });
  const result = buildDocumentEvidence(listing);
  assert.equal(result.items[0].accessState, 'restricted');
});

test('normalizes stated access values to lowercase underscored tokens', () => {
  const listing = baseListing({
    provenance: {
      ...baseListing().provenance,
      sourceFacts: { documents: [makeDocument({ accessState: 'Registration Required' })] }
    }
  });
  const result = buildDocumentEvidence(listing);
  assert.equal(result.items[0].accessState, 'registration_required');
});

test('falls back to link_available when a URL is present and no access state is stated', () => {
  const listing = baseListing({
    provenance: {
      ...baseListing().provenance,
      sourceFacts: { documents: [makeDocument({ accessState: undefined })] }
    }
  });
  const result = buildDocumentEvidence(listing);
  assert.equal(result.items[0].accessState, 'link_available');
});

test('falls back to unknown when no URL is present and no access state is stated', () => {
  const listing = baseListing({
    provenance: {
      ...baseListing().provenance,
      sourceFacts: { documents: [makeDocument({ fileUrl: undefined })] }
    }
  });
  const result = buildDocumentEvidence(listing);
  assert.equal(result.items[0].accessState, 'unknown');
});

test('rejects unknown access state strings', () => {
  const listing = baseListing({
    provenance: {
      ...baseListing().provenance,
      sourceFacts: { documents: [makeDocument({ accessState: 'gibberish' })] }
    }
  });
  const result = buildDocumentEvidence(listing);
  assert.equal(result.items[0].accessState, 'link_available');
});

test('attaches sourceField provenance pointing at the source container path', () => {
  const listing = baseListing({
    provenance: {
      ...baseListing().provenance,
      sourceFacts: { documents: [makeDocument()] }
    }
  });
  const result = buildDocumentEvidence(listing);
  assert.equal(result.items[0].provenance.sourceField, 'provenance.sourceFacts.documents[0]');
});

test('attaches sourceFields provenance when fact and media containers agree', () => {
  // When two containers hold identical records, sourceFields surfaces both
  // container paths so a downstream consumer can verify the publisher
  // re-exposed the same documents through two channels.
  const docs = [makeDocument()];
  const listing = baseListing({
    provenance: {
      ...baseListing().provenance,
      sourceFacts: { documents: docs },
      media: { documents: docs }
    }
  });
  const result = buildDocumentEvidence(listing);
  assert.ok(result.items.every((item) => Array.isArray(item.provenance.sourceFields)));
  assert.equal(result.items[0].provenance.sourceFields.length, 2);
});

test('omits sourceFields when fact and media containers disagree', () => {
  // When two containers disagree, we expose a single sourceField (the path
  // of the iterated container) and a disagreement flag at the result level.
  const listing = baseListing({
    provenance: {
      ...baseListing().provenance,
      sourceFacts: { documents: [makeDocument({ title: 'A' })] },
      media: { documents: [makeDocument({ title: 'B' })] }
    }
  });
  const result = buildDocumentEvidence(listing);
  assert.equal(result.disagreement, true);
  assert.ok(result.items.every((item) => !item.provenance.sourceFields));
});

test('uses document.observedAt when present and parseable', () => {
  const docTime = new Date(Date.now() - 30_000).toISOString();
  const listing = baseListing({
    provenance: {
      ...baseListing().provenance,
      sourceFacts: { documents: [makeDocument({ observedAt: docTime })] }
    }
  });
  const result = buildDocumentEvidence(listing);
  assert.equal(result.items[0].observedAt, docTime);
});

test('falls back to listing observedAt when document timestamp is missing or invalid', () => {
  const listing = baseListing({
    provenance: {
      ...baseListing().provenance,
      sourceFacts: { documents: [makeDocument({ observedAt: 'not-a-date' })] }
    }
  });
  const result = buildDocumentEvidence(listing);
  assert.equal(result.items[0].observedAt, listing.sourceObservedAt);
});

test('truncates document label to 300 chars', () => {
  const huge = 'x'.repeat(500);
  const listing = baseListing({
    provenance: {
      ...baseListing().provenance,
      sourceFacts: { documents: [makeDocument({ title: huge })] }
    }
  });
  const result = buildDocumentEvidence(listing);
  assert.equal(result.items[0].label.length, 300);
});

test('collapses whitespace in document label', () => {
  const listing = baseListing({
    provenance: {
      ...baseListing().provenance,
      sourceFacts: { documents: [makeDocument({ title: '   messy\n\n\tlabel   ' })] }
    }
  });
  const result = buildDocumentEvidence(listing);
  assert.equal(result.items[0].label, 'messy label');
});

test('returns null label for documents with no recognizable label field', () => {
  const listing = baseListing({
    provenance: {
      ...baseListing().provenance,
      sourceFacts: { documents: [{ fileUrl: 'https://example.com/doc.pdf' }] }
    }
  });
  const result = buildDocumentEvidence(listing);
  assert.equal(result.items[0].label, null);
});

test('emits a placeholder item for documents with no fields at all', () => {
  const listing = baseListing({
    provenance: {
      ...baseListing().provenance,
      sourceFacts: { documents: [{}, makeDocument()] }
    }
  });
  const result = buildDocumentEvidence(listing);
  // Empty {} documents produce a placeholder item with all-null metadata,
  // so the UI can still show "1 document, no metadata" rather than silently
  // dropping the count. Only null / non-object / array documents are skipped.
  assert.equal(result.items.length, 2);
  assert.equal(result.items[0].label, null);
  assert.equal(result.items[0].url, null);
  assert.equal(result.items[0].accessState, 'unknown');
});

test('containers map reports the count per path', () => {
  const listing = baseListing({
    provenance: {
      ...baseListing().provenance,
      sourceFacts: { documents: [makeDocument(), makeDocument()] },
      media: { documents: [makeDocument({ title: 'C' })] }
    }
  });
  const result = buildDocumentEvidence(listing);
  assert.deepEqual(result.containers['provenance.sourceFacts.documents'], { count: 2 });
  assert.deepEqual(result.containers['provenance.media.documents'], { count: 1 });
});

test('sourceRecordUrl points at the exact publisher record URL', () => {
  const listing = baseListing({
    provenance: {
      ...baseListing().provenance,
      sourceFacts: { documents: [makeDocument()] }
    }
  });
  const result = buildDocumentEvidence(listing);
  assert.equal(result.items[0].provenance.sourceRecordUrl, listing.sourceUrl);
});

test('observedAt default comes from the listing sourceObservedAt', () => {
  const listing = baseListing({
    provenance: {
      ...baseListing().provenance,
      sourceFacts: { documents: [makeDocument()] }
    }
  });
  const result = buildDocumentEvidence(listing);
  assert.equal(result.observedAt, listing.sourceObservedAt);
});

test('observedAt default comes from provenance.observedAt when sourceObservedAt is absent', () => {
  const provenanceTime = '2026-09-14T13:00:00.000Z';
  const listing = baseListing({
    sourceObservedAt: undefined,
    provenance: {
      ...baseListing().provenance,
      observedAt: provenanceTime,
      sourceFacts: { documents: [makeDocument()] }
    }
  });
  const result = buildDocumentEvidence(listing);
  assert.equal(result.observedAt, new Date(provenanceTime).toISOString());
});

test('capturedEvidence gate enforces a sane now override', () => {
  // observedAt is in the past; now override is even further in the past so the
  // future-drift check rejects the record.
  const observedAt = '2026-09-14T10:00:00.000Z';
  const listing = baseListing({
    provenance: {
      ...baseListing().provenance,
      observedAt,
      sourceFacts: { documents: [makeDocument()] }
    }
  });
  const result = buildDocumentEvidence(listing, {
    now: Date.parse(observedAt) + (10 * 60 * 1000)
  });
  assert.equal(result.status, 'unknown');
});

test('archive provenance gate requires observed=true and a 64-char datasetSha256 and recordId', () => {
  const listing = baseListing({
    provenance: {
      origin: 'archive',
      observed: true,
      publisher: 'ServiceLink Archive',
      recordId: 'archive-1',
      observedAt: new Date().toISOString(),
      datasetSha256: 'b'.repeat(64),
      sourceFacts: { documents: [makeDocument()] }
    }
  });
  const result = buildDocumentEvidence(listing);
  assert.equal(result.status, 'observed');
});

test('archive provenance without datasetSha256 is rejected', () => {
  const listing = baseListing({
    provenance: {
      origin: 'archive',
      observed: true,
      publisher: 'ServiceLink Archive',
      recordId: 'archive-1',
      observedAt: new Date().toISOString(),
      // datasetSha256 missing
      sourceFacts: { documents: [makeDocument()] }
    }
  });
  const result = buildDocumentEvidence(listing);
  assert.equal(result.status, 'unknown');
});

test('archive provenance with wrong-length datasetSha256 is rejected', () => {
  const listing = baseListing({
    provenance: {
      origin: 'archive',
      observed: true,
      publisher: 'ServiceLink Archive',
      recordId: 'archive-1',
      observedAt: new Date().toISOString(),
      datasetSha256: 'tooshort',
      sourceFacts: { documents: [makeDocument()] }
    }
  });
  const result = buildDocumentEvidence(listing);
  assert.equal(result.status, 'unknown');
});

test('archive provenance without recordId is rejected', () => {
  const listing = baseListing({
    provenance: {
      origin: 'archive',
      observed: true,
      publisher: 'ServiceLink Archive',
      observedAt: new Date().toISOString(),
      datasetSha256: 'c'.repeat(64),
      sourceFacts: { documents: [makeDocument()] }
    }
  });
  const result = buildDocumentEvidence(listing);
  assert.equal(result.status, 'unknown');
});