'use strict';

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
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

function detectAvailableMemoryMb() {
  let memBytes = null;
  try {
    if (fs.existsSync('/sys/fs/cgroup/memory.max')) {
      const val = fs.readFileSync('/sys/fs/cgroup/memory.max', 'utf8').trim();
      if (val !== 'max') {
        const parsed = parseInt(val, 10);
        if (Number.isFinite(parsed) && parsed > 0) memBytes = parsed;
      }
    }
  } catch {}

  if (!memBytes) {
    try {
      if (fs.existsSync('/sys/fs/cgroup/memory/memory.limit_in_bytes')) {
        const val = fs.readFileSync('/sys/fs/cgroup/memory/memory.limit_in_bytes', 'utf8').trim();
        const parsed = parseInt(val, 10);
        if (Number.isFinite(parsed) && parsed > 0 && parsed < 0x7ffffffffffff000) {
          memBytes = parsed;
        }
      }
    } catch {}
  }

  if (!memBytes) {
    try {
      memBytes = os.totalmem();
    } catch {}
  }

  if (!memBytes || memBytes <= 0) return 2048;
  const totalMb = Math.floor(memBytes / (1024 * 1024));
  const targetMb = Math.floor(totalMb * 0.75);
  return Math.max(256, Math.min(4096, targetMb));
}

function resolveNodeOptions(existingOptions, defaultLimit = '4096') {
  if (existingOptions && existingOptions.includes('--max-old-space-size')) return existingOptions;
  return existingOptions ? `${existingOptions} --max-old-space-size=${defaultLimit}` : `--max-old-space-size=${defaultLimit}`;
}

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

async function waitForHealth(url, timeoutMs = 120000) {
  return require('./production-health').waitForHealth(url, {
    timeoutMs, closing:() => closing,
    onFailure:reason => console.error(`[Production] Health deadline exceeded (${reason}) for ${url}`),
  });
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

  // Cloud platforms (Render, Fly, Koyeb) require public port binding in < 25s.
  // Never block for 45s on advanced discovery readiness before falling back to
  // liveness; probe readiness for up to 3s, then fall back immediately.
  const ready = await waitForHealth(readyUrl, 3000);
  if (ready) {
    console.log(`[Production] Backend Listing API is healthy on port ${internalApiPort}.`);
    return true;
  }

  if (hasDatabase) {
    console.log('[Production] Database discovery readiness still initializing — falling back to /api/health liveness check.');
  } else {
    console.log('[Production] Advanced discovery readiness failed — continuing in Demo/in-memory mode.');
  }

  // Startup database migrations (e.g. column backfills + GIN index creation)
  // run synchronously before server.listen(), so a 10s budget can SIGTERM an
  // active migration on resource-constrained hosts.
  const configuredTimeout = Number(bootEnv.BACKEND_HEALTH_TIMEOUT_MS);
  const liveTimeoutMs = Number.isFinite(configuredTimeout) && configuredTimeout > 0
    ? configuredTimeout
    : (hasDatabase ? 120000 : 25000);
  const live = await waitForHealth(liveUrl, liveTimeoutMs);
  if (live) {
    console.log(`[Production] Backend Listing API is live on port ${internalApiPort} (liveness /api/health).`);
    return true;
  }

  console.error('[Production] Backend Listing API failed health check in time.');
  return false;
}

async function boot() {
  require('../server/discovery/evidence-storage').assertEvidenceStorage(bootEnv);
  console.log(`[Production] Bootstrapping Property-Crawl production runtime...`);
  console.log(`[Production] Public Port: ${publicPort} | Internal API Port: ${internalApiPort}`);

  // Embedded only when nothing else is configured. Never inject it over
  // DATABASE_URL: on Render that hid the live Postgres inventory.
  const defaultDbEnv =
    !hasDatabase &&
    !bootEnv.PROPERTY_DB &&
    !bootEnv.PROPERTY_PG_DATA_DIR &&
    !bootEnv.PROPERTY_INVENTORY_BACKEND
      ? { PROPERTY_DB: 'embedded' }
      : {};

  const apiEnv = {
    ...bootEnv,
    ...defaultDbEnv,
    PORT: String(internalApiPort),
    NODE_ENV: 'production',
    NODE_OPTIONS: resolveNodeOptions(bootEnv.NODE_OPTIONS, String(detectAvailableMemoryMb())),
    // Let both services become healthy before the first CPU/IO-heavy crawl.
    SCRAPER_BOOT_DELAY_MS: bootEnv.SCRAPER_BOOT_DELAY_MS || '90000',
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
    ...defaultDbEnv,
    PORT: String(publicPort),
    PROPERTY_API_URL: `http://127.0.0.1:${internalApiPort}`,
    NODE_ENV: 'production',
    NODE_OPTIONS: resolveNodeOptions(bootEnv.NODE_OPTIONS, String(detectAvailableMemoryMb())),
  };

  // next start serves .next — refuse to boot a stale/missing production build.
  const distDirName = process.env.NEXT_DISCOVERY_PREVIEW === '1'
    ? '.next-discovery-preview'
    : process.env.NEXT_VERIFY_BUILD === 'sources'
      ? '.next-sources-verify'
      : process.env.NEXT_VERIFY_BUILD === '1'
        ? '.next-verify'
        : '.next';
  const nextDir = path.join(root, distDirName);
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
    try {
      const healthRes = await fetch(`http://127.0.0.1:${publicPort}/api/health`, { signal: AbortSignal.timeout(2000) });
      if (healthRes.ok) {
        const health = await healthRes.json();
        console.log(`[Production] Active Data Mode: ${health.dataMode || (hasDatabase ? 'postgres' : 'memory')}`);
        console.log(`[Production] Document Review Store: ${health.documentReviewStore || 'memory'}`);
      }
    } catch {
      if (!hasDatabase) {
        console.log(`[Production] Data mode: Demo/in-memory (seeded from data.js).`);
      }
    }
    console.log(`========================================================`);
  } else {
    console.error('[Production] Next.js UI failed health check in time.');
    shutdown(1);
  }
}

if (require.main === module) boot().catch((err) => {
  console.error('[Production] Boot fatal error:', err);
  shutdown(1);
});

module.exports = { resolveNodeOptions, detectAvailableMemoryMb, awaitBackendReady, boot };
