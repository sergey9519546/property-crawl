const test = require('node:test');
const assert = require('node:assert/strict');
const { inspectMapLocation, groupMapLocations } = require('../src/lib/listing-map-policy');

function record(overrides = {}) {
  const sourceUrl = 'https://salesweb.civilview.com/Sales/SaleDetails?PropertyId=1234';
  const observedAt = new Date().toISOString();
  return {
    id: 'CIV-1234', source: 'civilview', sourceUrl,
    address: '19 West Park Avenue Apt 2', city: 'Park Ridge', state: 'NJ', zip: '07656', lat: 41.03, lng: -74.04,
    provenance: { origin: 'live', observed: true, recordKind: 'source_record', publisher: 'CivilView', recordId: '1234', observedAt,
      coordinates: { origin: 'publisher_record', verification: 'source_extracted', sourceRecordUrl: sourceUrl, observedAt, lat: 41.03, lng: -74.04 } },
    ...overrides,
  };
}

test('snapshot, unknown, derived and unverified coordinates never become property pins', () => {
  const base = record();
  for (const provenance of [undefined, { ...base.provenance, origin: 'snapshot' }, { ...base.provenance, coordinates: undefined },
    { ...base.provenance, derivedFields: { lat: 'city_centroid' } }, { ...base.provenance, observed: false }]) {
    assert.equal(inspectMapLocation({ ...base, provenance }).accepted, false);
  }
});

test('publisher coordinates require exact coordinate, record and timestamp evidence', () => {
  const base = record();
  assert.equal(inspectMapLocation(base).accepted, true);
  for (const patch of [{ lat: 91 }, { lat: 40 }, { lat: null }, { lng: Infinity }, { sourceUrl: 'https://salesweb.civilview.com/' }]) {
    assert.equal(inspectMapLocation({ ...base, ...patch }).accepted, false);
  }
  for (const patch of [{ observedAt: 'invalid' }, { sourceRecordUrl: 'https://salesweb.civilview.com/Sales/SaleDetails?PropertyId=5678' }]) {
    assert.equal(inspectMapLocation({ ...base, provenance: { ...base.provenance, coordinates: { ...base.provenance.coordinates, ...patch } } }).accepted, false);
  }
});

test('geocodes require exact full address, unit, city, state, ZIP and rooftop or parcel precision', () => {
  const base = record();
  const evidence = { ...base.provenance.coordinates, origin: 'geocoder', provider: 'County GIS', verification: 'exact_address_match', precision: 'rooftop',
    matchedAddress: { address: base.address, city: base.city, state: base.state, zip: base.zip } };
  const geocoded = (patch) => ({ ...base, provenance: { ...base.provenance, coordinates: { ...evidence, ...patch } } });
  assert.equal(inspectMapLocation(geocoded({})).accepted, true);
  assert.equal(inspectMapLocation(geocoded({ precision: 'city' })).accepted, false);
  for (const [key, value] of [['address', '19 West Park Avenue Apt 3'], ['state', 'NY'], ['zip', '07657'], ['city', 'Montvale']]) {
    assert.equal(inspectMapLocation(geocoded({ matchedAddress: { ...evidence.matchedAddress, [key]: value } })).accepted, false);
  }
});

test('coincident records share one unchanged location and retain their distinct identities', () => {
  const first = record();
  const second = record({ id: 'CIV-5678' });
  const groups = groupMapLocations([first, second, first, record({ id: 'snapshot', provenance: {} })]);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].map((listing) => listing.id), ['CIV-1234', 'CIV-5678']);
  assert.deepEqual(groups[0].map(({ lat, lng }) => [lat, lng]), [[41.03, -74.04], [41.03, -74.04]]);
});
