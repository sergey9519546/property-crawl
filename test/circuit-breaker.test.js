'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { ScraperCircuitBreaker, ScraperResponseError } = require('../server/scrapers/circuit-breaker');

test('ScraperCircuitBreaker starts in CLOSED state with zero failures', () => {
  const breaker = new ScraperCircuitBreaker();
  assert.equal(breaker.state, 'CLOSED');
  assert.equal(breaker.isOpen(), false);
  assert.equal(breaker.isClosed(), true);
  assert.equal(breaker.isHalfOpen(), false);
  assert.equal(breaker.consecutiveFailures, 0);
  assert.equal(breaker.lastTrippedAt, null);
  assert.equal(breaker.lastFailureAt, null);
});

test('ScraperCircuitBreaker trips to OPEN on immediate failure', () => {
  const breaker = new ScraperCircuitBreaker({ failureThreshold: 3 });
  breaker.trip('HTTP 403 Forbidden', { immediate: true });

  assert.equal(breaker.state, 'OPEN');
  assert.equal(breaker.isOpen(), true);
  assert.equal(breaker.isClosed(), false);
  assert.equal(breaker.isHalfOpen(), false);
  assert.equal(typeof breaker.lastTrippedAt, 'number');
  assert.ok(breaker.lastTrippedAt > 0);
  assert.equal(breaker.lastFailureReason, 'HTTP 403 Forbidden');
});

test('ScraperCircuitBreaker trips to OPEN when failureThreshold is reached', () => {
  const breaker = new ScraperCircuitBreaker({ failureThreshold: 3 });
  breaker.trip('Failure 1');
  assert.equal(breaker.state, 'CLOSED');
  assert.equal(breaker.isOpen(), false);

  breaker.trip('Failure 2');
  assert.equal(breaker.state, 'CLOSED');
  assert.equal(breaker.isOpen(), false);

  breaker.trip('Failure 3');
  assert.equal(breaker.state, 'OPEN');
  assert.equal(breaker.isOpen(), true);
});

test('ScraperCircuitBreaker honors configurable cooldownMs in options and env', () => {
  const defaultBreaker = new ScraperCircuitBreaker();
  assert.equal(defaultBreaker.cooldownMs, 3600000); // 1 hour default

  const customBreaker = new ScraperCircuitBreaker({ cooldownMs: 5000 });
  assert.equal(customBreaker.cooldownMs, 5000);

  const prevEnv = process.env.SCRAPER_CIRCUIT_BREAKER_COOLDOWN_MS;
  try {
    process.env.SCRAPER_CIRCUIT_BREAKER_COOLDOWN_MS = '120000';
    const envBreaker = new ScraperCircuitBreaker();
    assert.equal(envBreaker.cooldownMs, 120000);
  } finally {
    if (prevEnv !== undefined) {
      process.env.SCRAPER_CIRCUIT_BREAKER_COOLDOWN_MS = prevEnv;
    } else {
      delete process.env.SCRAPER_CIRCUIT_BREAKER_COOLDOWN_MS;
    }
  }
});

test('cooldown expiration automatically transitions state from OPEN to HALF-OPEN', async () => {
  const breaker = new ScraperCircuitBreaker({ cooldownMs: 50 });
  breaker.trip('WAF bot challenge', { immediate: true });

  assert.equal(breaker.state, 'OPEN');
  assert.equal(breaker.isOpen(), true);

  // Before cooldown expires: remains OPEN
  assert.equal(breaker.state, 'OPEN');
  assert.equal(breaker.isOpen(), true);

  // Wait for cooldown to expire
  await new Promise((resolve) => setTimeout(resolve, 60));

  // After cooldown expires: transitions to HALF-OPEN and allows probe request
  assert.equal(breaker.state, 'HALF-OPEN');
  assert.equal(breaker.isHalfOpen(), true);
  assert.equal(breaker.isOpen(), false, 'HALF-OPEN allows single probe request through');
});

