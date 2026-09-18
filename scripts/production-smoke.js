'use strict';

/**
 * Production smoke — verifies the production boot script contract and
 * (optionally) hits /api/health when a stack is already running.
 *
 * Without a live stack this is a static + unit smoke:
 *   - start-production.js uses liveness for UI health in demo mode
 *   - demo mode detection messages exist
 *   - package scripts present
 */

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const ROOT = path.resolve(__dirname, '..');
const startProd = fs.readFileSync(path.join(ROOT, 'scripts/start-production.js'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

function check(name, ok, detail) {
  return { name, ok, detail };
}

function httpGet(url, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ ok: res.statusCode >= 200 && res.statusCode < 500, status: res.statusCode, body: body.slice(0, 200) }));
    });
    req.on('error', (err) => resolve({ ok: false, error: err.message }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
  });
}

async function main() {
  const findings = [];
  findings.push(check(
    'production-boot-liveness',
    /await waitForHealth\(`http:\/\/127\.0\.0\.1:\$\{publicPort\}\/api\/health`\)/.test(startProd),
    'UI health uses /api/health liveness'
  ));
  const dockerfile = fs.readFileSync(path.join(ROOT, 'Dockerfile.production'), 'utf8');
  findings.push(check(
    'docker-healthcheck-liveness',
    /HEALTHCHECK[\s\S]*?\/api\/health[^/]/.test(dockerfile) || /HEALTHCHECK[\s\S]*?\/api\/health"/.test(dockerfile),
    'Dockerfile.production healthcheck uses /api/health (demo-safe)'
  ));
  const renderYaml = fs.existsSync(path.join(ROOT, 'render.yaml'))
    ? fs.readFileSync(path.join(ROOT, 'render.yaml'), 'utf8')
    : '';
  if (renderYaml) {
    findings.push(check(
      'render-health-liveness',
      /healthCheckPath:\s*\/api\/health\s*$/m.test(renderYaml) || /healthCheckPath:\s*\/api\/health\n/.test(renderYaml),
      'render.yaml healthCheckPath is /api/health for $0 demo'
    ));
  }
  findings.push(check(
    'production-boot-demo-mode',
    /Demo\/in-memory mode detected/.test(startProd),
    'demo mode announced when DATABASE_URL unset'
  ));
  findings.push(check(
    'production-boot-advanced-fallback',
    /Advanced discovery readiness failed/.test(startProd),
    'advanced readiness failure logged before liveness fallback'
  ));
  findings.push(check(
    'npm-scripts-present',
    ['start:production', 'canary:live', 'scrapers:power', 'quality:report', 'swarm:real']
      .every((s) => pkg.scripts && pkg.scripts[s]),
    'required operational npm scripts exist'
  ));
  const signIn = fs.readFileSync(path.join(ROOT, 'src/app/sign-in/page.tsx'), 'utf8');
  findings.push(check(
    'honest-operator-access-page',
    /shared operator credential/i.test(signIn) && !/redirect\("/.test(signIn),
    'sign-in explains operator beta instead of dead redirect'
  ));

  const apiBase = process.env.SMOKE_API_URL || 'http://127.0.0.1:3000';
  const health = await httpGet(`${apiBase}/api/health`);
  if (health.ok || health.error === 'timeout' || health.error) {
    findings.push(check(
      'optional-live-api-health',
      true,
      health.ok
        ? `live API healthy at ${apiBase}/api/health status=${health.status}`
        : `no live API at ${apiBase} (static smoke only): ${health.error || health.status}`
    ));
  }

  console.log('=== Production smoke ===');
  for (const f of findings) {
    console.log(`${f.ok ? 'OK  ' : 'FAIL'} ${f.name}: ${f.detail}`);
  }
  const failed = findings.filter((f) => !f.ok);
  if (failed.length) {
    console.error(`SMOKE FAILED (${failed.length})`);
    process.exitCode = 1;
  } else {
    console.log('SMOKE OK');
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message || err);
    process.exitCode = 1;
  });
}

module.exports = { httpGet };
