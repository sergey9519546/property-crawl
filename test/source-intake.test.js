const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { afterEach, test } = require('node:test');
const {
  getSummary,
  listEvidence,
  reviewEvidence,
  submitEvidence,
  validateSubmission,
} = require('../server/sources/intake');
const { loadStore } = require('../server/sources/store');
const { parseOptions } = require('../scripts/source-intake');
const { collect, parseOptions: parseCollectOptions, supportedSources } = require('../scripts/collect-source');
const { loadObservations } = require('../server/sources/observations');

const temporaryDirectories = [];

function temporaryStore() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'property-source-intake-'));
  temporaryDirectories.push(directory);
  return path.join(directory, 'intake.json');
}

afterEach(() => {
  while (temporaryDirectories.length) {
    const target = temporaryDirectories.pop();
    if (target.startsWith(os.tmpdir())) fs.rmSync(target, { recursive: true, force: true });
  }
});

function textSubmission(overrides = {}) {
  return {
    sourceId: 'civilview',
    sourceUrl: 'https://salesweb.civilview.com/Sales/SaleDetails?PropertyId=2128964683',
    capturedAt: '2026-01-02T03:04:05.000Z',
    kind: 'text',
    body: 'Publisher notice: sale record 2128964683.',
    ...overrides,
  };
}

test('catalog evidence is retained for review and safe summaries omit original content', () => {
  const storePath = temporaryStore();
  const result = submitEvidence(textSubmission(), { storePath, now: new Date('2026-01-03T00:00:00Z') });

  assert.equal(result.deduplicated, false);
  assert.match(result.record.id, /^intake_[a-f0-9]{24}$/);
  assert.equal(result.record.status, 'needs_review');
  assert.equal(result.record.source.cataloged, true);
  assert.equal(result.record.original, undefined);
  assert.equal(result.record.provenance.method, 'manual_evidence_import');

  const stored = loadStore(storePath).records[0];
  assert.equal(stored.original.body, textSubmission().body);
  assert.equal(stored.status, 'needs_review');
  assert.equal(getSummary(stored).original, undefined);
  assert.equal(getSummary(stored, { includeContent: true }).original.body, textSubmission().body);
});

test('stable content identity deduplicates a recaptured copy without overwriting provenance', () => {
  const storePath = temporaryStore();
  const first = submitEvidence(textSubmission(), { storePath, now: new Date('2026-01-03T00:00:00Z') });
  const second = submitEvidence(textSubmission({ capturedAt: '2026-01-04T03:04:05.000Z' }), {
    storePath,
    now: new Date('2026-01-05T00:00:00Z'),
  });

  assert.equal(second.deduplicated, true);
  assert.equal(second.record.id, first.record.id);
  assert.equal(second.record.capturedAt, '2026-01-02T03:04:05.000Z');
  assert.equal(loadStore(storePath).records.length, 1);
});

test('JSON bodies preserve original bytes and parsed candidate records without promoting listings', () => {
  const storePath = temporaryStore();
  const body = '[{"address":"10 Main St","openingBid":25000}]';
  const result = submitEvidence(textSubmission({ kind: 'json', body }), { storePath });
  const [safe] = listEvidence({ sourceId: 'civilview' }, { storePath });
  const [reviewCopy] = listEvidence({ includeContent: true }, { storePath });

  assert.equal(result.record.content.recordCount, 1);
  assert.equal(safe.original, undefined);
  assert.equal(reviewCopy.original.body, body);
  assert.deepEqual(reviewCopy.original.records, [{ address: '10 Main St', openingBid: 25000 }]);
  assert.equal(reviewCopy.status, 'needs_review');
});

test('unknown sources require explicit validated metadata', () => {
  const unknown = textSubmission({ sourceId: 'example-county' });
  const rejected = validateSubmission(unknown, { getSource: () => null });
  assert.equal(rejected.isValid, false);
  assert.ok(rejected.errors.some((error) => error.includes('customSource metadata')));

  const accepted = validateSubmission({
    ...unknown,
    customSource: {
      name: 'Example County Sheriff Sales',
      organization: 'Example County Sheriff',
      description: 'Official publisher',
      homepageUrl: 'https://sheriff.example.gov/sales',
    },
  }, { getSource: () => null });
  assert.equal(accepted.isValid, true, accepted.errors.join('; '));
  assert.equal(accepted.value.source.cataloged, false);
});

