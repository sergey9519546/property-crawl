// server/sources/observations.js
//
// Pure observation vocabulary shared by every part of the pipeline: the tracked
// fields, snapshot construction, and the status classifier that
// successive-snapshot diffs use. It owns no storage.
//
// The operational observation store is PostgreSQL (migrations 025 + 027): rows
// in `source_observations`, run metadata in `source_observation_runs`. See
// server/db/observations-persistence.js. The bounded JSON file store this
// module once owned — 40MB ceiling, lock file, compaction — was retired after
// its history was imported by scripts/import-observation-store.js; change
// events are now derived from snapshot rows by replaying compareSnapshots, so
// there is exactly one classifier and no stored event log to fall behind.

const crypto = require('node:crypto');
const { validateListingForIngestion } = require('../scrapers/validation');

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

// Production publisher statuses are prose, not enums: "Status: Active - Postponed"
// (950 live listings), "Status: Cancelled", "Status: Auctioned - Reverted to
// Beneficiary", "Auction Ends: Oct 07, 2026". Anchored ^enum$ matching against
// that vocabulary classifies 0 of 1,526 real transitions, so a returned-to-market
// event never fires. Normalize first (strip the "Status:" prefix, collapse
// whitespace, lowercase), then match on substrings. A postponement or
// cancellation marker wins over an "active" prefix, because "Active - Postponed"
// means the sale is currently postponed, not currently active.
const INACTIVE_STATUS_MARKERS = /(postpon|adjourn|stayed|reschedul|re-?schedul|withdraw|cancell|cancel|unsold|inactive|revert)/;
const ACTIVE_STATUS_MARKERS = /(active|scheduled|available|relisted|accepting bids|open for bidding|auction ends|auction:)/;

function classifyStatusActivity(value) {
  const normalized = String(value || '').replace(/^status\s*:\s*/i, '').replace(/\s+/g, ' ').trim().toLowerCase();
  if (!normalized) return 'unknown';
  if (INACTIVE_STATUS_MARKERS.test(normalized)) return 'inactive';
  if (ACTIVE_STATUS_MARKERS.test(normalized)) return 'active';
  return 'unknown';
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
      kind = classifyStatusActivity(before) === 'inactive'
        && classifyStatusActivity(after) === 'active' ? 'returned_to_market' : 'status_changed';
    }
    if (field === 'deposit') kind = 'terms_changed';
    if (field === 'address') kind = 'address_changed';
    changes.push({ field, before, after, kind, title: TITLES[kind] });
  }
  return changes;
}

// Validated live listings from a collection run, in observation order. A failed
// request is never evidence that an item disappeared or sold, so error runs
// produce no snapshots — only run metadata. A listing whose observation stamp
// is in the future by more than the clock-skew allowance is rejected too.
function acceptedLiveListings(sourceId, run, nowIso) {
  if (run.error) return [];
  return (run.listings || []).flatMap((listing) => {
    const result = validateListingForIngestion(listing, { expectedSource: sourceId });
    if (!result.isValid || listing.provenance?.origin !== 'live'
      || Date.parse(listing.sourceObservedAt || listing.provenance?.observedAt) > Date.parse(nowIso) + 300_000) return [];
    return [result.listing];
  }).sort((a, b) => Date.parse(a.sourceObservedAt || a.provenance.observedAt)
    - Date.parse(b.sourceObservedAt || b.provenance.observedAt));
}

module.exports = {
  FIELDS, TITLES, acceptedLiveListings, classifyStatusActivity, compareSnapshots, present, snapshot,
};
