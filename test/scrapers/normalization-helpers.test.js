'use strict';

// test/scrapers/normalization-helpers.test.js
//
// Direct unit coverage for the pure helpers exported from
// server/scrapers/normalization.js that have no dedicated test file:
//   - normalizeApn: strips non-alphanumeric, upper-cases, never invents
//   - buildParcelKey: stable `${fips5}-${apn}` join key when 5-digit FIPS
//     is present; stateFips + countyFips composition as a fallback;
//     normalized APN alone when no FIPS at all
//   - mapDistressStage: maps source-key strings to reo / scheduled /
//     pre_foreclosure / tax_sale / unknown with sale-date proximity logic
//
// These helpers back every listing normalization and the discovery join
// query. Silent drift would let two records that look like the same
// parcel get linked or unlinked without explanation.

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  normalizeApn,
  buildParcelKey,
  mapDistressStage,
  standardizeListingRecord,
} = require('../../server/scrapers/normalization');

// --- normalizeApn -----------------------------------------------------

test('normalizeApn: returns null for null / undefined input', () => {
  assert.equal(normalizeApn(null), null);
  assert.equal(normalizeApn(undefined), null);
});

test('normalizeApn: returns null when the input has no alphanumeric characters', () => {
  // Stripping leaves nothing; the helper refuses to fabricate an APN.
  assert.equal(normalizeApn('---'), null);
  assert.equal(normalizeApn(''), null);
});

test('normalizeApn: keeps letters and digits and upper-cases', () => {
  assert.equal(normalizeApn('abc-123-def'), 'ABC123DEF');
  assert.equal(normalizeApn('12.34.56'), '123456');
  assert.equal(normalizeApn('a 1 b 2'), 'A1B2');
});

test('normalizeApn: coerces non-string inputs via String()', () => {
  assert.equal(normalizeApn(12345), '12345');
  assert.equal(normalizeApn(true), 'TRUE');
});

// --- buildParcelKey ----------------------------------------------------

test('buildParcelKey: returns null when no APN is present (never fabricates a key)', () => {
  assert.equal(buildParcelKey({}), null);
  assert.equal(buildParcelKey({ countyFips: '39035' }), null);
  assert.equal(buildParcelKey({ apn: '' }), null);
  assert.equal(buildParcelKey({ apn: null }), null);
});

test('buildParcelKey: composes `${fips5}-${apn}` when 5-digit county FIPS is present', () => {
  assert.equal(buildParcelKey({ apn: '012-345678', countyFips: '39035' }), '39035-012345678');
});

test('buildParcelKey: composes from stateFips + 3-digit countyFips when countyFips is not 5 digits', () => {
  // stateFips is 2 digits, countyFips is 3 digits → 5-digit FIPS.
  assert.equal(buildParcelKey({ apn: 'ABC', stateFips: '39', countyFips: '035' }), '39035-ABC');
});

test('buildParcelKey: returns just the normalized APN when no usable FIPS is present', () => {
  // No countyFips at all → just APN.
  assert.equal(buildParcelKey({ apn: 'ABC-123' }), 'ABC123');
  // Invalid lengths (countyFips not 5, stateFips not 2 or countyFips not 3) → APN.
  assert.equal(buildParcelKey({ apn: 'ABC', countyFips: 'abc' }), 'ABC');
});

test('buildParcelKey: prefers the 5-digit countyFips branch over the stateFips + countyFips branch', () => {
  // Both shapes would compose "39035"; verify the explicit-5 path is taken
  // and the stateFips value is not concatenated on top.
  assert.equal(buildParcelKey({ apn: 'X', countyFips: '39035', stateFips: '99' }), '39035-X');
});

// --- mapDistressStage --------------------------------------------------

test('mapDistressStage: REO sources map to reo', () => {
  // REO_SOURCES = ['hud', 'fannie', 'freddie', 'va', 'fdic', 'treasury',
  //                'irs', 'gsa', 'landbank', 'landbanksearch', 'usda', ...]
  for (const source of ['hud', 'fannie', 'freddie', 'va', 'fdic', 'treasury', 'irs', 'gsa', 'landbank', 'usda']) {
    assert.equal(mapDistressStage(source), 'reo', `expected reo for ${source}`);
  }
});

test('mapDistressStage: scheduled sources map to scheduled', () => {
  for (const source of ['trustee', 'county-trustee-sale', 'bid4assets']) {
    assert.equal(mapDistressStage(source), 'scheduled', `expected scheduled for ${source}`);
  }
});

