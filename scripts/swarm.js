'use strict';
/**
 * scripts/swarm.js — CLI entry for the project-native swarm orchestrator.
 *
 * Usage:
 *   node scripts/swarm.js "<objective>" [--strategy=development] [--mode=centralized]
 *     [--max-agents=5] [--timeout=60] [--parallel] [--review] [--testing]
 *     [--dry-run] [--verbose] [--monitor]
 *   node scripts/swarm.js status
 *   node scripts/swarm.js agents
 *   node scripts/swarm.js memory query <terms> [--namespace=...]
 */

const fs = require('fs');
const path = require('path');
const { SwarmOrchestrator } = require('./swarm/orchestrator');
const { MemoryStore } = require('./swarm/memory-store');
const { AgentRegistry } = require('./swarm/agent-registry');
const { TaskQueue } = require('./swarm/task-queue');
const config = require('./swarm/config');

const ROOT = path.resolve(__dirname, '..');
const LAST_RUN_PATH = path.join(ROOT, '.cache', 'swarm-last-run.json');
const QUEUE_PATH = path.join(ROOT, '.cache', 'swarm-tasks.json');

function parseArgs(argv) {
  const flags = {
    dryRun: false,
    verbose: false,
    monitor: false,
    parallel: false,
    review: false,
    testing: false,
    real: false,
  };
  const opts = {};
  const positional = [];
  for (const arg of argv) {
    if (arg === '--dry-run') flags.dryRun = true;
    else if (arg === '--verbose') flags.verbose = true;
    else if (arg === '--monitor') flags.monitor = true;
    else if (arg === '--parallel') flags.parallel = true;
    else if (arg === '--review') flags.review = true;
    else if (arg === '--testing') flags.testing = true;
    else if (arg === '--real') flags.real = true;
    else if (arg.startsWith('--strategy=')) opts.strategy = arg.slice('--strategy='.length);
    else if (arg.startsWith('--mode=')) opts.mode = arg.slice('--mode='.length);
    else if (arg.startsWith('--max-agents=')) opts.maxAgents = Number(arg.slice('--max-agents='.length));
    else if (arg.startsWith('--timeout=')) {
      const t = Number(arg.slice('--timeout='.length));
      opts.timeoutMinutes = Number.isFinite(t) && t > 0 ? t : undefined;
    }
    else if (arg.startsWith('--namespace=')) opts.namespace = arg.slice('--namespace='.length);
    else if (arg.startsWith('--')) {
      // ignore unknown flags rather than crashing
    } else positional.push(arg);
  }
  return { flags, opts, positional };
}

function usage() {
  console.log(`Usage:
  node scripts/swarm.js "<objective>" [options]
  node scripts/swarm.js status
  node scripts/swarm.js agents
  node scripts/swarm.js memory query <terms> [--namespace=ns]

Options:
  --strategy=<name>   auto|development|research|analysis|testing|optimization|maintenance|canary
  --mode=<name>       centralized|distributed|hierarchical|mesh|hybrid
  --max-agents=<n>    default ${config.defaults.maxAgents}
  --timeout=<min>     default ${config.defaults.timeoutMinutes} (minimum 1)
  --parallel          enable parallel phase execution
  --review            append a review phase
  --testing           append a testing phase (default on via config)
  --real              execute allowlisted commands (default is simulated)
  --dry-run           print the plan as JSON and exit
  --verbose           log every orchestrator event
  --monitor           poll queue stats every 500ms until the run completes`);
}

function cmdStatus() {
  let last = null;
  if (fs.existsSync(LAST_RUN_PATH)) {
    try {
      last = JSON.parse(fs.readFileSync(LAST_RUN_PATH, 'utf8'));
    } catch (_) {}
  }
  if (!last) {
    console.log('No previous swarm run found (.cache/swarm-last-run.json).');
  } else {
    console.log('Last run:');
    console.log(`  runId:      ${last.runId}`);
    console.log(`  strategy:   ${last.strategy}`);
    console.log(`  mode:       ${last.mode}`);
    console.log(`  objective:  ${last.objective}`);
    console.log(`  dryRun:     ${Boolean(last.dryRun)}`);
    console.log(`  durationMs: ${last.durationMs}`);
    console.log(`  results:    ${(last.results || []).length}`);
    console.log(`  queueStats: ${JSON.stringify(last.queueStats || {})}`);
  }
  const queue = new TaskQueue({ persistPath: QUEUE_PATH });
  console.log('Queue stats:', JSON.stringify(queue.stats()));
}

function cmdAgents() {
  const registry = new AgentRegistry({ maxAgents: config.defaults.maxAgents });
  console.log(`Agent types (${Object.keys(config.agentTypes).length}):`);
  for (const t of registry.types()) {
    const pb = t.playbook ? 'playbook:yes' : 'playbook:no';
    console.log(`  - ${t.name} [${pb}] caps=${t.capabilities.join(',')}`);
    console.log(`      ${t.description}`);
  }
  console.log(`Strategies (${Object.keys(config.strategies).length}):`);
  for (const [name, s] of Object.entries(config.strategies)) {
    console.log(`  - ${name}: ${s.description}`);
  }
}

