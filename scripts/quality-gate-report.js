'use strict';

/**
 * Quality-gate report — runs the non-PostgreSQL suites and classifies
 * environment-dependent failures honestly.
 */

const { execFileSync } = require('node:child_process');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

const SUITES = [
  { id: 'unit-core', cmd: [process.execPath, ['--test', 'test/suite.test.js']], envRequired: false },
  { id: 'listing-intelligence', cmd: [process.execPath, ['--test', 'test/listing-intelligence.test.js', 'test/listing-intelligence-view.test.js', 'test/scraper-upgrade.test.js', 'test/market-enrollment.test.js', 'test/nationwide-coverage.test.js']], envRequired: false },
  { id: 'terminal-filters', cmd: [process.execPath, ['--test', 'test/terminal-filter-store.test.mjs', 'test/score-bands.test.mjs', 'test/hunt-ranking.test.js']], envRequired: false },
  { id: 'context', cmd: [process.execPath, ['scripts/gen-context.js', '--check']], envRequired: false },
  { id: 'scrapers', cmd: [process.execPath, ['test/scrapers.test.js']], envRequired: false },
  { id: 'scrapling+upgrade', cmd: [process.execPath, ['--test', 'test/scrapling-bridge.test.js', 'test/scraper-upgrade.test.js']], envRequired: false },
  { id: 'canary+power', cmd: [process.execPath, ['--test', 'test/canary-live.test.js', 'test/scraper-power-report.test.js', 'test/promotion-gate-contract.test.js']], envRequired: false },
  { id: 'forms+boot', cmd: [process.execPath, ['--test', 'test/form-submissions.test.js', 'test/production-boot.test.js', 'test/production-env.test.js', 'test/production-proxy-timeout.test.js', 'test/property-api-proxy-inventory.test.js', 'test/document-review-persistence.test.js', 'test/document-review-route.test.js', 'test/document-review-transitions.test.js', 'test/document-review-persist-failure.test.js', 'test/document-review-store-lock.test.js', 'test/document-review-pg-store.test.js', 'test/document-review-queue-ui.test.js', 'test/source-network-approval-ui.test.js', 'test/property-intelligence-auth.test.js', 'test/fetch-strategy-ssrf.test.js', 'test/cors-policy.test.js', 'test/workspace-mutation-gate.test.js', 'test/hardening.test.js', 'test/source-catalog.test.js']], envRequired: false },
  { id: 'db-contract', cmd: [process.execPath, ['--test', 'test/db.test.js']], envRequired: false },
  { id: 'db-pg', cmd: [process.execPath, ['test/db.test.js']], envRequired: 'DATABASE_URL' },
  { id: 'sources', cmd: [process.execPath, ['--test', 'test/source-catalog.test.js', 'test/source-intake.test.js', 'test/source-intake-aliases.test.js', 'test/source-network.test.js', 'test/source-network-http.test.js', 'test/source-observations.test.js', 'test/source-collector-coverage.test.js', 'test/live-cache-refresh.test.js', 'test/federal-register-source.test.js', 'test/servicelink.test.js', 'test/listing-identifiers.test.js', 'test/email-ingest.test.js']], envRequired: false },
  { id: 'email-ingest', cmd: [process.execPath, ['--test', 'test/email-ingest.test.js']], envRequired: false },
  { id: 'swarm', cmd: [process.execPath, ['--test', 'test/swarm.test.js', 'test/swarm-executor.test.js']], envRequired: false },
  { id: 'discovery-backend', cmd: [process.execPath, ['--test', 'test/discovery-backend.test.js', 'test/discovery-acceptance.test.js', 'test/discovery-acceptance-store.test.js']], envRequired: 'DISCOVERY_TEST_DATABASE_URL' },
  { id: 'discovery-ops', cmd: [process.execPath, ['--test', 'test/discovery-worker.test.js', 'test/discovery-worker-scope.test.js', 'test/discovery-promotion-evidence.test.js']], envRequired: 'DISCOVERY_TEST_DATABASE_URL' },
];

/**
 * True when a suite's own output shows that tests actually failed.
 *
 * Kept separate and pure so the classification can be tested directly, without
 * spawning a three-minute gate.
 */
