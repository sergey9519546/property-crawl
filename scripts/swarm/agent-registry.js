'use strict';
/**
 * scripts/swarm/agent-registry.js — Agent type loading and instance registry.
 *
 * Loads typed agent definitions from scripts/swarm/config.js and attaches
 * role-playbook markdown from .kilo/agent/*.md onto the matching agent types
 * (scraper-engineer → specialist, reviewer → reviewer, qa-engineer → tester).
 */

const fs = require('fs');
const path = require('path');
const config = require('./config');

const ROOT = path.resolve(__dirname, '..', '..');
const AGENT_DIR = path.join(ROOT, '.kilo', 'agent');

const PLAYBOOK_MAP = {
  'coordinator.md': 'coordinator',
  'developer.md': 'developer',
  'researcher.md': 'researcher',
  'analyzer.md': 'analyzer',
  'documenter.md': 'documenter',
  'monitor.md': 'monitor',
  'specialist.md': 'specialist',
  'scraper-engineer.md': 'specialist',
  'reviewer.md': 'reviewer',
  'qa-engineer.md': 'tester',
};

function loadPlaybooks() {
  const byType = {};
  try {
    for (const file of fs.readdirSync(AGENT_DIR)) {
      const mapped = PLAYBOOK_MAP[file];
      if (!mapped) continue;
      const full = path.join(AGENT_DIR, file);
      try {
        byType[mapped] = fs.readFileSync(full, 'utf8');
      } catch (_) {}
    }
  } catch (_) {}
  return byType;
}

class AgentRegistry {
  /**
   * @param {object} [opts]
   * @param {number} [opts.maxAgents] override config.defaults.maxAgents
   */
  constructor(opts = {}) {
    this.maxAgents = opts.maxAgents != null ? opts.maxAgents : config.defaults.maxAgents;
    this.playbooks = loadPlaybooks();
    this.agents = new Map();
    this._seq = 0;
  }

  /** @returns {object[]} frozen agent-type descriptors with playbook attached */
  types() {
    return Object.entries(config.agentTypes).map(([name, def]) => ({
      name,
      description: def.description,
      capabilities: [...def.capabilities],
      permissions: { ...def.permissions },
      maxConcurrency: def.maxConcurrency,
      playbook: this.playbooks[name] || null,
    }));
  }

  /**
   * Create an agent instance of the given type.
   * @param {string} type key in config.agentTypes
   * @param {string} [id] optional stable id
   */
  createAgent(type, id) {
    if (!config.agentTypes[type]) {
      throw new Error(`Unknown agent type "${type}"`);
    }
    if (this.agents.size >= this.maxAgents) {
      throw new Error(`Agent registry at capacity (${this.maxAgents})`);
    }
    this._seq += 1;
    const agentId = id || `${type}-${this._seq}`;
    if (this.agents.has(agentId)) {
      throw new Error(`Agent id "${agentId}" already exists`);
    }
    const def = config.agentTypes[type];
    const agent = {
      id: agentId,
      type,
      status: 'idle',
      claimedTasks: [],
      startedAt: new Date().toISOString(),
      playbook: this.playbooks[type] || null,
      capabilities: [...def.capabilities],
      maxConcurrency: def.maxConcurrency,
    };
    this.agents.set(agentId, agent);
    return agent;
  }

  listAgents() {
    return Array.from(this.agents.values());
  }

  getAgent(id) {
    return this.agents.get(id) || null;
  }

  /** Mark an agent idle and drop its claimed-task bookkeeping. */
  releaseAgent(id) {
    const agent = this.agents.get(id);
    if (!agent) return false;
    agent.status = 'idle';
    agent.claimedTasks = [];
    return true;
  }

  count() {
    return this.agents.size;
  }

  capacity() {
    return Math.max(0, this.maxAgents - this.agents.size);
  }
}

module.exports = { AgentRegistry, loadPlaybooks, PLAYBOOK_MAP, AGENT_DIR };
