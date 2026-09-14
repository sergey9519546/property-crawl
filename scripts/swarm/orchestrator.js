'use strict';
/**
 * scripts/swarm/orchestrator.js — Swarm coordinator for property-crawl.
 *
 * Resolves a strategy from the objective, builds a phase plan (optionally
 * topologically sorted via scripts/capability-graph.js), spawns typed agents,
 * and runs a deterministic simulated executor against a work-stealing queue.
 * Emits progress events and flushes memory to memory/episodes/ at the end.
 *
 * No shell commands are executed from the orchestrator; every task result is
 * marked simulated: true so runs stay testable and side-effect free.
 */

const crypto = require('crypto');
const { EventEmitter } = require('events');
const config = require('./config');
const { MemoryStore } = require('./memory-store');
const { AgentRegistry } = require('./agent-registry');
const { TaskQueue } = require('./task-queue');

// Phase name → preferred agent types (order = spawn priority).
const PHASE_AGENT_TYPES = {
  route: ['coordinator'],
  plan: ['coordinator', 'researcher'],
  explore: ['researcher'],
  collect: ['researcher', 'specialist'],
  gather: ['analyzer', 'researcher'],
  profile: ['analyzer', 'monitor'],
  triage: ['coordinator', 'monitor'],
  implement: ['specialist', 'developer'],
  fix: ['developer', 'specialist'],
  integrate: ['developer', 'specialist'],
  redesign: ['developer', 'analyzer'],
  normalize: ['specialist'],
  synthesize: ['analyzer', 'documenter'],
  compute: ['analyzer'],
  interpret: ['analyzer', 'documenter'],
  analyze: ['analyzer'],
  execute: ['specialist', 'developer', 'tester'],
  benchmark: ['tester', 'analyzer'],
  verify: ['tester'],
  gate: ['tester'],
  review: ['reviewer'],
  testing: ['tester'],
  report: ['documenter'],
  document: ['documenter'],
  canary: ['specialist', 'tester'],
};

const KEYWORD_STRATEGY = [
  { re: /\b(test|qa|verify|regression|suite)\b/i, strategy: 'testing' },
  { re: /\b(canar\w*|promot\w*|rollout|source-gate)\b/i, strategy: 'canary' },
  { re: /\b(scrape|scraper|source|collector|auction|hud|treasury|gsa|irs|usda)\b/i, strategy: 'development' },
  { re: /\b(research|audit|investigate|explore|network)\b/i, strategy: 'research' },
  { re: /\b(optimize|performance|profile|benchmark|latency)\b/i, strategy: 'optimization' },
  { re: /\b(fix|bug|repair|patch|broken|fail)\b/i, strategy: 'maintenance' },
  { re: /\b(analyz|coverage|score|metric|health)\b/i, strategy: 'analysis' },
];

class SwarmOrchestrator extends EventEmitter {
  /**
   * @param {object} [opts]
   * @param {string} [opts.strategy]
   * @param {string} [opts.mode]
   * @param {number} [opts.maxAgents]
   * @param {boolean} [opts.parallel]
   * @param {boolean} [opts.review]
   * @param {boolean} [opts.testing]
   * @param {number} [opts.timeoutMinutes]
   * @param {boolean} [opts.dryRun]
   * @param {MemoryStore} [opts.memory]
   * @param {TaskQueue} [opts.queue]
   * @param {AgentRegistry} [opts.registry]
   */
  constructor(opts = {}) {
    super();
    const d = config.defaults;
    this.strategy = opts.strategy || 'auto';
    this.mode = opts.mode || d.mode;
    this.maxAgents = opts.maxAgents != null ? opts.maxAgents : d.maxAgents;
    this.parallel = opts.parallel != null ? opts.parallel : d.parallel;
    this.review = opts.review != null ? opts.review : d.review;
    this.testing = opts.testing != null ? opts.testing : d.testing;
    this.timeoutMinutes = opts.timeoutMinutes != null ? opts.timeoutMinutes : d.timeoutMinutes;
    this.dryRun = Boolean(opts.dryRun);
    this.memory = opts.memory || new MemoryStore();
    this.queue = opts.queue || new TaskQueue({ persist: true });
    this.registry = opts.registry || new AgentRegistry({ maxAgents: this.maxAgents });
    this.capabilityGraph = tryLoadCapabilityGraph();
  }

