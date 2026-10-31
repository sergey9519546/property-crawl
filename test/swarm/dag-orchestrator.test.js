'use strict';

const assert = require('node:assert/strict');
const { test, describe } = require('node:test');
const { DagOrchestrator, executeDag, ENRICHMENT_NODE_DEFS } = require('../../server/swarm/dag-orchestrator');
const { TriggerWeightManager } = require('../../server/swarm/trigger-weights');

describe('DagOrchestrator (Tier 3.3)', () => {
  test('compiles correct topological parallel stages', () => {
    const orchestrator = new DagOrchestrator();
    const stages = orchestrator.compileStages('dossier_synthesis');

    assert.equal(stages.length, 4);

    // Stage 1: geocode
    assert.deepEqual(stages[0], ['geocode']);

    // Stage 2: parallel branches
    const stage2 = [...stages[1]].sort();
    assert.deepEqual(stage2, ['cadastral_parcel', 'code_enforcement', 'hpi_benchmark', 'hud_safmr']);

    // Stage 3: title_risk depends on code_enforcement
    assert.deepEqual(stages[2], ['title_risk']);

    // Stage 4: dossier_synthesis depends on all previous branches
    assert.deepEqual(stages[3], ['dossier_synthesis']);
  });

  test('executes end-to-end DAG and passes accumulated context forward', async () => {
    const initialContext = {
      address: '100 North Orange Ave, Orlando, FL 32801',
      situs: '100 N Orange Ave',
      zip: '32801',
      state: 'FL',
      apn: '29-22-12-0000-00-001',
      saleDate: '2026-11-20',
      openingBid: 150000,
    };

    const result = await executeDag(initialContext);

    assert.equal(result.success, true);
    assert.ok(result.stages.length >= 4);

    // Context accumulated fields
    assert.ok(result.context.lat !== undefined);
    assert.ok(result.context.lng !== undefined);
    assert.ok(result.context.fips !== undefined);
    assert.ok(result.context.parcelGeometry !== undefined);
    assert.ok(result.context.hpiIndex !== undefined);
    assert.ok(result.context.fmr2br !== undefined);
    assert.ok(result.context.riskScore !== undefined);
    assert.ok(result.context.dossier !== undefined);
    assert.equal(result.context.dossier.address, initialContext.address);

    // Telemetry reporting
    assert.ok(result.telemetry.totalDurationMs >= 0);
    assert.ok(result.telemetry.completedNodes.includes('geocode'));
    assert.ok(result.telemetry.completedNodes.includes('dossier_synthesis'));
    assert.equal(result.telemetry.failedNodes.length, 0);

    const geoDiag = result.telemetry.nodeDiagnostics.geocode;
    assert.equal(geoDiag.status, 'completed');
    assert.ok(geoDiag.durationMs >= 0);
    assert.ok(geoDiag.outputs.includes('lat'));
  });

  test('fault isolation: optional node failure fails soft and allows downstream completion', async () => {
    const weights = new TriggerWeightManager();
    const orchestrator = new DagOrchestrator({
      triggerWeights: weights,
      handlers: {
        // Deliberately fail the optional code_enforcement node
        code_enforcement: async () => {
          throw new Error('SODA municipal open data portal 503 service unavailable');
        },
      },
    });

    const initialContext = {
      address: '500 W Temple St, Los Angeles, CA 90012',
      situs: '500 W Temple St',
      zip: '90012',
      state: 'CA',
      apn: '5408-010-001',
    };

    const result = await orchestrator.executeDag(initialContext);

    // Pipeline succeeds soft despite optional node failure
    assert.equal(result.success, true);
    assert.ok(result.telemetry.failedNodes.includes('code_enforcement'));
    assert.ok(result.telemetry.completedNodes.includes('dossier_synthesis'));

    // Check node diagnostics recorded the error
    const ceDiag = result.telemetry.nodeDiagnostics.code_enforcement;
    assert.equal(ceDiag.status, 'failed');
    assert.ok(ceDiag.error.includes('SODA municipal open data portal 503'));

    // Downstream title_risk and dossier_synthesis still completed
    assert.equal(result.telemetry.nodeDiagnostics.title_risk.status, 'completed');
    assert.equal(result.telemetry.nodeDiagnostics.dossier_synthesis.status, 'completed');
    assert.ok(result.context.dossier);
  });

  test('handles node execution timeout cleanly', async () => {
    const orchestrator = new DagOrchestrator({
      nodeTimeoutMs: 50,
      handlers: {
        hpi_benchmark: async () => {
          return new Promise(resolve => setTimeout(() => resolve({ hpiIndex: 500 }), 300));
        },
      },
    });

    const result = await orchestrator.executeDag({
      address: '123 Test St, Columbus, OH 43215',
      state: 'OH',
      zip: '43215',
    });

    assert.equal(result.success, true);
    assert.ok(result.telemetry.failedNodes.includes('hpi_benchmark'));
    assert.ok(result.telemetry.nodeDiagnostics.hpi_benchmark.error.includes('timed out'));
  });

  test('validates input and output schemas and skips/fails gracefully', async () => {
    const orchestrator = new DagOrchestrator({
      handlers: {
        cadastral_parcel: async () => {
          // Output validation failure (missing required parcelGeometry and lotAcres)
          return { unexpectedFieldOnly: true };
        },
      },
    });

    const result = await orchestrator.executeDag({
      address: '789 Main St, Miami, FL 33101',
      zip: '33101',
      state: 'FL',
    });

    assert.ok(result.telemetry.failedNodes.includes('cadastral_parcel'));
    assert.ok(result.telemetry.nodeDiagnostics.cadastral_parcel.error.includes('Output validation failed'));
  });
});
