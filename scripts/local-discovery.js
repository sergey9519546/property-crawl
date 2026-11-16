'use strict';

/**
 * Local $0 discovery stack helper (PostgreSQL + Migration 014).
 * Uses docker-compose.discovery.yml db service when Docker is running, and
 * falls back to a loopback PGLiteSocketServer (PostgreSQL + PostGIS 3.6) on
 * 127.0.0.1:${DISCOVERY_DB_PORT} when no Docker daemon is available.
 */

const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');

const ROOT = path.resolve(__dirname, '..');
const CACHE_DIR = path.join(ROOT, '.cache');
const PGLITE_DATA_DIR = path.join(CACHE_DIR, 'local-discovery-pglite');
const PGLITE_PID_FILE = path.join(CACHE_DIR, 'local-discovery-pglite.pid');

function run(cmd, args, env = process.env) {
  const result = spawnSync(cmd, args, { cwd: ROOT, env, stdio: 'inherit', shell: false });
  return result.status === 0;
}

function isDockerDaemonAvailable() {
  const probe = spawnSync('docker', ['info'], { cwd: ROOT, stdio: 'pipe', shell: false });
  return probe.status === 0;
}

function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readDaemonPid() {
  try {
    const raw = fs.readFileSync(PGLITE_PID_FILE, 'utf8').trim();
    const pid = Number.parseInt(raw, 10);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

async function waitForPostgres(databaseUrl, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const pool = new Pool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 1500 });
    try {
      await pool.query('SELECT 1');
      await pool.end();
      return true;
    } catch {
      await pool.end().catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  return false;
}

async function runPgliteDaemon(dbPort) {
  const { PGLiteSocketServer } = require('@electric-sql/pglite-socket');
  const { startEmbeddedPostgres } = require('../server/db/pglite-pool');

  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const logFile = path.join(CACHE_DIR, 'local-discovery-pglite.log');
  const appendLog = (msg) => {
    try {
      fs.appendFileSync(logFile, `[${new Date().toISOString()}] pid=${process.pid} ${msg}\n`, 'utf8');
    } catch {
      // ignore logging error
    }
  };
  process.on('uncaughtException', (err) => {
    appendLog(`uncaughtException: ${err && err.stack ? err.stack : String(err)}`);
  });
  process.on('unhandledRejection', (err) => {
    appendLog(`unhandledRejection: ${err && err.stack ? err.stack : String(err)}`);
  });
  process.on('exit', (code) => {
    appendLog(`exit code=${code}`);
  });
  appendLog(`starting PGLiteSocketServer on 127.0.0.1:${dbPort}`);
  const started = await startEmbeddedPostgres({ dataDir: PGLITE_DATA_DIR, log: () => {} });
  const socketServer = new PGLiteSocketServer({
    db: started.db,
    host: '127.0.0.1',
    port: Number(dbPort),
    maxConnections: 512,
  });
  socketServer.addEventListener('error', (event) => {
    const err = event && event.detail;
    appendLog(`socketServer error: ${err && err.stack ? err.stack : String(err)}`);
  });
  await socketServer.start();
  appendLog(`listening on 127.0.0.1:${dbPort}`);
  fs.writeFileSync(PGLITE_PID_FILE, `${process.pid}\n`, 'utf8');

  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    try { await socketServer.stop(); } catch {}
    try { await started.db.close(); } catch {}
    try { fs.unlinkSync(PGLITE_PID_FILE); } catch {}
    process.exit(0);
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}

async function stopPgliteDaemon() {
  const pid = readDaemonPid();
  if (pid && isPidAlive(pid)) {
    try { process.kill(pid, 'SIGTERM'); } catch {}
    const deadline = Date.now() + 4000;
    while (Date.now() < deadline && isPidAlive(pid)) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (isPidAlive(pid)) {
      try { process.kill(pid, 'SIGKILL'); } catch {}
    }
  }
  try { fs.unlinkSync(PGLITE_PID_FILE); } catch {}
}

async function main() {
  const dbPort = process.env.DISCOVERY_DB_PORT || '55432';
  const user = process.env.POSTGRES_USER || 'property';
  const password = process.env.POSTGRES_PASSWORD || 'property-local-dev';
  const database = process.env.POSTGRES_DB || 'property_crawl';
  const databaseUrl = `postgres://${user}:${password}@127.0.0.1:${dbPort}/${database}`;
  const env = {
    ...process.env,
    POSTGRES_USER: user,
    POSTGRES_PASSWORD: password,
    POSTGRES_DB: database,
    DISCOVERY_DB_PORT: dbPort,
    DATABASE_URL: databaseUrl,
    DISCOVERY_MODE: 'advanced',
  };

  if (process.argv.includes('--daemon-pglite')) {
    await runPgliteDaemon(dbPort);
    return 0;
  }

  const action = process.argv[2] || 'status';

  console.log('=== Local discovery (Migration 014) ===');
  console.log(`Action: ${action}`);
  console.log(`DATABASE_URL (local loopback): ${databaseUrl}`);
  console.log('Credentials are local-dev only. Do not reuse on public hosts.');

  if (action === 'status') {
    const pid = readDaemonPid();
    if (pid && isPidAlive(pid)) {
      console.log(`Loopback PGLiteSocketServer active (PID ${pid}) on 127.0.0.1:${dbPort}.`);
    }
    console.log('');
    console.log('Next steps:');
    console.log('  npm run discovery:local -- up');
    console.log('  npm run discovery:local -- migrate');
    console.log('  npm run discovery:local -- canary');
    return 0;
  }

  if (action === 'up') {
    const existingPid = readDaemonPid();
    if (existingPid && isPidAlive(existingPid) && await waitForPostgres(databaseUrl, 2000)) {
      console.log(`Loopback PGLiteSocketServer already running (PID ${existingPid}) on 127.0.0.1:${dbPort}.`);
      return 0;
    }

    if (isDockerDaemonAvailable()) {
      const compose = run('docker', [
        'compose',
        '-f',
        'docker-compose.discovery.yml',
        'up',
        '-d',
        'discovery-db',
      ], env);
      if (compose) {
        console.log('discovery-db starting via compose; wait for healthy then run migrate.');
        return 0;
      }
      console.log('docker compose unavailable — starting postgis container via docker run...');
      spawnSync('docker', ['rm', '-f', 'property-discovery-db'], { cwd: ROOT, stdio: 'ignore', shell: false });
      const started = run('docker', [
        'run',
        '-d',
        '--name',
        'property-discovery-db',
        '-e',
        `POSTGRES_USER=${user}`,
        '-e',
        `POSTGRES_PASSWORD=${password}`,
        '-e',
        `POSTGRES_DB=${database}`,
        '-p',
        `127.0.0.1:${dbPort}:5432`,
        '--health-cmd',
        `pg_isready -U ${user} -d ${database}`,
        '--health-interval',
        '5s',
        '--health-timeout',
        '5s',
        '--health-retries',
        '12',
        'postgis/postgis:16-3.4-alpine',
      ], env);
      if (started) {
        const pgReady = await waitForPostgres(databaseUrl, 45_000);
        console.log(pgReady ? `Started property-discovery-db ready on 127.0.0.1:${dbPort}.` : `Started property-discovery-db on 127.0.0.1:${dbPort}. Wait ~15s then migrate.`);
        if (!pgReady) return 1;
        return 0;
      }
    }

    console.log('Docker daemon unavailable — starting loopback PGLiteSocketServer (PostGIS 3.6)...');
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    const child = spawn(process.execPath, [__filename, '--daemon-pglite'], {
      cwd: ROOT,
      env,
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();

    const ready = await waitForPostgres(databaseUrl, 30_000);
    if (!ready) {
      console.error(`Timed out waiting for PGLiteSocketServer on 127.0.0.1:${dbPort}.`);
      return 1;
    }
    const activePid = readDaemonPid();
    console.log(`Loopback PGLiteSocketServer ready (PID ${activePid || child.pid}) on 127.0.0.1:${dbPort}.`);
    return 0;
  }

  if (action === 'migrate') {
    console.log('Applying discovery migrations (includes 014 promotion evidence)...');
    return run('node', ['scripts/discovery-migrate.js'], env) ? 0 : 1;
  }

  if (action === 'canary') {
    console.log('Migration 014 canary status (requires advanced + PG)...');
    return run('node', ['scripts/canary-live.js', 'list'], env) ? 0 : 1;
  }

  if (action === 'down') {
    await stopPgliteDaemon();
    if (isDockerDaemonAvailable()) {
      run('docker', ['compose', '-f', 'docker-compose.discovery.yml', 'down'], env);
      run('docker', ['rm', '-f', 'property-discovery-db'], env);
    }
    return 0;
  }

  console.error(`Unknown action: ${action}`);
  return 1;
}

main().then(
  (code) => {
    if (!process.argv.includes('--daemon-pglite')) {
      process.exit(code);
    }
  },
  (err) => {
    console.error(err && err.stack ? err.stack : err);
    process.exit(1);
  }
);
