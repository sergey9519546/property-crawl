'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  COMPARE_LIMIT,
  normalizeCompareIds,
  toggleCompareId,
  removeCompareId,
  makeCompareTarget,
} = require('../src/lib/compare-selection.js');

test('compare selection keeps the first id as the target and caps at four', () => {
  assert.equal(COMPARE_LIMIT, 4);
  assert.deepEqual(normalizeCompareIds([' a ', 'a', '', 'b', 3, 'c', 'd', 'e']), ['a', 'b', 'c', 'd']);
  assert.deepEqual(toggleCompareId(['a'], 'b'), ['a', 'b']);
  assert.deepEqual(toggleCompareId(['a', 'b', 'c', 'd'], 'e'), ['a', 'b', 'c', 'd']);
  assert.deepEqual(toggleCompareId(['a', 'b'], 'a'), ['b']);
  assert.deepEqual(makeCompareTarget(['a', 'b', 'c'], 'c'), ['c', 'a', 'b']);
  assert.deepEqual(makeCompareTarget(['a', 'b'], 'missing'), ['a', 'b']);
  assert.deepEqual(removeCompareId(['a', 'b'], 'a'), ['b']);
  assert.deepEqual(normalizeCompareIds('nope'), []);
});
