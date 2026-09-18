'use strict';

const test = require('node:test');
const assert = require('node:assert');

const {
  ALLOWLIST,
  resolveCommand,
  executeCapability,
} = require('../scripts/swarm/executor');

test('allowlist covers core verification capabilities', () => {
  assert.ok(ALLOWLIST.verify_completion_gate);
  assert.ok(ALLOWLIST.scrape_auctions);
  assert.ok(resolveCommand('verify_completion_gate'));
  assert.equal(resolveCommand('unknown_capability_xyz'), null);
});

test('simulated mode never claims real execution', async () => {
  const result = await executeCapability({ capability: 'verify_completion_gate', mode: 'simulated' });
  assert.equal(result.ok, true);
  assert.equal(result.simulated, true);
  assert.equal(result.mode, 'simulated');
});

test('real mode refuses non-allowlisted capabilities', async () => {
  const result = await executeCapability({ capability: 'not_a_real_capability', mode: 'real' });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'capability_not_allowlisted');
  assert.equal(result.simulated, false);
});

test('real mode runs the allowlisted context drift gate', async () => {
  const result = await executeCapability({
    capability: 'normalize_listings',
    mode: 'real',
    timeoutMs: 30_000,
  });
  assert.equal(result.simulated, false);
  assert.equal(result.mode, 'real');
  assert.equal(result.ok, true, result.stderr || result.notes);
  assert.ok(/context/i.test(result.label || result.notes || ''));
});
