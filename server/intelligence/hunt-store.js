'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_STORE_PATH = path.resolve(__dirname, '../../.cache/saved-hunts.json');
const MAX_STORE_BYTES = 20 * 1024 * 1024;
const MAX_HUNTS = 50;
const MAX_EVENTS = 2000;
const MAX_BASELINE_RECORDS = 10000;
const MAX_TOTAL_BASELINE_RECORDS = 25000;
const HUNT_ID = /^hunt_[a-f0-9]{24}$/;
const EVENT_ID = /^hevt_[a-f0-9]{24}$/;

function emptyStore() {
  return { version: 1, updatedAt: null, hunts: [], baselines: {}, events: [] };
}

function resolveStorePath(filePath) {
  return path.resolve(filePath || process.env.PROPERTY_HUNTS_PATH || DEFAULT_STORE_PATH);
}

function assertStoreShape(store) {
  if (!store || store.version !== 1 || !Array.isArray(store.hunts)
    || !store.baselines || typeof store.baselines !== 'object' || Array.isArray(store.baselines)
    || !Array.isArray(store.events)) throw new Error('Invalid saved-hunt store; existing data was preserved');
  if (store.hunts.length > MAX_HUNTS || store.events.length > MAX_EVENTS) {
    throw new Error('Saved-hunt store exceeds its record limits; existing data was preserved');
  }
  const ids = new Set();
  for (const hunt of store.hunts) {
    if (!hunt || !HUNT_ID.test(hunt.id || '') || ids.has(hunt.id)
      || !Number.isInteger(hunt.version) || hunt.version < 1
      || typeof hunt.name !== 'string' || !hunt.criteria
      || !/^[a-f0-9]{64}$/.test(hunt.criteriaHash || '') || !Array.isArray(hunt.versions)) {
      throw new Error('Invalid saved-hunt record; existing data was preserved');
    }
    ids.add(hunt.id);
  }
  let baselineRecords = 0;
  for (const [huntId, baseline] of Object.entries(store.baselines)) {
    if (!ids.has(huntId) || !baseline || !Number.isInteger(baseline.huntVersion)
      || !baseline.records || typeof baseline.records !== 'object' || Array.isArray(baseline.records)) {
      throw new Error('Invalid saved-hunt baseline; existing data was preserved');
    }
    const count = Object.keys(baseline.records).length;
    if (count > MAX_BASELINE_RECORDS) throw new Error('Saved-hunt baseline exceeds its record limit');
    baselineRecords += count;
  }
  if (baselineRecords > MAX_TOTAL_BASELINE_RECORDS) throw new Error('Saved-hunt baselines exceed their total record limit');
  const eventIds = new Set();
  for (const event of store.events) {
    if (!event || !EVENT_ID.test(event.id || '') || eventIds.has(event.id) || !ids.has(event.huntId)) {
      throw new Error('Invalid saved-hunt event; existing data was preserved');
    }
    eventIds.add(event.id);
  }
  return store;
}

function loadStore(filePath) {
  const resolved = resolveStorePath(filePath);
  if (!fs.existsSync(resolved)) return emptyStore();
  const stats = fs.statSync(resolved);
  if (!stats.isFile() || stats.size > MAX_STORE_BYTES) throw new Error('Saved-hunt store exceeds its safe size limit');
  return assertStoreShape(JSON.parse(fs.readFileSync(resolved, 'utf8')));
}

function mutateStore(filePath, mutate, options = {}) {
  if (typeof mutate !== 'function') throw new TypeError('Saved-hunt mutation must be a function');
  const resolved = resolveStorePath(filePath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  const lockPath = `${resolved}.lock`;
  let lock;
  try {
    lock = fs.openSync(lockPath, 'wx', 0o600);
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error('Saved-hunt store is locked by another writer; retry after it finishes');
    throw error;
  }
  const temporary = `${resolved}.${crypto.randomUUID()}.tmp`;
  try {
    const store = loadStore(resolved);
    const result = mutate(store);
    if (result?.changed === false) return result.value;
    const now = options.now ? new Date(options.now).toISOString() : new Date().toISOString();
    store.updatedAt = now;
    assertStoreShape(store);
    const body = JSON.stringify(store);
    if (Buffer.byteLength(body, 'utf8') > MAX_STORE_BYTES) throw new Error('Saved-hunt store exceeds its safe size limit');
    fs.writeFileSync(temporary, body, { flag: 'wx', mode: 0o600 });
    fs.renameSync(temporary, resolved);
    return result?.value;
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    if (lock !== undefined) fs.closeSync(lock);
    if (fs.existsSync(lockPath)) fs.unlinkSync(lockPath);
  }
}

module.exports = {
  DEFAULT_STORE_PATH,
  EVENT_ID,
  HUNT_ID,
  MAX_BASELINE_RECORDS,
  MAX_EVENTS,
  MAX_HUNTS,
  MAX_STORE_BYTES,
  MAX_TOTAL_BASELINE_RECORDS,
  assertStoreShape,
  emptyStore,
  loadStore,
  mutateStore,
  resolveStorePath,
};