  /**
   * Keyword-route an objective to a concrete strategy.
   * @param {string} objective
   * @param {string} [requested]
   */
  resolveStrategy(objective, requested) {
    const want = requested || this.strategy;
    if (want && want !== 'auto' && config.strategies[want]) return want;
    const text = String(objective || '');
    for (const rule of KEYWORD_STRATEGY) {
      if (rule.re.test(text)) return rule.strategy;
    }
    return 'development';
  }

  /**
   * Build the ordered phase plan. Uses capability-graph parallel stages when the
   * graph covers the strategy's capability surface; otherwise falls back to the
   * strategy's linear phases.
   * @param {string} strategyName
   */
  buildPhasePlan(strategyName) {
    const strategy = config.strategies[strategyName] || config.strategies.development;
    const phases = strategy.phases.map((name, idx) => ({
      name,
      index: idx,
      agentTypes: PHASE_AGENT_TYPES[name] || ['coordinator'],
      capabilities: capabilitiesForPhase(name),
      parallel: false,
      source: 'strategy',
    }));

    // Attempt to enrich with capability-graph stages when we can map a target.
    const graphPlan = this._graphPlanFor(strategyName);
    if (graphPlan) {
      phases.push({
        name: 'capability-graph',
        index: phases.length,
        agentTypes: ['specialist', 'analyzer', 'tester'],
        capabilities: graphPlan.stages.flatMap((s) => s.capabilities.map((c) => c.name)),
        parallel: true,
        source: 'capability-graph',
        graphStages: graphPlan.stages.map((s) => ({
          stageIndex: s.stageIndex,
          parallel: s.parallel,
          capabilities: s.capabilities.map((c) => c.name),
        })),
      });
    }

    if (this.review) {
      phases.push({
        name: 'review',
        index: phases.length,
        agentTypes: ['reviewer'],
        capabilities: ['verify_completion_gate'],
        parallel: false,
        source: 'review-flag',
      });
    }
    if (this.testing) {
      phases.push({
        name: 'testing',
        index: phases.length,
        agentTypes: ['tester'],
        capabilities: ['verify_completion_gate'],
        parallel: false,
        source: 'testing-flag',
      });
    }

    return phases;
  }

  _graphPlanFor(strategyName) {
    if (!this.capabilityGraph) return null;
    try {
      // Map strategies onto a graph product they most naturally produce.
      const targetByStrategy = {
        development: 'property_dossier',
        research: 'property_dossier',
        analysis: 'deal_score',
        testing: 'completion_certification',
        optimization: 'raw_records',
        maintenance: 'completion_certification',
        canary: 'completion_certification',
        auto: 'property_dossier',
      };
      const target = targetByStrategy[strategyName];
      if (!target) return null;
      return this.capabilityGraph.buildExecutionPlan(target);
    } catch (_) {
      return null;
    }
  }

  /**
   * Simulated deterministic executor. Records start/end and returns a
   * structured result; never shells out.
   */
  async execute(agent, task) {
    const started = Date.now();
    // Yield so the event loop stays responsive in parallel stages.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const durationMs = Math.max(0, Date.now() - started);
    const notes = this._notesFor(agent, task);
    return {
      ok: true,
      agentId: agent.id,
      taskId: task.id,
      phase: task.phase,
      capability: task.capability,
      durationMs,
      notes,
      simulated: true,
    };
  }

  _notesFor(agent, task) {
    const base = `[simulated] ${agent.type} (${agent.id}) executed ${task.capability} in phase ${task.phase}`;
    if (task.phase === 'testing' || task.capability === 'verify_completion_gate') {
      const classified = classifyChangeType(task);
      return `${base}; planned verify-gate: node scripts/verify-gate.js --change-type=${classified}`;
    }
    if (task.phase === 'review') {
      return `${base}; review axes: Standards + Spec (file:line citations required)`;
    }
    return base;
  }

