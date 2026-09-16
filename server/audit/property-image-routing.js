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
 *
 * Checks (each returns {ok: boolean, reason: string | null}):
 *   address_geocodable       listing has the components the route's geocode
 *                            gate requires (housenumber + route + state + zip)
 *   state_valid              state is a 2-letter US postal code
 *   zip_valid                ZIP matches 5-digit or ZIP+4
 *   coords_in_state          when (lat, lng) are present, they fall inside
 *                            the listing's state's bounding rectangle
 *   publisher_host_consistent
 *                            sourceUrl.host is one of the expected hosts for
 *                            provenance.publisher; off-pattern hosts (e.g. a
 *                            treasury listing hosted on a non-treasury.gov
 *                            domain) are flagged
 *   photo_provenance_consistent
 *                            when provenance.media.photo is present, its
 *                            sourceRecordUrl matches the listing's sourceUrl —
 *                            the photo must have been extracted from THIS
 *                            record, not from some other listing on the host
 *
 * The CLI (`scripts/audit-property-image-routing.cjs`) reads live listings
 * via `server/db/client.js` and runs this module over a sample.
 */

const { sourceObservedAddress } = require('../routes/property-image');

// Approximate rectangular bounding boxes for the 50 US states + DC.
// Source: US Census Bureau / TIGER state FIPS codes (public domain).
// These are coarse on purpose — the audit only needs to catch the
// "Springfield, MO but coords in Maine" kind of mismatch. Tighter
// bounds would only flag legitimate listings near state borders.
const STATE_BBOX = Object.freeze({
  AL: { south: 30.22, north: 35.01, west: -88.47, east: -84.89 },
  AK: { south: 51.21, north: 71.44, west: -179.15, east: -129.97 },
  AZ: { south: 31.33, north: 37.00, west: -114.82, east: -109.05 },
  AR: { south: 33.00, north: 36.50, west: -94.62, east: -89.64 },
  CA: { south: 32.53, north: 42.01, west: -124.41, east: -114.13 },
  CO: { south: 36.99, north: 41.00, west: -109.06, east: -102.04 },
  CT: { south: 40.98, north: 42.05, west: -73.73, east: -71.79 },
  DE: { south: 38.45, north: 39.84, west: -75.79, east: -75.05 },
  DC: { south: 38.79, north: 38.99, west: -77.12, east: -76.91 },
  FL: { south: 24.40, north: 31.00, west: -87.63, east: -80.03 },
  GA: { south: 30.36, north: 35.00, west: -85.61, east: -80.84 },
  HI: { south: 18.91, north: 22.24, west: -160.25, east: -154.81 },
  ID: { south: 41.99, north: 49.00, west: -117.24, east: -111.05 },
  IL: { south: 36.97, north: 42.51, west: -91.51, east: -87.50 },
  IN: { south: 37.77, north: 41.76, west: -88.10, east: -84.78 },
  IA: { south: 40.38, north: 43.50, west: -96.64, east: -90.14 },
  KS: { south: 36.99, north: 40.00, west: -102.05, east: -94.59 },
  KY: { south: 36.50, north: 39.15, west: -89.57, east: -81.97 },
  LA: { south: 28.93, north: 33.02, west: -94.04, east: -88.82 },
  ME: { south: 43.06, north: 47.46, west: -71.08, east: -66.95 },
  MD: { south: 37.91, north: 39.72, west: -79.49, east: -75.05 },
  MA: { south: 41.24, north: 42.89, west: -73.51, east: -69.93 },
  MI: { south: 41.70, north: 48.30, west: -90.42, east: -82.42 },
  MN: { south: 43.50, north: 49.38, west: -97.24, east: -89.49 },
  MS: { south: 30.17, north: 35.00, west: -91.65, east: -88.10 },
  MO: { south: 35.99, north: 40.61, west: -95.77, east: -89.10 },
  MT: { south: 44.36, north: 49.00, west: -116.05, east: -104.04 },
  NE: { south: 39.99, north: 43.00, west: -104.05, east: -95.31 },
  NV: { south: 35.00, north: 42.00, west: -120.01, east: -114.04 },
  NH: { south: 42.70, north: 45.31, west: -72.56, east: -70.61 },
  NJ: { south: 38.93, north: 41.36, west: -75.56, east: -73.89 },
  NM: { south: 31.33, north: 37.00, west: -109.05, east: -103.00 },
  NY: { south: 40.50, north: 45.02, west: -79.76, east: -71.85 },
  NC: { south: 33.84, north: 36.59, west: -84.32, east: -75.46 },
  ND: { south: 45.94, north: 49.00, west: -104.05, east: -96.55 },
  OH: { south: 38.40, north: 41.98, west: -84.82, east: -80.52 },
  OK: { south: 33.62, north: 37.00, west: -103.00, east: -94.43 },
  OR: { south: 41.99, north: 46.30, west: -124.57, east: -116.46 },
  PA: { south: 39.72, north: 42.27, west: -80.52, east: -74.69 },
  RI: { south: 41.15, north: 42.02, west: -71.86, east: -71.12 },
  SC: { south: 32.03, north: 35.22, west: -83.35, east: -78.54 },
  SD: { south: 42.48, north: 45.95, west: -104.06, east: -96.43 },
  TN: { south: 34.98, north: 36.68, west: -90.31, east: -81.65 },
  TX: { south: 25.84, north: 36.50, west: -106.65, east: -93.51 },
  UT: { south: 36.99, north: 42.00, west: -114.05, east: -109.04 },
  VT: { south: 42.73, north: 45.02, west: -73.44, east: -71.46 },
  VA: { south: 36.54, north: 39.47, west: -83.68, east: -75.24 },
  WA: { south: 45.54, north: 49.00, west: -124.85, east: -116.92 },
  WV: { south: 37.20, north: 40.64, west: -82.64, east: -77.72 },
  WI: { south: 42.49, north: 47.08, west: -92.89, east: -86.81 },
  WY: { south: 41.00, north: 45.01, west: -111.06, east: -104.05 },
});