test('mapDistressStage: sheriff/civilview within 30 days of saleDate maps to scheduled', () => {
  const tomorrow = new Date(Date.now() + 1 * 86_400_000).toISOString();
  assert.equal(mapDistressStage('sheriff', tomorrow), 'scheduled');
  assert.equal(mapDistressStage('civilview', tomorrow), 'scheduled');
  assert.equal(mapDistressStage('ohio-sheriff-sale', tomorrow), 'scheduled');
});

test('mapDistressStage: sheriff/civilview beyond 30 days maps to pre_foreclosure', () => {
  const farFuture = new Date(Date.now() + 90 * 86_400_000).toISOString();
  assert.equal(mapDistressStage('sheriff', farFuture), 'pre_foreclosure');
});

test('mapDistressStage: sheriff/civilview without saleDate maps to pre_foreclosure', () => {
  assert.equal(mapDistressStage('sheriff', null), 'pre_foreclosure');
  assert.equal(mapDistressStage('civilview'), 'pre_foreclosure');
});

test('mapDistressStage: tax-sale / tax-deed aliases map to tax_sale', () => {
  assert.equal(mapDistressStage('tax_sale'), 'tax_sale');
  assert.equal(mapDistressStage('tax-sale'), 'tax_sale');
  assert.equal(mapDistressStage('tax_sale-list'), 'tax_sale');
  assert.equal(mapDistressStage('tax-deed'), 'tax_sale');
});

test('mapDistressStage: unknown source maps to unknown', () => {
  assert.equal(mapDistressStage('unknown-source'), 'unknown');
  assert.equal(mapDistressStage(''), 'unknown');
  assert.equal(mapDistressStage(null), 'unknown');
  assert.equal(mapDistressStage(undefined), 'unknown');
});

test('mapDistressStage: source comparison is case-insensitive', () => {
  assert.equal(mapDistressStage('HUD'), 'reo');
  assert.equal(mapDistressStage('Sheriff', new Date(Date.now() + 1 * 86_400_000).toISOString()), 'scheduled');
});


test('normalizePropType and standardizeListingRecord preserve Single Family, clear Unknown, and populate images', () => {
  const { standardizeListingRecord, normalizePropType } = require('../../server/scrapers/normalization');
  assert.equal(normalizePropType('Single Family'), 'Single Family');
  assert.equal(normalizePropType('Single Family Home'), 'Single Family');
  assert.equal(normalizePropType('single-family residential'), 'Single Family');
  assert.equal(normalizePropType('Mobile Home'), 'Manufactured');
  assert.equal(normalizePropType('Vacant Lot'), 'Land');
  assert.equal(normalizePropType('Condominium'), 'Condo');
  assert.equal(normalizePropType('Unknown'), null);
  assert.equal(normalizePropType('N/A'), null);

  const normalized = standardizeListingRecord({
    id: 'TRSY-TEST-1',
    source: 'treasury',
    state: 'NC',
    address: '139-B Farless Road',
    propType: 'Unknown',
    photo: 'https://www.treasury.gov/auctions/treasury/rp/images/house1.gif',
    images: ['https://www.treasury.gov/auctions/treasury/rp/images/house2.gif', 'https://images.unsplash.com/fake.jpg'],
    sourceUrl: 'https://www.treasury.gov/auctions/treasury/rp/139farless.shtml',
    sourceObservedAt: '2026-10-01T00:00:00.000Z',
    provenance: { origin: 'live', observed: true, publisher: 'U.S. Department of the Treasury', recordId: '1' },
  });
  assert.equal(normalized.propType, null);
  assert.deepEqual(normalized.images, [
    'https://www.treasury.gov/auctions/treasury/rp/images/house1.gif',
    'https://www.treasury.gov/auctions/treasury/rp/images/house2.gif',
  ]);
});

// --- deriveHasDocuments / standardizeListingRecord hasDocuments ----------