  /**
   * Run the swarm against an objective.
   * @param {string} objective
   * @returns {Promise<object>} run report
   */
  async run(objective) {
    const runId = `run-${crypto.randomBytes(6).toString('hex')}`;
    const startedAt = Date.now();
    const strategyName = this.resolveStrategy(objective, this.strategy);
    const strategy = config.strategies[strategyName];

    this.memory.set('objective', objective, 'swarm');
    this.memory.set(
      'run',
      { runId, strategy: strategyName, mode: this.mode, dryRun: this.dryRun, startedAt: new Date(startedAt).toISOString() },
      'swarm'
    );
    // Each run starts from a clean queue; leftover tasks from prior runs would
    // otherwise pollute stats and steal work under the shared persist path.
    this.queue.clear();

    const phases = this.buildPhasePlan(strategyName);
    this.emit('phase:start', { runId, phase: phases[0] ? phases[0].name : null, strategy: strategyName });

    // Spawn agents (up to maxAgents) covering the types the plan needs.
    const wantedTypes = uniqueWantedTypes(phases, strategy);
    const agents = this._spawnAgents(wantedTypes);

    // Build tasks for every phase.
    const tasks = [];
    for (const phase of phases) {
      const caps = phase.capabilities.length > 0 ? phase.capabilities : ['verify_completion_gate'];
      for (const cap of caps) {
        const task = this.queue.enqueue({
          id: `${runId}:${phase.name}:${cap}`,
          strategy: strategyName,
          phase: phase.name,
          capability: cap,
          payload: { objective, runId },
          priority: phase.index,
          maxAttempts: 2,
        });
        tasks.push(task);
      }
    }

    if (this.dryRun) {
      const report = {
        runId,
        strategy: strategyName,
        mode: this.mode,
        objective,
        phases,
        agents: agents.map(summarizeAgent),
        tasks: tasks.map(summarizeTask),
        results: [],
        durationMs: Date.now() - startedAt,
        dryRun: true,
        timeoutMinutes: this.timeoutMinutes,
        queueStats: this.queue.stats(),
      };
      this.memory.set('lastPlan', report, 'swarm');
      // Dry-run must not leave residue in the persistent queue.
      this.queue.clear();
      this.emit('run:complete', { runId, dryRun: true });
      return report;
    }

    const results = [];
    const deadline = startedAt + this.timeoutMinutes * 60 * 1000;
    let timedOut = false;

    // Execute phase by phase so ordering is deterministic.
    for (const phase of phases) {
      if (Date.now() >= deadline) {
        timedOut = true;
        break;
      }
      this.emit('phase:start', { runId, phase: phase.name });
      const phaseTasks = tasks.filter((t) => t.phase === phase.name);
      const outcomes = await this._runPhase(phase, phaseTasks, agents, deadline);
      results.push(...outcomes);
      this.emit('phase:end', { runId, phase: phase.name, completed: outcomes.filter((o) => o.ok).length });
      for (const agent of agents) {
        if (agent.status === 'busy') {
          agent.status = 'idle';
          this.emit('agent:idle', { agentId: agent.id });
        }
      }
    }

    if (timedOut) {
      this.queue.abortRemaining(`timeout after ${this.timeoutMinutes}m`);
      this.memory.set('timeout', { runId, timeoutMinutes: this.timeoutMinutes }, 'swarm');
    }

    // Recover any leases that slipped.
    this.queue.expireLeases();

    const durationMs = Date.now() - startedAt;
    const report = {
      runId,
      strategy: strategyName,
      mode: this.mode,
      objective,
      phases,
      agents: agents.map(summarizeAgent),
      tasks: tasks.map((t) => summarizeTask(this.queue.get(t.id) || t)),
      results,
      durationMs,
      dryRun: false,
      timedOut,
      queueStats: this.queue.stats(),
    };

    this.memory.set('lastReport', report, 'swarm');
    this.memory.set(
      'summary',
      {
        runId,
        strategy: strategyName,
        ok: results.filter((r) => r.ok).length,
        failed: results.filter((r) => !r.ok).length,
        durationMs,
      },
      'swarm'
    );

    this.emit('run:complete', { runId, timedOut, results: results.length });
    try {
      report.episodePath = this.memory.flushToEpisodes('swarm');
    } catch (_) {
      report.episodePath = null;
    }
    return report;
  }

