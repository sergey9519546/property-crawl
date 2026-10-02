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
      res.on('end', () => resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, body: body.slice(0, 200) }));
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
    'production-boot-loads-local-env',
    /loadLocalEnvFiles/.test(startProd) && /--env-file-if-exists=\.env\.local/.test(startProd),
    'API child process loads .env.local (operator token parity with Next)'
  ));
  findings.push(check(
    'document-review-durable-store',
    fs.existsSync(path.join(ROOT, 'server/intelligence/document-review-store.js'))
      && /createDocumentReviewStore/.test(fs.readFileSync(path.join(ROOT, 'server/routes/document-review.js'), 'utf8'))
      && /unbrowse/.test(fs.readFileSync(path.join(ROOT, 'src/lib/property-api.ts'), 'utf8'))
      && /document_reviews/.test(fs.readFileSync(path.join(ROOT, 'server/db/schema.sql'), 'utf8'))
      && /schema\.sql/.test(fs.readFileSync(path.join(ROOT, 'Dockerfile.production'), 'utf8')),
    'document-review store + PG schema + Docker schema copy present'
  ));
  findings.push(check(
    'schema-mirror-sync',
    (() => {
      try {
        const { execFileSync } = require('node:child_process');
        execFileSync(process.execPath, [path.join(ROOT, 'scripts/sync-schema-mirror.js'), '--check'], { cwd: ROOT, stdio: 'pipe' });
        return true;
      } catch { return false; }
    })(),
    'src/lib/db/schema.sql and all migrations match server/db/'
  ));
  findings.push(check(
    'production-e2e-gate-present',
    fs.existsSync(path.join(ROOT, 'scripts/run-production-e2e.js'))
      && Boolean(pkg.scripts && pkg.scripts['test:production-e2e'])
      && /run-production-e2e\.js/.test(fs.readFileSync(path.join(ROOT, '.github/workflows/ci.yml'), 'utf8')),
    'production boot + e2e is wired into package scripts and CI unit-gate'
  ));
  // The finding below claims an ORDER ("logged before liveness fallback"), so
  // verify the order. The previous test only proved the log string existed
  // somewhere in the file, which would have passed just as happily with the
  // log moved after the fallback - the one ordering that would hide the cause
  // of a degraded boot.
  const readinessFailureAt = startProd.indexOf('Advanced discovery readiness failed');
  const livenessFallbackAt = startProd.indexOf('waitForHealth(liveUrl');
  findings.push(check(
    'production-boot-advanced-fallback',
    readinessFailureAt !== -1 && livenessFallbackAt !== -1 && readinessFailureAt < livenessFallbackAt,
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

  // Always report what the live probe found. This finding used to be wrapped
  // in a status guard that skipped it whenever the API answered 5xx, so a
  // reachable-but-unhealthy API produced NO line at all - the result that most
  // deserves attention was the one case the report stayed silent about. The
  // probe also treated any status below 500 as healthy, so a 404 (route moved,
  // wrong path, bad deploy) was announced as "live API healthy".
  //
  // Three outcomes, and only one of them is a failure:
  //   - 2xx              -> healthy
  //   - reachable, other -> FAIL: you pointed the smoke at a live API and it
  //                         is not serving health
  //   - unreachable      -> pass: CI runs this with no stack running, so an
  //                         absent API is the expected case, and the detail
  //                         line says so explicitly.
  const apiBase = process.env.SMOKE_API_URL || 'http://127.0.0.1:3000';
  const health = await httpGet(`${apiBase}/api/health`);
  const reachable = typeof health.status === 'number';
  findings.push(check(
    'optional-live-api-health',
    reachable ? health.ok : true,
    reachable
      ? (health.ok
        ? `live API healthy at ${apiBase}/api/health status=${health.status}`
        : `live API at ${apiBase} answered status=${health.status}, which is not healthy`)
      : `no live API at ${apiBase} (static smoke only): ${health.error || 'no status'}`
  ));

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
