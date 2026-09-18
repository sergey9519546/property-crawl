'use strict';
/**
 * scripts/swarm/executor.js — Real vs simulated task execution for swarm runs.
 *
 * Simulated mode remains the default so unit tests and dry planning stay
 * side-effect free. Real mode only executes an explicit allowlist of
 * property-crawl verification/collection commands, each with a hard timeout.
 */

const { spawn } = require('child_process');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

/** Capability → allowlisted commands (relative to repo root). */
const ALLOWLIST = Object.freeze({
  verify_completion_gate: [
    { cmd: process.execPath, args: ['scripts/verify-gate.js', '--change-type=trivial', '--json'], label: 'verify-gate trivial' },
  ],
  normalize_listings: [
    { cmd: process.execPath, args: ['--test', 'test/context.test.js'], label: 'context drift gate' },
  ],
  evaluate_saved_hunts: [
    { cmd: process.execPath, args: ['--test', 'test/hunts.test.js'], label: 'hunts unit' },
  ],
  scrape_auctions: [
    { cmd: process.execPath, args: ['test/scrapers.test.js'], label: 'scraper suite (offline)' },
  ],
  generate_property_dossier: [
    { cmd: process.execPath, args: ['--test', 'test/property-intelligence.test.js'], label: 'property intelligence' },
  ],
  completion_certification: [
    { cmd: process.execPath, args: ['--test', 'test/canary-live.test.js', 'test/scraper-power-report.test.js'], label: 'canary + scraper-power contracts' },
  ],
  source_gate: [
    { cmd: process.execPath, args: ['scripts/canary-live.js', 'help'], label: 'canary-live help (dry, no DB)' },
  ],
  deal_score: [
    { cmd: process.execPath, args: ['--test', 'test/signals.test.js'], label: 'opportunity signals unit' },
  ],
});

const DEFAULT_TIMEOUT_MS = 60_000;

function resolveCommand(capability) {
  const list = ALLOWLIST[capability];
  if (!list || list.length === 0) return null;
  return list[0];
}

function runCommand(entry, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(entry.cmd, entry.args, {
      cwd: ROOT,
      env: { ...process.env, NODE_ENV: process.env.NODE_ENV || 'test', RUN_REAL_SCRAPERS: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill('SIGKILL'); } catch (_) {}
      resolve({
        ok: false,
        timedOut: true,
        label: entry.label,
        durationMs: Date.now() - started,
        exitCode: null,
        stdout: stdout.slice(-4000),
        stderr: `${stderr.slice(-2000)}\n[swarm-executor] timed out after ${timeoutMs}ms`.trim(),
      });
    }, timeoutMs);

    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        ok: false,
        label: entry.label,
        durationMs: Date.now() - started,
        exitCode: null,
        stdout: stdout.slice(-4000),
        stderr: err.message,
      });
    });
    child.on('exit', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        ok: code === 0,
        label: entry.label,
        durationMs: Date.now() - started,
        exitCode: code,
        stdout: stdout.slice(-4000),
        stderr: stderr.slice(-2000),
        command: `${entry.cmd} ${entry.args.join(' ')}`,
      });
    });
  });
}

/**
 * Execute one capability.
 * @param {object} opts
 * @param {string} opts.capability
 * @param {'simulated'|'real'} [opts.mode]
 * @param {number} [opts.timeoutMs]
 */
async function executeCapability({ capability, mode = 'simulated', timeoutMs = DEFAULT_TIMEOUT_MS }) {
  if (mode !== 'real') {
    return {
      ok: true,
      capability,
      mode: 'simulated',
      simulated: true,
      notes: `[simulated] ${capability} — no command executed`,
    };
  }
  const entry = resolveCommand(capability);
  if (!entry) {
    return {
      ok: false,
      capability,
      mode: 'real',
      simulated: false,
      error: 'capability_not_allowlisted',
      notes: `[real] ${capability} has no allowlisted command; refuse to invent one`,
    };
  }
  const result = await runCommand(entry, { timeoutMs });
  return {
    ok: result.ok,
    capability,
    mode: 'real',
    simulated: false,
    timedOut: Boolean(result.timedOut),
    label: result.label,
    command: result.command || `${entry.cmd} ${entry.args.join(' ')}`,
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    notes: result.ok
      ? `[real] ${result.label} passed in ${result.durationMs}ms`
      : `[real] ${result.label} failed (exit ${result.exitCode})`,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

module.exports = {
  ROOT,
  ALLOWLIST,
  DEFAULT_TIMEOUT_MS,
  resolveCommand,
  runCommand,
  executeCapability,
};
