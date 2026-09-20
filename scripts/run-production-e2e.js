'use strict';

/**
 * Production-boot + user-workflow e2e gate.
 *
 * Boots scripts/start-production.js on free local ports (without inheriting
 * SCRAPER_ADMIN_TOKEN so .env.local loading is actually exercised), waits for
 * liveness, runs scripts/e2e-user-workflow.js against an isolated document-
 * review store, then tears the stack down.
 *
 * Usage:
 *   node scripts/run-production-e2e.js
 *   node scripts/run-production-e2e.js --port 3980
 *
 * Exit 0 only when e2e reports PASS.
 */

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const E2E_TIMEOUT_MS = Number(process.env.PRODUCTION_E2E_TIMEOUT_MS || 180000);

function parseArgs(argv) {
  const args = { port: null, withDb: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--port' && argv[i + 1]) {
      args.port = Number(argv[i + 1]);
      i += 1;
    } else if (argv[i] === '--with-db') {
      args.withDb = true;
    }
  }
  return args;
}

function isPortFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => server.close(() => resolve(true)));
    server.listen(port, '127.0.0.1');
  });
}

async function pickPorts(preferredPublic) {
  const preferred = Number.isFinite(preferredPublic) && preferredPublic > 0 ? [preferredPublic] : [];
  const candidates = [...preferred, 3980, 3990, 4000, 4010, 4020, 4030, 4040, 4050, 4060, 4070];
  for (const publicPort of candidates) {
    const apiPort = publicPort + 2;
    if (await isPortFree(publicPort) && await isPortFree(apiPort)) {
      return { publicPort, apiPort };
    }
  }
  throw new Error('No free production e2e port pair found');
}

async function waitForHttp(url, timeoutMs = 60000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return true;
    } catch {
      // boot in progress
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

function loadTokenFromEnvLocal() {
  try {
    const line = fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8')
      .split(/\r?\n/)
      .find((l) => l.startsWith('SCRAPER_ADMIN_TOKEN='));
    return line ? line.slice('SCRAPER_ADMIN_TOKEN='.length).trim() : '';
  } catch {
    return '';
  }
}

function killTree(pid) {
  if (!pid) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => resolve();
    try {
      if (process.platform === 'win32') {
        const child = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
        child.on('exit', done);
        child.on('error', done);
        setTimeout(done, 3000);
      } else {
        process.kill(-pid, 'SIGTERM');
        setTimeout(() => {
          try { process.kill(-pid, 'SIGKILL'); } catch { /* gone */ }
          done();
        }, 2000);
      }
    } catch {
      try { process.kill(pid, 'SIGTERM'); } catch { /* already gone */ }
      done();
    }
  });
}

async function waitForPortFree(port, timeoutMs = 8000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await isPortFree(port)) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

function runE2e(baseUrl, token) {
  return new Promise((resolve) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), E2E_TIMEOUT_MS);
    const e2e = spawn(process.execPath, ['scripts/e2e-user-workflow.js'], {
      cwd: ROOT,
      env: { ...process.env, E2E_BASE_URL: baseUrl },
      stdio: 'inherit',
      signal: controller.signal,
    });
    e2e.on('exit', (code) => {
      clearTimeout(timer);
      resolve(code == null ? 1 : code);
    });
    e2e.on('error', () => {
      clearTimeout(timer);
      resolve(1);
    });
  });
}

async function main() {
  const args = parseArgs(process.argv);
  const { publicPort, apiPort } = await pickPorts(args.port);
  const baseUrl = `http://127.0.0.1:${publicPort}`;
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), `property-e2e-state-${publicPort}-`));
  const reviewStorePath = path.join(stateDir, 'document-review-store.json');
  const liveCachePath = path.join(stateDir, 'live-listings.json');
  const logPath = path.join(ROOT, '.cache', `production-e2e-${publicPort}.log`);
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const logFd = fs.openSync(logPath, 'a');

  const env = {
    ...process.env,
    PORT: String(publicPort),
    INTERNAL_API_PORT: String(apiPort),
    E2E_BASE_URL: baseUrl,
    // Isolate e2e writes from the operator's shared .cache store.
    PROPERTY_DOCUMENT_REVIEW_STORE_PATH: reviewStorePath,
    PROPERTY_LIVE_CACHE_PATH: liveCachePath,
  };
  // Force the production orchestrator to load secrets from .env.local.
  delete env.SCRAPER_ADMIN_TOKEN;
  delete env.PROPERTY_OPERATOR_SECRET;
  // Default unit-gate path pins demo mode. Opt into PG with --with-db.
  if (!args.withDb) {
    delete env.DATABASE_URL;
    delete env.DISCOVERY_MODE;
    delete env.DISCOVERY_TEST_DATABASE_URL;
  }

  const tokenFromFile = loadTokenFromEnvLocal();
  console.log(`[production-e2e] booting start:production UI=${publicPort} API=${apiPort}`);
  console.log(`[production-e2e] isolated review store=${reviewStorePath}`);
  console.log(`[production-e2e] log=${logPath}`);

  const boot = spawn(process.execPath, ['scripts/start-production.js'], {
    cwd: ROOT,
    env,
    detached: process.platform !== 'win32',
    stdio: ['ignore', logFd, logFd],
  });

  let e2eCode = 1;
  try {
    const healthy = await waitForHttp(`${baseUrl}/api/health`, 90000);
    if (!healthy) {
      console.error('[production-e2e] stack failed liveness within 90s');
      try {
        const tail = fs.readFileSync(logPath, 'utf8').split(/\r?\n/).slice(-40).join('\n');
        console.error(tail);
      } catch { /* ignore */ }
      e2eCode = 1;
    } else {
      const health = await fetch(`${baseUrl}/api/health`).then((r) => r.json()).catch(() => ({}));
      console.log(`[production-e2e] health dataMode=${health.dataMode} documentReviewStore=${health.documentReviewStore}`);
      if (!tokenFromFile) {
        console.warn('[production-e2e] WARNING: SCRAPER_ADMIN_TOKEN missing in .env.local; operator checks will fail');
      }
      console.log(`[production-e2e] running e2e against ${baseUrl} (timeout ${E2E_TIMEOUT_MS}ms, withDb=${args.withDb})`);
      if (!args.withDb) process.env.E2E_EXPECT_DEMO = '1';
      else delete process.env.E2E_EXPECT_DEMO;
      e2eCode = await runE2e(baseUrl, tokenFromFile);
    }
  } finally {
    await killTree(boot.pid);
    await waitForPortFree(publicPort);
    await waitForPortFree(apiPort);
    try { fs.closeSync(logFd); } catch { /* ignore */ }
  }

  console.log(`[production-e2e] ${e2eCode === 0 ? 'PASS' : 'FAIL'} (exit=${e2eCode})`);
  process.exit(e2eCode);
}

main().catch((err) => {
  console.error('[production-e2e] fatal:', err.message || err);
  process.exit(1);
});
