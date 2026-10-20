'use strict';

/**
 * Per-host AutoThrottle + Retry-After + Crawlee-style adaptive latency throttling.
 */

const DEFAULT_TARGET_LATENCY_MS = 1500;
const DEFAULT_MAX_INTERVAL_MS = 5000;
const DEFAULT_MIN_INTERVAL_MS = 250;
const DEFAULT_ALPHA = 0.25;

const hostLastRequest = new Map();
const hostRetryAfterUntil = new Map();
const hostLatencyEma = new Map();

function hostnameOf(url) {
  try { return new URL(String(url)).hostname || 'unknown'; } catch { return 'unknown'; }
}

function parseRetryAfterMs(value) {
  if (value == null || value === '') return null;
  const raw = String(value).trim();
  if (/^\d+$/.test(raw)) return Math.min(300000, Number(raw) * 1000);
  const date = Date.parse(raw);
  if (Number.isFinite(date)) return Math.min(300000, Math.max(0, date - Date.now()));
  return null;
}

/**
 * Record a request duration for a host and update its exponential moving average (EMA).
 *
 * @param {string} url - Full URL or hostname.
 * @param {number} durationMs - Request duration in milliseconds.
 * @param {object} [options={}] - Optional tuning parameters (e.g. alpha).
 * @returns {{ host: string, durationMs: number, emaMs: number }}
 */
function recordHostLatency(url, durationMs, options = {}) {
  const host = typeof url === 'string' && url.includes('://') ? hostnameOf(url) : String(url || 'unknown');
  const duration = Math.max(0, Number(durationMs) || 0);
  const alpha = Number.isFinite(options.alpha) ? options.alpha : DEFAULT_ALPHA;
  const current = hostLatencyEma.get(host);
  const nextEma = current == null
    ? duration
    : Math.round(alpha * duration + (1 - alpha) * current);
  hostLatencyEma.set(host, nextEma);
  return { host, durationMs: duration, emaMs: nextEma };
}

/**
 * Compute the effective minimum interval for a host, scaling up if latency spikes above target.
 *
 * @param {string} urlOrHost - Target URL or hostname.
 * @param {number} [baseIntervalMs] - Baseline interval (defaults to env or 250ms).
 * @param {object} [options={}] - Options (targetLatencyMs, maxIntervalMs, env).
 * @returns {number} Effective min interval in ms clamped to maxIntervalMs.
 */
function computeAdaptiveInterval(urlOrHost, baseIntervalMs, options = {}) {
  const host = typeof urlOrHost === 'string' && urlOrHost.includes('://')
    ? hostnameOf(urlOrHost)
    : String(urlOrHost || 'unknown');
  const ema = hostLatencyEma.get(host);
  const env = options.env || process.env;
  const targetLatencyMs = Number(options.targetLatencyMs ?? env.SCRAPER_TARGET_LATENCY_MS ?? DEFAULT_TARGET_LATENCY_MS);
  const maxIntervalMs = Number(options.maxIntervalMs ?? env.SCRAPER_MAX_HOST_INTERVAL_MS ?? DEFAULT_MAX_INTERVAL_MS);
  const base = Math.max(0, Number(baseIntervalMs ?? env.SCRAPER_MIN_HOST_INTERVAL_MS ?? DEFAULT_MIN_INTERVAL_MS));

  if (ema == null || ema <= targetLatencyMs) {
    return base;
  }

  // Scale interval up adaptively when EMA exceeds target
  const ratio = ema / targetLatencyMs;
  const scaled = Math.round(base * ratio);
  return Math.min(maxIntervalMs, Math.max(base, scaled));
}

function getHostLatencyEma(urlOrHost) {
  const host = typeof urlOrHost === 'string' && urlOrHost.includes('://')
    ? hostnameOf(urlOrHost)
    : String(urlOrHost || 'unknown');
  return hostLatencyEma.get(host) ?? null;
}

async function autoThrottle(url, options = {}) {
  const env = options.env || process.env;
  const host = hostnameOf(url);
  const baseMinIntervalMs = Number(options.minIntervalMs ?? env.SCRAPER_MIN_HOST_INTERVAL_MS ?? DEFAULT_MIN_INTERVAL_MS);
  const effectiveMinIntervalMs = computeAdaptiveInterval(host, baseMinIntervalMs, options);

  // Tests stay fast unless the suite explicitly opts into throttling.
  const disabled = options.disabled === true
    || (options.minIntervalMs == null && env.NODE_ENV === 'test' && env.SCRAPER_MIN_HOST_INTERVAL_MS == null);
  if (disabled) {
    return {
      host,
      waitedMs: 0,
      minIntervalMs: 0,
      effectiveMinIntervalMs: 0,
      baseMinIntervalMs,
      disabled: true
    };
  }

  const sleep = options.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const now = Date.now();
  const retryUntil = hostRetryAfterUntil.get(host) || 0;
  const last = hostLastRequest.get(host) || 0;
  let waitMs = 0;
  if (retryUntil > now) waitMs = Math.max(waitMs, retryUntil - now);
  const due = last + effectiveMinIntervalMs;
  if (due > now) waitMs = Math.max(waitMs, due - now);
  if (waitMs > 0) await sleep(Math.min(waitMs, 30000));
  hostLastRequest.set(host, Date.now());
  return {
    host,
    waitedMs: waitMs,
    minIntervalMs: effectiveMinIntervalMs,
    effectiveMinIntervalMs,
    baseMinIntervalMs,
    emaLatencyMs: hostLatencyEma.get(host) ?? null
  };
}

function noteRetryAfter(url, retryAfterHeader) {
  const host = hostnameOf(url);
  const ms = parseRetryAfterMs(retryAfterHeader);
  if (ms == null) return null;
  hostRetryAfterUntil.set(host, Date.now() + ms);
  return { host, retryAfterMs: ms };
}

function resetThrottleState() {
  hostLastRequest.clear();
  hostRetryAfterUntil.clear();
  hostLatencyEma.clear();
}

module.exports = {
  autoThrottle,
  noteRetryAfter,
  parseRetryAfterMs,
  hostnameOf,
  resetThrottleState,
  recordHostLatency,
  computeAdaptiveInterval,
  getHostLatencyEma,
  hostLatencyEma,
  DEFAULT_TARGET_LATENCY_MS,
  DEFAULT_MAX_INTERVAL_MS,
  DEFAULT_MIN_INTERVAL_MS
};
