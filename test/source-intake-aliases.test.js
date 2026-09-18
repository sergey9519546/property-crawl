'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { parseCapturedAt, validateSubmission } = require('../server/sources/intake');

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

test('listing adapter keys resolve to cataloged sources without customSource', () => {
  for (const [adapterKey, catalogId] of [
    ['gsa', 'gsa-real-estate-sales'],
    ['hud', 'hud-homestore'],
    ['irs', 'irs-auctions'],
    ['treasury', 'treasury-forfeiture'],
    ['usda', 'usda-resales'],
    ['sheriff', 'ohio-sheriff-sale'],
    ['landbank', 'landbanksearch'],
    ['marshals', 'us-marshals'],
    ['fannie', 'fannie-homepath'],
    ['freddie', 'freddie-homesteps'],
    ['va', 'va-vrm'],
  ]) {
    const result = validateSubmission(textSubmission({ sourceId: adapterKey }));
    assert.equal(result.isValid, true, `${adapterKey}: ${result.errors.join('; ')}`);
    assert.equal(result.value.sourceId, catalogId);
    assert.equal(result.value.source.cataloged, true);
    assert.equal(result.value.source.id, catalogId);
  }
});

test('catalog ids continue to resolve directly', () => {
  const result = validateSubmission(textSubmission({ sourceId: 'gsa-real-estate-sales' }));
  assert.equal(result.isValid, true, result.errors.join('; '));
  assert.equal(result.value.sourceId, 'gsa-real-estate-sales');
  assert.equal(result.value.source.cataloged, true);
});

test('ISO-8601 capture times with offsets, microseconds, and datetime-local values are accepted', () => {
  const now = new Date('2026-09-05T15:39:12.000Z');
  for (const capturedAt of [
    '2026-09-05T15:39:12.000Z',
    '2026-09-05T15:39:12Z',
    '2026-09-05T15:39:12.123456+00:00',
    '2026-09-05T15:39:12+00:00',
    '2026-09-05T15:39:12.123+00:00',
    '2026-09-05T15:39:12',
    '2026-09-05T15:39',
  ]) {
    const result = validateSubmission(textSubmission({ capturedAt }), { now });
    assert.equal(result.isValid, true, `${capturedAt}: ${result.errors.join('; ')}`);
    assert.match(result.value.capturedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  }
  const missing = validateSubmission(textSubmission({ capturedAt: undefined }), { now });
  assert.equal(missing.isValid, true, missing.errors.join('; '));
  assert.equal(missing.value.capturedAt, now.toISOString());
});

test('human-readable capture times remain rejected', () => {
  assert.equal(validateSubmission(textSubmission({ capturedAt: 'January 2, 2026' })).isValid, false);
  assert.equal(Number.isFinite(parseCapturedAt('January 2, 2026')), false);
  assert.equal(Number.isFinite(parseCapturedAt('2026-09-05T15:39:12.123456+00:00')), true);
});

test('unknown sources still require customSource metadata', () => {
  const rejected = validateSubmission(textSubmission({ sourceId: 'example-county' }), { getSource: () => null });
  assert.equal(rejected.isValid, false);
  assert.ok(rejected.errors.some((error) => error.includes('customSource metadata')));
});
