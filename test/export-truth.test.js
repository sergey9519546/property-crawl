const assert = require('node:assert/strict');
const test = require('node:test');

const db = require('../server/db/client');
const handleExport = require('../server/routes/export');

test('exports require the configured operator credential', async () => {
  const previousToken = process.env.SCRAPER_ADMIN_TOKEN;
  process.env.SCRAPER_ADMIN_TOKEN = 'export-test-token';
  const res = {
    statusCode: 200, body: null,
    setHeader() {}, status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
  };
  try {
    await handleExport({ method: 'GET', url: '/api/export?format=json', headers: {} }, res);
    assert.equal(res.statusCode, 401);
    assert.match(res.body.error, /unlock|credential/i);
  } finally {
    if (previousToken === undefined) delete process.env.SCRAPER_ADMIN_TOKEN;
    else process.env.SCRAPER_ADMIN_TOKEN = previousToken;
  }
});
test('CSV export leaves unavailable financial and legal fields blank', async () => {
  const originalGetListings = db.getListings;
  const originalToken = process.env.SCRAPER_ADMIN_TOKEN;
  process.env.SCRAPER_ADMIN_TOKEN = 'export-test-token';
  db.getListings = async () => ({
    listings: [{
      id: 'CIV-NJ-2-100',
      address: '19 West Park Avenue',
      city: 'Park Ridge',
      state: 'NJ',
      zip: '07656',
      source: 'civilview',
      openingBid: null,
      estLow: null,
      estHigh: null,
      equity: null,
      dealScore: null,
      cashToClose: null,
      redemptionDays: null,
      seniorLienRisk: null,
      saleDate: null,
      plaintiff: null,
      defendant: null,
      deposit: null,
    }],
  });

  const headers = {};
  let body = '';
  try {
    await handleExport(
      { method: 'GET', url: '/api/export?format=csv', headers: { authorization: 'Bearer export-test-token' } },
      {
        setHeader(name, value) { headers[name.toLowerCase()] = value; },
        send(value) { body = value; },
      },
    );
  } finally {
    db.getListings = originalGetListings;
    if (originalToken === undefined) delete process.env.SCRAPER_ADMIN_TOKEN;
    else process.env.SCRAPER_ADMIN_TOKEN = originalToken;
  }

  assert.match(headers['content-type'], /text\/csv/);
  assert.match(body.split('\r\n')[0], /Bid Spread/);
  assert.doesNotMatch(body.split('\r\n')[0], /Built-in Equity|Equity Spread/);
  const row = body.split('\r\n')[1].split(',');
  for (const index of [6, 7, 8, 9, 10, 12, 13, 14, 15, 16, 17, 18, 19, 20]) {
    assert.equal(row[index], '', `column ${index} must remain blank when source evidence is absent`);
  }
  assert.equal(row[11], 'unresolved');
  assert.match(row[21], /published terms or explicit assumptions/);
});

test('JSON export uses Bid Spread and rejects legacy guessed cash totals', () => {
  const exported = handleExport.publicExportListing({
    id: 'TRUTH-1', source: 'serviceLink auction', equity: 45_000, dealScore: 70,
    raw: 'ServiceLink Auction publisher record',
    sourceUrl: 'https://www.servicelinkauction.com/property-details/publisher-1',
    privateCollectorState: { leaseOwner: 'worker-secret' },
    documents: [{ url: 'https://publisher.example/document', privateToken: 'not-exported' }],
    provenance: { publisher: 'ServiceLink Auction', recordId: 'publisher-1', origin: 'live', observed: true, sourceFacts: { internal: true }, derivedFields: { sqft: { model: 'test-model', inputs: ['photo'], privateInput: 'not-exported' } } },
    cashToClose: 106_000,
    cashToCloseDetails: { openingBid: 100_000, buyersPremium: 5_000, transferTax: 500, totalCashToClose: 106_000 },
  });
  assert.equal(exported.bidSpread, 45_000);
  assert.equal(exported.equity, undefined);
  assert.equal(exported.source, 'Public Auction Network');
  assert.equal(exported.raw, undefined);
  assert.equal(exported.privateCollectorState, undefined);
  assert.equal(exported.documents, undefined);
  assert.equal(exported.sourceUrl, 'https://www.servicelinkauction.com/property-details/publisher-1');
  assert.equal(exported.provenance.sourceFacts, undefined);
  assert.deepEqual(exported.provenance.derivedFields.sqft, { model: 'test-model', inputs: ['photo'] });
  assert.equal(exported.provenance.publisher, 'Public Auction Network');
  assert.doesNotMatch(exported.source, /servicelink/i);
  assert.doesNotMatch(exported.provenance.publisher, /servicelink/i);
  assert.equal(exported.cashRequirement.totalAcquisitionCost, null);
  assert.equal(exported.cashRequirement.status, 'unresolved');
  assert.match(exported.dealScoreMeaning, /triage only/i);
});

test('JSON export retains normalized identifiers, year, program aliases, and supplied sale timezone', () => {
  const exported = handleExport.publicExportListing({
    id: 'NORMALIZED-1', source: 'hud', address: '1 Evidence Way', state: 'CA',
    year: 1987, yearBuilt: 1986, apn: 'APN-001', parcelId: 'PARCEL-002', parcelNumber: 'PARCEL-003', caseNumber: '042-788842',
    auctionProgram: 'HUD REO', program: 'HUD REO', lifecycleStatus: 'publicly_listed', lifecycle: 'publicly_listed', transactionOutcome: null,
    saleDate: '2026-09-30', saleTime: '10:00', saleTimezone: 'America/Los_Angeles',
    raw: 'publisher payload', provenance: { origin: 'live', observed: true, recordId: 'record-1', sourceFacts: { privatePayload: true } },
  });
  assert.equal(exported.year, 1987);assert.equal(exported.yearBuilt, 1986);
  assert.equal(exported.apn, 'APN-001');assert.equal(exported.parcelId, 'PARCEL-002');assert.equal(exported.parcelNumber, 'PARCEL-003');assert.equal(exported.caseNumber, '042-788842');
  assert.equal(exported.auctionProgram, 'HUD REO');assert.equal(exported.program, 'HUD REO');assert.equal(exported.lifecycleStatus, 'publicly_listed');assert.equal(exported.lifecycle, 'publicly_listed');
  assert.equal(exported.saleTimezone, 'America/Los_Angeles');assert.equal(exported.raw, undefined);assert.equal(exported.provenance.sourceFacts, undefined);
});
