'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { huntSafety } = require('../server/sources/collection-coordinator');

test('source failure cannot be promoted to hunt evaluation', () => {
  const result = huntSafety({
    skipped: false, completeCycle: true, totalRejected: 0,
    sourceResults: [{ sourceId: 'servicelink', accepted: 0, rejected: 0, error: 'upstream timeout' }],
  });
  assert.equal(result.safe, false);
  assert.equal(result.reason, 'source_failed');
});

test('rejected records block evaluation while partial clean records remain positive-only safe', () => {
  assert.equal(huntSafety({ skipped: false, completeCycle: true, totalRejected: 1, sourceResults: [{ sourceId: 'servicelink', accepted: 2, rejected: 1 }] }).safe, false);
  const partial=huntSafety({ skipped: false, completeCycle: true, totalRejected: 0, sourceResults: [{ sourceId: 'servicelink', accepted: 2, rejected:0, report: { complete: false } }] });
  assert.equal(partial.safe, true);
  assert.deepEqual(partial.completeSourceIds, []);
});
