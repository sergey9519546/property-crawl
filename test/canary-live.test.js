'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  WAVE_CANDIDATES,
  evaluateCanaryClean,
  extractSourceResult,
  parseSourceList,
  resolveTargets,
  dryRunPlan,
  hasLiveDatabase,
  parseArgs,
} = require('../scripts/canary-live');

test('evaluateCanaryClean accepts Migration 014 gate-clean source results', () => {
  const result = evaluateCanaryClean({
    sourceId: 'treasury',
    accepted: 12,
    error: null,
    observationError: null,
    runId: 'run-1',
    report: {
      scope: { source: 'treasury', pages: 2 },
      complete: true,
      fullSweepComplete: true,
      truncated: false,
    },
  });
  assert.equal(result.clean, true);
  assert.equal(result.code, 'CLEAN');
  assert.equal(result.accepted, 12);
});

test('evaluateCanaryClean rejects incomplete, empty, errored, or truncated runs', () => {
  assert.equal(evaluateCanaryClean(null).clean, false);
  assert.equal(evaluateCanaryClean({
    accepted: 0,
    report: { scope: {}, complete: true, fullSweepComplete: true, truncated: false },
  }).clean, false);
  assert.equal(evaluateCanaryClean({
    accepted: 3,
    error: 'UPSTREAM_FORBIDDEN',
    report: { scope: {}, complete: true, fullSweepComplete: true, truncated: false },
  }).clean, false);
  assert.equal(evaluateCanaryClean({
    accepted: 3,
    report: { scope: {}, complete: true, fullSweepComplete: false, truncated: false },
  }).clean, false);
  assert.equal(evaluateCanaryClean({
    accepted: 3,
    report: { scope: {}, complete: true, fullSweepComplete: true, truncated: true },
  }).clean, false);
});

test('extractSourceResult finds the canary source in nested worker output', () => {
  const output = {
    result: {
      sourceResults: [
        { sourceId: 'hud', accepted: 1 },
        { sourceId: 'treasury', accepted: 4, report: { scope: { a: 1 }, complete: true } },
      ],
    },
  };
  const hit = extractSourceResult(output, 'treasury');
  assert.equal(hit.accepted, 4);
  assert.equal(extractSourceResult(output, 'missing'), null);
});

test('resolveTargets supports explicit, wave, and all-promoted modes', () => {
  assert.deepEqual(resolveTargets({ flags: { sources: 'Treasury, USDA' }, promoted: [] }).sources, ['treasury', 'usda']);
  assert.deepEqual(resolveTargets({ flags: { wave: 'wave1' }, promoted: [] }).sources, WAVE_CANDIDATES.wave1);
  assert.deepEqual(resolveTargets({ flags: { 'all-promoted': true }, promoted: ['servicelink'] }).sources, ['servicelink']);
  assert.equal(resolveTargets({ flags: {}, promoted: [] }).sources.length, 0);
  assert.throws(() => resolveTargets({ flags: { wave: 'wave9' }, promoted: [] }), /Unknown wave/);
});

test('dryRunPlan emits discovery-worker canary and promote commands', () => {
  const plan = dryRunPlan({ mode: 'wave1', sources: ['usda', 'gsa'] }, { repeat: 2 }).join('\n');
  assert.match(plan, /npm run discovery:worker -- --canary usda/);
  assert.match(plan, /npm run discovery:worker -- --canary gsa/);
  assert.match(plan, /--promote usda/);
  assert.match(plan, /SCRAPLING_SOURCES=gsa/);
});

test('hasLiveDatabase requires both DATABASE_URL and DISCOVERY_MODE=advanced', () => {
  assert.equal(hasLiveDatabase({}), false);
  assert.equal(hasLiveDatabase({ DATABASE_URL: 'postgres://x', DISCOVERY_MODE: 'demo' }), false);
  assert.equal(hasLiveDatabase({ DISCOVERY_MODE: 'advanced' }), false);
  assert.equal(hasLiveDatabase({ DATABASE_URL: 'postgres://x', DISCOVERY_MODE: 'advanced' }), true);
});

test('parseSourceList normalizes CSV tokens', () => {
  assert.deepEqual(parseSourceList('HUD, gsa ,irs'), ['hud', 'gsa', 'irs']);
});

test('parseArgs reads command, flags, and --key=value forms', () => {
  const parsed = parseArgs(['run', '--sources', 'a,b', '--repeat=2', '--all-promoted']);
  assert.equal(parsed.command, 'run');
  assert.equal(parsed.flags.sources, 'a,b');
  assert.equal(parsed.flags.repeat, '2');
  assert.equal(parsed.flags['all-promoted'], true);
});

test('canary-live CLI dry-run exits 0 without DATABASE_URL', async () => {
  const { main } = require('../scripts/canary-live');
  const previousDb = process.env.DATABASE_URL;
  const previousMode = process.env.DISCOVERY_MODE;
  delete process.env.DATABASE_URL;
  delete process.env.DISCOVERY_MODE;
  try {
    const code = await main(['run', '--sources', 'treasury', '--repeat', '2']);
    assert.equal(code, 0);
  } finally {
    if (previousDb === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDb;
    if (previousMode === undefined) delete process.env.DISCOVERY_MODE;
    else process.env.DISCOVERY_MODE = previousMode;
  }
});
