// Use a relative path here (not @server/scrapers/*) because this file is
// also exercised by raw `node --test`, which does not resolve Next.js webpack
// aliases. Next.js still loads this file fine via its own resolver.
const { inspectSourceRecordUrl } = require('../../server/scrapers/source-policy');

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function observed(value) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp <= Date.now() + 5 * 60_000;
}

function normalized(value) {
  return text(value).toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
}

/** Coordinates alone are not evidence of a property's location. */
function inspectMapLocation(listing) {
  const reject = (reason) => ({ accepted: false, reason });
  const provenance = object(listing?.provenance);
  if (provenance.origin !== 'live' || provenance.observed !== true || provenance.recordKind !== 'source_record'
      || !text(provenance.publisher) || !String(provenance.recordId ?? '').trim()
      || !observed(listing.sourceObservedAt ?? provenance.observedAt)) return reject('not_source_observed');
  const source = inspectSourceRecordUrl(listing.source, listing.sourceUrl);
  if (!source.isValid) return reject('source_record_unverified');
  const { lat, lng } = listing;
  if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)
      || Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0)) return reject('coordinates_missing_or_invalid');
  const derived = object(provenance.derivedFields);
  if (['lat', 'lng', 'latitude', 'longitude', 'coordinates', 'location', 'geocode'].some((key) => Boolean(derived[key]))) {
    return reject('derived_coordinates');
  }
  const evidence = object(provenance.coordinates);
  if (evidence.lat !== lat || evidence.lng !== lng || !observed(evidence.observedAt)) return reject('coordinate_evidence_missing');
  const evidenceSource = inspectSourceRecordUrl(listing.source, evidence.sourceRecordUrl);
  if (!evidenceSource.isValid || evidenceSource.url !== source.url) return reject('coordinate_record_mismatch');
  if (evidence.origin === 'publisher_record' && evidence.verification === 'source_extracted') {
    return { accepted: true, lat, lng, reason: 'publisher_coordinates' };
  }
  if (evidence.origin !== 'geocoder' || evidence.verification !== 'exact_address_match'
      || !['rooftop', 'parcel'].includes(evidence.precision) || !text(evidence.provider)) return reject('coordinate_precision_unverified');
  const match = object(evidence.matchedAddress);
  // Require all published components, including any unit in the full address.
  for (const key of ['address', 'city', 'state', 'zip']) {
    if (!normalized(listing[key]) || normalized(listing[key]) !== normalized(match[key])) return reject('geocode_address_mismatch');
  }
  return { accepted: true, lat, lng, reason: 'exact_address_geocode' };
}

/** Keep coincident records at their actual coordinate; never invent offsets. */
function groupMapLocations(listings) {
  const groups = new Map();
  for (const listing of listings) {
    if (!inspectMapLocation(listing).accepted) continue;
    const key = `${listing.lng},${listing.lat}`;
    const group = groups.get(key);
    if (group) {
      if (!group.some((record) => record.id === listing.id)) group.push(listing);
    } else groups.set(key, [listing]);
  }
  return [...groups.values()];
}

function parcelTextValue(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function parcelCoordinate(value, min, max) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= min && numeric <= max ? numeric : null;
}

function hasObservedParcelCoordinates(listing) {
  const provenance = listing && listing.provenance;
  if (!provenance || typeof provenance !== 'object' || provenance.observed !== true) return false;
  if (provenance.origin === 'snapshot' || provenance.recordKind === 'demo') return false;
  const derived = provenance.derivedFields;
  if (!derived || typeof derived !== 'object') return true;
  return !derived.geocode && !derived.coordinates && !derived.location;
}

/** Preflight /api/parcel-boundary eligibility to prevent doomed 422 UI requests. */
function inspectParcelBoundaryInputs(listing) {
  if (!listing || typeof listing !== 'object') {
    return {
      eligible: false,
      code: 'EXACT_COORDINATES_REQUIRED',
      message: 'Exact source coordinates are required for parcel geometry lookup.',
      state: '',
      county: '',
      apn: '',
      lat: null,
      lng: null,
    };
  }

  const state = parcelTextValue(listing.state);
  const county = parcelTextValue(listing.county);
  const apn = parcelTextValue(
    listing.apn ?? listing.parcelNumber ?? listing.parcelId ?? listing.provenance?.parcelNumber
  );
  const lat = parcelCoordinate(listing.lat, -90, 90);
  const lng = parcelCoordinate(listing.lng, -180, 180);
  const hasListingCoords =
    listing.lat !== null &&
    listing.lat !== undefined &&
    listing.lat !== '' &&
    listing.lng !== null &&
    listing.lng !== undefined &&
    listing.lng !== '';

  if (hasListingCoords && !hasObservedParcelCoordinates(listing)) {
    return {
      eligible: false,
      code: 'EXACT_COORDINATES_UNVERIFIED',
      message: 'This listing does not have source-observed coordinates for parcel geometry lookup.',
      state,
      county,
      apn,
      lat,
      lng,
    };
  }

  if ((lat === null || lng === null) && !apn) {
    return {
      eligible: false,
      code: 'EXACT_COORDINATES_REQUIRED',
      message: 'Exact source coordinates are required for parcel geometry lookup.',
      state,
      county,
      apn,
      lat,
      lng,
    };
  }

  if (!state) {
    return {
      eligible: false,
      code: 'STATE_REQUIRED',
      message: 'State is required for parcel geometry lookup.',
      state,
      county,
      apn,
      lat,
      lng,
    };
  }

  return {
    eligible: true,
    code: null,
    message: null,
    state,
    county,
    apn,
    lat,
    lng,
  };
}

module.exports = { inspectMapLocation, groupMapLocations, inspectParcelBoundaryInputs };
