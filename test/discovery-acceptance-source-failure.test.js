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

test('partial or rejected discovery cycles remain unsafe', () => {
  assert.equal(huntSafety({ skipped: false, completeCycle: true, totalRejected: 1, sourceResults: [{ sourceId: 'servicelink', accepted: 2, rejected: 1 }] }).safe, false);
  assert.equal(huntSafety({ skipped: false, completeCycle: true, totalRejected: 0, sourceResults: [{ sourceId: 'servicelink', accepted: 2, report: { complete: false } }] }).safe, false);
});
