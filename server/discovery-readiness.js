'use strict';

/**
 * Readiness policy for the discovery brain. This helper is intentionally
 * dependency-injected so the API process can check its real database client
 * without making the quality gate depend on a particular DB implementation.
 */
async function discoveryReadiness(options = {}) {
  const env = options.env || process.env;
  const result = {
    ready: false,
    mode: env.DATABASE_URL ? 'advanced' : 'demo',
    checks: {},
    limitations: [],
  };

  if (!env.DATABASE_URL) {
    result.checks.database = { ready: false, reason: 'DATABASE_URL is not configured' };
    result.limitations.push('Demo/in-memory mode cannot provide durable discovery state, leases, or production completeness.');
    return result;
  }

  if (typeof options.databaseProbe !== 'function') {
    result.checks.database = { ready: false, reason: 'database probe is unavailable' };
    return result;
  }

  try {
    await options.databaseProbe();
    result.checks.database = { ready: true };
    result.ready = true;
  } catch (error) {
    result.checks.database = {
      ready: false,
      reason: String(error?.message || error || 'database probe failed').slice(0, 240),
    };
  }
  return result;
}

module.exports = { discoveryReadiness };
