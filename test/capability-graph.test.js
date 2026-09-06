'use strict';
const assert = require('node:assert/strict');
const { test, describe } = require('node:test');
const { CapabilityGraph, createDefaultGraph } = require('../scripts/capability-graph');

describe('CapabilityGraph (Tier 3.3 DAG Orchestrator)', () => {
  test('default graph has valid capabilities with no broken dependencies', () => {
    const graph = createDefaultGraph();
    const val = graph.validate();
    assert.equal(val.valid, true);
    assert.equal(val.errors.length, 0);
    assert.ok(val.capabilityCount >= 8);
  });

  test('detects missing dependency error during validation', () => {
    const graph = new CapabilityGraph();
    graph.register({
      name: 'node_b',
      depends_on: ['non_existent_node'],
      produces: 'b_out'
    });
    const val = graph.validate();
    assert.equal(val.valid, false);
    assert.ok(val.errors[0].includes('depends on missing capability'));
  });

  test('detects cycle in dependency graph', () => {
    const graph = new CapabilityGraph();
    graph.register({ name: 'node_a', depends_on: ['node_b'], produces: 'a_out' });
    graph.register({ name: 'node_b', depends_on: ['node_c'], produces: 'b_out' });
    graph.register({ name: 'node_c', depends_on: ['node_a'], produces: 'c_out' });

    assert.throws(() => {
      graph.detectCycles();
    }, /Cycle detected in capability graph/);
  });

  test('compiles multi-stage execution plan for property_dossier with parallel stages', () => {
    const graph = createDefaultGraph();
    const plan = graph.buildExecutionPlan('property_dossier');

    assert.equal(plan.target, 'generate_property_dossier');
    assert.equal(plan.produces, 'property_dossier');
    assert.equal(plan.totalStages, 4);
    assert.equal(plan.totalSteps, 6);

    // Stage 1: scrape_auctions
    assert.equal(plan.stages[0].capabilities[0].name, 'scrape_auctions');

    // Stage 2: normalize_listings
    assert.equal(plan.stages[1].capabilities[0].name, 'normalize_listings');

    // Stage 3: parallel execution of compute_deal_score, enrich_public_records, evaluate_opportunity_signals
    assert.equal(plan.stages[2].parallel, true);
    const stage3Names = plan.stages[2].capabilities.map(c => c.name).sort();
    assert.deepEqual(stage3Names, [
      'compute_deal_score',
      'enrich_public_records',
      'evaluate_opportunity_signals'
    ]);

    // Stage 4: generate_property_dossier
    assert.equal(plan.stages[3].capabilities[0].name, 'generate_property_dossier');
  });

  test('compiles single-stage plan for root capability', () => {
    const graph = createDefaultGraph();
    const plan = graph.buildExecutionPlan('scrape_auctions');
    assert.equal(plan.totalStages, 1);
    assert.equal(plan.totalSteps, 1);
    assert.equal(plan.stages[0].capabilities[0].name, 'scrape_auctions');
  });

  test('calculates external inputs required for plan', () => {
    const graph = createDefaultGraph();
    const plan = graph.buildExecutionPlan('property_dossier');
    assert.ok(plan.requiredInputs.includes('source_identifier'));
    assert.ok(plan.requiredInputs.includes('collection_options'));
    assert.ok(plan.requiredInputs.includes('source_observations'));
  });

  test('throws error for unknown target', () => {
    const graph = createDefaultGraph();
    assert.throws(() => {
      graph.buildExecutionPlan('unknown_target_xyz');
    }, /Target "unknown_target_xyz" not found/);
  });
});
