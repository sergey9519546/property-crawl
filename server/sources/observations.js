const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { validateListingForIngestion } = require('../scrapers/validation');

const DEFAULT_PATH = path.resolve(__dirname, '../../.cache/source-observations.json');
const MAX_BYTES = 40 * 1024 * 1024;
const FIELDS = ['openingBid', 'saleDate', 'status', 'deposit', 'address'];
const TITLES = {
  bid_reduced: 'Published opening bid reduced',
  bid_changed: 'Published opening bid changed',
  sale_date_changed: 'Sale date changed',
  status_changed: 'Sale status changed',
  returned_to_market: 'Publisher reports a return to market',
  terms_changed: 'Payment terms changed',
  address_changed: 'Address changed on the same source record',
};

function resolvedPath(options = {}) {
  return options.filePath || process.env.PROPERTY_OBSERVATIONS_PATH || DEFAULT_PATH;
}

function loadObservations(options = {}) {
  const filePath = resolvedPath(options);
  if (!fs.existsSync(filePath)) return { version: 1, runs: {}, records: {}, signals: [] };
  if (fs.statSync(filePath).size > MAX_BYTES) throw new Error('Source observation store exceeds size limit');
  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (data.version !== 1 || !data.runs || !data.records || !Array.isArray(data.signals)) {
    throw new Error('Invalid source observation store; existing history was preserved');
  }
  return data;
}

function snapshot(listing) {
  const observedAt = new Date(listing.sourceObservedAt || listing.provenance.observedAt).toISOString();
  return {
    listingId: listing.id, source: listing.source, sourceUrl: listing.sourceUrl,
    observedAt, state: listing.state, county: listing.county || null,
    recordId: String(listing.provenance.recordId),
    noticeExcerpt: String(listing.raw || '').slice(0, 12000),
    noticeSha256: crypto.createHash('sha256').update(String(listing.raw || '')).digest('hex'),
    fields: Object.fromEntries(FIELDS.map((key) => [key, key === 'openingBid' && present(listing[key])
      ? Number(listing[key]) : typeof listing[key] === 'string' ? listing[key].replace(/\s+/g, ' ').trim() : listing[key] ?? null])),
  };
}

function present(value) { return value !== null && value !== undefined && value !== ''; }

function compareSnapshots(previous, current) {
  // New records and newly populated fields do not demonstrate a change in sale terms.
  if (!previous || Date.parse(current.observedAt) <= Date.parse(previous.observedAt)) return [];
  const changes = [];
  for (const field of FIELDS) {
    const before = previous.fields[field], after = current.fields[field];
    if (!present(before) || !present(after) || String(before) === String(after)) continue;
    let kind;
    if (field === 'openingBid') kind = Number(after) < Number(before) ? 'bid_reduced' : 'bid_changed';
    if (field === 'saleDate') kind = 'sale_date_changed';
    if (field === 'status') {
      kind = /^(withdrawn|cancelled|canceled|unsold|postponed|inactive)$/i.test(String(before))
        && /^(active|scheduled|available|relisted)$/i.test(String(after)) ? 'returned_to_market' : 'status_changed';
    }
    if (field === 'deposit') kind = 'terms_changed';
    if (field === 'address') kind = 'address_changed';
    changes.push({ field, before, after, kind, title: TITLES[kind] });
  }
  return changes;
}

function updateObservations(data, sourceId, run, options = {}) {
  if (!/^[a-z][a-z0-9_-]{1,79}$/.test(sourceId)) throw new Error('Invalid observation source');
  const now = options.now ? new Date(options.now).toISOString() : new Date().toISOString();
  const accepted = (run.listings || []).flatMap((listing) => {
    const result = validateListingForIngestion(listing, { expectedSource: sourceId });
    if (!result.isValid || listing.provenance?.origin !== 'live'
      || Date.parse(listing.sourceObservedAt || listing.provenance?.observedAt) > Date.parse(now) + 300_000) return [];
    return [result.listing];
  });
  let newSignals = 0;
  let applied = 0;
  // A failed request is never evidence that an item disappeared or sold.
  if (!run.error) {
    for (const listing of accepted) {
      const current = snapshot(listing);
      // Exact publisher record identity only. Address similarity cannot establish parcel identity.
      const key = crypto.createHash('sha256').update(`${sourceId}\n${current.recordId}`).digest('hex');
      const existing = data.records[key];
      const previous = existing?.latest;
      if (previous && Date.parse(current.observedAt) <= Date.parse(previous.observedAt)) continue;
      const changes = compareSnapshots(previous, current);
      for (const change of changes) {
        const id = crypto.createHash('sha256').update(`${key}\n${current.observedAt}\n${change.field}`).digest('hex').slice(0, 24);
        if (data.signals.some((signal) => signal.id === id)) continue;
        data.signals.push({
          id, sourceId, recordId: current.recordId, listingId: current.listingId, address: current.fields.address,
          state: current.state, county: current.county, observedAt: current.observedAt,
          ...change,
          evidence: [
            { sourceUrl: previous.sourceUrl, observedAt: previous.observedAt, value: change.before },
            { sourceUrl: current.sourceUrl, observedAt: current.observedAt, value: change.after },
          ],
          nextStep: 'Open the current publisher record and confirm the sale terms before acting.',
        });
        newSignals++;
      }
      data.records[key] = {
        firstObservedAt: existing?.firstObservedAt || current.observedAt,
        observations: (existing?.observations || 0) + 1,
        latest: current,
        history: [...(existing?.history || []), ...(changes.length && previous ? [previous] : [])].slice(-20),
      };
      applied++;
    }
  }
  data.signals = data.signals.sort((a, b) => b.observedAt.localeCompare(a.observedAt)).slice(0, 2000);
  const priorRun = data.runs[sourceId];
  data.runs[sourceId] = {
    lastRunAt: now,
    lastSuccessAt: run.error ? priorRun?.lastSuccessAt || null : now,
    lastNonEmptyAt: applied ? now : priorRun?.lastNonEmptyAt || null,
    acceptedCount: applied,
    evidenceCount: Math.max(0, Number(run.evidenceCount) || 0),
    rejectedCount: Math.max(0, Number(run.rejectedCount) || 0) + (run.listings || []).length - applied,
    error: run.error ? String(run.error).slice(0, 300) : null,
    durationMs: Math.max(0, Number(run.durationMs) || 0),
    runs: (priorRun?.runs || 0) + 1,
  };
  data.updatedAt = now;
  return { accepted: applied, newSignals };
}

function recordSourceRun(sourceId, run, options = {}) {
  const filePath = resolvedPath(options);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const lockPath = filePath + '.lock';
  let lock;
  try { lock = fs.openSync(lockPath, 'wx', 0o600); }
  catch (error) {
    if (error.code === 'EEXIST') throw new Error('Source observations are being written; retry after the writer finishes');
    throw error;
  }
  const temporary = filePath + '.' + crypto.randomUUID() + '.tmp';
  try {
    const data = loadObservations({ filePath });
    const result = updateObservations(data, sourceId, run, options);
    const body = JSON.stringify(data);
    if (Buffer.byteLength(body) > MAX_BYTES) throw new Error('Source observation store exceeds size limit');
    fs.writeFileSync(temporary, body, { flag: 'wx', mode: 0o600 });
    fs.renameSync(temporary, filePath);
    return result;
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    fs.closeSync(lock);
    fs.unlinkSync(lockPath);
  }
}

module.exports = { DEFAULT_PATH, compareSnapshots, loadObservations, recordSourceRun, updateObservations };
