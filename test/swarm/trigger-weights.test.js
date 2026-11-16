'use strict';

const assert = require('node:assert/strict');
const { test, describe } = require('node:test');
const { TriggerWeightManager, MIN_WEIGHT, MAX_WEIGHT } = require('../../server/swarm/trigger-weights');

describe('TriggerWeightManager (Tier 3.4 Self-Tuning Weights)', () => {
  test('initializes with default weight 1.0 clamped in [0.1, 1.0]', () => {
    const manager = new TriggerWeightManager();
    const weight = manager.getWeight('test_node');
    assert.equal(weight, 1.0);
    assert.ok(weight >= MIN_WEIGHT && weight <= MAX_WEIGHT);
  });

  test('adapts weight downward on failures and preserves min bounds [0.1, 1.0]', () => {
    const manager = new TriggerWeightManager({ learningRate: 0.5 });
    const node = 'flaky_collector';

    // Initial weight
    assert.equal(manager.getWeight(node), 1.0);

    // Record failures
    manager.recordExecutionOutcome(node, { success: false, latencyMs: 1200 });
    const after1 = manager.getWeight(node);
    assert.ok(after1 < 1.0, 'Weight should drop after failure');

    // Record multiple successive failures
    for (let i = 0; i < 15; i++) {
      manager.recordExecutionOutcome(node, { success: false, latencyMs: 5000 });
    }

    const clampedMin = manager.getWeight(node);
    assert.equal(clampedMin, MIN_WEIGHT, 'Weight must clamp at exactly 0.1 minimum');
    assert.ok(clampedMin >= 0.1);
  });

  test('recovers and tunes upward on successful executions with high yield', () => {
    const manager = new TriggerWeightManager({ learningRate: 0.4 });
    const node = 'recovering_node';

    // Force downward first
    manager.recordExecutionOutcome(node, { success: false });
    manager.recordExecutionOutcome(node, { success: false });
    const lowWeight = manager.getWeight(node);

    // Record successive high-yield successes
    for (let i = 0; i < 10; i++) {
      manager.recordExecutionOutcome(node, {
        success: true,
        latencyMs: 150,
        nonNullYieldRatio: 1.0,
      });
    }

    const recoveredWeight = manager.getWeight(node);
    assert.ok(recoveredWeight > lowWeight, 'Weight should recover after successful high-yield calls');
    assert.ok(recoveredWeight <= MAX_WEIGHT, 'Weight must not exceed 1.0 maximum');
  });

  test('adjusts for latency penalties when response time exceeds 3000ms', () => {
    const manager = new TriggerWeightManager({ learningRate: 0.5 });
    const fastNode = 'fast_endpoint';
    const slowNode = 'slow_endpoint';

    manager.recordExecutionOutcome(fastNode, { success: true, latencyMs: 200, nonNullYieldRatio: 1.0 });
    manager.recordExecutionOutcome(slowNode, { success: true, latencyMs: 8000, nonNullYieldRatio: 1.0 });

    const fastWeight = manager.getWeight(fastNode);
    const slowWeight = manager.getWeight(slowNode);

    assert.ok(fastWeight > slowWeight, 'Fast node should maintain higher weight than slow node with latency penalty');
  });

  test('calibrates baseline confidence by multiplying with node weight', () => {
    const manager = new TriggerWeightManager();
    const node = 'scorer';

    // With 1.0 weight
    assert.equal(manager.getCalibratedConfidence(node, 0.9), 0.9);

    // After failure drops weight
    manager.recordExecutionOutcome(node, { success: false });
    const newWeight = manager.getWeight(node);
    const calibrated = manager.getCalibratedConfidence(node, 0.9);

    assert.equal(calibrated, Math.round(0.9 * newWeight * 10000) / 10000);
    assert.ok(calibrated < 0.9);
  });

  test('exports, resets, and imports weight state preserving lastLatencyMs and avgYieldRatio', () => {
    const manager = new TriggerWeightManager();
    manager.recordExecutionOutcome('cap_a', { success: false, latencyMs: 1450 });
    manager.recordExecutionOutcome('cap_b', { success: true, latencyMs: 220, nonNullYieldRatio: 0.8 });

    const exported = manager.exportWeights();
    assert.ok(exported.cap_a);
    assert.ok(exported.cap_b);
    assert.equal(exported.cap_a.lastLatencyMs, 1450);
    assert.equal(exported.cap_b.lastLatencyMs, 220);
    assert.equal(exported.cap_b.avgYieldRatio, 0.8);

    manager.reset();
    assert.equal(manager.getWeight('cap_a'), 1.0);

    manager.importWeights(exported);
    assert.equal(manager.getWeight('cap_a'), exported.cap_a.weight);
    assert.equal(manager.getStats('cap_a').lastLatencyMs, 1450);
    assert.equal(manager.getStats('cap_b').lastLatencyMs, 220);
    assert.equal(manager.getStats('cap_b').avgYieldRatio, 0.8);
  });

  test('configures defaultTriggerWeightManager on .cache/trigger-weights.json and fails soft on unwritable paths', (t) => {
    const fs = require('node:fs');
    const os = require('node:os');
    const path = require('node:path');
    const { triggerWeightManager } = require('../../server/swarm/trigger-weights');

    assert.match(String(triggerWeightManager.filePath), /trigger-weights\.json$/);
    assert.equal(triggerWeightManager.saveToDisk(path.join(os.tmpdir(), `missing-${Date.now()}`, '\0bad')), false);

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-persist-'));
    t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));
    const filePath = path.join(tmpDir, 'weights.json');

    const writer = new TriggerWeightManager({ filePath, learningRate: 0.4 });
    writer.recordExecutionOutcome('geocode', { success: true, latencyMs: 310, nonNullYieldRatio: 0.75 });

    const reader = new TriggerWeightManager({ filePath });
    assert.equal(reader.getStats('geocode').lastLatencyMs, 310);
    assert.equal(reader.getStats('geocode').avgYieldRatio, 0.75);
  });
});
