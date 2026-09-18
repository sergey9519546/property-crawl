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
  { id: 'context', cmd: [process.execPath, ['scripts/gen-context.js', '--check']], envRequired: false },
  { id: 'scrapers', cmd: [process.execPath, ['test/scrapers.test.js']], envRequired: false },
  { id: 'scrapling+upgrade', cmd: [process.execPath, ['--test', 'test/scrapling-bridge.test.js', 'test/scraper-upgrade.test.js']], envRequired: false },
  { id: 'canary+power', cmd: [process.execPath, ['--test', 'test/canary-live.test.js', 'test/scraper-power-report.test.js', 'test/promotion-gate-contract.test.js']], envRequired: false },
  { id: 'forms+boot', cmd: [process.execPath, ['--test', 'test/form-submissions.test.js', 'test/production-boot.test.js']], envRequired: false },
  { id: 'sources', cmd: [process.execPath, ['--test', 'test/source-catalog.test.js', 'test/source-intake.test.js', 'test/source-intake-aliases.test.js', 'test/source-network.test.js', 'test/source-network-http.test.js', 'test/source-observations.test.js', 'test/source-collector-coverage.test.js', 'test/live-cache-refresh.test.js', 'test/federal-register-source.test.js', 'test/servicelink.test.js', 'test/listing-identifiers.test.js', 'test/email-ingest.test.js']], envRequired: false },
  { id: 'email-ingest', cmd: [process.execPath, ['--test', 'test/email-ingest.test.js']], envRequired: false },
  { id: 'swarm', cmd: [process.execPath, ['--test', 'test/swarm.test.js', 'test/swarm-executor.test.js']], envRequired: false },
  { id: 'discovery-backend', cmd: [process.execPath, ['--test', 'test/discovery-backend.test.js', 'test/discovery-acceptance.test.js', 'test/discovery-acceptance-store.test.js']], envRequired: 'DISCOVERY_TEST_DATABASE_URL' },
  { id: 'discovery-ops', cmd: [process.execPath, ['--test', 'test/discovery-worker.test.js', 'test/discovery-worker-scope.test.js', 'test/discovery-promotion-evidence.test.js']], envRequired: 'DISCOVERY_TEST_DATABASE_URL' },
];

function runSuite(suite) {
  const [cmd, args] = suite.cmd;
  const started = Date.now();
  try {
    execFileSync(cmd, args, {
      cwd: ROOT,
      stdio: 'pipe',
      env: process.env,
      timeout: 180000,
    });
    return { id: suite.id, status: 'pass', durationMs: Date.now() - started, envRequired: suite.envRequired };
  } catch (err) {
    const envMissing = Boolean(suite.envRequired) && !process.env[suite.envRequired];
    return {
      id: suite.id,
      status: envMissing ? 'skip_env' : 'fail',
      durationMs: Date.now() - started,
      envRequired: suite.envRequired,
      reason: envMissing ? `missing ${suite.envRequired}` : String(err.message || err).slice(0, 300),
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
module.exports = { SUITES, runSuite };
