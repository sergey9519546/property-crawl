'use strict';

const fs = require('fs');
const path = require('path');

const MEMORY_CACHE = new Map();

function loadJsonDiskCache(cachePath) {
  try {
    const stat = fs.statSync(cachePath);
    const memo = MEMORY_CACHE.get(cachePath);
    if (memo && memo.mtimeMs === stat.mtimeMs && memo.size === stat.size) {
      return memo.data;
    }
    const parsed = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      if (MEMORY_CACHE.size >= 32) {
        const oldest = MEMORY_CACHE.keys().next().value;
        if (oldest !== undefined) MEMORY_CACHE.delete(oldest);
      }
      MEMORY_CACHE.set(cachePath, { mtimeMs: stat.mtimeMs, size: stat.size, data: parsed });
      return parsed;
    }
  } catch {
    MEMORY_CACHE.delete(cachePath);
  }
  return {};
}

function saveJsonDiskCache(cache, cachePath) {
  try {
    const dir = path.dirname(cachePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    // Crash-safe write: a killed process must never truncate the cache file.
    const tmpPath = `${cachePath}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(tmpPath, JSON.stringify(cache, null, 2), 'utf8');
    fs.renameSync(tmpPath, cachePath);
    const stat = fs.statSync(cachePath);
    MEMORY_CACHE.set(cachePath, { mtimeMs: stat.mtimeMs, size: stat.size, data: cache });
  } catch {
    MEMORY_CACHE.delete(cachePath);
  }
}

const { getDurableCache, setDurableCache, pruneDurableCache } = require('./durable-cache');

module.exports = {
  loadJsonDiskCache,
  saveJsonDiskCache,
  getDurableCache,
  setDurableCache,
  pruneDurableCache,
};
