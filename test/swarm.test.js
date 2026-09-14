'use strict';
/**
 * test/swarm.test.js — Swarm orchestration layer tests (Node builtins only).
 */
const assert = require('node:assert/strict');
const { test, describe, before, after } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const config = require('../scripts/swarm/config');
const { MemoryStore } = require('../scripts/swarm/memory-store');
const { AgentRegistry } = require('../scripts/swarm/agent-registry');
const { TaskQueue } = require('../scripts/swarm/task-queue');
const { SwarmOrchestrator } = require('../scripts/swarm/orchestrator');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-test-'));
}

describe('swarm/config', () => {
  test('exposes all strategies, agent types, and coordination modes', () => {
    for (const name of ['auto', 'development', 'research', 'analysis', 'testing', 'optimization', 'maintenance', 'canary']) {
      assert.ok(config.strategies[name], `missing strategy ${name}`);
      assert.ok(config.strategies[name].description);
      assert.ok(Array.isArray(config.strategies[name].defaultAgents));
      assert.equal(typeof config.strategies[name].defaultMaxAgents, 'number');
      assert.ok(Array.isArray(config.strategies[name].phases));
      assert.ok(config.strategies[name].phases.length > 0);
    }
    for (const name of ['coordinator', 'developer', 'researcher', 'analyzer', 'tester', 'reviewer', 'documenter', 'monitor', 'specialist']) {
      assert.ok(config.agentTypes[name], `missing agent type ${name}`);
      assert.ok(Array.isArray(config.agentTypes[name].capabilities));
      assert.ok(config.agentTypes[name].permissions);
      assert.equal(typeof config.agentTypes[name].maxConcurrency, 'number');
    }
    for (const name of ['centralized', 'distributed', 'hierarchical', 'mesh', 'hybrid']) {
      assert.ok(config.coordinationModes[name], `missing mode ${name}`);
      assert.equal(typeof config.coordinationModes[name].coordinators, 'number');
    }
    assert.equal(config.defaults.maxAgents, 5);
    assert.equal(config.defaults.mode, 'centralized');
  });

  test('config object is frozen', () => {
    assert.equal(Object.isFrozen(config), true);
    assert.throws(() => {
      config.defaults.maxAgents = 99;
    });
  });
});

