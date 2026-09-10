const test = require('node:test');
const assert = require('node:assert/strict');
const { publicationGate } = require('../scripts/build-data');

function listing(overrides = {}) {
  return {
    id: 'CIV-NJ-7-1', source: 'civilview', state: 'NJ', address: '19 West Park Avenue, Park Ridge, NJ 07656',
    sourceUrl: 'https://salesweb.civilview.com/Sales/SaleDetails?PropertyId=1',
    openingBid: 100000, sourceObservedAt: '2026-09-08T12:00:00Z',
    provenance: { origin: 'live', recordKind: 'source_record', observed: true, publisher: 'CivilView', recordId: '1' },
    ...overrides,
  };
}

test('live publication requires minimum count, source coverage, and no fixture/demo/snapshot leak', () => {
  const enough = Array.from({ length: 20 }, (_, i) => listing({ id: `CIV-NJ-7-${i + 1}`, source: i % 3 === 0 ? 'civilview' : i % 3 === 1 ? 'hud' : 'fannie' }));
  const result = publicationGate(enough, { live: true });
  assert.equal(result.passed, true);
  assert.equal(result.sourceCount, 3);
});

test('live publication is rejected when the count is below the minimum', () => {
  const few = [listing(), listing({ id: 'CIV-NJ-7-2' })];
  const result = publicationGate(few, { live: true });
  assert.equal(result.passed, false);
  assert.ok(result.violations.some((v) => v.includes('listing count')));
});

test('live publication is rejected when source coverage is too narrow', () => {
  const oneSource = Array.from({ length: 25 }, (_, i) => listing({ id: `CIV-NJ-7-${i + 1}` }));
  const result = publicationGate(oneSource, { live: true });
  assert.equal(result.passed, false);
  assert.ok(result.violations.some((v) => v.includes('source coverage')));
});

test('live publication is rejected when fixture/demo/snapshot records would be published', () => {
  const mixed = Array.from({ length: 25 }, (_, i) => listing({
    id: `CIV-NJ-7-${i + 1}`,
    source: i % 3 === 0 ? 'civilview' : i % 3 === 1 ? 'hud' : 'fannie',
    provenance: i === 0 ? { origin: 'snapshot', recordKind: 'demo', publisher: 'Embedded data snapshot' } : listing().provenance,
  }));
  const result = publicationGate(mixed, { live: true });
  assert.equal(result.passed, false);
  assert.ok(result.violations.some((v) => v.includes('fixture/demo/snapshot')));
});

test('dev publication has a relaxed count and coverage bar so a snapshot reproduction can land', () => {
  const oneSnapshot = [listing({
    provenance: { origin: 'snapshot', recordKind: 'demo', publisher: 'Embedded data snapshot' },
  })];
  const result = publicationGate(oneSnapshot, { live: false });
  assert.equal(result.passed, true);
  assert.equal(result.sourceCount, 1);
});

test('dev publication is still rejected when nothing was produced (would wipe a working bundle)', () => {
  const result = publicationGate([], { live: false });
  assert.equal(result.passed, false);
  assert.ok(result.violations.length >= 1);
});
