'use strict';

const fs = require('node:fs');
const path = require('node:path');
const DEFAULT_MIN_FREE_BYTES = 1024 * 1024 * 1024;

// This measures the collector's local volume, not a remote PostgreSQL server.
function inspectCollectionStorage({ env = process.env, statfs = fs.statfsSync } = {}) {
  const minimum = env.DISCOVERY_MIN_FREE_BYTES === undefined
    ? DEFAULT_MIN_FREE_BYTES : Number(env.DISCOVERY_MIN_FREE_BYTES);
  if (!Number.isSafeInteger(minimum) || minimum < 1) {
    return { ready: false, code: 'DISCOVERY_STORAGE_CONFIG', reason: 'DISCOVERY_MIN_FREE_BYTES must be a positive integer' };
  }
  const storagePath = path.resolve(env.DISCOVERY_STORAGE_PATH || process.cwd());
  try {
    const stats = statfs(storagePath, { bigint: true });
    const available = BigInt(stats.bavail) * BigInt(stats.bsize);
    const freeBytes = Number(available > BigInt(Number.MAX_SAFE_INTEGER) ? BigInt(Number.MAX_SAFE_INTEGER) : available);
    const ready = available >= BigInt(minimum);
    return { ready, freeBytes, minimumFreeBytes: minimum, scope: 'collector_local_volume',
      ...(ready ? {} : { code: 'DISCOVERY_STORAGE_LOW', reason: 'Collection paused: local storage is below the free-space reserve' }) };
  } catch {
    return { ready: false, code: 'DISCOVERY_STORAGE_UNAVAILABLE', scope: 'collector_local_volume',
      reason: 'Collector storage capacity could not be checked' };
  }
}

function requireCollectionStorage(probe = inspectCollectionStorage) {
  const health = probe();
  if (!health?.ready) {
    const error = new Error(health?.reason || 'Collector storage is unavailable');
    error.code = health?.code || 'DISCOVERY_STORAGE_UNAVAILABLE';
    throw error;
  }
  return health;
}

module.exports = { inspectCollectionStorage, requireCollectionStorage, DEFAULT_MIN_FREE_BYTES };
