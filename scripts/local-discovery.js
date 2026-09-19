'use strict';

/**
 * Local $0 discovery stack helper (PostgreSQL + Migration 014).
 * Uses docker-compose.discovery.yml db service only when available.
 */

const { spawnSync } = require('node:child_process');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

function run(cmd, args, env = process.env) {
  const result = spawnSync(cmd, args, { cwd: ROOT, env, stdio: 'inherit', shell: false });
  return result.status === 0;
}

function main() {
  const action = process.argv[2] || 'status';
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

  console.log('=== Local discovery (Migration 014) ===');
  console.log(`Action: ${action}`);
  console.log(`DATABASE_URL (local loopback): ${databaseUrl}`);
  console.log('Credentials are local-dev only. Do not reuse on public hosts.');

  if (action === 'status') {
    console.log('');
    console.log('Next steps:');
    console.log('  npm run discovery:local -- up');
    console.log('  npm run discovery:local -- migrate');
    console.log('  npm run discovery:local -- canary');
    return 0;
  }

  if (action === 'up') {
    // Prefer docker compose plugin; fall back to plain docker run (loopback PostGIS).
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
    if (!started) {
      console.error('Failed to start discovery-db via docker run.');
      return 1;
    }
    console.log(`Started property-discovery-db on 127.0.0.1:${dbPort}. Wait ~15s then migrate.`);
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
    run('docker', ['compose', '-f', 'docker-compose.discovery.yml', 'down'], env);
    run('docker', ['rm', '-f', 'property-discovery-db'], env);
    return 0;
  }

  console.error(`Unknown action: ${action}`);
  return 1;
}

process.exit(main());
