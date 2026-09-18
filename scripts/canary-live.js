'use strict';

/**
 * Live canary runner for promoted / wave candidate sources.
 *
 * Wraps scripts/discovery-worker.js Migration 014 promotion gates:
 *   - two distinct clean durable canary runs
 *   - matching configured acquisition scope
 *   - accepted records, rejected=0, no errors, complete + fullSweep
 *
 * Requires PostgreSQL + DISCOVERY_MODE=advanced for live runs.
 * Without DATABASE_URL the CLI prints a dry-run plan and exits 0.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const WAVE_CANDIDATES = Object.freeze({
  wave1: Object.freeze(['servicelink', 'treasury', 'irs', 'usda', 'gsa', 'hud']),
  wave2: Object.freeze(['landbank', 'civilview', 'bid4assets']),
});

const REPORT_DIR = path.resolve(process.cwd(), '.cache/canary-reports');

/** Clean canary = Migration 014 gate-clean + store rejected_count=0. */
function evaluateCanaryClean(sourceResult) {
  if (!sourceResult) {
    return { clean: false, code: 'MISSING_SOURCE_RESULT', reasons: ['no sourceResult for canary source'] };
  }
  const report = sourceResult.report || {};
  const scope = report.scope;
  const reasons = [];
  if (!scope || !Object.keys(scope).length) reasons.push('missing acquisition scope');
  if (sourceResult.error) reasons.push(`source error: ${sourceResult.error}`);
  if (sourceResult.observationError) reasons.push(`observation error: ${sourceResult.observationError}`);
  const accepted = Number(sourceResult.accepted) || 0;
  if (accepted <= 0) reasons.push('accepted records must be > 0');
  const rejected = sourceResult.rejected;
  if (rejected !== undefined && rejected !== null && Number(rejected) !== 0) {
    reasons.push(`rejected records must be 0 (got ${rejected})`);
  }
  if (report.recordsRejected != null && Number(report.recordsRejected) !== 0) {
    reasons.push(`report.recordsRejected must be 0 (got ${report.recordsRejected})`);
  }
  if (report.complete !== true) reasons.push('report.complete must be true');
  if (report.fullSweepComplete !== true) reasons.push('report.fullSweepComplete must be true');
  if (report.truncated === true) reasons.push('report.truncated must be false');
  if (report.fixtureFallbackUsed === true) reasons.push('fixture inventory is not a clean canary');
  return {
    clean: reasons.length === 0,
    code: reasons.length === 0 ? 'CLEAN' : 'NOT_CLEAN',
    reasons,
    accepted,
    rejected: rejected == null ? null : Number(rejected),
    scope: scope || null,
    runId: sourceResult.runId || null,
  };
}

function extractSourceResult(runOutput, sourceKey) {
  if (!runOutput || typeof runOutput !== 'object') return null;
  const candidates = [
    runOutput.result?.sourceResults,
    runOutput.sourceResults,
    runOutput.result?.results,
    runOutput.results,
  ];
  for (const list of candidates) {
    if (!Array.isArray(list)) continue;
    const hit = list.find((row) => row && (row.sourceId === sourceKey || row.source === sourceKey || row.sourceKey === sourceKey));
    if (hit) return hit;
  }
  return null;
}

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      positional.push(token);
      continue;
    }
    const eq = token.indexOf('=');
    if (eq > 0) {
      flags[token.slice(2, eq)] = token.slice(eq + 1);
      continue;
    }
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      flags[key] = true;
    } else {
      flags[key] = next;
      i += 1;
    }
  }
  return { command: positional[0] || 'help', positional: positional.slice(1), flags };
}