  _spawnAgents(wantedTypes) {
    const agents = [];
    for (const type of wantedTypes) {
      if (this.registry.count() >= this.maxAgents) break;
      if (this.registry.capacity() <= 0) break;
      try {
        const agent = this.registry.createAgent(type);
        agents.push(agent);
      } catch (_) {}
    }
    // Guarantee at least one agent so the run can claim something.
    if (agents.length === 0 && this.registry.capacity() > 0) {
      try {
        agents.push(this.registry.createAgent('coordinator'));
      } catch (_) {}
    }
    return agents;
  }

  async _runPhase(phase, phaseTasks, agents, deadline) {
    const outcomes = [];
    // Reset queue status for these tasks if a previous attempt left residue.
    for (const task of phaseTasks) {
      const live = this.queue.get(task.id);
      if (live && live.status === 'queued') continue;
      if (live && live.status === 'claimed' && live.leaseExpiresAt && live.leaseExpiresAt < Date.now()) {
        this.queue.expireLeases();
      }
    }

    const pending = phaseTasks
      .map((t) => this.queue.get(t.id))
      .filter((t) => t && (t.status === 'queued' || t.status === 'claimed'));

    if (this.parallel && pending.length > 1) {
      // Fan out: each pending task is claimed by a capable idle agent.
      const runners = pending.map(async (task) => {
        if (Date.now() >= deadline) {
          this.queue.fail(task.id, 'timeout');
          return { ok: false, taskId: task.id, error: 'timeout' };
        }
        const agent = pickAgent(agents, this.queue, task.capability);
        if (!agent) {
          this.queue.fail(task.id, 'no capable agent');
          return { ok: false, taskId: task.id, error: 'no capable agent' };
        }
        return this._claimAndExecute(agent, task);
      });
      const settled = await Promise.all(runners);
      outcomes.push(...settled);
    } else {
      for (const task of pending) {
        if (Date.now() >= deadline) {
          this.queue.fail(task.id, 'timeout');
          outcomes.push({ ok: false, taskId: task.id, error: 'timeout' });
          continue;
        }
        const agent = pickAgent(agents, this.queue, task.capability);
        if (!agent) {
          this.queue.fail(task.id, 'no capable agent');
          outcomes.push({ ok: false, taskId: task.id, error: 'no capable agent' });
          continue;
        }
        outcomes.push(await this._claimAndExecute(agent, task));
      }
    }
    return outcomes;
  }

  async _claimAndExecute(agent, pendingTask) {
    const claimed = this.queue.claim(agent.id, agent.capabilities, 60000);
    if (!claimed || claimed.id !== pendingTask.id) {
      // Work-stealing race: another agent (or filter mismatch) took it.
      const alt = claimed || this.queue.get(pendingTask.id);
      if (!alt) {
        return { ok: false, taskId: pendingTask.id, error: 'claim-miss' };
      }
      if (claimed) {
        // We claimed a different task — execute that one instead.
        return this._finishClaimed(agent, claimed);
      }
      return { ok: false, taskId: pendingTask.id, error: `status=${alt.status}` };
    }
    return this._finishClaimed(agent, claimed);
  }

