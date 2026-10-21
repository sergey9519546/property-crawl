import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PRIORITY_HIGH_AT,
  PRIORITY_MODERATE_AT,
  priorityBand,
} from '../src/lib/triage-bands.ts';

test('priority bands match the measured live distribution (2026-10-21)', () => {
  // Actionable inventory scored 20 (confirmed sale date only) for 2,017
  // listings and 30 (sale + one observed event) for 58.
  assert.equal(PRIORITY_MODERATE_AT, 30);
  assert.equal(PRIORITY_HIGH_AT, 50);
});

test('priorityBand classifies the whole 0-99 scale without gaps', () => {
  assert.equal(priorityBand(0), 'unscored');
  assert.equal(priorityBand(1), 'routine');
  assert.equal(priorityBand(20), 'routine');  // the dominant live score
  assert.equal(priorityBand(29), 'routine');
  assert.equal(priorityBand(30), 'moderate');  // sale date + one event fact
  assert.equal(priorityBand(49), 'moderate');
  assert.equal(priorityBand(50), 'high');      // three facts, or deep verified discount
  assert.equal(priorityBand(99), 'high');
});

test('priorityBand rejects non-finite and negative inputs as unscored', () => {
  assert.equal(priorityBand(-1), 'unscored');
  assert.equal(priorityBand(NaN), 'unscored');
  assert.equal(priorityBand(Number('')), 'unscored');
});
