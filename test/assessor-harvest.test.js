'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { afterEach, test } = require('node:test');
const {
  cacheKeyFor,
  harvestAssessorRolls,
  taxYearFromRawAttributes,
} = require('../server/enrichment/assessor-harvest');

const temporaryDirectories = [];
function temporaryCachePath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'assessor-harvest-'));
  temporaryDirectories.push(dir);
  return path.join(dir, 'assessor-roll.json');
}
afterEach(() => {
  while (temporaryDirectories.length) {
    const dir = temporaryDirectories.pop();
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
});

// ServiceLink-style live listing in an enrolled county (Cuyahoga OH has a
// statutory taxable-fraction conversion in the registry).
function liveListing(overrides = {}) {
  return {
    id: 'OH-CUY-1001',
    source: 'civilview',
    state: 'OH',
    county: 'Cuyahoga',
    address: '1428 E 105th St, Cleveland, OH 44108',
    openingBid: 40000,
    lat: 41.4825,
    lng: -81.6012,
    provenance: { origin: 'live', observed: true, publisher: 'CivilView', recordId: '1001' },
    ...overrides,
  };
}

// The ArcGIS FeatureServer response shape queryArcgisParcel normalizes.
function arcgisFetchReturning(attributes) {
  return async () => ({
    ok: true,
    json: async () => ({
      features: attributes ? [{ attributes }] : [],
    }),
  });
}

const CUYAHOGA_ATTRIBUTES = {
  PARCELPIN: '101-01-001',
  TOTAL_ASSESSED_VAL: 70000,
  LAND_ASSESSED_VAL: 20000,
  BLDG_ASSESSED_VAL: 50000,
  TAX_YEAR: 2024,
  LUC_DESC: 'RESIDENTIAL',
};

test('harvest attaches the assessor parcel and records durable provenance', async () => {
  const cachePath = temporaryCachePath();
  const listing = liveListing();
  const fetchCalls = [];
  const results = await harvestAssessorRolls([listing], {
    cachePath,
    fetchFn: async (url) => { fetchCalls.push(url); return arcgisFetchReturning(CUYAHOGA_ATTRIBUTES)(); },
    now: Date.parse('2026-10-21T00:00:00.000Z'),
  });

  assert.equal(results.harvested, 1);
  assert.equal(results.fetched, 1);
  assert.equal(fetchCalls.length, 1);
  assert.ok(listing.assessorParcel);
  assert.equal(listing.assessorParcel.assessedValue.total, 70000);
  assert.equal(listing.assessorParcel.rawApn, '101-01-001');
  assert.equal(listing.assessorParcel.canonicalApn, '10101001'); // normalizeApn strips separators
  // Durable provenance: trimmed parcel (no rawAttributes), county, basis, year.
  const roll = listing.provenance.derivedFields.assessorRoll;
  assert.equal(roll.countyKey, 'OH-CUYAHOGA');
  assert.equal(roll.basis, 'ARCGIS_REST_PARCEL');
  assert.equal(roll.assessmentYear, 2024);
  assert.ok(roll.parcel);
  assert.equal(roll.parcel.assessedValue.total, 70000);
  assert.equal('rawAttributes' in roll.parcel, false);
  // The roll figure fills assessed + assessmentYear for the FHFA fallback.
  assert.equal(listing.assessed, 70000);
  assert.equal(listing.assessmentYear, 2024);
  assert.equal(listing.parcelKey, '39035-10101001');

  // Verify Postgres JSONB reload path: when only provenance.derivedFields.assessorRoll survives,
  // presentListing still reconstructs the canonical parcelKey.
  const { presentListing } = require('../server/routes/listings');
  const pgReloaded = presentListing({
    id: listing.id,
    source: listing.source,
    state: listing.state,
    county: listing.county,
    address: listing.address,
    provenance: listing.provenance,
  });
  assert.equal(pgReloaded.parcelKey, '39035-10101001');
});

test('harvest uses the disk cache and does not refetch within the TTL', async () => {
  const cachePath = temporaryCachePath();
  const first = liveListing();
  let fetchCount = 0;
  const fetchFn = async () => { fetchCount += 1; return arcgisFetchReturning(CUYAHOGA_ATTRIBUTES)(); };
  await harvestAssessorRolls([first], { cachePath, fetchFn, now: Date.parse('2026-10-21T00:00:00.000Z') });

  const second = liveListing({ id: 'OH-CUY-1002' });
  const results = await harvestAssessorRolls([second], { cachePath, fetchFn, now: Date.parse('2026-10-21T00:00:00.000Z') });
  assert.equal(fetchCount, 1);
  assert.equal(results.cacheHits, 1);
  assert.ok(second.assessorParcel);
});

test('harvest skips non-enrolled counties, non-live provenance, and already-harvested listings', async () => {
  const cachePath = temporaryCachePath();
  const fetchFn = async () => { throw new Error('must not be called'); };
  const results = await harvestAssessorRolls([
    liveListing({ state: 'CA', county: 'Los Angeles' }), // enrolled? No — not in the registry.
    liveListing({ id: 'X-2', provenance: { origin: 'seed', observed: false } }),
    liveListing({ id: 'X-3', assessorParcel: { assessedValue: { total: 1 } } }),
    liveListing({ id: 'X-4', lat: null }),
  ], { cachePath, fetchFn, now: Date.parse('2026-10-21T00:00:00.000Z') });
  assert.equal(results.considered, 0);
  assert.equal(results.harvested, 0);
});

test('harvest is bounded per run and fails open on unreachable rolls', async () => {
  const cachePath = temporaryCachePath();
  const listings = Array.from({ length: 6 }, (_, i) => liveListing({ id: `OH-CUY-${i}`, lat: 41.48 + i * 0.01 }));
  const results = await harvestAssessorRolls(listings, {
    cachePath,
    limit: 3,
    // queryArcgisParcel swallows transport errors and returns null, so an
    // unreachable roll surfaces as a miss — never a crash, never a harvest.
    fetchFn: async () => { throw new Error('network down'); },
    now: Date.parse('2026-10-21T00:00:00.000Z'),
  });
  assert.equal(results.considered, 3); // limit respected
  assert.equal(results.notFound, 3);
  assert.equal(results.harvested, 0);
  assert.equal(listings.every((listing) => listing.assessorParcel === undefined), true);
});

test('an empty feature list is a miss, not an error, and is not cached as a hit', async () => {
  const cachePath = temporaryCachePath();
  const listing = liveListing();
  const results = await harvestAssessorRolls([listing], {
    cachePath,
    fetchFn: arcgisFetchReturning(null),
    now: Date.parse('2026-10-21T00:00:00.000Z'),
  });
  assert.equal(results.notFound, 1);
  assert.equal(results.harvested, 0);
  assert.equal(listing.assessorParcel, undefined);
});

test('taxYearFromRawAttributes accepts common roll-year spellings and rejects nonsense', () => {
  assert.equal(taxYearFromRawAttributes({ TAX_YEAR: 2024 }), 2024);
  assert.equal(taxYearFromRawAttributes({ assessYr: '2023' }), 2023);
  assert.equal(taxYearFromRawAttributes({ ROLL_YEAR: 1850 }), null);
  assert.equal(taxYearFromRawAttributes({ TAX_YEAR: 'n/a' }), null);
  assert.equal(taxYearFromRawAttributes(null), null);
});

test('cacheKeyFor is stable for a county and rounded coordinates', () => {
  assert.equal(cacheKeyFor('OH-CUYAHOGA', 41.482512, -81.601239), 'OH-CUYAHOGA:41.48251,-81.60124');
  assert.equal(cacheKeyFor('OH-CUYAHOGA', null, null, '10101001'), 'OH-CUYAHOGA:apn:10101001');
});

test('harvest attaches assessor parcel via APN lookup when coordinates are null', async () => {
  const cachePath = temporaryCachePath();
  const listing = liveListing({
    id: 'OH-CUY-APN-ONLY',
    lat: null,
    lng: null,
    provenance: {
      origin: 'live',
      observed: true,
      publisher: 'CivilView',
      recordId: 'apn-only-1',
      sourceFacts: {
        parcelNumber: '101-01-001',
      },
    },
  });
  const fetchCalls = [];
  const results = await harvestAssessorRolls([listing], {
    cachePath,
    fetchFn: async (url) => {
      fetchCalls.push(url);
      return arcgisFetchReturning(CUYAHOGA_ATTRIBUTES)();
    },
    now: Date.parse('2026-10-21T00:00:00.000Z'),
  });

  assert.equal(results.harvested, 1);
  assert.equal(results.fetched, 1);
  assert.equal(fetchCalls.length, 1);
  assert.ok(fetchCalls[0].includes('UPPER%28PARCELPIN%29+LIKE'));
  assert.ok(listing.assessorParcel);
  assert.equal(listing.assessorParcel.canonicalApn, '10101001');
  assert.equal(listing.assessed, 70000);
  assert.equal(listing.parcelKey, '39035-10101001');

  // Verify cached under countyKey:apn:cleanApn
  const rawCache = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
  assert.ok(rawCache['OH-CUYAHOGA:apn:10101001']);
  assert.equal(rawCache['OH-CUYAHOGA:apn:10101001'].parcel.canonicalApn, '10101001');

  // Verify second run hits cache without fetching
  const secondListing = liveListing({
    id: 'OH-CUY-APN-ONLY-2',
    lat: null,
    lng: null,
    apn: '10101001',
  });
  const cachedResults = await harvestAssessorRolls([secondListing], {
    cachePath,
    fetchFn: async () => { throw new Error('must not refetch'); },
    now: Date.parse('2026-10-21T00:00:00.000Z'),
  });
  assert.equal(cachedResults.harvested, 1);
  assert.equal(cachedResults.cacheHits, 1);
  assert.equal(secondListing.assessed, 70000);
});
