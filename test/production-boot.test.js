'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const startProduction = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'start-production.js'), 'utf8');

test('production orchestrator waits on liveness, not advanced readiness, for demo boot', () => {
  assert.match(startProduction, /\/api\/health['"`]/);
  assert.match(startProduction, /Demo\/in-memory mode detected/);
  assert.match(startProduction, /Advanced discovery readiness failed/);
  // Must not gate Next UI start on /api/health/ready.
  assert.doesNotMatch(
    startProduction,
    /await waitForHealth\(`http:\/\/127\.0\.0\.1:\$\{publicPort\}\/api\/health\/ready`\)/
  );
  assert.match(
    startProduction,
    /await waitForHealth\(`http:\/\/127\.0\.0\.1:\$\{publicPort\}\/api\/health`\)/
  );
});
