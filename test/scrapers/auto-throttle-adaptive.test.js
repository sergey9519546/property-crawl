'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  autoThrottle,
  recordHostLatency,
  computeAdaptiveInterval,
  getHostLatencyEma,
  resetThrottleState,
  DEFAULT_TARGET_LATENCY_MS,
  DEFAULT_MAX_INTERVAL_MS,
  DEFAULT_MIN_INTERVAL_MS
} = require('../../server/scrapers/auto-throttle');

test.beforeEach(() => {
  resetThrottleState();
});

test('recordHostLatency: records initial latency as host EMA and parses hostname from URL', () => {
  const result = recordHostLatency('https://salesweb.civilview.com/Sales/SalesDetails?id=123', 800);
  assert.equal(result.host, 'salesweb.civilview.com');
  assert.equal(result.durationMs, 800);
  assert.equal(result.emaMs, 800);
  assert.equal(getHostLatencyEma('https://salesweb.civilview.com/other'), 800);
});

test('recordHostLatency: updates EMA with exponential moving average formula', () => {
  const host = 'https://api.example.gov/listings';
  recordHostLatency(host, 1000, { alpha: 0.25 });
  assert.equal(getHostLatencyEma(host), 1000);

  // Second observation: 0.25 * 2000 + 0.75 * 1000 = 500 + 750 = 1250
  recordHostLatency(host, 2000, { alpha: 0.25 });
  assert.equal(getHostLatencyEma(host), 1250);

  // Third observation: 0.25 * 2000 + 0.75 * 1250 = 500 + 937.5 = 1438 (rounded)
  recordHostLatency(host, 2000, { alpha: 0.25 });
  assert.equal(getHostLatencyEma(host), 1438);
});

test('computeAdaptiveInterval: remains at base minIntervalMs when latency is <= target', () => {
  const host = 'https://fast.gov/api';
  recordHostLatency(host, 400); // 400ms is well below 1500ms target
  const interval = computeAdaptiveInterval(host, 250, { targetLatencyMs: 1500, maxIntervalMs: 5000 });
  assert.equal(interval, 250);
});

test('computeAdaptiveInterval: adaptively scales up when latency spikes above target', () => {
  const host = 'https://laggy.gov/api';
  // Simulate latency spike: 3000ms against 1500ms target (ratio = 2.0)
  recordHostLatency(host, 3000);
  const interval = computeAdaptiveInterval(host, 250, { targetLatencyMs: 1500, maxIntervalMs: 5000 });
  // Base 250 * 2.0 = 500ms
  assert.equal(interval, 500);

  // Severe spike: 4500ms against 1500ms target (ratio = 3.0)
  resetThrottleState();
  recordHostLatency(host, 4500);
  const severeInterval = computeAdaptiveInterval(host, 250, { targetLatencyMs: 1500, maxIntervalMs: 5000 });
  // Base 250 * 3.0 = 750ms
  assert.equal(severeInterval, 750);
});

test('computeAdaptiveInterval: clamps scaling to maxIntervalMs on extreme latency spikes', () => {
  const host = 'https://overwhelmed.gov/api';
  // Extreme spike: 45,000ms duration
  recordHostLatency(host, 45000);
  const interval = computeAdaptiveInterval(host, 250, { targetLatencyMs: 1500, maxIntervalMs: 5000 });
  assert.equal(interval, 5000);
});

test('computeAdaptiveInterval: gradually decays back to baseline as requests return faster', () => {
  const host = 'https://recovering.gov/api';
  // Initial high spike
  recordHostLatency(host, 4000, { alpha: 0.5 });
  assert.ok(computeAdaptiveInterval(host, 250, { targetLatencyMs: 1500 }) > 250);

  // Subsequent fast responses decay the EMA
  recordHostLatency(host, 200, { alpha: 0.5 }); // 0.5 * 200 + 0.5 * 4000 = 2100
  assert.equal(getHostLatencyEma(host), 2100);

  recordHostLatency(host, 200, { alpha: 0.5 }); // 0.5 * 200 + 0.5 * 2100 = 1150 (<= 1500)
  assert.equal(getHostLatencyEma(host), 1150);

  const recoveredInterval = computeAdaptiveInterval(host, 250, { targetLatencyMs: 1500 });
  assert.equal(recoveredInterval, 250);
});

test('autoThrottle: scales delay when latency is elevated and respects mock sleep', async () => {
  const host = 'https://throttled.gov/search';
  recordHostLatency(host, 3000); // 3000ms EMA with 1500ms target -> 2x base interval

  const sleeps = [];
  const mockSleep = (ms) => { sleeps.push(ms); return Promise.resolve(); };

  // First request: initializes hostLastRequest
  const first = await autoThrottle(host, { minIntervalMs: 250, targetLatencyMs: 1500, sleep: mockSleep });
  assert.equal(first.effectiveMinIntervalMs, 500);
  assert.equal(first.waitedMs, 0);

  // Immediate second request: should wait effectiveMinIntervalMs (500ms)
  const second = await autoThrottle(host, { minIntervalMs: 250, targetLatencyMs: 1500, sleep: mockSleep });
  assert.equal(second.effectiveMinIntervalMs, 500);
  assert.ok(second.waitedMs >= 490, `expected wait near 500ms, got ${second.waitedMs}`);
  assert.ok(sleeps.length > 0);
  assert.ok(sleeps[0] >= 490);
});

test('autoThrottle: backward compatibility with options.disabled and return structure', async () => {
  const url = 'https://bypass.gov/test';
  const res = await autoThrottle(url, { disabled: true });
  assert.equal(res.disabled, true);
  assert.equal(res.waitedMs, 0);
  assert.equal(res.minIntervalMs, 0);
  assert.equal(res.host, 'bypass.gov');
});

test('resetThrottleState: clears all recorded host EMAs and throttles', () => {
  recordHostLatency('https://host1.gov/api', 2000);
  recordHostLatency('https://host2.gov/api', 1200);
  assert.ok(getHostLatencyEma('https://host1.gov/api'));
  assert.ok(getHostLatencyEma('https://host2.gov/api'));

  resetThrottleState();
  assert.equal(getHostLatencyEma('https://host1.gov/api'), null);
  assert.equal(getHostLatencyEma('https://host2.gov/api'), null);
});
