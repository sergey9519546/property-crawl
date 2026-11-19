'use strict';

const DEFAULT_CANONICAL_ORIGIN = 'https://perfectproperty.bid';
const DEFAULT_APP_HOST = 'perfectproperty.bid';
const DEFAULT_ALERTS_FROM = 'PerfectProperty Alerts <alerts@perfectproperty.bid>';

/**
 * Resolves the canonical public origin for metadata, sitemaps, alerts, and pings.
 * Always strips trailing slashes and falls back strictly to https://perfectproperty.bid.
 */
function getCanonicalOrigin(explicitOrigin, env = typeof process !== 'undefined' ? process.env : {}) {
  const raw =
    explicitOrigin ||
    env?.PUBLIC_APP_ORIGIN ||
    env?.NEXT_PUBLIC_APP_URL ||
    DEFAULT_CANONICAL_ORIGIN;
  const trimmed = String(raw || '').trim().replace(/\/+$/, '');
  return trimmed || DEFAULT_CANONICAL_ORIGIN;
}

module.exports = {
  DEFAULT_CANONICAL_ORIGIN,
  DEFAULT_APP_HOST,
  DEFAULT_ALERTS_FROM,
  getCanonicalOrigin,
};
