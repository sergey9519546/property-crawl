const { findBotChallengeSignature } = require('./circuit-breaker');
const { normalizeOcrText } = require('../ai/notice-parser');
const { inspectSourceRecordUrl } = require('./source-policy');

const US_STATE_OR_TERRITORY = /^[A-Z]{2}$/;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{1,159}$/;
// Closed set of US states + DC. Format-only regex (US_STATE_OR_TERRITORY)
// would let "ZZ" or "AQ" through; ingestion must require a real postal code.
// Source: USPS two-letter state abbreviations.
const US_STATES = new Set([
  'AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN',
  'IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH',
  'NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT',
  'VT','VA','WA','WV','WI','WY',
  // US territories also surfaced by some government sources.
  'PR','VI','GU','MP','AS'
]);

function finitePositive(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0;
}

function isKnown(value) {
  return value !== null && value !== undefined && value !== '';
}

function sanitizeListingForIngestion(item = {}) {
  const rawText = normalizeOcrText(String(item.raw ?? ''));
  return {
    ...item,
    id: String(item.id ?? '').trim(),
    source: String(item.source ?? '').trim().toLowerCase(),
    state: String(item.state ?? '').trim().toUpperCase(),
    address: String(item.address ?? '').replace(/\s+/g, ' ').trim(),
    sourceUrl: item.sourceUrl == null ? null : String(item.sourceUrl).trim(),
    raw: rawText.trim()
  };
}

function validateListingForIngestion(item, options = {}) {
  const listing = sanitizeListingForIngestion(item);
  const expectedSource = String(options.expectedSource ?? '').trim().toLowerCase();
  const errors = [];

  if (!SAFE_ID.test(listing.id)) errors.push('invalid_id');
  if (!listing.source) errors.push('missing_source');
  if (expectedSource && listing.source !== expectedSource) errors.push('source_mismatch');
  if (!US_STATE_OR_TERRITORY.test(listing.state) || listing.state === 'US' || !US_STATES.has(listing.state)) {
    errors.push('invalid_state');
  }
  if (listing.address.length < 8 || listing.address.length > 500) errors.push('invalid_address');
  if (isKnown(listing.openingBid) && !finitePositive(listing.openingBid)) errors.push('invalid_opening_bid');
  if (isKnown(listing.estLow) && !finitePositive(listing.estLow)) errors.push('invalid_est_low');
  if (isKnown(listing.estHigh) && !finitePositive(listing.estHigh)) errors.push('invalid_est_high');
  if (isKnown(listing.estLow) && isKnown(listing.estHigh) && Number(listing.estHigh) < Number(listing.estLow)) {
    errors.push('invalid_estimate_range');
  }

  const hasLat = isKnown(listing.lat);
  const hasLng = isKnown(listing.lng);
  if (hasLat !== hasLng) errors.push('partial_geocode');
  if (hasLat) {
    const lat = Number(listing.lat);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) errors.push('invalid_latitude');
  }
  if (hasLng) {
    const lng = Number(listing.lng);
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) errors.push('invalid_longitude');
  }

  if (!listing.sourceUrl) errors.push('missing_source_url');
  else {
    const sourceUrlCheck = inspectSourceRecordUrl(listing.source, listing.sourceUrl);
    if (!sourceUrlCheck.isValid) errors.push(sourceUrlCheck.error);
  }

  if (listing.raw.length < 10 || listing.raw.length > 100_000) errors.push('invalid_raw_notice');
  if (findBotChallengeSignature(`${listing.address}\n${listing.raw}`)) errors.push('challenge_payload');
  const provenance = listing.provenance && typeof listing.provenance === 'object'
    ? listing.provenance
    : {};
  const origin = String(provenance.origin || '').trim().toLowerCase();
  if (provenance.fixture === true || provenance.observed === false || ['fixture', 'demo', 'snapshot'].includes(origin)) {
    errors.push('fixture_record_not_ingestible');
  }
  if (provenance.observed !== true) errors.push('missing_observed_provenance');
  if (!String(provenance.publisher || '').trim()) errors.push('missing_provenance_publisher');
  if (!String(provenance.recordId || '').trim()) errors.push('missing_provenance_record_id');
  const observedAt = listing.sourceObservedAt || provenance.observedAt;
  if (!observedAt || !Number.isFinite(Date.parse(String(observedAt)))) errors.push('missing_source_observation_time');

  return {
    isValid: errors.length === 0,
    errors,
    listing
  };
}

module.exports = {
  sanitizeListingForIngestion,
  validateListingForIngestion
};
