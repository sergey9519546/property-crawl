'use strict';

// test/discovery/worker-health-helpers.test.js
//
// Direct unit coverage for server/discovery/worker-health.js. The
// worker /health endpoint renders the result of workerHealthStatus as
// "not_started" / "lease_lost" / "stale" / "healthy" — silent drift in
// the staleness window or status projection would silently mis-report
// worker liveness and let a stuck worker be treated as alive.
//
//   - row null -> not_started
//   - last_loop_status === 'lease_lost' -> lease_lost (priority over stale)
//   - missing / future / far-past last_seen_at -> stale
//   - within window -> healthy

const assert = require('node:assert/strict');
const test = require('node:test');

const { workerHealthStatus, DEFAULT_MAX_AGE_SECONDS } = require('../../server/discovery/worker-health');

const NOW = Date.UTC(2026, 4, 7, 12, 0, 0);

test('DEFAULT_MAX_AGE_SECONDS: pinned at 360 (6 minutes, exceeds 300s poll interval)', () => {
  assert.equal(DEFAULT_MAX_AGE_SECONDS, 360);
});

test('workerHealthStatus: null row -> not_started', () => {
  assert.equal(workerHealthStatus(null, NOW), 'not_started');
});

test('workerHealthStatus: lease_lost status beats staleness check', () => {
  const row = { last_loop_status: 'lease_lost', last_seen_at: '2026-05-07T11:59:50.000Z' };
  assert.equal(workerHealthStatus(row, NOW), 'lease_lost');
});

test('workerHealthStatus: last_seen_at within window -> healthy', () => {
  const row = { last_loop_status: 'ok', last_seen_at: '2026-05-07T11:59:50.000Z' };  // 10s ago
  assert.equal(workerHealthStatus(row, NOW), 'healthy');
});

test('workerHealthStatus: last_seen_at at the boundary -> healthy (under window)', () => {
  // 359s = 1 second before staleness threshold
  const row = { last_seen_at: new Date(NOW - 359_000).toISOString() };
  assert.equal(workerHealthStatus(row, NOW), 'healthy');
});

test('workerHealthStatus: last_seen_at over the window -> stale', () => {
  const row = { last_seen_at: new Date(NOW - (360 + 1) * 1000).toISOString() };
  assert.equal(workerHealthStatus(row, NOW), 'stale');
});

test('workerHealthStatus: missing last_seen_at -> stale', () => {
  assert.equal(workerHealthStatus({}, NOW), 'stale');
});

test('workerHealthStatus: unparseable last_seen_at -> stale', () => {
  assert.equal(workerHealthStatus({ last_seen_at: 'not-a-date' }, NOW), 'stale');
});

test('workerHealthStatus: last_seen_at in the future (clock skew) -> stale', () => {
  const row = { last_seen_at: new Date(NOW + 120_000).toISOString() };
  assert.equal(workerHealthStatus(row, NOW), 'stale');
});

test('workerHealthStatus: custom maxAgeSeconds overrides the default', () => {
  const row = { last_seen_at: new Date(NOW - 60_000).toISOString() };  // 60s ago
  assert.equal(workerHealthStatus(row, NOW, 30), 'stale');
  assert.equal(workerHealthStatus(row, NOW, 90), 'healthy');
});