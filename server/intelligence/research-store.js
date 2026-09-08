'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_STORE_PATH = path.resolve(__dirname, '../../.cache/research-workspace.json');
const MAX_STORE_BYTES = 24 * 1024 * 1024;
const MAX_CASES = 2000;
const MAX_CASE_HISTORY = 200;
const CASE_ID = /^rcase_[a-f0-9]{24}$/;

function emptyStore() {
  return { version: 1, updatedAt: null, cases: [] };
}

function resolveStorePath(filePath) {
  return path.resolve(filePath || process.env.PROPERTY_RESEARCH_WORKSPACE_PATH || DEFAULT_STORE_PATH);
}

function assertStoreShape(store) {
  if (!store || store.version !== 1 || !Array.isArray(store.cases)) {
    throw new Error('Invalid research-workspace store; existing data was preserved');
  }
  if (store.cases.length > MAX_CASES) {
    throw new Error('Research-workspace store exceeds its case limit; existing data was preserved');
  }
  const ids = new Set();
  const identities = new Set();
  for (const item of store.cases) {
    const sourceRef = item?.sourceRef;
    const valid = item && CASE_ID.test(item.id || '')
      && typeof item.identityKey === 'string' && /^[a-f0-9]{64}$/.test(item.identityKey)
      && sourceRef && typeof sourceRef.sourceId === 'string' && typeof sourceRef.recordId === 'string'
      && /^[a-z0-9][a-z0-9_-]{1,63}$/.test(sourceRef.sourceId)
      && sourceRef.recordId.length >= 1 && sourceRef.recordId.length <= 300
      && ['inbox', 'pursue', 'pass'].includes(item.state)
      && Number.isInteger(item.revision) && item.revision >= 1
      && Array.isArray(item.origins) && Array.isArray(item.evidenceLinks) && Array.isArray(item.history)
      && item.origins.length <= 100 && item.evidenceLinks.length <= 100 && item.history.length <= MAX_CASE_HISTORY
      && item.listingSnapshot && typeof item.listingSnapshot === 'object' && !Array.isArray(item.listingSnapshot)
      && !Object.hasOwn(item.listingSnapshot, 'raw')
      && item.dossierSnapshot && typeof item.dossierSnapshot === 'object' && !Array.isArray(item.dossierSnapshot)
      && typeof item.reconsiderationRequired === 'boolean'
      && (item.latestTrigger === null || typeof item.latestTrigger === 'object')
      && Number.isFinite(Date.parse(item.createdAt)) && Number.isFinite(Date.parse(item.updatedAt));
    const expectedIdentity = valid
      ? crypto.createHash('sha256').update(`${sourceRef.sourceId}\n${sourceRef.recordId}`).digest('hex')
      : null;
    const safeLinks = valid && item.evidenceLinks.every((link) => link && typeof link === 'object'
      && /^intake_[a-f0-9]{24}$/.test(link.intakeId || '')
      && /^[a-f0-9]{64}$/.test(link.contentSha256 || '')
      && typeof link.sourceUrl === 'string' && /^https:\/\//i.test(link.sourceUrl)
      && !Object.hasOwn(link, 'original'));
    if (!valid || !safeLinks || expectedIdentity !== item.identityKey || item.id !== `rcase_${item.identityKey.slice(0, 24)}`
      || ids.has(item?.id) || identities.has(item?.identityKey)) {
      throw new Error('Invalid research case; existing data was preserved');
    }
    ids.add(item.id);
    identities.add(item.identityKey);
  }
  return store;
}

function loadStore(filePath) {
  const resolved = resolveStorePath(filePath);
  if (!fs.existsSync(resolved)) return emptyStore();
  const stats = fs.statSync(resolved);
  if (!stats.isFile() || stats.size > MAX_STORE_BYTES) {
    throw new Error('Research-workspace store exceeds its safe size limit');
  }
  return assertStoreShape(JSON.parse(fs.readFileSync(resolved, 'utf8')));
}

function replaceFileWithRetry(temporary,resolved,options={}) {
  const attempts=Math.max(1,Math.min(10,Number(options.attempts)||9));
  const wait=typeof options.wait==='function'?options.wait:(milliseconds)=>Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,milliseconds);
  for(let attempt=0;attempt<attempts;attempt+=1){
    try{fs.renameSync(temporary,resolved);return;}
    catch(error){const retryable=(options.platform||process.platform)==='win32'&&['EPERM','EACCES','EBUSY'].includes(error.code);if(!retryable||attempt===attempts-1)throw error;wait(Math.min(250,10*(2**attempt)));}
  }
}

function mutateStore(filePath, mutate, options = {}) {
  if (typeof mutate !== 'function') throw new TypeError('Research-workspace mutation must be a function');
  const resolved = resolveStorePath(filePath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  const lockPath = `${resolved}.lock`;
  let lock;
  try {
    lock = fs.openSync(lockPath, 'wx', 0o600);
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error('Research workspace is locked by another writer; retry after it finishes');
    throw error;
  }
  const temporary = `${resolved}.${crypto.randomUUID()}.tmp`;
  try {
    const store = loadStore(resolved);
    const result = mutate(store) || {};
    if (result.changed === false) return result.value;
    if (store.cases.length > MAX_CASES) throw new Error(`Research workspace cannot contain more than ${MAX_CASES} cases`);
    store.updatedAt = new Date(options.now === undefined ? Date.now() : options.now).toISOString();
    assertStoreShape(store);
    const body = JSON.stringify(store);
    if (Buffer.byteLength(body, 'utf8') > MAX_STORE_BYTES) throw new Error('Research workspace exceeds its safe size limit');
    fs.writeFileSync(temporary, body, { flag: 'wx', mode: 0o600 });
    replaceFileWithRetry(temporary, resolved, options.replaceOptions);
    return result.value;
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    if (lock !== undefined) fs.closeSync(lock);
    if (fs.existsSync(lockPath)) fs.unlinkSync(lockPath);
  }
}

module.exports = {
  CASE_ID,
  DEFAULT_STORE_PATH,
  MAX_CASES,
  MAX_CASE_HISTORY,
  MAX_STORE_BYTES,
  assertStoreShape,
  emptyStore,
  loadStore,
  mutateStore,
  resolveStorePath,
  replaceFileWithRetry,
};