function cmdMemoryQuery(terms, namespace) {
  const memory = new MemoryStore();
  const hits = memory.query(terms.join(' '), namespace);
  if (hits.length === 0) {
    console.log(`No memory hits for "${terms.join(' ')}".`);
    return;
  }
  console.log(`${hits.length} hit(s):`);
  for (const hit of hits) {
    const preview =
      typeof hit.value === 'string'
        ? hit.value.slice(0, 120)
        : JSON.stringify(hit.value).slice(0, 120);
    console.log(`  [${hit.score}] ${hit.namespace}/${hit.key}: ${preview}`);
  }
}

function printSummary(report) {
  console.log('=== SWARM RUN SUMMARY ===');
  console.log(`runId:      ${report.runId}`);
  console.log(`strategy:   ${report.strategy}`);
  console.log(`mode:       ${report.mode}`);
  console.log(`exec:       ${report.executionMode || 'simulated'}`);
  console.log(`objective:  ${report.objective}`);
  console.log(`dryRun:     ${Boolean(report.dryRun)}`);
  console.log(`durationMs: ${report.durationMs}`);
  console.log(`agents:     ${report.agents.map((a) => `${a.id}(${a.type})`).join(', ') || 'none'}`);
  console.log(`phases:     ${(report.phases || []).map((p) => p.name).join(' → ')}`);
  console.log(`tasks:      ${(report.tasks || []).length}`);
  console.log(`results:    ${(report.results || []).length}`);
  if (report.timedOut) console.log('TIMED OUT — remaining tasks aborted');
  if (report.queueStats) console.log(`queue:      ${JSON.stringify(report.queueStats)}`);
  if (report.episodePath) console.log(`episode:    ${report.episodePath}`);
  const ok = (report.results || []).filter((r) => r.ok).length;
  const failed = (report.results || []).filter((r) => !r.ok).length;
  console.log(`outcomes:   ${ok} ok, ${failed} failed`);
  console.log('=========================');
}

async function cmdRun(objective, flags, opts) {
  const overrides = {};
  if (opts.strategy) overrides.strategy = opts.strategy;
  if (opts.mode) overrides.mode = opts.mode;
  if (Number.isFinite(opts.maxAgents)) overrides.maxAgents = opts.maxAgents;
  if (Number.isFinite(opts.timeoutMinutes)) overrides.timeoutMinutes = opts.timeoutMinutes;
  if (flags.parallel) overrides.parallel = true;
  if (flags.review) overrides.review = true;
  if (flags.testing) overrides.testing = true;
  overrides.dryRun = flags.dryRun;
  overrides.executionMode = flags.real ? 'real' : 'simulated';

  const orchestrator = new SwarmOrchestrator(overrides);

  if (flags.verbose) {
    for (const ev of ['phase:start', 'phase:end', 'task:claimed', 'task:done', 'task:failed', 'agent:idle', 'run:complete']) {
      orchestrator.on(ev, (payload) => {
        console.error(`[swarm] ${ev} ${JSON.stringify(payload)}`);
      });
    }
  }

  let monitorTimer = null;
  if (flags.monitor) {
    const queue = orchestrator.queue;
    monitorTimer = setInterval(() => {
      const s = queue.stats();
      console.error(
        `[monitor] queued=${s.queued} claimed=${s.claimed} done=${s.done} failed=${s.failed} dead=${s.deadLetter}`
      );
    }, 500);
  }

  try {
    const report = await orchestrator.run(objective);
    if (flags.dryRun) {
      console.log(JSON.stringify(report, null, 2));
      return 0;
    }
    fs.mkdirSync(path.dirname(LAST_RUN_PATH), { recursive: true });
    fs.writeFileSync(LAST_RUN_PATH, JSON.stringify(report, null, 2), 'utf8');
    printSummary(report);
    if (report.timedOut) return 1;
    return 0;
  } finally {
    if (monitorTimer) clearInterval(monitorTimer);
  }
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
    usage();
    return argv.length === 0 ? 1 : 0;
  }

  const { flags, opts, positional } = parseArgs(argv);
  const cmd = positional[0];

  if (cmd === 'status') {
    cmdStatus();
    return 0;
  }
  if (cmd === 'agents') {
    cmdAgents();
    return 0;
  }
  if (cmd === 'memory') {
    const sub = positional[1];
    if (sub === 'query') {
      const terms = positional.slice(2);
      if (terms.length === 0) {
        console.error('memory query requires search terms');
        return 1;
      }
      cmdMemoryQuery(terms, opts.namespace);
      return 0;
    }
    console.error(`Unknown memory subcommand "${sub}"`);
    return 1;
  }

  // Treat the whole positional join as the objective.
  const objective = positional.join(' ').trim();
  if (!objective) {
    usage();
    return 1;
  }
  return cmdRun(objective, flags, opts);
}

if (require.main === module) {
  main()
    .then((code) => process.exit(code || 0))
    .catch((err) => {
      console.error(err && err.stack ? err.stack : String(err));
      process.exit(1);
    });
}

module.exports = { main, parseArgs };
