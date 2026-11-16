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

function resolveDefaultDbEnv(env = bootEnv) {
  // Embedded only when nothing else is configured. Never inject it over
  // DATABASE_URL: on Render that hid the live Postgres inventory.
  if (
    !env.DATABASE_URL &&
    !env.PROPERTY_DB &&
    !env.PROPERTY_PG_DATA_DIR &&
    !env.PROPERTY_INVENTORY_BACKEND
  ) {
    return { PROPERTY_DB: 'embedded' };
  }
  return {};
}

function resolveBackendBootMode(env = bootEnv) {
  const effectiveEnv = { ...env, ...resolveDefaultDbEnv(env), NODE_ENV: 'production' };
  if (effectiveEnv.DATABASE_URL) return 'postgres';
  if (
    effectiveEnv.PROPERTY_INVENTORY_BACKEND !== 'memory' &&
    (effectiveEnv.PROPERTY_DB === 'embedded' || Boolean(effectiveEnv.PROPERTY_PG_DATA_DIR))
  ) {
    return 'embedded';
  }
  return effectiveEnv.PROPERTY_INVENTORY_BACKEND === 'memory' ? 'memory' : 'unconfigured';
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

async function waitForHealth(url, timeoutMs = 120000, options = {}) {
  const onFailure = typeof options.onFailure === 'function'
    ? options.onFailure
    : (reason => console.error(`[Production] Health deadline exceeded (${reason}) for ${url}`));
  return require('./production-health').waitForHealth(url, {
    timeoutMs, closing: () => closing,
    onFailure,
  });
}

/**
 * Backend readiness strategy:
 * - With DATABASE_URL: wait on advanced readiness (/api/health/ready).
 * - With embedded PostgreSQL (PGLite): allow initialization and fall back to
 *   liveness (/api/health) without logging Demo/in-memory warnings.
 * - Without DATABASE_URL or embedded PostgreSQL: Demo/in-memory mode detected —
 *   advanced discovery readiness may fail; fall back to liveness (/api/health)
 *   after a short wait.
 */
async function awaitBackendReady(options = {}) {
  const env = options.env || bootEnv;
  const port = options.port || internalApiPort;
  const readyUrl = options.readyUrl || `http://127.0.0.1:${port}/api/health/ready`;
  const liveUrl = options.liveUrl || `http://127.0.0.1:${port}/api/health`;
  const log = typeof options.log === 'function' ? options.log : console.log;
  const errorLog = typeof options.error === 'function' ? options.error : console.error;
  const probeHealth = typeof options.waitForHealth === 'function' ? options.waitForHealth : null;
  const backendMode = resolveBackendBootMode(env);
  const hasDatabase = backendMode === 'postgres';
  const usesEmbeddedPostgres = backendMode === 'embedded';

  if (usesEmbeddedPostgres) {
    log('[Production] Embedded PostgreSQL mode detected (PGLite; DATABASE_URL unset).');
  } else if (!hasDatabase) {
    log('[Production] Demo/in-memory mode detected (DATABASE_URL unset).');
  }

  // Cloud platforms (Render, Fly, Koyeb) require public port binding in < 25s.
  // Never block for 45s on advanced discovery readiness before falling back to
  // liveness; probe readiness for up to 3s, then fall back immediately.
  let readyFailureReason = null;
  const readyOpts = { onFailure: (reason) => { readyFailureReason = reason; } };
  const ready = probeHealth
    ? await probeHealth(readyUrl, 3000, readyOpts)
    : await waitForHealth(readyUrl, 3000, readyOpts);
  if (ready) {
    log(`[Production] Backend Listing API is healthy on port ${port}.`);
    return true;
  }

  if (hasDatabase) {
    log('[Production] Database discovery readiness still initializing — falling back to /api/health liveness check.');
  } else if (usesEmbeddedPostgres) {
    const reasonSuffix = readyFailureReason ? ` (${readyFailureReason})` : '';
    log(`[Production] Embedded PostgreSQL still initializing${reasonSuffix} — falling back to /api/health liveness check.`);
  } else {
    log('[Production] Advanced discovery readiness failed — continuing in Demo/in-memory mode.');
  }

  // Startup database migrations (e.g. column backfills + GIN index creation)
  // run synchronously before server.listen(), so a 10s budget can SIGTERM an
  // active migration on resource-constrained hosts.
  const configuredTimeout = Number(env.BACKEND_HEALTH_TIMEOUT_MS);
  const liveTimeoutMs = Number.isFinite(configuredTimeout) && configuredTimeout > 0
    ? configuredTimeout
    : (hasDatabase ? 240000 : (usesEmbeddedPostgres ? 120000 : 25000));
  const live = probeHealth
    ? await probeHealth(liveUrl, liveTimeoutMs)
    : await waitForHealth(liveUrl, liveTimeoutMs);
  if (live) {
    log(`[Production] Backend Listing API is live on port ${port} (liveness /api/health).`);
    return true;
  }

  errorLog('[Production] Backend Listing API failed health check in time.');
  return false;
}

async function boot() {
  require('../server/discovery/evidence-storage').assertEvidenceStorage(bootEnv);
  console.log(`[Production] Bootstrapping Property-Crawl production runtime...`);
  console.log(`[Production] Public Port: ${publicPort} | Internal API Port: ${internalApiPort}`);

  const defaultDbEnv = resolveDefaultDbEnv(bootEnv);
  const usesEmbeddedPostgres = resolveBackendBootMode(bootEnv) === 'embedded';

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
        console.log(`[Production] Active Data Mode: ${health.dataMode || ((hasDatabase || usesEmbeddedPostgres) ? 'postgres' : 'memory')}`);
        console.log(`[Production] Document Review Store: ${health.documentReviewStore || 'memory'}`);
      }
    } catch {
      if (usesEmbeddedPostgres) {
        console.log('[Production] Data mode: Embedded PostgreSQL (PGLite).');
      } else if (!hasDatabase) {
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

module.exports = {
  resolveNodeOptions,
  detectAvailableMemoryMb,
  resolveDefaultDbEnv,
  resolveBackendBootMode,
  awaitBackendReady,
  boot,
};
