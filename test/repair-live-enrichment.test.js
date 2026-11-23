'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { repairLiveEnrichment } = require('../server/enrichment/repair-live-enrichment');
const { createScrapersHandler } = require('../server/routes/scrapers');
const { inspectMapLocation } = require('../src/lib/listing-map-policy');

function makeFakePool(initialRows) {
  const rows = initialRows.map((r) => JSON.parse(JSON.stringify(r)));
  const updates = [];

  return {
    rows,
    updates,
    async query(sql, params = []) {
      const normalizedSql = sql.replace(/\s+/g, ' ').trim();
      if (normalizedSql.startsWith('SELECT') && normalizedSql.includes("state = 'NJ'") && normalizedSql.includes("assessorRoll")) {
        return {
          rows: rows
            .filter((r) => r.state === 'NJ' && r.provenance?.derivedFields?.assessorRoll?.parcel)
            .map((r) => ({ ...r })),
        };
      }
      if (normalizedSql.startsWith('SELECT') && normalizedSql.includes("WHERE source_key = 'civilview'")) {
        return {
          rows: rows
            .filter((r) => r.source === 'civilview')
            .map((r) => ({ ...r })),
        };
      }
      if (normalizedSql.startsWith('SELECT') && normalizedSql.includes('latitude IS NULL OR longitude IS NULL')) {
        const limit = Number(params[0]) || 60;
        return {
          rows: rows
            .filter((r) => (r.lat == null || r.lng == null || (r.lat === 0 && r.lng === 0)) && r.address && r.state)
            .slice(0, limit)
            .map((r) => ({ ...r })),
        };
      }
      if (normalizedSql.startsWith('UPDATE listings SET latitude = NULL, longitude = NULL')) {
        const [id, provenanceJson] = params;
        const target = rows.find((r) => r.id === id);
        if (target) {
          target.lat = null;
          target.lng = null;
          target.provenance = JSON.parse(provenanceJson);
          updates.push({ kind: 'geocode_backoff', id });
        }
        return { rowCount: target ? 1 : 0, rows: [] };
      }
      if (normalizedSql.startsWith('UPDATE listings SET latitude = $2, longitude = $3')) {
        const [id, lat, lng, assessed, year, propType, provenanceJson] = params;
        const target = rows.find((r) => r.id === id);
        if (target) {
          if (normalizedSql.includes('COALESCE($4, assessed_value)')) {
            target.lat = lat;
            target.lng = lng;
            target.assessed = target.assessed ?? assessed;
            target.year = target.year ?? year;
            target.propType = (target.propType && target.propType !== 'Unknown') ? target.propType : propType;
          } else {
            target.lat = lat;
            target.lng = lng;
            target.assessed = assessed;
            target.year = year;
            target.propType = propType;
          }
          target.provenance = JSON.parse(provenanceJson);
          updates.push({ kind: 'geo_or_nj', id, lat, lng, assessed });
        }
        return { rowCount: target ? 1 : 0, rows: [] };
      }
      if (normalizedSql.startsWith('UPDATE listings SET judgment_amount = COALESCE')) {
        const [id, judgment, provenanceJson] = params;
        const target = rows.find((r) => r.id === id);
        if (target) {
          target.judgment = target.judgment ?? judgment;
          target.provenance = JSON.parse(provenanceJson);
          updates.push({ kind: 'civilview', id, judgment });
        }
        return { rowCount: target ? 1 : 0, rows: [] };
      }
      if (normalizedSql.startsWith('SELECT') && normalizedSql.includes('catch_summary IS NULL')) {
        const limit = Number(params[0]) || 250;
        return {
          rows: rows
            .filter((r) => r.catchSummary == null)
            .slice(0, limit)
            .map((r) => ({ ...r })), 
        };
      }
      if (normalizedSql.startsWith('UPDATE listings SET catch_summary = $2')) {
        const [id, summary] = params;
        const target = rows.find((r) => r.id === id);
        if (target) {
          target.catchSummary = summary;
          updates.push({ kind: 'catch_summary', id, summary });
        }
        return { rowCount: target ? 1 : 0, rows: [] };
      }
      throw new Error(`Unexpected SQL in fake pool: ${normalizedSql}`);
    },
  };
}