// Publisher → expected host suffixes. A listing whose sourceUrl.host ends
// with any of these suffixes is treated as published by the right publisher.
// We keep this list small and explicit — the publishers we have live data
// for — rather than trying to enumerate every government host.
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
const US_STATES = new Set(Object.keys(STATE_BBOX));

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
  const observed = sourceObservedAddress(listing);
  if (!observed) {
    return { ok: false, reason: 'address_missing_or_unparseable_for_geocoding' };
  }
  return { ok: true, reason: null };
}

function checkStateValid(listing) {
  const state = safeText(listing?.state, 2)?.toUpperCase();
  if (!state || !US_STATE_CODE.test(state) || !US_STATES.has(state)) {
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
    // No coords is not, by itself, a routing hazard — the route falls back
    // to address geocoding. This check only fires when coords are present.
    return { ok: true, reason: 'coords_absent_skipped' };
  }
  const state = safeText(listing?.state, 2)?.toUpperCase();
  if (!state || !US_STATE_CODE.test(state)) {
    return { ok: false, reason: 'state_invalid_for_coord_check' };
  }
  const bbox = STATE_BBOX[state];
  if (!bbox) {
    return { ok: true, reason: `state_bbox_unknown:${state}_skipped` };
  }
  if (lat < bbox.south || lat > bbox.north || lng < bbox.west || lng > bbox.east) {
    return {
      ok: false,
      reason: `coords_outside_state_bbox:lat=${lat},lng=${lng},state=${state}`,
    };
  }
  return { ok: true, reason: null };
}

function checkPublisherHostConsistent(listing) {
  const publisher = safeText(listing?.provenance?.publisher, 256);
  if (!publisher) return { ok: false, reason: 'publisher_missing' };
  const expected = PUBLISHER_HOSTS[publisher];
  if (!expected) {
    // Unknown publisher is informational — we have no expected hosts to
    // compare against. Do not flag; the audit is not exhaustive about which
    // hosts are valid, only about KNOWN publishers landing on the wrong host.
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
    // A missing photo is normal — many listings have no publisher photo.
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
  // The "fail rate" the threshold applies to is the per-listing hard-fail
  // rate — i.e. the share of listings that failed at least one check.
  // A row that fails only soft checks (host mismatch on an unknown
  // publisher) is still flagged, but the threshold is set against the
  // share of rows that have at least one hard fail.
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