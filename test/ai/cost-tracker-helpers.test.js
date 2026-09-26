'use strict';

// test/ai/cost-tracker-helpers.test.js
//
// Direct unit coverage for server/ai/cost_tracker.js. The cost tracker
// gates every AI call against a USD budget; silent drift in the cost
// calculation or budget check would silently let unbounded AI calls
// happen, or block legitimate ones.
//
//   - MODEL_RATES frozen shape: input + output rate per model
//   - CostTracker.calculateCost: pricing formula, fallback to gpt-4o-mini
//   - CostRecord: frozen record with cost coercion
//   - CostTracker: totalCost / totalInputTokens / totalOutputTokens / isOverBudget
//   - .add() returns a new frozen tracker, not mutation

const assert = require('node:assert/strict');
const test = require('node:test');

const { CostRecord, CostTracker, MODEL_RATES } = require('../../server/ai/cost_tracker');

// --- MODEL_RATES structural pins --------------------------------------

test('MODEL_RATES: five published models, each with input + output rates', () => {
  const expected = ['gemini-2.0-flash-lite', 'gemini-2.0-flash', 'gemini-2.5-flash', 'gpt-4o-mini', 'gpt-4o'];
  for (const model of expected) {
    assert.ok(MODEL_RATES[model], `${model} missing`);
    assert.equal(typeof MODEL_RATES[model].input, 'number');
    assert.equal(typeof MODEL_RATES[model].output, 'number');
    assert.ok(MODEL_RATES[model].input > 0);
    assert.ok(MODEL_RATES[model].output > 0);
  }
});

test('MODEL_RATES: output rate is always >= input rate (no publisher inversion)', () => {
  for (const [model, rate] of Object.entries(MODEL_RATES)) {
    assert.ok(rate.output >= rate.input, `${model}: output ${rate.output} < input ${rate.input}`);
  }
});

// --- CostRecord -------------------------------------------------------

test('CostRecord: stores and exposes all fields', () => {
  const ts = new Date('2026-01-15T00:00:00Z');
  const rec = new CostRecord({ model: 'gpt-4o-mini', inputTokens: 1000, outputTokens: 500, costUsd: 0.001, timestamp: ts });
  assert.equal(rec.model, 'gpt-4o-mini');
  assert.equal(rec.inputTokens, 1000);
  assert.equal(rec.outputTokens, 500);
  assert.equal(rec.costUsd, 0.001);
  assert.equal(rec.timestamp, ts);
});

test('CostRecord: costUsd is coerced to Number', () => {
  const rec = new CostRecord({ model: 'gpt-4o-mini', costUsd: '0.123' });
  assert.equal(rec.costUsd, 0.123);
  assert.equal(typeof rec.costUsd, 'number');
});

test('CostRecord: is frozen', () => {
  const rec = new CostRecord({ model: 'gpt-4o-mini' });
  assert.equal(Object.isFrozen(rec), true);
});

// --- CostTracker.calculateCost ---------------------------------------

test('CostTracker.calculateCost: gemini-2.0-flash-lite pricing', () => {
  // 1M input tokens * $0.075/M + 1M output tokens * $0.30/M = $0.375
  const cost = CostTracker.calculateCost('gemini-2.0-flash-lite', 1_000_000, 1_000_000);
  assert.equal(cost, 0.375);
});

test('CostTracker.calculateCost: gpt-4o (the most expensive model)', () => {
  // 1M input * $2.50 + 1M output * $10.00 = $12.50
  const cost = CostTracker.calculateCost('gpt-4o', 1_000_000, 1_000_000);
  assert.equal(cost, 12.50);
});

test('CostTracker.calculateCost: unknown model falls back to gpt-4o-mini rate', () => {
  const unknown = CostTracker.calculateCost('not-a-model', 1_000_000, 0);
  const expected = CostTracker.calculateCost('gpt-4o-mini', 1_000_000, 0);
  assert.equal(unknown, expected);
});

test('CostTracker.calculateCost: zero tokens -> zero cost', () => {
  assert.equal(CostTracker.calculateCost('gpt-4o', 0, 0), 0);
});

