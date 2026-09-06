const { inspectSourceRecordUrl } = require('./scrapers/source-policy');

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

module.exports = { inspectMapLocation, groupMapLocations };