test('unsafe URLs, non-ISO timestamps, oversized content, and credential-shaped fields are rejected', () => {
  for (const sourceUrl of [
    'http://example.gov/notice/1',
    'https://localhost/notice/1',
    'https://127.0.0.1/notice/1',
    'https://user:pass@example.gov/notice/1',
    'https://example.gov/notice/1?access_token=secret',
  ]) {
    assert.equal(validateSubmission(textSubmission({ sourceUrl })).isValid, false, sourceUrl);
  }
  assert.equal(validateSubmission(textSubmission({ capturedAt: 'January 2, 2026' })).isValid, false);
  assert.equal(validateSubmission(textSubmission({ body: 'x'.repeat(512 * 1024 + 1) })).isValid, false);
  assert.equal(validateSubmission(textSubmission({ body: 'Authorization: Bearer secret-value' })).isValid, false);
  assert.equal(validateSubmission(textSubmission({ kind: 'json', body: undefined, records: [{ apiKey: 'secret' }] })).isValid, false);
});

test('review records a disposition but leaves the item in the evidence store', () => {
  const storePath = temporaryStore();
  const submitted = submitEvidence(textSubmission(), { storePath });
  const reviewed = reviewEvidence(submitted.record.id, {
    decision: 'approve',
    reviewer: 'source-admin',
    note: 'URL and capture are ready for normalization review.',
  }, { storePath, now: new Date('2026-01-03T12:00:00Z') });

  assert.equal(reviewed.status, 'reviewed');
  assert.equal(reviewed.review.decision, 'approved');
  assert.equal(loadStore(storePath).records.length, 1);
  assert.equal(listEvidence({ status: 'needs_review' }, { storePath }).length, 0);
});

test('CLI parsers keep imports bounded and preserve CivilView collection options', () => {
  assert.deepEqual(parseOptions(['list', '--source', 'civilview', '--limit', '10']), {
    command: 'list', source: 'civilview', limit: '10',
  });
  assert.deepEqual(parseCollectOptions(['--state', 'NJ', '--counties', '2', '--limit', '24', '--new-first']), {
    targetState: 'NJ', maxCounties: 2, maxDetailPages: 24, newFirst: true,
  });
  assert.throws(() => parseOptions(['list', '--limit', '201']), /between 1 and 200/);
});

test('collector support is derived from production scheduler scrapers only', () => {
  const sources = supportedSources();
  assert.deepEqual(sources, [...sources].sort());
  for (const source of ['bid4assets', 'civilview', 'fannie', 'freddie', 'gsa', 'hud', 'irs', 'landbank', 'marshals', 'sheriff', 'treasury', 'usda', 'va']) {
    assert.ok(sources.includes(source), `missing scheduler collector ${source}`);
  }
  assert.equal(sources.includes('fdic'), false);
  assert.equal(sources.includes('trustee'), false);
});

test('collector writes successful and failed source-run observations without admitting unsupported keys', async () => {
  const scheduler = require('../server/scrapers/scheduler');
  const original = scheduler.realScrapers;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'property-source-collect-'));
  temporaryDirectories.push(directory);
  const storePath = path.join(directory, 'live.json');
  const observationPath = path.join(directory, 'observations.json');
  const observedAt = '2025-09-05T10:00:00.000Z';
  const record = {
    id: 'HUD-OH-COLLECT-1', source: 'hud', state: 'OH', county: 'Cuyahoga', city: 'Cleveland', zip: '44101',
    address: '10 Collector Observation Avenue, Cleveland, OH 44101', openingBid: null,
    raw: 'Official HUD HomeStore property record for collector observation test.',
    sourceUrl: 'https://www.hudhomestore.gov/property/propertydetails?caseNumber=123456',
    sourceObservedAt: observedAt,
    provenance: {
      origin: 'live', observed: true, recordKind: 'source_record', publisher: 'HUD HomeStore',
      recordId: '123456', observedAt,
    },
  };
  try {
    scheduler.realScrapers = [{ name: 'HudTestCollector', sourceKey: 'hud', scrapeFeed: async () => [record] }];
    const success = await collect('hud', { storePath, observationPath });
    assert.equal(success.accepted, 1);
    assert.equal(loadObservations({ filePath: observationPath }).runs.hud.acceptedCount, 1);
    assert.deepEqual(supportedSources(), ['hud']);
    await assert.rejects(() => collect('irs', { storePath, observationPath }), /scheduler-backed collector/);

    scheduler.realScrapers = [{ name: 'HudFailingCollector', sourceKey: 'hud', scrapeFeed: async () => { throw new Error('upstream unavailable'); } }];
    await assert.rejects(() => collect('hud', { storePath, observationPath }), /upstream unavailable/);
    assert.equal(loadObservations({ filePath: observationPath }).runs.hud.error, 'upstream unavailable');
  } finally {
    scheduler.realScrapers = original;
  }
});
