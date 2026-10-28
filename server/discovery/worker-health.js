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

// A durable job pinned at 'running' with an expired lease is the strongest
// evidence available that the pipeline is wedged: no worker holds the row, and
// nothing about the worker's own heartbeat can detect it. The worker can be
// perfectly healthy -- reporting in on time, reporting 'idle' -- while a job it
// abandoned is still frozen at 'running' forever, because an expired lease has
// no code path that closes it. That count used to be surfaced in
// backlog.expiredRunning and then deliberately excluded from `degraded`, so an
// operator read `degraded:false, ready:true` beside a job list with rows stuck
// at 'running'. The status vocabulary is user-visible (it is rendered by the
// source-network workbench and typed in src/), so it is left exactly as it is;
// the wedge is reported through the flag that UI already reads.
function expiredJobBacklogDegraded(backlog) {
  return Number(backlog?.expiredRunning || 0) > 0;
}

// not_started and disabled mean no discovery worker is expected. They are not
// a wedge. stale and lease_lost are. An expired running job is a wedge even
// when the worker row itself is healthy, missing, or disabled.
function collectionDegraded(status, backlog) {
  if (expiredJobBacklogDegraded(backlog)) return true;
  if (status === 'not_started' || status === 'disabled') return false;
  return status !== 'healthy';
}

// Escalate-only normaliser for an already-assembled payload. Deliberately
// monotonic: it can turn `degraded:false` into `degraded:true`, never the
// reverse, so it cannot rewrite a producer's deliberate `degraded:false` for a
// worker that is 'disabled' or 'not_started' (those are not degradation
// signals, and a demo deployment with no worker must not read as degraded).
function withExpiredJobSignal(health) {
  if (!health || typeof health !== 'object') return health;
  if (!expiredJobBacklogDegraded(health.backlog)) return health;
  return { ...health, degraded: true };
}

module.exports = {
  DEFAULT_MAX_AGE_SECONDS,
  workerHealthStatus,
  expiredJobBacklogDegraded,
  collectionDegraded,
  withExpiredJobSignal,
};
