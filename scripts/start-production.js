'use strict';

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { loadLocalEnvFiles, resolveInternalApiPort } = require('./production-env');

const root = path.resolve(__dirname, '..');
const nextBin = path.join(root, 'node_modules', 'next', 'dist', 'bin', 'next');

// Next.js loads .env.local itself; the plain Node listing API does not.
// process.env always wins so cloud secret injection is never clobbered.
const bootEnv = loadLocalEnvFiles(process.env);

// Public port exposed by the cloud provider (Render, Koyeb, Hugging Face, etc.)
const publicPort = Number(bootEnv.PORT) || 3000;

// Internal port for the backend listing API (must not collide with publicPort
// or with other local stacks). Cloud PORT=3000 keeps historical 3002; any
// other public port uses publicPort+2 (3700 → 3702).
const internalApiPort = resolveInternalApiPort(publicPort, bootEnv.INTERNAL_API_PORT);

const hasDatabase = Boolean(bootEnv.DATABASE_URL);
const children = [];
let closing = false;

function start(name, command, args, env) {
  console.log(`[Production] Starting ${name}...`);
  const child = spawn(command, args, {
    cwd: root,
    env,
    stdio: 'inherit',
    windowsHide: true,
  });
  children.push(child);
  child.on('exit', (code, signal) => {
    if (closing) return;
    console.error(`[Production] ${name} exited (${signal || code}). Shutting down stack.`);
    shutdown(code || 1);
  });
  return child;
}

function shutdown(exitCode = 0) {
  if (closing) return;
  closing = true;
  for (const child of children) {
    if (!child.killed) child.kill('SIGTERM');
  }
  setTimeout(() => process.exit(exitCode), 500).unref();
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
process.on('uncaughtException', (err) => {
  console.error('[Production] Uncaught exception:', err);
  shutdown(1);
});

async function waitForHealth(url, timeoutMs = 30000) {
  const startAt = Date.now();
  while (Date.now() - startAt < timeoutMs && !closing) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(1500) });
      if (res.ok) return true;
    } catch {
      // transient connection failure during boot is expected
    }
    await new Promise((r) => setTimeout(r, 750));
  }
  return false;
}

/**
 * Backend readiness strategy:
 * - With DATABASE_URL: wait on advanced readiness (/api/health/ready).
 * - Without DATABASE_URL: Demo/in-memory mode detected — advanced discovery
 *   readiness may fail; fall back to liveness (/api/health) after a short wait.
 */
async function awaitBackendReady() {
  const readyUrl = `http://127.0.0.1:${internalApiPort}/api/health/ready`;
  const liveUrl = `http://127.0.0.1:${internalApiPort}/api/health`;

  if (!hasDatabase) {
    console.log('[Production] Demo/in-memory mode detected (DATABASE_URL unset).');
  }

  const ready = await waitForHealth(readyUrl, hasDatabase ? 45000 : 8000);
  if (ready) {
    console.log(`[Production] Backend Listing API is healthy on port ${internalApiPort}.`);
    return true;
  }

  if (!hasDatabase) {
    console.log('[Production] Advanced discovery readiness failed — continuing in Demo/in-memory mode.');
  }

  const live = await waitForHealth(liveUrl, 30000);
  if (live) {
    console.log(`[Production] Backend Listing API is live on port ${internalApiPort} (liveness /api/health).`);
    return true;
  }

  console.error('[Production] Backend Listing API failed health check in time.');
  return false;
}

async function boot() {
  console.log(`[Production] Bootstrapping Property-Crawl production runtime...`);
  console.log(`[Production] Public Port: ${publicPort} | Internal API Port: ${internalApiPort}`);

  const apiEnv = {
    ...bootEnv,
    PORT: String(internalApiPort),
    NODE_ENV: 'production',
  };
  // --env-file-if-exists matches start:api / dev:api so the Node API sees
  // operator credentials even if this orchestrator is launched without them.
  // Only .env.local is passed here: Node warns on every missing --env-file
  // path, and production images legitimately have no .env.
  start(
    'Backend Listing API',
    process.execPath,
    ['--env-file-if-exists=.env.local', 'server/server.js'],
    apiEnv
  );

  console.log(`[Production] Awaiting Backend Listing API on 127.0.0.1:${internalApiPort}...`);
  const apiReady = await awaitBackendReady();
  if (!apiReady) {
    shutdown(1);
    return;
  }

  const nextEnv = {
    ...bootEnv,
    PORT: String(publicPort),
    PROPERTY_API_URL: `http://127.0.0.1:${internalApiPort}`,
    NODE_ENV: 'production',
  };

  // next start serves .next — refuse to boot a stale/missing production build.
  const nextDir = path.join(root, process.env.NEXT_DISCOVERY_PREVIEW === '1' ? '.next-discovery-preview' : '.next');
  const buildId = path.join(nextDir, 'BUILD_ID');
  if (!fs.existsSync(buildId)) {
    console.error(`[Production] Missing Next production build at ${nextDir}. Run: npm run build`);
    shutdown(1);
    return;
  }

  start(
    'Next.js Canonical UI',
    process.execPath,
    [nextBin, 'start', '-p', String(publicPort), '-H', '0.0.0.0'],
    nextEnv
  );

  console.log(`[Production] Awaiting Next.js UI on public port ${publicPort}...`);
  // UI readiness is liveness: the public healthcheck must not depend on
  // advanced discovery readiness that demo mode cannot satisfy.
  const uiReady = await waitForHealth(`http://127.0.0.1:${publicPort}/api/health`);
  if (uiReady) {
    console.log(`========================================================`);
    console.log(`[Production] Property-Crawl Production Stack LIVE!`);
    console.log(`[Production] Listening on 0.0.0.0:${publicPort}`);
    console.log(`[Production] Healthcheck: http://0.0.0.0:${publicPort}/api/health`);
    if (!hasDatabase) {
      console.log(`[Production] Data mode: Demo/in-memory (seeded from data.js).`);
    }
    console.log(`========================================================`);
  } else {
    console.error('[Production] Next.js UI failed health check in time.');
    shutdown(1);
  }
}

boot().catch((err) => {
  console.error('[Production] Boot fatal error:', err);
  shutdown(1);
});
