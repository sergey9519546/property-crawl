'use strict';

// test/production-smoke-health.test.js
//
// scripts/production-smoke.js ends with an optional live probe of /api/health.
// Two things were wrong with it, and both made the smoke pass while saying
// something untrue or nothing at all:
//
//   1. `ok` was `status < 500`, so a 404 (route moved, wrong path, bad deploy)
//      was reported as "live API healthy".
//   2. The finding was wrapped in `if (health.ok || health.error)`, so an API
//      that answered 5xx produced NO line at all - the result that most
//      deserves attention was the one case the report stayed silent about.
//
// An unreachable API must keep passing: CI runs this with no stack running.
// These tests pin that distinction with a real server, not a mock.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { execFile } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'production-smoke.js');

// The server must live outside this process: execFile blocks the event loop,
// so a same-process server can never answer. That mistake made the first
// version of this file report "timeout" for every status code and prove
// nothing.
function runSmoke(apiBase) {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [SCRIPT],
      { cwd: ROOT, encoding: 'utf8', env: { ...process.env, SMOKE_API_URL: apiBase }, maxBuffer: 16 * 1024 * 1024 },
      (err, stdout, stderr) => resolve({ exitCode: err ? err.code ?? 1 : 0, out: `${stdout}${stderr}` })
    );
  });
}

async function withStatus(status, fn) {
  const server = http.createServer((req, res) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ status: 'down' }));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  try {
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((r) => server.close(r));
  }
}

function healthLine(out) {
  return out.split(/\r?\n/).find((l) => l.includes('optional-live-api-health'));
}

test('a 2xx health response passes and says so', async () => {
  await withStatus(200, async (base) => {
    const { out } = await runSmoke(base);
    const line = healthLine(out);
    assert.ok(line, 'the live-health finding must always be reported');
    assert.match(line, /^OK\s/);
    assert.match(line, /live API healthy .*status=200/);
    // Deliberately not asserting the process exit code here. The smoke also
    // runs ten static checks against the working tree, and any one of those can
    // fail for reasons unrelated to health. The health finding's own verdict is
    // what this test is about; the failure path is asserted below via the
    // finding line and SMOKE FAILED.
  });
});

test('a 404 is not reported as a healthy live API', async () => {
  await withStatus(404, async (base) => {
    const { out } = await runSmoke(base);
    const line = healthLine(out);
    assert.ok(line, 'the finding must be present, not skipped');
    assert.match(line, /^FAIL\s/, 'a 404 health response must not pass the smoke');
    assert.doesNotMatch(line, /live API healthy/);
    assert.match(line, /status=404/);
    assert.match(out, /SMOKE FAILED/);
  });
});

test('a 5xx health response is reported rather than vanishing', async () => {
  for (const status of [500, 502, 503]) {
    await withStatus(status, async (base) => {
      const { out } = await runSmoke(base);
      const line = healthLine(out);
      assert.ok(line, `status ${status}: the finding must be present, not skipped`);
      assert.match(line, /^FAIL\s/, `status ${status} must fail the smoke`);
      assert.match(line, new RegExp(`status=${status}`));
      assert.match(out, /SMOKE FAILED/);
    });
  }
});

test('an unreachable API still passes, because CI runs with no stack', async () => {
  // Port 1 is reserved and never listening; this is the CI-shaped case.
  const { out } = await runSmoke('http://127.0.0.1:1');
  const line = healthLine(out);
  assert.ok(line, 'the finding must be present even with no API');
  assert.match(line, /^OK\s/);
  assert.match(line, /static smoke only/);
});

test('the live-health finding is unconditional, not gated behind a status test', () => {
  // The regression was an `if (health.ok || health.error)` wrapper that dropped
  // the 5xx case. Assert the structure so it cannot come back.
  const source = fs.readFileSync(SCRIPT, 'utf8');
  assert.doesNotMatch(
    source,
    /if\s*\(\s*health\.ok\s*\|\|/,
    'the live-health finding must not be wrapped in a condition that can skip it'
  );
});

test('the advanced-readiness finding actually verifies the ordering it claims', () => {
  // Its detail says "logged before liveness fallback". A presence-only regex
  // passes just as well with the log moved after the fallback, which is the one
  // ordering that would hide why a boot degraded. Assert the comparison exists.
  const source = fs.readFileSync(SCRIPT, 'utf8');
  assert.match(source, /readinessFailureAt\s*<\s*livenessFallbackAt/);
  assert.doesNotMatch(
    source,
    /\/Advanced discovery readiness failed\/\.test\(startProd\)/,
    'a presence-only test does not verify the ordering the finding claims'
  );
  // And the real boot script must still satisfy it.
  const startProd = fs.readFileSync(path.join(ROOT, 'scripts/start-production.js'), 'utf8');
  assert.ok(
    startProd.indexOf('Advanced discovery readiness failed') < startProd.indexOf('waitForHealth(liveUrl'),
    'start-production.js should log the readiness failure before falling back to liveness'
  );
});
