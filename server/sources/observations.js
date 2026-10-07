const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { validateListingForIngestion } = require('../scrapers/validation');

const DEFAULT_PATH = path.resolve(__dirname, '../../.cache/source-observations.json');
// Was a bare 40MB literal, not overridable, while the sibling live-record store
// has been env-configurable with a clamp for some time. This store reached
// 39.7MB against the 40MB ceiling - about 356KB of headroom, roughly one
// collection run from a hard failure that takes down every route reading
// observation history.
//
// Raising the ceiling is not a fix for unbounded growth (pruning superseded
// observations is), but it converts a predictable outage into a working system,
// and it matches the sibling store's shape so there is one convention rather
// than two. If the store does eventually exceed even this, loadObservations
// throws and every consumer now reports historyUnavailable rather than
// silently reporting "no bid reduction observed".
const MAX_BYTES = Math.max(
  8 * 1024 * 1024,
  Math.min(
    128 * 1024 * 1024,
    Number.parseInt(process.env.PROPERTY_OBSERVATIONS_MAX_BYTES, 10) || 64 * 1024 * 1024,
  ),
);
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

// How full the store is, how fast it is filling, and roughly how long that
// lasts. Reported on /api/health because this is the one backing store that
// provably fills up and then degrades: past MAX_BYTES, loadObservations throws,
// every source flips to historyUnavailable, and nothing anywhere said how much
// room was left. Measured on this deployment it reached 51.84MB of 64MB after
// a 32.6-day window -- about 1.59MB/day, roughly 7.6 days of runway.
//
// This reports capacity. It does not prune: what to drop is a product
// decision, and a big-bang prune would blank the change-detection view on
// /sources until the next collection cycle re-established it.
//
// The growth rate is derived from the store's own run history, so it reflects
// the cadence this deployment is actually collecting at rather than an
// assumption. An unreadable or absent store reports what is known and leaves
// the rest null rather than guessing.
function observationStoreCapacity(options = {}) {
  const filePath = resolvedPath(options);
  const capBytes = MAX_BYTES;
  if (!fs.existsSync(filePath)) {
    return {
      path: filePath, exists: false, bytes: 0, capBytes, headroomBytes: capBytes,
      usedFraction: 0, bytesPerDay: null, estimatedDaysRemaining: null, willExceedCeiling: false,
    };
  }
  const bytes = fs.statSync(filePath).size;
  let bytesPerDay = null;
  let estimatedDaysRemaining = null;
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    // Growth is driven by records accumulating, so the span must be over WHEN
    // THEY FIRST APPEARED -- not over when each source last ran.
    //
    // Using run timestamps understates the runway by roughly half: sources are
    // enrolled progressively, so `runs[*].lastRunAt` starts well after the
    // store began filling. Measured that way the same 51.84MB store reported
    // 3.10MB/day and 4.1 days remaining, when the 32.6-day observation window
    // the bytes actually accumulated over gives 1.59MB/day and about 7.6 days.
    // Under-reporting headroom on a capacity warning pushes people to prune
    // early, so the basis has to be the one the bytes correspond to.
    const recordStamps = Object.values(data.records || {})
      .map((record) => Date.parse(record && record.firstObservedAt))
      .filter(Number.isFinite)
      .sort((a, b) => a - b);
    const runStamps = Object.values(data.runs || {})
      .map((run) => Date.parse(run && run.lastRunAt))
      .filter(Number.isFinite)
      .sort((a, b) => a - b);
    const stamps = recordStamps.length > 1 ? recordStamps : runStamps;
    if (stamps.length > 1) {
      const spanDays = (stamps[stamps.length - 1] - stamps[0]) / 86_400_000;
      if (spanDays > 0) {
        bytesPerDay = Number((bytes / spanDays).toFixed(3));
        const headroom = Math.max(0, capBytes - bytes);
        estimatedDaysRemaining = bytesPerDay > 0
          ? Number((headroom / bytesPerDay).toFixed(1))
          : null;
      }
    }
  } catch {
    // An unreadable store still has a measurable size; only the rate is unknown.
  }
  const headroomBytes = Math.max(0, capBytes - bytes);
  return {
    path: filePath, exists: true, bytes, capBytes, headroomBytes,
    usedFraction: Number((bytes / capBytes).toFixed(4)),
    bytesPerDay, estimatedDaysRemaining, willExceedCeiling: bytes >= capBytes,
  };
}

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

module.exports = {
  DEFAULT_PATH, MAX_BYTES, compareSnapshots, loadObservations,
  observationStoreCapacity, recordSourceRun, updateObservations,
};
