'use strict';
/**
 * scripts/swarm/config.js — Frozen swarm orchestration configuration.
 *
 * Strategies describe multi-phase work plans tuned to property-crawl's domain
 * (source canaries, scraper engineering, evidence gates, release verification).
 * Agent types declare which capability-graph nodes they may execute.
 * Coordination modes describe how coordinators fan out work.
 */

const deepFreeze = (obj) => {
  Object.freeze(obj);
  for (const value of Object.values(obj)) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
      deepFreeze(value);
    }
  }
  return obj;
};

const strategies = {
  auto: {
    description: 'Keyword-routed strategy; picks the best match at run time.',
    defaultAgents: ['coordinator'],
    defaultMaxAgents: 5,
    phases: ['route', 'execute', 'verify'],
  },
  development: {
    description: 'Build or repair scrapers, collectors, and listing pipelines.',
    defaultAgents: ['coordinator', 'specialist', 'developer', 'tester'],
    defaultMaxAgents: 5,
    phases: ['plan', 'implement', 'integrate', 'verify'],
  },
  research: {
    description: 'Investigate sources, audit networks, and synthesize findings with citations.',
    defaultAgents: ['coordinator', 'researcher', 'analyzer', 'documenter'],
    defaultMaxAgents: 4,
    phases: ['explore', 'collect', 'synthesize', 'report'],
  },
  analysis: {
    description: 'Measure coverage, score opportunities, and interpret source health.',
    defaultAgents: ['coordinator', 'analyzer', 'researcher', 'documenter'],
    defaultMaxAgents: 4,
    phases: ['gather', 'compute', 'interpret', 'report'],
  },
  testing: {
    description: 'Plan and run proportional verification through the evidence gate.',
    defaultAgents: ['coordinator', 'tester', 'reviewer'],
    defaultMaxAgents: 4,
    phases: ['plan', 'execute', 'gate', 'report'],
  },
  optimization: {
    description: 'Profile scrapers and workers, then redesign hot paths with a benchmark delta.',
    defaultAgents: ['coordinator', 'analyzer', 'developer', 'tester'],
    defaultMaxAgents: 4,
    phases: ['profile', 'redesign', 'implement', 'benchmark'],
  },
  maintenance: {
    description: 'Triage failures, patch, verify, and document the repair.',
    defaultAgents: ['coordinator', 'developer', 'tester', 'documenter'],
    defaultMaxAgents: 4,
    phases: ['triage', 'fix', 'verify', 'document'],
  },
  canary: {
    description: 'Run source canaries in parallel',
    defaultAgents: ['coordinator', 'specialist', 'tester'],
    defaultMaxAgents: 6,
    phases: ['plan', 'execute', 'gate', 'report'],
  },
};

// Capability names align with scripts/capability-graph.js createDefaultGraph().
const agentTypes = {
  coordinator: {
    description: 'Plans phases, assigns work, and owns the run report.',
    capabilities: [
      'scrape_auctions',
      'normalize_listings',
      'compute_deal_score',
      'enrich_public_records',
      'evaluate_opportunity_signals',
      'generate_property_dossier',
      'evaluate_saved_hunts',
      'verify_completion_gate',
    ],
    permissions: { read: 'allow', bash: 'allow', edit: 'scripts/**' },
    maxConcurrency: 1,
  },
  developer: {
    description: 'Implements scraper, server, and pipeline changes under the listing contract.',
    capabilities: ['scrape_auctions', 'normalize_listings', 'evaluate_saved_hunts'],
    permissions: { read: 'allow', bash: 'allow', edit: 'server/scrapers/**,scripts/**' },
    maxConcurrency: 2,
  },
  researcher: {
    description: 'Audits source networks and collects bounded evidence on property sources.',
    capabilities: ['scrape_auctions', 'evaluate_opportunity_signals'],
    permissions: { read: 'allow', bash: 'allow', edit: 'memory/**' },
    maxConcurrency: 3,
  },
  analyzer: {
    description: 'Computes enrichment, deal scores, and coverage metrics.',
    capabilities: ['enrich_public_records', 'compute_deal_score', 'evaluate_opportunity_signals'],
    permissions: { read: 'allow', bash: 'allow', edit: 'none' },
    maxConcurrency: 3,
  },
  tester: {
    description: 'Runs the proportional verify-gate and refuses uncertified completion.',
    capabilities: ['verify_completion_gate'],
    permissions: { read: 'allow', bash: 'allow', edit: 'none' },
    maxConcurrency: 2,
  },
  reviewer: {
    description: 'Reviews changes along Standards and Spec axes with file:line citations.',
    capabilities: ['verify_completion_gate'],
    permissions: { read: 'allow', bash: 'allow', edit: 'none' },
    maxConcurrency: 2,
  },
  documenter: {
    description: 'Writes human-readable reports and episode snapshots with citations.',
    capabilities: ['generate_property_dossier'],
    permissions: { read: 'allow', bash: 'deny', edit: 'memory/**,docs/**' },
    maxConcurrency: 2,
  },
  monitor: {
    description: 'Watches queue stats, lease health, and source canaries.',
    capabilities: ['verify_completion_gate'],
    permissions: { read: 'allow', bash: 'allow', edit: 'none' },
    maxConcurrency: 1,
  },
  specialist: {
    description: 'Domain expert for government/auction/REO scrapers (HUD, IRS, Treasury, GSA, USDA).',
    capabilities: [
      'scrape_auctions',
      'normalize_listings',
      'evaluate_opportunity_signals',
      'generate_property_dossier',
    ],
    permissions: { read: 'allow', bash: 'allow', edit: 'server/scrapers/**,scripts/**' },
    maxConcurrency: 2,
  },
};

const coordinationModes = {
  centralized: {
    description: 'Single coordinator claims and dispatches every task (default).',
    coordinators: 1,
  },
  distributed: {
    description: 'Peer agents claim from a shared queue; no single dispatcher.',
    coordinators: 0,
  },
  hierarchical: {
    description: 'One lead coordinator with per-phase sub-coordinators.',
    coordinators: 2,
  },
  mesh: {
    description: 'Fully connected agents; any agent may claim any capability it holds.',
    coordinators: 0,
  },
  hybrid: {
    description: 'Central coordinator for planning plus distributed claim for execution.',
    coordinators: 1,
  },
};

const defaults = {
  maxAgents: 5,
  timeoutMinutes: 60,
  mode: 'centralized',
  parallel: true,
  review: false,
  testing: true,
};

module.exports = deepFreeze({
  strategies,
  agentTypes,
  coordinationModes,
  defaults,
});