describe('swarm/memory-store', () => {
  test('set/get/delete/list/export/import round-trip', () => {
    const dir = tmpDir();
    const store = new MemoryStore(path.join(dir, 'mem.json'));
    store.set('goal', 'canary HUD sources', 'swarm');
    store.set('other', 42, 'swarm');
    assert.equal(store.get('goal', 'swarm'), 'canary HUD sources');
    assert.deepEqual(store.list('swarm'), ['goal', 'other']);
    assert.deepEqual(store.exportNs('swarm'), { goal: 'canary HUD sources', other: 42 });
    store.importNs({ extra: true }, 'swarm');
    assert.equal(store.get('extra', 'swarm'), true);
    assert.equal(store.delete('other', 'swarm'), true);
    assert.equal(store.get('other', 'swarm'), undefined);
  });

  test('persists atomically and survives reload', () => {
    const dir = tmpDir();
    const storePath = path.join(dir, 'mem.json');
    const a = new MemoryStore(storePath);
    a.set('k', 'v1', 'default');
    const b = new MemoryStore(storePath);
    assert.equal(b.get('k', 'default'), 'v1');
    // No leftover .tmp files after atomic write
    const leftovers = fs.readdirSync(dir).filter((f) => f.endsWith('.tmp'));
    assert.equal(leftovers.length, 0);
  });

  test('query ranks token and substring hits', () => {
    const dir = tmpDir();
    const store = new MemoryStore(path.join(dir, 'mem.json'));
    store.set('hud-canary', { source: 'HUD', status: 'ok' }, 'swarm');
    store.set('unrelated', 'nothing here', 'swarm');
    store.set('treasury-scraper', 'treasury auction scrape plan', 'dev');
    const hits = store.query('hud canary', 'swarm');
    assert.ok(hits.length >= 1);
    assert.equal(hits[0].key, 'hud-canary');
    const all = store.query('scraper');
    assert.ok(all.some((h) => h.namespace === 'dev' && h.key === 'treasury-scraper'));
  });

  test('objective convention and markdown episode flush', () => {
    const dir = tmpDir();
    const store = new MemoryStore(path.join(dir, 'mem.json'));
    store.set('objective', 'test the scrapers', 'swarm');
    const md = store.toMarkdown('swarm');
    assert.match(md, /# swarm episode/);
    assert.match(md, /test the scrapers/);
    assert.match(md, /citation:/);
    // flushToEpisodes writes into repo memory/episodes; use a custom path check via toMarkdown only
    // (flush is exercised lightly — it must return an existing file)
    const ep = store.flushToEpisodes('swarm');
    assert.ok(fs.existsSync(ep));
    assert.match(path.basename(ep), /^swarm-.*\.md$/);
  });
});

describe('swarm/agent-registry', () => {
  test('creates agents, lists them, and attaches playbooks', () => {
    const reg = new AgentRegistry({ maxAgents: 4 });
    const specialist = reg.createAgent('specialist');
    assert.equal(specialist.status, 'idle');
    assert.ok(Array.isArray(specialist.capabilities));
    assert.ok(specialist.capabilities.includes('scrape_auctions'));
    if (fs.existsSync(path.join(ROOT, '.kilo', 'agent', 'scraper-engineer.md'))) {
      assert.ok(specialist.playbook && specialist.playbook.includes('scraper'));
    }
    const reviewer = reg.createAgent('reviewer');
    if (fs.existsSync(path.join(ROOT, '.kilo', 'agent', 'reviewer.md'))) {
      assert.ok(reviewer.playbook && reviewer.playbook.includes('review'));
    }
    assert.equal(reg.count(), 2);
    assert.equal(reg.listAgents().length, 2);
    assert.equal(reg.getAgent(specialist.id).id, specialist.id);
  });

  test('enforces max agents and rejects unknown types', () => {
    const reg = new AgentRegistry({ maxAgents: 1 });
    reg.createAgent('tester');
    assert.throws(() => reg.createAgent('tester'), /capacity/);
    assert.throws(() => reg.createAgent('nope'), /Unknown agent type/);
  });

  test('releaseAgent resets status', () => {
    const reg = new AgentRegistry({ maxAgents: 2 });
    const a = reg.createAgent('tester');
    a.status = 'busy';
    a.claimedTasks.push('t1');
    assert.equal(reg.releaseAgent(a.id), true);
    assert.equal(a.status, 'idle');
    assert.deepEqual(a.claimedTasks, []);
  });
});

describe('swarm/task-queue', () => {
  function makeQueue() {
    const dir = tmpDir();
    return new TaskQueue({ persistPath: path.join(dir, 'q.json'), persist: true });
  }

  test('enqueue/claim/complete honors capability and priority', () => {
    const q = makeQueue();
    q.enqueue({ id: 'low', capability: 'scrape_auctions', priority: 7, phase: 'p' });
    q.enqueue({ id: 'high', capability: 'scrape_auctions', priority: 1, phase: 'p' });
    q.enqueue({ id: 'other', capability: 'verify_completion_gate', priority: 0, phase: 'p' });

    const claimed = q.claim('agent-1', ['scrape_auctions']);
    assert.equal(claimed.id, 'high');
    assert.equal(claimed.leaseOwner, 'agent-1');
    assert.ok(claimed.leaseExpiresAt > Date.now());

    const claimed2 = q.claim('agent-2', ['verify_completion_gate']);
    assert.equal(claimed2.id, 'other');
    assert.equal(q.claim('agent-3', ['compute_deal_score']), null);

    q.complete('high', { ok: true });
    assert.equal(q.get('high').status, 'done');
    const stats = q.stats();
    assert.equal(stats.done, 1);
    assert.equal(stats.claimed, 1);
  });

  test('fail re-queues until maxAttempts then dead-letters', () => {
    const q = makeQueue();
    q.enqueue({ id: 'flaky', capability: 'x', maxAttempts: 2 });
    q.claim('a1', ['x']);
    q.fail('flaky', 'boom');
    assert.equal(q.get('flaky').status, 'queued');
    q.claim('a1', ['x']);
    q.fail('flaky', 'boom2');
    assert.equal(q.get('flaky').status, 'deadLetter');
    assert.equal(q.stats().deadLetter, 1);
  });

  test('expireLeases returns orphaned tasks to the queue', () => {
    const q = makeQueue();
    q.enqueue({ id: 'orphan', capability: 'x' });
    const claimed = q.claim('a1', ['x'], 10);
    assert.equal(claimed.status, 'claimed');
    const recovered = q.expireLeases(Date.now() + 100);
    assert.equal(recovered.length, 1);
    assert.equal(q.get('orphan').status, 'queued');
  });

  test('persists across restart', () => {
    const dir = tmpDir();
    const p = path.join(dir, 'q.json');
    const q1 = new TaskQueue({ persistPath: p });
    q1.enqueue({ id: 'keep', capability: 'x', priority: 3 });
    const q2 = new TaskQueue({ persistPath: p });
    assert.equal(q2.get('keep').priority, 3);
    assert.equal(q2.stats().queued, 1);
  });

  test('abortRemaining fails queued and claimed work', () => {
    const q = makeQueue();
    q.enqueue({ id: 'a', capability: 'x' });
    q.enqueue({ id: 'b', capability: 'x' });
    q.claim('a1', ['x']);
    const n = q.abortRemaining('timeout');
    assert.equal(n, 2);
    assert.equal(q.stats().failed, 2);
  });
});

describe('swarm/orchestrator', () => {
  test('dry-run returns a plan without executing', async () => {
    const dir = tmpDir();
    const orch = new SwarmOrchestrator({
      strategy: 'development',
      dryRun: true,
      memory: new MemoryStore(path.join(dir, 'm.json')),
      queue: new TaskQueue({ persist: false }),
      registry: new AgentRegistry({ maxAgents: 3 }),
      maxAgents: 3,
    });
    const report = await orch.run('build a HUD scraper');
    assert.equal(report.dryRun, true);
    assert.ok(Array.isArray(report.phases));
    assert.ok(report.phases.length >= 3);
    assert.ok(report.agents.length >= 1);
    assert.ok(report.tasks.length >= 1);
    assert.equal(report.results.length, 0);
    assert.equal(orch.memory.get('objective', 'swarm'), 'build a HUD scraper');
  });

  test('run completes, produces a report, and flushes memory', async () => {
    const dir = tmpDir();
    const memory = new MemoryStore(path.join(dir, 'm.json'));
    const orch = new SwarmOrchestrator({
      strategy: 'development',
      dryRun: false,
      parallel: false,
      review: true,
      testing: true,
      maxAgents: 4,
      timeoutMinutes: 5,
      memory,
      queue: new TaskQueue({ persist: false }),
      registry: new AgentRegistry({ maxAgents: 4 }),
    });
    const events = [];
    orch.on('task:done', (e) => events.push(e));
    const report = await orch.run('repair the treasury collector');
    assert.equal(report.dryRun, false);
    assert.equal(report.timedOut, false);
    assert.ok(report.results.length > 0);
    assert.ok(report.results.every((r) => r.simulated === true));
    assert.ok(events.length > 0);
    assert.ok(report.queueStats.done > 0);
    assert.ok(report.episodePath && fs.existsSync(report.episodePath));
    assert.equal(memory.get('objective', 'swarm'), 'repair the treasury collector');
    const testingNotes = report.results.filter((r) => String(r.notes || '').includes('verify-gate'));
    assert.ok(testingNotes.length > 0, 'testing phase should record a planned verify-gate command');
  });

  test('auto strategy selection picks testing for "test the scrapers"', () => {
    const orch = new SwarmOrchestrator({ strategy: 'auto' });
    assert.equal(orch.resolveStrategy('test the scrapers'), 'testing');
    assert.equal(orch.resolveStrategy('research foreclosure filings'), 'research');
    assert.equal(orch.resolveStrategy('audit the discovery graph'), 'research');
    assert.equal(orch.resolveStrategy('optimize discovery workers'), 'optimization');
    assert.equal(orch.resolveStrategy('fix the broken pipeline'), 'maintenance');
    assert.equal(orch.resolveStrategy('analyze coverage metrics'), 'analysis');
    assert.equal(orch.resolveStrategy('scrape county auctions'), 'development');
    assert.equal(orch.resolveStrategy('something vague'), 'development');
  });

  test('canary strategy exists with expected shape', () => {
    const canary = config.strategies.canary;
    assert.ok(canary, 'missing strategy canary');
    assert.equal(canary.description, 'Run source canaries in parallel');
    assert.deepEqual(canary.defaultAgents, ['coordinator', 'specialist', 'tester']);
    assert.equal(canary.defaultMaxAgents, 6);
    assert.deepEqual(canary.phases, ['plan', 'execute', 'gate', 'report']);
  });

  test('auto strategy selection picks canary for "run source canaries"', () => {
    const orch = new SwarmOrchestrator({ strategy: 'auto' });
    assert.equal(orch.resolveStrategy('run source canaries'), 'canary');
    assert.equal(orch.resolveStrategy('promote the source after canary'), 'canary');
    assert.equal(orch.resolveStrategy('rollout the new collector'), 'canary');
    assert.equal(orch.resolveStrategy('source-gate check before promote'), 'canary');
  });

  test('phase plan includes canary phases', () => {
    const orch = new SwarmOrchestrator({ strategy: 'canary', testing: false, review: false });
    const phases = orch.buildPhasePlan('canary');
    const names = phases.map((p) => p.name);
    for (const expected of ['plan', 'execute', 'gate', 'report']) {
      assert.ok(names.includes(expected), `missing phase ${expected}`);
    }
  });

  test('timeout aborts remaining work', async () => {
    const dir = tmpDir();
    const orch = new SwarmOrchestrator({
      strategy: 'development',
      maxAgents: 1,
      timeoutMinutes: 0, // deadline is already passed
      parallel: false,
      testing: false,
      review: false,
      memory: new MemoryStore(path.join(dir, 'm.json')),
      queue: new TaskQueue({ persist: false }),
      registry: new AgentRegistry({ maxAgents: 1 }),
    });
    const report = await orch.run('urgent scraper work');
    assert.equal(report.timedOut, true);
  });

  test('uses capability-graph stages when available', () => {
    const orch = new SwarmOrchestrator({ strategy: 'development', testing: false, review: false });
    const phases = orch.buildPhasePlan('development');
    const graphPhase = phases.find((p) => p.name === 'capability-graph');
    if (orch.capabilityGraph) {
      assert.ok(graphPhase, 'expected a capability-graph phase');
      assert.ok(graphPhase.graphStages.length >= 1);
    } else {
      assert.equal(graphPhase, undefined);
    }
  });
});

describe('swarm CLI', () => {
  function cliEnv() {
    const dir = tmpDir();
    return {
      ...process.env,
      SWARM_MEMORY_PATH: path.join(dir, 'swarm-memory.json'),
      SWARM_TASKS_PATH: path.join(dir, 'swarm-tasks.json'),
    };
  }

  test('--dry-run exits 0 and prints a plan', () => {
    const out = execFileSync(
      process.execPath,
      [path.join(ROOT, 'scripts', 'swarm.js'), 'dry run demo', '--dry-run', '--strategy=development'],
      { cwd: ROOT, encoding: 'utf8', env: cliEnv() }
    );
    const parsed = JSON.parse(out);
    assert.equal(parsed.dryRun, true);
    assert.equal(parsed.strategy, 'development');
    assert.ok(Array.isArray(parsed.phases));
    assert.ok(parsed.tasks.length > 0);
  });

  test('agents subcommand lists types', () => {
    const out = execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'swarm.js'), 'agents'], {
      cwd: ROOT,
      encoding: 'utf8',
      env: cliEnv(),
    });
    assert.match(out, /specialist/);
    assert.match(out, /reviewer/);
    assert.match(out, /tester/);
  });

  test('status subcommand runs without crashing', () => {
    const out = execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'swarm.js'), 'status'], {
      cwd: ROOT,
      encoding: 'utf8',
      env: cliEnv(),
    });
    assert.match(out, /Queue stats|Last run|No previous/);
  });
});
