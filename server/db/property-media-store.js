'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { exactAddress, inspectSecondaryMedia } = require('../scrapers/secondary-property-media');
const { acquireOwnedLock, releaseOwnedLock, replaceFileWithRetry } = require('../intelligence/research-store');
const defaultPath = () => process.env.PROPERTY_MEDIA_CACHE_PATH || path.resolve(__dirname, '../../.cache/property-media.json');

function readMediaStore(file = defaultPath()) {
  if (!fs.existsSync(file)) return [];
  if (fs.statSync(file).size > 5_000_000) throw new Error('Property media store exceeds size limit');
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (data.version !== 1 || !Array.isArray(data.entries) || data.entries.length > 1000) throw new Error('Invalid property media store');
  return data.entries;
}

function attachMedia(listing, entries) {
  // Revalidate on EVERY read. A changed address can never inherit stale images.
  for (const entry of entries) {
    const candidate = { ...listing, provenance: { ...listing.provenance, media: { ...listing.provenance?.media, secondary: entry } } };
    if (inspectSecondaryMedia(candidate).accepted) return candidate;
  }
  return listing;
}

function saveMedia(listing, media, file = defaultPath(), options = {}) {
  if (!inspectSecondaryMedia({ ...listing, provenance: { media: { secondary: media } } }).accepted) throw new Error('Secondary media failed exact-address evidence gate');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const lockPath = file + '.lock';
  const lockHandle = acquireOwnedLock(lockPath, { staleLockMs: options.staleLockMs });
  const temporary = file + '.' + crypto.randomUUID() + '.tmp';
  try {
    const maxEntries = Number.isInteger(options.maxEntries) && options.maxEntries >= 1 ? options.maxEntries : 1000;
    const maxBytes = Number.isInteger(options.maxBytes) && options.maxBytes >= 64 ? options.maxBytes : 5_000_000;
    const entries = readMediaStore(file);
    const key = JSON.stringify(exactAddress(listing));
    const next = [media, ...entries.filter(item => JSON.stringify(exactAddress(item.matchedAddress)) !== key)];
    if (next.length > maxEntries) next.length = maxEntries;
    let body = JSON.stringify({ version: 1, entries: next });
    while (Buffer.byteLength(body, 'utf8') > maxBytes && next.length > 1) {
      next.pop();
      body = JSON.stringify({ version: 1, entries: next });
    }
    if (Buffer.byteLength(body, 'utf8') > maxBytes) throw new Error('Property media store exceeds size limit');
    fs.writeFileSync(temporary, body, { flag: 'wx', mode: 0o600 });
    replaceFileWithRetry(temporary, file, options.replaceOptions);
  } finally {
    try { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); } catch (_) {}
    releaseOwnedLock(lockHandle);
  }
}
module.exports = { readMediaStore, attachMedia, saveMedia };
