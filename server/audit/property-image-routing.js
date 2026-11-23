'use strict';

/**
 * Upstream data-quality audit for the property-image route.
 *
 * Question this answers: "are the correct properties getting the correct
 * images from wherever the listing was at?" The property-image route maps
 * a listing to imagery using either its stored (lat, lng) or its source-
 * observed address. If either of those is wrong, the route will pull
 * imagery of the wrong place.
 *
 * This module runs deterministic, offline checks against a listing row and
 * returns a per-listing verdict plus an aggregate summary. It does not
 * call Google, Panoramax, or any external geocoder — it only inspects
 * what is already in the row.
 */

const { sourceObservedAddress } = require('../routes/property-image');
const { STATE_BBOX, isCoordInStateBounds, detectCoincidentCoordPoison } = require('../geo/state-bounds');
const { canonicalizePhotoUrl, detectDuplicatePhotoUrls } = require('../scrapers/media-policy');
const { isUsStateOrTerritoryCode } = require('../state-codes');

const PUBLISHER_HOSTS = Object.freeze({
  'USDA Rural Development': ['resales.usda.gov'],
  'U.S. Department of the Treasury': ['treasury.gov'],
  'Internal Revenue Service': ['irsauctions.gov'],
  'ServiceLink Auction': ['servicelinkauction.com'],
  'HUD eGIS — Single Family REO': ['egis.hud.gov', 'hudhomestore.gov'],
  'General Services Administration': ['realestatesales.gov'],
  'CivilView': ['salesweb.civilview.com'],
});

const US_STATE_CODE = /^[A-Z]{2}$/;
const ZIP_RE = /^\d{5}(?:-\d{4})?$/;

function safeText(value, maximumLength = 256) {
  if (value === null || value === undefined) return null;
  const text = String(value).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, maximumLength) : null;
}

function safeHost(url) {
  const raw = safeText(url, 2048);
  if (!raw) return null;
  try { return new URL(raw).host.toLowerCase(); } catch (_) { return null; }
}

function checkAddressGeocodable(listing) {
  const qualification = listing?.provenance?.sourceFacts?.addressQualification;
  if (qualification === 'positive_land_evidence') {
    return { ok: true, reason: 'land_without_housenumber_publisher_recorded' };
  }
  const observed = sourceObservedAddress(listing);
  if (!observed) {
    return { ok: false, reason: 'address_missing_or_unparseable_for_geocoding' };
  }
  return { ok: true, reason: null };
}

function checkStateValid(listing) {
  const state = safeText(listing?.state, 2);
  if (!isUsStateOrTerritoryCode(state)) {
    return { ok: false, reason: `state_invalid:${listing?.state || ''}` };
  }
  return { ok: true, reason: null };
}

function checkZipValid(listing) {
  const zip = safeText(listing?.zip, 10);
  if (!zip || !ZIP_RE.test(zip)) {
    return { ok: false, reason: `zip_invalid:${listing?.zip || ''}` };
  }
  return { ok: true, reason: null };
}

function checkCoordsInState(listing) {
  const lat = Number(listing?.lat);
  const lng = Number(listing?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) {
    return { ok: true, reason: 'coords_absent_skipped' };
  }
  const state = safeText(listing?.state, 2)?.toUpperCase();
  if (!state || !US_STATE_CODE.test(state) || !isUsStateOrTerritoryCode(state)) {
    return { ok: false, reason: 'state_invalid_for_coord_check' };
  }
  const bbox = STATE_BBOX[state];
  if (!bbox) {
    // Valid USPS territory code (e.g. PR, VI) — skip per audit contract.
    return { ok: true, reason: `state_bbox_unknown:${state}_skipped` };
  }
  return isCoordInStateBounds(lat, lng, state);
}

function checkPublisherHostConsistent(listing) {
  const publisher = safeText(listing?.provenance?.publisher, 256);
  if (!publisher) return { ok: false, reason: 'publisher_missing' };
  const expected = PUBLISHER_HOSTS[publisher];
  if (!expected) {
    return { ok: true, reason: `publisher_unknown:${publisher}_skipped` };
  }
  const host = safeHost(listing?.sourceUrl);
  if (!host) return { ok: false, reason: 'source_url_unparseable' };
  const matched = expected.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
  if (!matched) {
    return { ok: false, reason: `host_mismatch:publisher=${publisher},host=${host}` };
  }
  return { ok: true, reason: null };
}

