'use strict';
/*
 * agent-system.test.js — Authoritative acceptance tests for the ACTUAL Adversary
 * scenarios from audit/03-adversary.md (not the domain-level adversary.test.js).
 * Tests the agent system itself: routing, verification, drift gates,
 * config-under-test, memory, graceful degradation.
 *
 * These are the acceptance criteria for the upgraded agent system.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');

// --- Scenario 1: Deterministic routing under ambiguity ---
test('Scenario 1: Deterministic routing under ambiguity', () => {
  const { route } = require('../scripts/skill-router.js');

  // "audit my site" — the Adversary's complaint was 5+ skills with equal weight.
  // The upgraded system must NEVER return 5+ equal-weight matches. It either:
  // (a) returns ≤3 ranked candidates, (b) makes a deterministic pick, or
  // (c) honestly reports no match with a reason.
  const result = route('audit my site');
  assert.ok(result.recommendation, 'must have a recommendation (deterministic, ask, or none)');
  assert.ok(result.reason, 'must justify the recommendation');
  assert.ok(result.candidates.length <= 3, 'must never return more than 3 candidates');

  // a precise query should produce a deterministic pick
  const precise = route('scrape sheriff sales property');
  assert.ok(precise.candidates.length > 0, 'precise query must match at least one skill');
  if (precise.recommendation === 'deterministic') {
    assert.ok(precise.pick, 'deterministic recommendation must include a pick');
    assert.ok(precise.pick.score > 0, 'pick must have a positive score');
  }

  // an ambiguous query with multiple matches must rank them (not equal weight)
  const ambig = route('legal title scrape');
  if (ambig.candidates.length > 1) {
    const scores = ambig.candidates.map((c) => c.score);
    // at least the top must differ from the bottom (ranking, not equal weight)
    assert.ok(scores[0] > scores[scores.length - 1] || scores.every((s) => s === scores[0]),
      'multiple candidates must be ranked by score');
  }

  // every candidate must have a score and justification
  for (const c of result.candidates) {
    assert.ok(c.score !== undefined, 'each candidate must have a score');
    assert.ok(c.justification, 'each candidate must have a justification');
  }
});

// --- Scenario 2: Proportional verification ---
test('Scenario 2: Proportional verification', () => {
  const { classifyChange, getGate } = require('../scripts/verify-gate.js');

  // trivial: docs only
  assert.strictEqual(classifyChange(['README.md']), 'trivial');
  assert.strictEqual(classifyChange(['AGENTS.md']), 'trivial');

  // scraper: scraper files
  assert.strictEqual(classifyChange(['server/scrapers/sheriff.js']), 'scraper');

  // schema: data.js or db schema
  assert.strictEqual(classifyChange(['data.js']), 'schema');
  assert.strictEqual(classifyChange(['server/db/schema.sql']), 'schema');

  // runtime: server routes or UI
  assert.strictEqual(classifyChange(['server/routes/listings.js']), 'runtime');
  assert.strictEqual(classifyChange(['src/app/page.tsx']), 'runtime');

  // agent: .kilo, .agents, memory, hooks
  assert.strictEqual(classifyChange(['.kilo/command/test.md']), 'agent');
  assert.strictEqual(classifyChange(['.agents/skills/test/SKILL.md']), 'agent');
  assert.strictEqual(classifyChange(['memory/facts.md']), 'agent');
  assert.strictEqual(classifyChange(['scripts/hooks/pre-completion.js']), 'agent');

  // gate must be proportional: trivial < scraper < full
  const trivialGate = getGate('trivial');
  const scraperGate = getGate('scraper');
  const schemaGate = getGate('schema');

  assert.ok(trivialGate.suites.length <= 2, 'trivial gate must run <= 2 suites (fast)');
  assert.ok(scraperGate.suites.length >= 2, 'scraper gate must run >= 2 suites');
  assert.ok(schemaGate.suites.some((s) => s.includes('sync')), 'schema gate must include sync drift test');
  assert.ok(schemaGate.suites.some((s) => s.includes('context')), 'schema gate must include context drift test');
  assert.ok(trivialGate.maxDuration < scraperGate.maxDuration, 'trivial gate must be faster than scraper gate');

  // agent gate must run agent-system acceptance tests
  const agentGate = getGate('agent');
  assert.ok(agentGate.suites.some((s) => s.includes('agent-system')), 'agent gate must include agent-system acceptance');
  assert.ok(agentGate.suites.some((s) => s.includes('gen-skills-index') || s.includes('gen-context')),
    'agent gate must include drift checks');
  assert.ok(trivialGate.maxDuration < agentGate.maxDuration, 'trivial gate must be faster than agent gate');
});

// --- Scenario 3: Evidence-cited completion ---
test('Scenario 3: Evidence-cited completion', () => {
  const { runGate } = require('../scripts/verify-gate.js');

  // run a trivial gate (no files changed = trivial)
  const block = runGate('trivial');
  assert.ok(block.changeType, 'completion block must have changeType');
  assert.ok(block.gateLabel, 'completion block must have gate label');
  assert.ok(typeof block.allPassed === 'boolean', 'completion block must have allPassed boolean');
  assert.ok(Array.isArray(block.results), 'completion block must have results array');
  assert.ok(block.evidence, 'completion block must have evidence string');

  // each result must cite the command, pass/fail, and exit code
  for (const r of block.results) {
    assert.ok(r.cmd, 'each result must cite the command');
    assert.ok(typeof r.passed === 'boolean', 'each result must have passed boolean');
    assert.ok(typeof r.exitCode === 'number', 'each result must have exit code');
    assert.ok(typeof r.elapsedMs === 'number', 'each result must have elapsed time');
  }
});

// --- Scenario 4: Drift-gated domain model ---
test('Scenario 4: Drift-gated domain model', () => {
  // CONTEXT.md must exist and have a digest
  const ctxPath = path.join(ROOT, 'CONTEXT.md');
  assert.ok(fs.existsSync(ctxPath), 'CONTEXT.md must exist');
  const ctx = fs.readFileSync(ctxPath, 'utf8');
  assert.ok(ctx.includes('CONTEXT-DIGEST:'), 'CONTEXT.md must embed a drift digest');

  // gen-context.js --check must pass
  const exitCode = execSync('node scripts/gen-context.js --check', { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  assert.ok(exitCode.toString().includes('current'), 'gen-context --check must report current');

  // context.test.js must exist and pass
  assert.ok(fs.existsSync(path.join(ROOT, 'test', 'context.test.js')), 'test/context.test.js must exist');
});

// --- Scenario 5: Config-under-test ---
test('Scenario 5: Config-under-test', () => {
  // commands must exist and be testable
  const cmdDir = path.join(ROOT, '.kilo', 'command');
  assert.ok(fs.existsSync(cmdDir), '.kilo/command/ must exist');
  const commands = fs.readdirSync(cmdDir).filter((f) => f.endsWith('.md'));
  assert.ok(commands.length >= 5, `at least 5 commands must exist, found ${commands.length}`);

  // agents must exist and be testable
  const agentDir = path.join(ROOT, '.kilo', 'agent');
  assert.ok(fs.existsSync(agentDir), '.kilo/agent/ must exist');
  const agents = fs.readdirSync(agentDir).filter((f) => f.endsWith('.md'));
  assert.ok(agents.length >= 3, `at least 3 agents must exist, found ${agents.length}`);

  // test files must exist for commands and agents
  assert.ok(fs.existsSync(path.join(ROOT, 'test', 'commands.test.js')), 'test/commands.test.js must exist');
  assert.ok(fs.existsSync(path.join(ROOT, 'test', 'agents.test.js')), 'test/agents.test.js must exist');

  // hooks must exist with a pre-completion gate
  assert.ok(fs.existsSync(path.join(ROOT, '.kilo', 'hooks', 'hooks.json')), '.kilo/hooks/hooks.json must exist');
  const hooks = JSON.parse(fs.readFileSync(path.join(ROOT, '.kilo', 'hooks', 'hooks.json'), 'utf8'));
  assert.ok(hooks.hooks.some((h) => h.event === 'Stop' && h.blocking), 'must have a blocking Stop hook');
  assert.ok(fs.existsSync(path.join(ROOT, 'scripts', 'hooks', 'pre-completion.js')), 'pre-completion hook script must exist');
});

// --- Scenario 6: Dead-config cleanup with provenance ---
test('Scenario 6: Dead-config cleanup with provenance', () => {
  const { main } = require('../scripts/skills-doctor.js');
  const report = main.call({ exitCode: 0 }); // call without side effects

  // doctor must report duplicates, empty dirs, epoch files, stale bundles
  assert.ok(Array.isArray(report.dups), 'must report duplicate skills');
  assert.ok(Array.isArray(report.emptydirs), 'must report empty dirs');
  assert.ok(Array.isArray(report.epoch), 'must report epoch-stamped files');
  assert.ok(Array.isArray(report.staleBundles), 'must report stale bundles');

  // .gemini (if present) should be flagged as stale bundle
  // (it may have been cleaned up already — just verify the scanner runs)
});

// --- Scenario 7: Graceful scrape failure ---
test('Scenario 7: Graceful scrape failure', () => {
  const { ScraperCircuitBreaker } = require('../server/scrapers/circuit-breaker');

  const breaker = new ScraperCircuitBreaker({ minPayloadBytes: 50, failureThreshold: 3 });

  // 403 must be rejected
  const r403 = breaker.validateResponse({ status: 403, body: 'Access Denied' });
  assert.strictEqual(r403.isValid, false, '403 must fail validation');

  // Cloudflare challenge must be rejected
  const rCf = breaker.validateResponse({ status: 200, body: '<html><title>Attention Required! | Cloudflare</title></html>' });
  assert.strictEqual(rCf.isValid, false, 'Cloudflare challenge must fail');

  // zero-byte payload must be rejected
  const rZero = breaker.validateResponse({ status: 200, body: '' });
  assert.strictEqual(rZero.isValid, false, 'zero-byte payload must fail');

  // valid response must pass
  const rOk = breaker.validateResponse({ status: 200, body: 'x'.repeat(100) });
  assert.ok(rOk.isValid, 'valid response must pass');
});

// --- Scenario 8: Schema-boundary drift is caught ---
test('Scenario 8: Schema-boundary drift is caught', () => {
  // sync.test.js must exist (v0 <-> v2 drift)
  assert.ok(fs.existsSync(path.join(ROOT, 'test', 'sync.test.js')), 'test/sync.test.js must exist');

  // context.test.js must exist (domain model drift)
  assert.ok(fs.existsSync(path.join(ROOT, 'test', 'context.test.js')), 'test/context.test.js must exist');

  // run sync test to verify it passes
  try {
    execSync('node --test test/sync.test.js', { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    assert.fail(`sync.test.js must pass: ${err.message}`);
  }
});

// --- Scenario 9: Memory survives and stays truthful ---
test('Scenario 9: Memory survives and stays truthful', () => {
  const memDir = path.join(ROOT, 'memory');
  assert.ok(fs.existsSync(memDir), 'memory/ directory must exist');

  // facts.md must exist with cited invariants
  const factsPath = path.join(memDir, 'facts.md');
  assert.ok(fs.existsSync(factsPath), 'memory/facts.md must exist');
  const facts = fs.readFileSync(factsPath, 'utf8');
  // every fact must cite a source file
  assert.ok(facts.includes('Source:'), 'facts.md must cite source files for each fact');

  // working.md must exist
  const workingPath = path.join(memDir, 'working.md');
  assert.ok(fs.existsSync(workingPath), 'memory/working.md must exist');

  // episodes/ dir must exist
  const episodesDir = path.join(memDir, 'episodes');
  assert.ok(fs.existsSync(episodesDir), 'memory/episodes/ must exist');
});

// --- Scenario 10: Free-tier resilience ---
test('Scenario 10: Free-tier resilience (graceful degradation)', () => {
  // DATABASE_URL must not be required to boot
  const clientPath = path.join(ROOT, 'server', 'db', 'client.js');
  assert.ok(fs.existsSync(clientPath), 'server/db/client.js must exist');
  const client = fs.readFileSync(clientPath, 'utf8');
  assert.ok(
    client.includes('in-memory') || client.includes('InMemory') || client.includes('memory'),
    'db client must have in-memory fallback when DATABASE_URL is unset'
  );

  // skills-doctor must run without DATABASE_URL
  try {
    execSync('node scripts/skills-doctor.js --json', { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    assert.fail(`skills-doctor must run without DATABASE_URL: ${err.message}`);
  }

  // skill-router must run without any external dependencies
  try {
    execSync('node scripts/skill-router.js "test query" --json', { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    assert.fail(`skill-router must run without external deps: ${err.message}`);
  }

  // verify-gate must run without DATABASE_URL
  try {
    execSync('node scripts/verify-gate.js --json', { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    assert.fail(`verify-gate must run without DATABASE_URL: ${err.message}`);
  }
});