test('CostTracker.calculateCost: rounding to 6 decimals', () => {
  // Use enough tokens to produce a sub-cent cost without rounding to 0
  const cost = CostTracker.calculateCost('gpt-4o-mini', 100, 0);
  // 100 / 1M * 0.15 = 1.5e-5 -> rounded to 6 decimals -> 0.000015
  assert.equal(cost, 1.5e-5);
});

test('CostTracker.calculateCost: sub-6-decimal values round to 0 (documented behavior)', () => {
  // toFixed(6) on values smaller than 1e-6 rounds to 0
  const cost = CostTracker.calculateCost('gpt-4o-mini', 1, 0);
  assert.equal(cost, 0);
});

// --- CostTracker aggregates -----------------------------------------

test('CostTracker: totalCost sums all records', () => {
  const r1 = new CostRecord({ model: 'gpt-4o-mini', inputTokens: 1000, outputTokens: 0, costUsd: 0.10 });
  const r2 = new CostRecord({ model: 'gpt-4o-mini', inputTokens: 2000, outputTokens: 0, costUsd: 0.25 });
  const t = new CostTracker({ records: [r1, r2] });
  assert.equal(t.totalCost, 0.35);
});

test('CostTracker: totalInputTokens / totalOutputTokens aggregate', () => {
  const r1 = new CostRecord({ model: 'gpt-4o-mini', inputTokens: 1000, outputTokens: 500, costUsd: 0.01 });
  const r2 = new CostRecord({ model: 'gpt-4o-mini', inputTokens: 2000, outputTokens: 800, costUsd: 0.02 });
  const t = new CostTracker({ records: [r1, r2] });
  assert.equal(t.totalInputTokens, 3000);
  assert.equal(t.totalOutputTokens, 1300);
});

test('CostTracker: isOverBudget triggers when totalCost meets budgetLimitUsd', () => {
  const r = new CostRecord({ model: 'gpt-4o-mini', inputTokens: 0, outputTokens: 0, costUsd: 5.00 });
  const t = new CostTracker({ budgetLimitUsd: 5.00, records: [r] });
  assert.equal(t.isOverBudget, true);
});

test('CostTracker: isOverBudget false when totalCost below budget', () => {
  const r = new CostRecord({ model: 'gpt-4o-mini', inputTokens: 0, outputTokens: 0, costUsd: 4.99 });
  const t = new CostTracker({ budgetLimitUsd: 5.00, records: [r] });
  assert.equal(t.isOverBudget, false);
});

test('CostTracker: empty records -> zero totals, not over budget', () => {
  const t = new CostTracker({ budgetLimitUsd: 5.00, records: [] });
  assert.equal(t.totalCost, 0);
  assert.equal(t.totalInputTokens, 0);
  assert.equal(t.totalOutputTokens, 0);
  assert.equal(t.isOverBudget, false);
});

// --- CostTracker.add ---------------------------------------------------

test('CostTracker.add: returns a new tracker with the record appended', () => {
  const r = new CostRecord({ model: 'gpt-4o-mini', inputTokens: 1000, outputTokens: 0, costUsd: 0.10 });
  const t1 = new CostTracker({ budgetLimitUsd: 5.00 });
  const t2 = t1.add(r);
  assert.equal(t1.records.length, 0);
  assert.equal(t2.records.length, 1);
  assert.equal(t2.totalCost, 0.10);
});

test('CostTracker.add: returned tracker is frozen', () => {
  const r = new CostRecord({ model: 'gpt-4o-mini' });
  const t2 = new CostTracker({ budgetLimitUsd: 5.00 }).add(r);
  assert.equal(Object.isFrozen(t2), true);
  assert.equal(Object.isFrozen(t2.records), true);
});

test('CostTracker constructor: records array is frozen (no mutation)', () => {
  const r = new CostRecord({ model: 'gpt-4o-mini' });
  const records = [r];
  const t = new CostTracker({ records });
  records.push(new CostRecord({ model: 'gpt-4o-mini' }));
  assert.equal(t.records.length, 1);
});