test('repairLiveEnrichment clears mismatched NJ situs parcel, backfills CivilView upset/judgment without fabricating openingBid, and Census-geocodes missing coords', async () => {
  const pool = makeFakePool([
    {
      id: 'CIV-NJ-10-2249533993',
      source: 'civilview',
      state: 'NJ',
      county: 'Hudson',
      city: 'NORTH BERGEN',
      zip: '07047',
      address: '1427 46TH STREET, NORTH BERGEN, NJ 07047',
      sourceUrl: 'https://salesweb.civilview.com/Sales/SaleDetails?PropertyId=2249533993',
      lat: 40.783149,
      lng: -74.029037,
      assessed: 705700,
      year: 1989,
      propType: 'Triplex',
      openingBid: null,
      judgment: null,
      raw: 'TAX LOT 38 BLOCK 153\nESTIMATED UPSET BID AMOUNT: $1,263,000.00\nCURRENT AMOUNT DUE: $312,000.00',
      sourceObservedAt: '2026-10-15T12:00:00.000Z',
      provenance: {
        origin: 'live',
        observed: true,
        recordKind: 'source_record',
        publisher: 'CivilView',
        recordId: '2249533993',
        observedAt: '2026-10-15T12:00:00.000Z',
        parcelKey: '34017-090815338',
        coordinates: { lat: 40.783149, lng: -74.029037 },
        derivedFields: {
          parcelKey: true,
          assessorRoll: {
            parcel: {
              situsAddress: '712 80TH ST',
              canonicalApn: '090815338',
              assessedValue: { total: 705700 },
            },
          },
        },
      },
    },
    {
      id: 'GSA-TX-101',
      source: 'gsa',
      state: 'TX',
      county: 'Travis',
      city: 'Austin',
      zip: '78701',
      address: '300 W 8TH ST',
      sourceUrl: 'https://realestatesales.gov/asset-details?property_id=101',
      lat: null,
      lng: null,
      assessed: null,
      year: null,
      propType: 'Commercial',
      openingBid: 50000,
      judgment: null,
      raw: 'Federal courthouse annex',
      sourceObservedAt: '2026-10-15T12:00:00.000Z',
      provenance: {
        origin: 'live',
        observed: true,
        recordKind: 'source_record',
        publisher: 'GSA',
        recordId: '101',
        observedAt: '2026-10-15T12:00:00.000Z',
      },
    },
  ]);

  const report = await repairLiveEnrichment({
    pool,
    dryRun: false,
    now: Date.parse('2026-11-10T00:00:00.000Z'),
    enrichNjListing: async (listing) => {
      if (listing.id === 'CIV-NJ-10-2249533993') {
        listing.lat = 40.779111;
        listing.lng = -74.021222;
        listing.assessed = 415000;
        listing.year = 1925;
        listing.propType = 'Single Family';
        listing.provenance.derivedFields = listing.provenance.derivedFields || {};
        listing.provenance.derivedFields.assessorRoll = {
          parcel: {
            situsAddress: '1427 46TH ST',
            canonicalApn: '090807412',
            assessedValue: { total: 415000 },
          },
        };
        listing.provenance.coordinates = {
          origin: 'geocoder',
          provider: 'NJGIN Cadastral Parcel Centroid',
          verification: 'exact_address_match',
          precision: 'parcel',
          sourceRecordUrl: listing.sourceUrl,
          observedAt: '2026-11-10T00:00:00.000Z',
          lat: 40.779111,
          lng: -74.021222,
          matchedAddress: {
            address: listing.address,
            city: listing.city,
            state: listing.state,
            zip: listing.zip,
          },
        };
      }
      return { found: true };
    },
    resolveCensusCoordinates: async ({ observedAddress }) => {
      if (observedAddress?.zip5 === '78701') {
        return { lat: 30.2706, lng: -97.7458, basis: 'source_observed_address_census_geocode' };
      }
      return null;
    },
  });

  assert.equal(report.njMismatchedFound, 1);
  assert.equal(report.njMismatchedCleared, 1);
  assert.equal(report.njReEnriched, 1);
  assert.equal(report.civilviewUpdated, 1);
  assert.equal(report.geocodedCount, 1);
  assert.equal(report.catchBackfilled, 2);

  const njRow = pool.rows.find((r) => r.id === 'CIV-NJ-10-2249533993');
  assert.equal(njRow.lat, 40.779111);
  assert.equal(njRow.assessed, 415000);
  assert.equal(njRow.provenance.derivedFields.assessorRoll.parcel.situsAddress, '1427 46TH ST');
  assert.equal(njRow.provenance.approximateUpsetPrice.amount, 1263000);
  assert.equal(njRow.judgment, 312000);
  assert.equal(njRow.openingBid, null, 'must never fabricate openingBid from upset or judgment');
  assert.equal(inspectMapLocation(njRow).accepted, true, 'NJ repaired coords must pass map policy');

  const gsaRow = pool.rows.find((r) => r.id === 'GSA-TX-101');
  assert.equal(gsaRow.lat, 30.2706);
  assert.equal(gsaRow.lng, -97.7458);
  assert.equal(inspectMapLocation(gsaRow).accepted, true, 'Census geocoded coords must pass map policy');
  assert.ok(typeof njRow.catchSummary === 'string' && njRow.catchSummary.includes('judgment'.toLowerCase()) || njRow.catchSummary.length > 0);
  assert.ok(typeof gsaRow.catchSummary === 'string' && gsaRow.catchSummary.includes('$50,000'));
});

test('POST /api/scrapers/run?action=repair-enrichment enforces SCRAPER_ADMIN_TOKEN and dispatches repairLiveEnrichment', async () => {
  let calledWith = null;
  const handler = createScrapersHandler({
    env: { SCRAPER_ADMIN_TOKEN: 'top-secret-token' },
    repairLiveEnrichment: async (opts) => {
      calledWith = opts;
      return { dryRun: opts.dryRun, njMismatchedCleared: 2, civilviewUpdated: 10, geocodedCount: 5 };
    },
  });

  const makeRes = () => ({
    statusCode: 200,
    body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  });

  const unauthRes = makeRes();
  await handler({ method: 'POST', url: '/api/scrapers/run?action=repair-enrichment', headers: {} }, unauthRes);
  assert.equal(unauthRes.statusCode, 401);
  assert.equal(calledWith, null);

  const authRes = makeRes();
  await handler({
    method: 'POST',
    url: '/api/scrapers/run?action=repair-enrichment&njLimit=15&geocodeLimit=25&dryRun=true',
    headers: { 'x-scraper-token': 'top-secret-token' },
    body: {},
  }, authRes);
  assert.equal(authRes.statusCode, 200);
  assert.equal(authRes.body.status, 'completed');
  assert.equal(authRes.body.action, 'repair-enrichment');
  assert.deepEqual(calledWith, { njLimit: 15, geocodeLimit: 25, dryRun: true });
  assert.equal(authRes.body.report.civilviewUpdated, 10);
});
