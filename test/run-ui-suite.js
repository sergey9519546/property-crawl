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
// - The Node listing API on :3000 is reused if already healthy, otherwise
//   booted and torn down with the suite.

const { spawn, spawnSync } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const API_PORT = 3000;
const UI_PORT = process.env.UI_SUITE_PORT ? Number(process.env.UI_SUITE_PORT) : 3100;

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

async function waitFor(port, route, label, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await probe(port, route)) {
      console.log(`[ui-suite] ${label} ready on :${port}`);
      return;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`[ui-suite] ${label} failed to start on :${port} within ${timeoutMs / 1000}s`);
}

function startCmd(command, args, extraEnv = {}) {
  const child = spawn(command, args, {
    cwd: ROOT,
    env: { ...process.env, ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
    windowsHide: true,
  });
  child.stdout.on('data', () => {});
  child.stderr.on('data', () => {});
  return child;
}

async function main() {
  const owned = [];

  try {
    if (await probe(API_PORT, '/api/health')) {
      console.log('[ui-suite] reusing existing Node API on :3000');
    } else {
      console.log('[ui-suite] booting Node API (server/server.js) on :3000...');
      const api = startCmd(process.execPath, ['server/server.js'], { PORT: String(API_PORT) });
      owned.push(api);
      await waitFor(API_PORT, '/api/health', 'Node API');
    }

    if (!fs.existsSync(path.join(ROOT, '.next', 'BUILD_ID'))) {
      console.log('[ui-suite] no production build found — running next build...');
      const build = spawnSync('npx', ['next', 'build'], {
        cwd: ROOT,
        stdio: 'inherit',
        shell: process.platform === 'win32',
      });
      if (build.status !== 0) throw new Error('[ui-suite] next build failed');
    }

    console.log(`[ui-suite] booting Next production server on :${UI_PORT}...`);
    const ui = startCmd('npx', ['next', 'start', '-p', String(UI_PORT)], {
      PROPERTY_API_URL: `http://localhost:${API_PORT}`,
    });
    owned.push(ui);
    await waitFor(UI_PORT, '/api/listings', 'Next production server', 120_000);

    const py = process.platform === 'win32'
      ? 'python'
      : (spawnSync('python3', ['--version']).status === 0 ? 'python3' : 'python');
    const result = spawnSync(py, [path.join('test', 'next_ui_e2e_test.py')], {
      cwd: ROOT,
      stdio: 'inherit',
      env: { ...process.env, NEXT_UI_URL: `http://localhost:${UI_PORT}` },
    });
    if (result.error) throw result.error;
    process.exitCode = result.status === 0 ? 0 : 1;
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
