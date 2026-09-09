'use strict';

const { spawn } = require('node:child_process');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const nextBin = path.join(root, 'node_modules', 'next', 'dist', 'bin', 'next');

// Public port exposed by the cloud provider (Render, Koyeb, Hugging Face, etc.)
const publicPort = Number(process.env.PORT) || 3000;

// Internal port for the backend listing API (must not collide with publicPort)
const internalApiPort = Number(process.env.INTERNAL_API_PORT) || (publicPort === 3000 ? 3002 : 3000);

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
  const start = Date.now();
  while (Date.now() - start < timeoutMs && !closing) {
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

async function boot() {
  console.log(`[Production] Bootstrapping Property-Crawl production runtime...`);
  console.log(`[Production] Public Port: ${publicPort} | Internal API Port: ${internalApiPort}`);

  // 1. Start backend Node API on internal loopback port
  const apiEnv = {
    ...process.env,
    PORT: String(internalApiPort),
    NODE_ENV: 'production',
  };
  start('Backend Listing API', process.execPath, ['server/server.js'], apiEnv);

  console.log(`[Production] Awaiting Backend Listing API on 127.0.0.1:${internalApiPort}...`);
  const apiReady = await waitForHealth(`http://127.0.0.1:${internalApiPort}/api/health`);
  if (!apiReady) {
    console.error('[Production] Backend Listing API failed health check in time.');
    shutdown(1);
    return;
  }
  console.log(`[Production] Backend Listing API is healthy on port ${internalApiPort}.`);

  // 2. Start Next.js on the public port, proxying API calls internally
  const nextEnv = {
    ...process.env,
    PORT: String(publicPort),
    PROPERTY_API_URL: `http://127.0.0.1:${internalApiPort}`,
    NODE_ENV: 'production',
  };

  start(
    'Next.js Canonical UI',
    process.execPath,
    [nextBin, 'start', '-p', String(publicPort), '-H', '0.0.0.0'],
    nextEnv
  );

  console.log(`[Production] Awaiting Next.js UI on public port ${publicPort}...`);
  const uiReady = await waitForHealth(`http://127.0.0.1:${publicPort}/api/health`);
  if (uiReady) {
    console.log(`========================================================`);
    console.log(`[Production] Property-Crawl Production Stack LIVE!`);
    console.log(`[Production] Listening on 0.0.0.0:${publicPort}`);
    console.log(`[Production] Healthcheck: http://0.0.0.0:${publicPort}/api/health`);
    console.log(`========================================================`);
  }
}

boot().catch((err) => {
  console.error('[Production] Boot fatal error:', err);
  shutdown(1);
});