function parseSourceList(raw) {
  return String(raw || '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

function resolveTargets({ flags, promoted = [] }) {
  if (flags['all-promoted'] === true) {
    return { mode: 'all-promoted', sources: [...promoted] };
  }
  if (flags.sources) {
    return { mode: 'explicit', sources: parseSourceList(flags.sources) };
  }
  if (flags.source) {
    return { mode: 'explicit', sources: [String(flags.source).trim().toLowerCase()] };
  }
  if (flags.wave) {
    const wave = String(flags.wave);
    if (!WAVE_CANDIDATES[wave]) {
      throw new Error(`Unknown wave "${wave}". Use wave1 or wave2.`);
    }
    return { mode: `wave:${wave}`, sources: [...WAVE_CANDIDATES[wave]] };
  }
  return { mode: 'default-promoted', sources: [...promoted] };
}

function scraplingHint(sourceKey) {
  const scraplingReady = ['gsa', 'hud', 'treasury', 'irs', 'usda', 'civilview', 'ca-controller-tax-sale'];
  if (!scraplingReady.includes(sourceKey)) return null;
  return `Optional structural parser: SCRAPLING_SOURCES=${sourceKey} (native parse remains default)`;
}

function dryRunPlan(targets, { repeat = 1 } = {}) {
  const lines = [];
  lines.push('Dry-run only — DATABASE_URL / DISCOVERY_MODE=advanced not configured.');
  lines.push('Live canaries require PostgreSQL discovery store (Migration 014).');
  lines.push('');
  if (!targets.sources.length) {
    lines.push('No target sources resolved. Promote sources or pass --sources / --wave.');
  }
  for (const source of targets.sources) {
    for (let i = 1; i <= repeat; i += 1) {
      lines.push(`npm run discovery:worker -- --canary ${source}`);
      if (i < repeat) lines.push(`  # distinct clean run ${i + 1}/${repeat} for the same scope`);
    }
    lines.push(`# after two clean runs: npm run discovery:worker -- --promote ${source}`);
    const hint = scraplingHint(source);
    if (hint) lines.push(`# ${hint}`);
    lines.push('');
  }
  lines.push('Wave candidates:');
  for (const [wave, sources] of Object.entries(WAVE_CANDIDATES)) {
    lines.push(`  ${wave}: ${sources.join(', ')}`);
  }
  return lines;
}

function writeReport(payload) {
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const id = crypto.randomBytes(4).toString('hex');
  const file = path.join(REPORT_DIR, `canary-${stamp}-${id}.json`);
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return file;
}

function hasLiveDatabase(env = process.env) {
  return Boolean(env.DATABASE_URL) && env.DISCOVERY_MODE === 'advanced';
}

function formatRolloutRow(row) {
  const approved = row.approved ? 'promoted' : row.state;
  return [
    String(row.sourceKey).padEnd(20),
    String(approved).padEnd(12),
    `clean=${String(row.cleanRuns).padStart(2)}`,
    `qualified=${row.evidenceQualified ? 'yes' : 'no'}`,
    row.scopeHash ? `scope=${String(row.scopeHash).slice(0, 12)}…` : 'scope=—',
  ].join('  ');
}

async function loadDiscoveryStack() {
  const db = require('../server/db/client');
  const { createDiscoveryStore } = require('../server/discovery/store');
  const worker = require('./discovery-worker');
  const scheduler = require('../server/scrapers/scheduler');
  const { refreshScraplingFlags } = require('../server/scrapers/scrapling-bridge');
  const store = createDiscoveryStore(db);
  return { db, store, worker, scheduler, refreshScraplingFlags };
}

async function cmdList() {
  if (!hasLiveDatabase()) {
    console.log(dryRunPlan({ mode: 'wave1', sources: WAVE_CANDIDATES.wave1 }, { repeat: 2 }).join('\n'));
    console.log('');
    console.log('Cannot list promoted sources without DATABASE_URL + DISCOVERY_MODE=advanced.');
    return 0;
  }
  const { store, db } = await loadDiscoveryStack();
  const statuses = await store.sourceRolloutStatuses();
  if (!statuses.length) {
    console.log('No rollout rows yet. Run canaries to create discovery_source_rollouts state.');
    db.pool?.end?.();
    return 0;
  }
  console.log('Source rollouts (Migration 014 evidence gate):');
  for (const row of statuses) console.log(`  ${formatRolloutRow(row)}`);
  db.pool?.end?.();
  return 0;
}

async function cmdStatus(flags) {
  if (!hasLiveDatabase()) {
    console.log('status requires DATABASE_URL + DISCOVERY_MODE=advanced.');
    console.log(dryRunPlan({ mode: 'wave1', sources: flags.source ? [String(flags.source)] : WAVE_CANDIDATES.wave1 }, { repeat: 1 }).join('\n'));
    return 0;
  }
  const { store, db } = await loadDiscoveryStack();
  let statuses = await store.sourceRolloutStatuses();
  if (flags.source) {
    const key = String(flags.source).toLowerCase();
    statuses = statuses.filter((row) => row.sourceKey === key);
    if (!statuses.length) {
      console.log(`No rollout row for source "${key}".`);
      db.pool?.end?.();
      return 1;
    }
  }
  for (const row of statuses) {
    console.log(formatRolloutRow(row));
    if (flags.source && row.configuredScope) {
      console.log(`  configuredScope: ${JSON.stringify(row.configuredScope)}`);
      console.log(`  promotedAt: ${row.promotedAt || '—'}`);
    }
  }
  db.pool?.end?.();
  return 0;
}

async function cmdRun(flags) {
  const repeat = Math.max(1, Math.min(5, Number(flags.repeat) || 1));
  const strict = flags.strict !== false && flags.strict !== 'false';
  if (!hasLiveDatabase()) {
    const targets = resolveTargets({ flags, promoted: [] });
    if (!targets.sources.length && flags['all-promoted']) {
      targets.sources = [...WAVE_CANDIDATES.wave1];
      targets.mode = 'dry-run-wave1';
    }
    console.log(dryRunPlan(targets, { repeat }).join('\n'));
    console.log('');
    console.log('Live canary not executed. Set DATABASE_URL and DISCOVERY_MODE=advanced, then re-run.');
    return 0;
  }

  const prelim = resolveTargets({ flags, promoted: [] });
  if (flags.scrapling === true || flags['scrapling-sources']) {
    const scraplingList = flags['scrapling-sources']
      ? parseSourceList(flags['scrapling-sources'])
      : prelim.sources;
    process.env.SCRAPLING_SOURCES = scraplingList.join(',');
    console.log(`[canary] SCRAPLING_SOURCES=${process.env.SCRAPLING_SOURCES}`);
  }

  const { db, store, worker, scheduler, refreshScraplingFlags } = await loadDiscoveryStack();
  const refreshed = refreshScraplingFlags(scheduler.realScrapers || [], process.env);
  if (process.env.SCRAPLING_SOURCES) {
    console.log(`[canary] refreshScraplingFlags enabled ${refreshed} scrapers`);
  }

  let promoted = [];
  try {
    promoted = await store.promotedSources();
  } catch (error) {
    console.error(`Unable to read promoted sources: ${error.message}`);
  }
  const targets = resolveTargets({ flags, promoted });
  if (!targets.sources.length) {
    console.log('No target sources. Pass --sources, --wave wave1, or --all-promoted after promotion.');
    db.pool?.end?.();
    return 1;
  }

  const results = [];
  const runIdsBySource = new Map();
  for (const source of targets.sources) {
    for (let attempt = 1; attempt <= repeat; attempt += 1) {
      const startedAt = new Date().toISOString();
      let evaluation;
      let raw = null;
      let error = null;
      try {
        raw = await worker.run({ canarySource: source, database: db, collector: scheduler, discoveryStore: store });
        const sourceResult = extractSourceResult(raw, source);
        evaluation = evaluateCanaryClean(sourceResult);
        if (evaluation.clean && evaluation.runId) {
          if (!runIdsBySource.has(source)) runIdsBySource.set(source, new Set());
          runIdsBySource.get(source).add(String(evaluation.runId));
        }
      } catch (err) {
        error = String(err?.message || err);
        evaluation = { clean: false, code: 'RUN_FAILED', reasons: [error] };
      }
      results.push({
        source,
        attempt,
        startedAt,
        finishedAt: new Date().toISOString(),
        mode: targets.mode,
        evaluation,
        error,
        jobId: raw?.id || raw?.job?.id || null,
        scraplingEnabled: Boolean(process.env.SCRAPLING_SOURCES),
        hint: scraplingHint(source),
      });
      const mark = evaluation.clean ? 'CLEAN' : 'NOT_CLEAN';
      console.log(`[canary] ${source} attempt ${attempt}/${repeat}: ${mark}${evaluation.accepted != null ? ` accepted=${evaluation.accepted}` : ''}${evaluation.rejected != null ? ` rejected=${evaluation.rejected}` : ''}${error ? ` error=${error}` : ''}`);
      if (!evaluation.clean && evaluation.reasons?.length) {
        for (const reason of evaluation.reasons) console.log(`         - ${reason}`);
      }
    }
  }

  const reportPath = writeReport({
    kind: 'live-canary-batch',
    mode: targets.mode,
    repeat,
    strict,
    promoted,
    targets: targets.sources,
    scraplingSources: process.env.SCRAPLING_SOURCES || null,
    results,
    summary: {
      total: results.length,
      clean: results.filter((r) => r.evaluation?.clean).length,
      notClean: results.filter((r) => !r.evaluation?.clean).length,
    },
  });
  console.log(`[canary] report: ${path.relative(process.cwd(), reportPath)}`);

  const cleanBySource = new Map();
  for (const row of results) {
    if (!row.evaluation?.clean) continue;
    cleanBySource.set(row.source, (cleanBySource.get(row.source) || 0) + 1);
  }

  console.log('[canary] clean counts (need ≥2 distinct run IDs for promote):');
  for (const source of targets.sources) {
    const cleans = cleanBySource.get(source) || 0;
    const distinct = runIdsBySource.get(source)?.size || 0;
    const ready = cleans >= 2 && distinct >= 2;
    console.log(`  ${source}: clean=${cleans} distinctRunIds=${distinct}${ready ? '  → promote-ready' : ''}`);
    if (cleans >= 2 && distinct < 2) {
      console.log('         - warning: repeated runId(s); Migration 014 needs distinct durable runs');
    }
  }

  db.pool?.end?.();
  const anyNotClean = results.some((r) => !r.evaluation?.clean);
  if (strict && anyNotClean) {
    console.error('[canary] STRICT: one or more canaries were not clean.');
    return 1;
  }
  return results.every((r) => r.evaluation?.clean) ? 0 : 1;
}

async function cmdPromote(flags) {
  const source = String(flags.source || flags.positional?.[0] || '').trim().toLowerCase();
  if (!source) {
    console.error('promote requires --source <sourceKey>');
    return 2;
  }
  if (!hasLiveDatabase()) {
    console.log(`Dry-run promote: npm run discovery:worker -- --promote ${source}`);
    console.log('Requires two clean durable canaries with matching scope (Migration 014).');
    return 0;
  }
  const { db, store } = await loadDiscoveryStack();
  try {
    const row = await store.promoteSource(source);
    console.log(JSON.stringify(row, null, 2));
    db.pool?.end?.();
    return 0;
  } catch (error) {
    console.error(`Promote failed for ${source}: ${error.message}`);
    db.pool?.end?.();
    return 1;
  }
}

function help() {
  console.log(`Live canary script for promoted sources (Migration 014)

Commands:
  list                         Show rollout / promotion state
  status [--source KEY]        Show clean-run counts
  run --all-promoted           Canary every approved promoted source
  run --sources a,b            Canary explicit sources
  run --wave wave1             Canary wave candidates (promotion still required)
  run --repeat 2               Two sequential canaries (distinct runs)
  run --scrapling              Enable Scrapling for the canary batch
  run --strict false           Exit 0 even if some canaries are not clean
  promote --source KEY         Promote after two clean runs

Environment:
  DATABASE_URL                 PostgreSQL+PostGIS (required for live)
  DISCOVERY_MODE=advanced      Required for live canaries
  SCRAPLING_SOURCES            Optional structural parser allowlist

Clean criteria (gate-clean):
  sole source, accepted > 0, rejected = 0, no source/observation error,
  complete=true, fullSweepComplete=true, truncated=false,
  no fixture inventory, exact acquisition scope persisted.
`);
}

async function main(argv = process.argv.slice(2)) {
  const { command, flags, positional } = parseArgs(argv);
  flags.positional = positional;
  switch (command) {
    case 'list':
      return cmdList();
    case 'status':
      return cmdStatus(flags);
    case 'run':
      return cmdRun(flags);
    case 'promote':
      return cmdPromote(flags);
    case 'help':
    case '--help':
    case '-h':
      help();
      return 0;
    default:
      console.error(`Unknown command: ${command}`);
      help();
      return 2;
  }
}

if (require.main === module) {
  main()
    .then((code) => { process.exitCode = code || 0; })
    .catch((error) => {
      console.error(error.message || error);
      process.exitCode = 1;
    });
}

module.exports = {
  WAVE_CANDIDATES,
  REPORT_DIR,
  evaluateCanaryClean,
  extractSourceResult,
  parseArgs,
  parseSourceList,
  resolveTargets,
  dryRunPlan,
  hasLiveDatabase,
  writeReport,
  main,
};
