'use strict';

// test/discovery/discovery-contracts-helpers.test.js
//
// Direct unit coverage for the pure helpers exported from
// server/discovery/contracts.js. These pin the published "wave" -> source
// list mapping used by the discovery worker to schedule collection runs.
// Silent drift would silently drop a source from a wave (or add a typo'd
// name) and the worker would silently skip it forever.
//
//   - WAVES frozen shape: wave1 + wave2 keys, both arrays of source keys
//   - sourcesForWave: name lookup, returns a fresh array (mutation-safe)
//   - unknown wave throws
//   - returned array is decoupled from the frozen source

const assert = require('node:assert/strict');
const test = require('node:test');

const { WAVES, sourcesForWave } = require('../../server/discovery/contracts');

// --- WAVES structural pins ---------------------------------------------

test('WAVES: contains exactly wave1 and wave2 keys', () => {
  assert.deepEqual(Object.keys(WAVES).sort(), ['wave1', 'wave2']);
});

test('WAVES: wave1 contains the federal and core sources', () => {
  assert.deepEqual([...WAVES.wave1].sort(), [
    'gsa', 'hud', 'irs', 'servicelink', 'treasury', 'usda',
  ]);
});

test('WAVES: wave2 contains the lower-priority sources', () => {
  assert.deepEqual([...WAVES.wave2].sort(), ['bid4assets', 'civilview', 'landbank']);
});

test('WAVES: outer + inner arrays are frozen', () => {
  assert.equal(Object.isFrozen(WAVES), true);
  assert.equal(Object.isFrozen(WAVES.wave1), true);
  assert.equal(Object.isFrozen(WAVES.wave2), true);
});

// --- sourcesForWave -----------------------------------------------------

test('sourcesForWave: returns a fresh array (mutation does not leak back)', () => {
  const a = sourcesForWave('wave1');
  a.push('rogue');
  const b = sourcesForWave('wave1');
  assert.ok(!b.includes('rogue'));
});

test('sourcesForWave: unknown wave throws', () => {
  assert.throws(() => sourcesForWave('wave99'), /Unknown discovery wave/);
  assert.throws(() => sourcesForWave(''), /Unknown discovery wave/);
  assert.throws(() => sourcesForWave('WAVE1'), /Unknown discovery wave/);
});

test('sourcesForWave: wave1 returns the federal / core list', () => {
  const sources = sourcesForWave('wave1');
  assert.equal(sources.length, 6);
  assert.ok(sources.includes('treasury'));
  assert.ok(sources.includes('usda'));
});

test('sourcesForWave: wave2 returns the secondary list', () => {
  const sources = sourcesForWave('wave2');
  assert.equal(sources.length, 3);
  assert.ok(sources.includes('civilview'));
});