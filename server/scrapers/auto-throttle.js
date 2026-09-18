'use strict';

/**
 * Per-host AutoThrottle + Retry-After (Crawlee-style polish for foolproof scrape).
 */

const hostLastRequest = new Map();
const hostRetryAfterUntil = new Map();

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

async function autoThrottle(url, options = {}) {
  const env = options.env || process.env;
  // Tests stay fast unless the suite explicitly opts into throttling.
  const disabled = options.disabled === true
    || (options.minIntervalMs == null && env.NODE_ENV === 'test' && env.SCRAPER_MIN_HOST_INTERVAL_MS == null);
  if (disabled) return { host: hostnameOf(url), waitedMs: 0, minIntervalMs: 0, disabled: true };
  const host = hostnameOf(url);
  const minIntervalMs = Number(options.minIntervalMs ?? env.SCRAPER_MIN_HOST_INTERVAL_MS ?? 250);
  const sleep = options.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const now = Date.now();
  const retryUntil = hostRetryAfterUntil.get(host) || 0;
  const last = hostLastRequest.get(host) || 0;
  let waitMs = 0;
  if (retryUntil > now) waitMs = Math.max(waitMs, retryUntil - now);
  const due = last + minIntervalMs;
  if (due > now) waitMs = Math.max(waitMs, due - now);
  if (waitMs > 0) await sleep(Math.min(waitMs, 30000));
  hostLastRequest.set(host, Date.now());
  return { host, waitedMs: waitMs, minIntervalMs };
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
}

module.exports = {
  autoThrottle,
  noteRetryAfter,
  parseRetryAfterMs,
  hostnameOf,
  resetThrottleState,
};