function reportedTestFailure(raw) {
  return /^\s*(?:ℹ|info)\s+fail\s+[1-9]\d*\s*$/im.test(raw)
    || /^\s*not ok\b/im.test(raw)
    || /^\s*✖\s*failing tests:/im.test(raw);
}

/**
 * Decide a failing suite's status.
 *
 * Decide from what the suite REPORTED, not from whether its env var is set.
 *
 * The old rule asked the environment: `envRequired && !process.env[...]`. In
 * CI, where DATABASE_URL and DISCOVERY_TEST_DATABASE_URL are never set, that
 * rule relabelled every failure in the three env-gated suites -- a genuinely
 * broken assertion in discovery-worker.test.js included -- as skip_env, counted
 * it into `skip`, left `fail` at 0, and exited 0. The reason string was
 * computed and printed and nothing acted on it.
 *
 * A suite that cannot run its env-gated tests skips them and exits 0 (verified:
 * discovery-ops reports "fail 0, skipped 1"; db.test.js prints "DATABASE_URL not
 * set - skipping" and exits clean). So reaching this function at all already
 * means something went wrong, and that is true regardless of which env vars are
 * present. The env test is kept only as the fallback for a suite that dies
 * before producing a recognisable summary.
 */
function classifySuiteFailure(raw, envRequired, envPresent) {
  if (reportedTestFailure(raw)) return 'fail';
  return envRequired && !envPresent ? 'skip_env' : 'fail';
}

function runSuite(suite) {
  const [cmd, args] = suite.cmd;
  const started = Date.now();
  const env = { ...process.env };
  // db-contract suite uses an isolated in-memory DatabaseClient for fixtures;
  // strip ambient Postgres URLs so CI quality-gate cannot force live PG inserts.
  if (suite.id === 'db-contract') {
    delete env.DATABASE_URL;
    delete env.DISCOVERY_MODE;
  }
  try {
    execFileSync(cmd, args, {
      cwd: ROOT,
      stdio: 'pipe',
      env,
      timeout: 180000,
    });
    return { id: suite.id, status: 'pass', durationMs: Date.now() - started, envRequired: suite.envRequired };
  } catch (err) {
    const raw = [err.stdout, err.stderr].filter(Boolean).map((value) => String(value)).join('\n');
    const status = classifySuiteFailure(raw, suite.envRequired, process.env[suite.envRequired]);
    const output = raw
      .split(/\r?\n/)
      .filter((line) => /not ok|✖|Error|fail|assert|FAIL|SKIP/i.test(line))
      .slice(-12)
      .join(' | ');
    return {
      id: suite.id,
      status,
      durationMs: Date.now() - started,
      envRequired: suite.envRequired,
      reason: status === 'skip_env'
        ? `missing ${suite.envRequired}`
        : [String(err.message || err).slice(0, 160), output].filter(Boolean).join(' :: ').slice(0, 500),
    };
  }
}

function main() {
  const results = [];
  console.log('=== Quality gate report ===');
  console.log(`DATABASE_URL=${process.env.DATABASE_URL ? 'set' : 'unset'}`);
  console.log(`DISCOVERY_TEST_DATABASE_URL=${process.env.DISCOVERY_TEST_DATABASE_URL ? 'set' : 'unset'}`);
  for (const suite of SUITES) {
    process.stdout.write(`Running ${suite.id}... `);
    const result = runSuite(suite);
    results.push(result);
    console.log(result.status.toUpperCase());
  }
  const pass = results.filter((r) => r.status === 'pass').length;
  const fail = results.filter((r) => r.status === 'fail').length;
  const skip = results.filter((r) => r.status === 'skip_env').length;
  console.log('---');
  console.log(`RESULT pass=${pass} fail=${fail} skip_env=${skip} total=${results.length}`);
  for (const r of results.filter((x) => x.status !== 'pass')) {
    console.log(`  [${r.status}] ${r.id}: ${r.reason || r.envRequired}`);
  }
  if (fail > 0) {
    process.exitCode = 1;
    console.error('QUALITY GATE FAILED (code failures present)');
  } else {
    console.log('QUALITY GATE OK for non-PostgreSQL suites' + (skip ? ` (${skip} env-gated skipped)` : ''));
  }
}

if (require.main === module) main();
module.exports = { SUITES, runSuite, classifySuiteFailure, reportedTestFailure };