function checkPhotoProvenanceConsistent(listing) {
  const photo = listing?.provenance?.media?.photo;
  if (!photo || typeof photo !== 'object') {
    return { ok: true, reason: 'photo_absent_skipped' };
  }
  const photoSourceUrl = safeText(photo.sourceRecordUrl, 2048);
  const listingSourceUrl = safeText(listing?.sourceUrl, 2048);
  if (!photoSourceUrl || !listingSourceUrl) {
    return { ok: false, reason: 'photo_or_listing_source_url_missing' };
  }
  let photoUrl, listingUrl;
  try { photoUrl = new URL(photoSourceUrl); } catch (_) { return { ok: false, reason: 'photo_source_record_url_unparseable' }; }
  try { listingUrl = new URL(listingSourceUrl); } catch (_) { return { ok: false, reason: 'listing_source_url_unparseable' }; }
  photoUrl.hash = '';
  listingUrl.hash = '';
  if (photoUrl.toString() !== listingUrl.toString()) {
    return {
      ok: false,
      reason: `photo_source_record_mismatch:photo=${photoUrl},listing=${listingUrl}`,
    };
  }
  return { ok: true, reason: null };
}

const CHECKS = Object.freeze({
  address_geocodable: checkAddressGeocodable,
  state_valid: checkStateValid,
  zip_valid: checkZipValid,
  coords_in_state: checkCoordsInState,
  publisher_host_consistent: checkPublisherHostConsistent,
  photo_provenance_consistent: checkPhotoProvenanceConsistent,
});

const CHECK_ORDER = Object.freeze([
  'address_geocodable',
  'state_valid',
  'zip_valid',
  'coords_in_state',
  'publisher_host_consistent',
  'photo_provenance_consistent',
]);

function auditListing(listing) {
  const results = {};
  let pass = 0;
  let fail = 0;
  let skipped = 0;
  for (const name of CHECK_ORDER) {
    const result = CHECKS[name](listing);
    results[name] = result;
    if (!result.ok) fail += 1;
    else if (result.reason && result.reason.endsWith('_skipped')) skipped += 1;
    else pass += 1;
  }
  return { id: listing?.id, source: listing?.source, results, pass, fail, skipped };
}

function runAudit(listings, { threshold = 0.05 } = {}) {
  const rows = listings.map(auditListing);
  const total = rows.length;
  const anyFail = rows.filter((r) => r.fail > 0);
  const byCheck = Object.fromEntries(CHECK_ORDER.map((name) => [name, { pass: 0, fail: 0, skipped: 0 }]));
  for (const row of rows) {
    for (const name of CHECK_ORDER) {
      const verdict = row.results[name];
      if (!verdict.ok) byCheck[name].fail += 1;
      else if (verdict.reason && verdict.reason.endsWith('_skipped')) byCheck[name].skipped += 1;
      else byCheck[name].pass += 1;
    }
  }
  const poisonedCoords = detectCoincidentCoordPoison(listings);
  const poisonedPhotos = detectDuplicatePhotoUrls(listings);
  let coincidentPoisonRows = 0;
  let duplicatePhotoRows = 0;
  for (const item of listings) {
    const lat = Number(item?.lat);
    const lng = Number(item?.lng);
    if (Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0)) {
      if (poisonedCoords.has(`${lat.toFixed(5)},${lng.toFixed(5)}`)) coincidentPoisonRows += 1;
    }
    const urls = [item?.photo, ...(Array.isArray(item?.images) ? item.images : [])]
      .map(canonicalizePhotoUrl)
      .filter(Boolean);
    if (urls.some((u) => poisonedPhotos.has(u))) duplicatePhotoRows += 1;
  }

  const failRate = total > 0 ? anyFail.length / total : 0;
  const bySource = {};
  for (const row of rows) {
    const key = row.source || '(none)';
    if (!bySource[key]) bySource[key] = { total: 0, with_fail: 0 };
    bySource[key].total += 1;
    if (row.fail > 0) bySource[key].with_fail += 1;
  }
  for (const key of Object.keys(bySource)) {
    const bucket = bySource[key];
    bucket.fail_rate = bucket.total > 0 ? bucket.with_fail / bucket.total : 0;
  }
  return {
    total,
    rows_with_fail: anyFail.length,
    fail_rate: failRate,
    threshold,
    above_threshold: failRate > threshold,
    by_check: byCheck,
    by_source: bySource,
    batch_poison: {
      coincident_coord_poison: {
        poisoned_keys: [...poisonedCoords],
        affected_rows: coincidentPoisonRows,
      },
      duplicate_photo_url_poison: {
        poisoned_urls: [...poisonedPhotos],
        affected_rows: duplicatePhotoRows,
      },
    },
    rows,
  };
}

module.exports = {
  auditListing,
  runAudit,
  CHECK_ORDER,
  PUBLISHER_HOSTS,
  STATE_BBOX,
};