  async _finishClaimed(agent, claimed) {
    agent.status = 'busy';
    agent.claimedTasks.push(claimed.id);
    this.emit('task:claimed', { agentId: agent.id, taskId: claimed.id, capability: claimed.capability });
    const start = Date.now();
    try {
      const result = await this.execute(agent, claimed);
      this.queue.complete(claimed.id, result);
      this.memory.set(
        `task/${claimed.id}`,
        { agentId: agent.id, phase: claimed.phase, capability: claimed.capability, result, at: new Date().toISOString() },
        'swarm'
      );
      this.emit('task:done', { agentId: agent.id, taskId: claimed.id, durationMs: Date.now() - start });
      return result;
    } catch (err) {
      const failed = this.queue.fail(claimed.id, err.message);
      this.emit('task:failed', { agentId: agent.id, taskId: claimed.id, error: err.message });
      return { ok: false, taskId: claimed.id, error: err.message, status: failed.status };
    } finally {
      agent.status = 'idle';
      this.emit('agent:idle', { agentId: agent.id });
    }
  }
}

function tryLoadCapabilityGraph() {
  try {
    const mod = require('../capability-graph');
    if (mod && typeof mod.createDefaultGraph === 'function') {
      const graph = mod.createDefaultGraph();
      const val = graph.validate();
      if (val && val.valid) return graph;
    }
  } catch (_) {}
  return null;
}

function capabilitiesForPhase(phaseName) {
  const map = {
    route: ['normalize_listings'],
    plan: ['normalize_listings'],
    explore: ['scrape_auctions'],
    collect: ['scrape_auctions'],
    gather: ['enrich_public_records'],
    profile: ['evaluate_opportunity_signals'],
    triage: ['evaluate_opportunity_signals'],
    implement: ['scrape_auctions', 'normalize_listings'],
    fix: ['normalize_listings'],
    integrate: ['normalize_listings', 'evaluate_saved_hunts'],
    redesign: ['compute_deal_score'],
    synthesize: ['generate_property_dossier'],
    compute: ['compute_deal_score'],
    interpret: ['evaluate_opportunity_signals'],
    analyze: ['compute_deal_score', 'evaluate_opportunity_signals'],
    execute: ['scrape_auctions', 'normalize_listings'],
    benchmark: ['compute_deal_score'],
    verify: ['verify_completion_gate'],
    gate: ['verify_completion_gate'],
    review: ['verify_completion_gate'],
    testing: ['verify_completion_gate'],
    report: ['generate_property_dossier'],
    document: ['generate_property_dossier'],
    canary: ['scrape_auctions', 'verify_completion_gate'],
  };
  return map[phaseName] || ['normalize_listings'];
}

function uniqueWantedTypes(phases, strategy) {
  const ordered = [];
  const seen = new Set();
  const push = (t) => {
    if (!seen.has(t)) {
      seen.add(t);
      ordered.push(t);
    }
  };
  push('coordinator');
  for (const t of strategy.defaultAgents || []) push(t);
  for (const phase of phases) {
    for (const t of phase.agentTypes || []) push(t);
  }
  return ordered;
}

function pickAgent(agents, queue, capability) {
  // Prefer idle, under-budget agents; among them, prefer narrower capability
  // sets so specialists win scraper work over the catch-all coordinator.
  const rank = (a) =>
    (a.status === 'idle' ? 0 : 1) +
    (a.claimedTasks.length < a.maxConcurrency ? 0 : 2) +
    a.capabilities.length;
  const capable = agents
    .filter((a) => a.capabilities.includes(capability))
    .sort((a, b) => rank(a) - rank(b) || a.id.localeCompare(b.id));
  return capable[0] || null;
}

function summarizeAgent(agent) {
  return {
    id: agent.id,
    type: agent.type,
    status: agent.status,
    capabilities: agent.capabilities,
    claimedTasks: [...agent.claimedTasks],
    hasPlaybook: Boolean(agent.playbook),
  };
}

function summarizeTask(task) {
  return {
    id: task.id,
    strategy: task.strategy,
    phase: task.phase,
    capability: task.capability,
    priority: task.priority,
    status: task.status,
    attempts: task.attempts,
  };
}

function classifyChangeType(task) {
  if (task && task.phase === 'testing') return 'scraper';
  if (task && task.capability === 'verify_completion_gate') return 'agent';
  return 'trivial';
}

module.exports = { SwarmOrchestrator, KEYWORD_STRATEGY, PHASE_AGENT_TYPES };
