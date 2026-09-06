#!/usr/bin/env node
// test/run-ui-suite.js
//
// Self-contained runner for the canonical Playwright UI suite.
//
// Design decisions:
// - The Next UI under test is a PRODUCTION server (`next start`), never a
//   dev server. A `next dev` instance recompiles routes while the suite
//   runs — and every edit to src/ during a run turns /api/listings into a
//   transient 503, which then fails dozens of tests with "must be connected
//   to its listings API". Production builds are immutable and deterministic.
// - The UI always runs on its own port (default 3100) so an existing dev
//   server on 3001 is left untouched.
// - A fresh Node listing API runs on :3102, never a potentially stale dev API.
// - Verification uses .next-verify, leaving the active .next dev output alone.

const { spawn, spawnSync } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const API_PORT = process.env.UI_SUITE_API_PORT ? Number(process.env.UI_SUITE_API_PORT) : 3102;
const UI_PORT = process.env.UI_SUITE_PORT ? Number(process.env.UI_SUITE_PORT) : 3100;
process.env.NEXT_VERIFY_BUILD = '1';

function probe(port, route = '/') {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: route, timeout: 2000 }, (res) => {
      res.resume();
      resolve(res.statusCode < 500);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

async function waitFor(child, port, route, label, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child && child.exitCode !== null) {
      const logs = child.logs ? child.logs.join('') : '';
      throw new Error(`[ui-suite] ${label} exited prematurely with code ${child.exitCode}:\n${logs}`);
    }
    if (await probe(port, route)) {
      console.log(`[ui-suite] ${label} ready on :${port}`);
      return;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  const logs = child && child.logs ? child.logs.join('') : '';
  throw new Error(`[ui-suite] ${label} failed to start on :${port} within ${timeoutMs / 1000}s.\n${logs}`);
}

function startCmd(command, args, extraEnv = {}) {
  const isExe = command.toLowerCase().endsWith('.exe') || command === process.execPath;
  const child = spawn(command, args, {
    cwd: ROOT,
    env: { ...process.env, ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32' && !isExe,
    windowsHide: true,
  });
  child.logs = [];
  if (child.stdout) child.stdout.on('data', (d) => child.logs.push(d.toString()));
  if (child.stderr) child.stderr.on('data', (d) => child.logs.push(d.toString()));
  return child;
}

async function main() {
  const owned = [];

  try {
    if (await probe(API_PORT, '/api/health')) {
      throw new Error(`[ui-suite] API test port :${API_PORT} is already in use; choose UI_SUITE_API_PORT.`);
    } else {
      console.log(`[ui-suite] booting isolated Node API on :${API_PORT}...`);
      const api = startCmd(process.execPath, ['server/server.js'], {
        PORT: String(API_PORT),
        NODE_ENV: 'test',
        RUN_REAL_SCRAPERS: '0',
        // Forty-five journeys share one proxy socket. Test the default budget
        // separately; keep this isolated load run below its explicit ceiling.
        PROPERTY_API_RATE_LIMIT: '1000',
        DATABASE_URL: ''
      });
      owned.push(api);
      await waitFor(api, API_PORT, '/api/health', 'Node API');
    }

    if (!fs.existsSync(path.join(ROOT, '.next-verify', 'BUILD_ID'))) {
      console.log('[ui-suite] no production build found — running next build...');
      const build = spawnSync('npx', ['next', 'build'], {
        cwd: ROOT,
        stdio: 'inherit',
        shell: process.platform === 'win32',
      });
      if (build.status !== 0) throw new Error('[ui-suite] next build failed');
    }

    const nextBin = path.join(ROOT, 'node_modules', 'next', 'dist', 'bin', 'next');
    console.log(`[ui-suite] booting Next production server on :${UI_PORT}...`);
    const ui = startCmd(process.execPath, [nextBin, 'start', '-p', String(UI_PORT)], {
      PROPERTY_API_URL: `http://localhost:${API_PORT}`,
      GOOGLE_MAPS_API_KEY: '',
      GOOGLE_GEOCODING_API_KEY: '',
    });
    owned.push(ui);
    await waitFor(ui, UI_PORT, '/', 'Next production server', 60_000);

    const py = process.platform === 'win32'
      ? 'python'
      : (spawnSync('python3', ['--version']).status === 0 ? 'python3' : 'python');
    process.exitCode = 0;
    for (const suite of ['next_ui_e2e_test.py', 'detail_media_recovery_e2e_test.py']) {
      const result = spawnSync(py, [path.join('test', suite)], {
        cwd: ROOT,
        stdio: 'inherit',
        env: { ...process.env, NEXT_UI_URL: `http://localhost:${UI_PORT}` },
      });
      if (result.error) throw result.error;
      if (result.status !== 0) {
        for (const child of owned) console.error(child.logs.join('').slice(-12000));
        process.exitCode = 1;
      }
    }
  } finally {
    for (const child of owned) {
      if (process.platform === 'win32') {
        // Spawned through cmd.exe — kill the whole process tree.
        spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      } else {
        child.kill('SIGTERM');
      }
    }
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