test('probe success via recordSuccess() resets circuit to CLOSED', () => {
  const breaker = new ScraperCircuitBreaker({ cooldownMs: 1000 });
  breaker.trip('WAF challenge', { immediate: true });
  assert.equal(breaker.state, 'OPEN');

  // Fast-forward lastTrippedAt past cooldown
  breaker.lastTrippedAt = Date.now() - 2000;
  assert.equal(breaker.state, 'HALF-OPEN');
  assert.equal(breaker.isOpen(), false);

  // Probe succeeds
  breaker.recordSuccess();

  assert.equal(breaker.state, 'CLOSED');
  assert.equal(breaker.isOpen(), false);
  assert.equal(breaker.isClosed(), true);
  assert.equal(breaker.consecutiveFailures, 0);
  assert.equal(breaker.lastTrippedAt, null);
  assert.equal(breaker.lastFailureAt, null);
  assert.equal(breaker.lastFailureReason, null);
});

test('probe failure in HALF-OPEN immediately re-trips state to OPEN and resets timer', () => {
  const breaker = new ScraperCircuitBreaker({ cooldownMs: 1000, failureThreshold: 5 });
  breaker.trip('Initial 403', { immediate: true });

  // Fast-forward into HALF-OPEN
  breaker.lastTrippedAt = Date.now() - 2000;
  assert.equal(breaker.state, 'HALF-OPEN');

  const beforeTrip = Date.now();
  // Probe fails - should re-trip immediately even though consecutiveFailures < failureThreshold
  breaker.trip('Probe 403 encountered');

  assert.equal(breaker.state, 'OPEN');
  assert.equal(breaker.isOpen(), true);
  assert.ok(breaker.lastTrippedAt >= beforeTrip);
  assert.equal(breaker.lastFailureReason, 'Probe 403 encountered');
});

test('probe failure in HALF-OPEN via recordFailure() immediately re-trips state to OPEN', () => {
  const breaker = new ScraperCircuitBreaker({ cooldownMs: 1000 });
  breaker.trip('Initial challenge', { immediate: true });

  breaker.lastTrippedAt = Date.now() - 2000;
  assert.equal(breaker.state, 'HALF-OPEN');

  breaker.recordFailure('Probe failed');
  assert.equal(breaker.state, 'OPEN');
  assert.equal(breaker.isOpen(), true);
});

test('validateResponse transitions HALF-OPEN to CLOSED on valid 200 payload', () => {
  const breaker = new ScraperCircuitBreaker({ cooldownMs: 1000, minPayloadBytes: 10 });
  breaker.trip('403 Forbidden', { immediate: true });

  breaker.lastTrippedAt = Date.now() - 2000;
  assert.equal(breaker.state, 'HALF-OPEN');

  const result = breaker.validateResponse({
    status: 200,
    body: '<html><body>Healthy Listing 12345</body></html>',
  });

  assert.equal(result.isValid, true);
  assert.equal(result.error, null);
  assert.equal(breaker.state, 'CLOSED');
  assert.equal(breaker.isOpen(), false);
});

test('validateResponse re-trips HALF-OPEN to OPEN on 403 or challenge payload', () => {
  const breaker = new ScraperCircuitBreaker({ cooldownMs: 1000 });
  breaker.trip('Initial trip', { immediate: true });

  breaker.lastTrippedAt = Date.now() - 2000;
  assert.equal(breaker.state, 'HALF-OPEN');

  const result = breaker.validateResponse({
    status: 403,
    body: '<html>Forbidden</html>',
  });

  assert.equal(result.isValid, false);
  assert.equal(breaker.state, 'OPEN');
  assert.equal(breaker.isOpen(), true);
});

test('cooldown correctly parses ISO string in lastFailureAt if lastTrippedAt is null', () => {
  const breaker = new ScraperCircuitBreaker({ cooldownMs: 1000 });
  breaker.state = 'OPEN';
  breaker.lastTrippedAt = null;
  breaker.lastFailureAt = new Date(Date.now() - 5000).toISOString();

  assert.equal(breaker.state, 'HALF-OPEN');
  assert.equal(breaker.isOpen(), false);
});
