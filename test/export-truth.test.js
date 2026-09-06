const assert = require('node:assert/strict');
const test = require('node:test');

const db = require('../server/db/client');
const handleExport = require('../server/routes/export');

test('CSV export leaves unavailable financial and legal fields blank', async () => {
  const originalGetListings = db.getListings;
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
      { method: 'GET', url: '/api/export?format=csv', headers: {} },
      {
        setHeader(name, value) { headers[name.toLowerCase()] = value; },
        send(value) { body = value; },
      },
    );
  } finally {
    db.getListings = originalGetListings;
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
    provenance: { publisher: 'ServiceLink Auction', recordId: 'publisher-1' },
    cashToClose: 106_000,
    cashToCloseDetails: { openingBid: 100_000, buyersPremium: 5_000, transferTax: 500, totalCashToClose: 106_000 },
  });
  assert.equal(exported.bidSpread, 45_000);
  assert.equal(exported.equity, undefined);
  assert.equal(exported.source, 'Public Auction Network');
  assert.equal(exported.raw, 'Public Auction Network publisher record');
  assert.equal(exported.provenance.publisher, 'Public Auction Network');
  assert.doesNotMatch(JSON.stringify(exported), /servicelink/i);
  assert.equal(exported.cashRequirement.totalAcquisitionCost, null);
  assert.equal(exported.cashRequirement.status, 'unresolved');
  assert.match(exported.dealScoreMeaning, /triage only/i);
});
