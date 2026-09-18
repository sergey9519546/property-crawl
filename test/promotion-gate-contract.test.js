'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { checkPromotionContract } = require('../scripts/promotion-gate-check');
const { SwarmOrchestrator } = require('../scripts/swarm/orchestrator');
const { executeCapability } = require('../scripts/swarm/executor');

test('promotion gate contract holds without PostgreSQL', () => {
  const result = checkPromotionContract();
  assert.equal(result.ok, true, JSON.stringify(result.findings.filter((f) => !f.ok), null, 2));
  assert.ok(result.scheduledAdapterKeys.includes('servicelink'));
});

test('swarm real mode records real execution markers for allowlisted capabilities', async () => {
  const orch = new SwarmOrchestrator({ executionMode: 'real', maxAgents: 2, timeoutMinutes: 2 });
  assert.equal(orch.executionMode, 'real');
  const agent = { id: 'tester-1', type: 'tester' };
  const task = { id: 't1', phase: 'testing', capability: 'normalize_listings' };
  const result = await orch.execute(agent, task);
  assert.equal(result.simulated, false);
  assert.equal(result.mode, 'real');
  assert.ok(result.ok === true || result.ok === false);
  assert.ok(result.capability === 'normalize_listings');
});

test('swarm real executor expands allowlist for canary and signals capabilities', async () => {
  const missing = await executeCapability({ capability: 'not_allowlisted', mode: 'real' });
  assert.equal(missing.error, 'capability_not_allowlisted');
  const canaryHelp = await executeCapability({ capability: 'source_gate', mode: 'real', timeoutMs: 20000 });
  assert.equal(canaryHelp.simulated, false);
  assert.equal(canaryHelp.mode, 'real');
  assert.equal(canaryHelp.ok, true, canaryHelp.stderr || canaryHelp.notes);
});
