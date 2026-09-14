'use strict';
// Exceeds the worker's maximum 300-second polling interval with startup margin.
const DEFAULT_MAX_AGE_SECONDS = 360;

function workerHealthStatus(row, now = Date.now(), maxAgeSeconds = DEFAULT_MAX_AGE_SECONDS) {
  if (!row) return 'not_started';
  if (row.last_loop_status === 'lease_lost') return 'lease_lost';
  const seen = Date.parse(row.last_seen_at);
  if (!Number.isFinite(seen) || seen > now + 60_000 || now - seen > maxAgeSeconds * 1000) return 'stale';
  return 'healthy';
}

module.exports = { DEFAULT_MAX_AGE_SECONDS, workerHealthStatus };