test('standardizeListingRecord derives hasDocuments=true from valid document arrays when unset', () => {
  const { standardizeListingRecord, deriveHasDocuments } = require('../../server/scrapers/normalization');
  const base = {
    id: 'SL-DOC-1',
    source: 'servicelink',
    state: 'PA',
    address: '100 Main Street',
    sourceUrl: 'https://www.servicelinkauction.com/property-details/100-main-st',
    sourceObservedAt: '2026-11-01T00:00:00.000Z',
    provenance: { origin: 'live', observed: true, publisher: 'ServiceLink Auction', recordId: '1' },
  };

  // Positive control 1: provenance.sourceFacts.documents
  const fromSourceFacts = standardizeListingRecord({
    ...base,
    hasDocuments: null,
    provenance: {
      ...base.provenance,
      sourceFacts: { documents: [{ title: 'PA Consumer Notice', fileUrl: 'https://www.servicelinkauction.com/doc.pdf' }] },
    },
  });
  assert.equal(fromSourceFacts.hasDocuments, true);
  assert.equal(fromSourceFacts.triage.hasDocs, true);

  // Positive control 2: provenance.media.documents
  const fromMedia = standardizeListingRecord({
    ...base,
    provenance: {
      ...base.provenance,
      media: { documents: [{ id: 'media-doc-1' }] },
    },
  });
  assert.equal(fromMedia.hasDocuments, true);
  assert.equal(fromMedia.triage.hasDocs, true);

  // Positive control 3: top-level input.documents with a mix of invalid + valid entries
  const fromInputDocs = standardizeListingRecord({
    ...base,
    documents: [null, {}, { title: 'Bid Packet' }],
  });
  assert.equal(fromInputDocs.hasDocuments, true);
  assert.equal(deriveHasDocuments({ documents: [{ title: 'Notice' }] }, {}), true);
});

test('standardizeListingRecord preserves explicit boolean hasDocuments and leaves unknown as null', () => {
  const { standardizeListingRecord, deriveHasDocuments } = require('../../server/scrapers/normalization');
  const base = {
    id: 'SL-DOC-2',
    source: 'servicelink',
    state: 'PA',
    address: '200 Main Street',
    sourceUrl: 'https://www.servicelinkauction.com/property-details/200-main-st',
    sourceObservedAt: '2026-11-01T00:00:00.000Z',
    provenance: { origin: 'live', observed: true, publisher: 'ServiceLink Auction', recordId: '2' },
  };

  // Explicit boolean must be preserved verbatim even when arrays disagree or are absent.
  const explicitFalse = standardizeListingRecord({
    ...base,
    hasDocuments: false,
    provenance: { ...base.provenance, sourceFacts: { documents: [{ title: 'Ignored' }] } },
  });
  assert.equal(explicitFalse.hasDocuments, false);
  assert.equal(explicitFalse.triage.hasDocs, false);

  const explicitTrue = standardizeListingRecord({ ...base, hasDocuments: true });
  assert.equal(explicitTrue.hasDocuments, true);

  // Negative controls: unset + missing/empty/malformed document arrays must remain null (never fabricated false).
  for (const variant of [
    {},
    { documents: [] },
    { provenance: { ...base.provenance, sourceFacts: { documents: [] } } },
    { provenance: { ...base.provenance, media: { documents: [] } } },
    { documents: [null, undefined, {}, { title: '   ', url: null }, '', 123, []] },
    { provenance: { ...base.provenance, sourceFacts: { documents: { id: 'not-an-array' } }, media: { documents: 'bad' } } },
    { provenance: { ...base.provenance, sourceFacts: { documents: [{ kind: 'parcel', url: 'https://egis.hud.gov/query' }, { kind: 'feature', url: 'https://services9.arcgis.com/0/1' }] } } },
  ]) {
    const out = standardizeListingRecord({
      ...base,
      ...variant,
      provenance: variant.provenance || base.provenance,
    });
    assert.equal(out.hasDocuments, null);
    assert.equal(out.triage.hasDocs, false);
  }
  assert.equal(deriveHasDocuments({}, {}), null);
  assert.equal(deriveHasDocuments({ documents: [{}] }, {}), null);
});

test('mapDistressStage and computeTriage classify ServiceLink programs (TPS, CWCOT, Traditional, Short Sale)', () => {
  const soon = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
  const far = new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10);
  assert.equal(mapDistressStage('servicelink', soon, 'TPS'), 'scheduled');
  assert.equal(mapDistressStage('servicelink', far, 'CWCOT'), 'pre_foreclosure');
  assert.equal(mapDistressStage('servicelink', soon, 'Traditional'), 'reo');
  assert.equal(mapDistressStage('servicelink', soon, 'Short Sale'), 'pre_foreclosure');
  assert.equal(mapDistressStage('servicelink', soon, null), 'unknown');

  const rec = standardizeListingRecord({
    id: 'sl-triage-cwcot',
    source: 'servicelink',
    state: 'OH',
    address: '10 Main St',
    saleDate: far,
    sourceUrl: 'https://www.servicelinkauction.com/listing/sl-triage-cwcot',
    provenance: { origin: 'live', observed: true, publisher: 'ServiceLink Auction', recordId: 'sl-triage-cwcot', sourceFacts: { auctionProgram: 'CWCOT' } },
  });
  assert.equal(rec.triage.distressStage, 'pre_foreclosure');
});
