'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { createScrapersHandler } = require('../server/routes/scrapers');
const { EmailNoticesPipeline } = require('../server/sources/email-notices');
const { TrusteeSaleScraper } = require('../server/scrapers/trustee');

function createMockRes() {
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
  return res;
}

test('POST /api/scrapers/run action=email-ingest authenticates via X-Scraper-Admin-Token and enforces confidence/verbatim/apn gate', async () => {
  const upserted = [];
  const mockDb = {
    isPg: false,
    async createListing(listing) {
      upserted.push(listing);
      return listing;
    },
  };
  const reviewMap = new Map();
  const mockReviewStore = {
    map: reviewMap,
    async loadPg() {},
    async persistAsync() { return true; },
  };
  const pipeline = new EmailNoticesPipeline({
    db: mockDb,
    documentReviewStore: mockReviewStore,
  });

  const handler = createScrapersHandler({
    env: { SCRAPER_ADMIN_TOKEN: 'secret-admin-token' },
    database: mockDb,
    emailNoticesPipeline: pipeline,
  });

  // Unauthenticated -> 401
  const unauthRes = createMockRes();
  await handler({
    method: 'POST',
    url: '/api/scrapers/run',
    headers: { 'x-scraper-admin-token': 'wrong-token' },
    body: { action: 'email-ingest', raw: 'Subject: test\r\n\r\nhi' },
  }, unauthRes);
  assert.equal(unauthRes.statusCode, 401);

  // High-confidence notice WITH APN and verbatim spans -> auto-accepted
  const goodRaw = [
    'From: alerts@publicnoticesohio.com',
    'Subject: Cuyahoga County Sheriff Sale',
    '',
    'IN THE COURT OF COMMON PLEAS, CUYAHOGA COUNTY, OHIO.',
    'U.S. Bank National Association vs. Frank Gallagher',
    'Case No. CV-24-998811',
    'APN: 101-12-034',
    'Sale Date: December 01, 2026',
    '1200 West 9th St, Cleveland, OH 44113',
    'Opening bid: $175,000.00',
    'Judgment: $220,000.00',
  ].join('\r\n');

  const goodRes = createMockRes();
  await handler({
    method: 'POST',
    url: '/api/scrapers/run',
    headers: { 'x-scraper-admin-token': 'secret-admin-token' },
    body: { action: 'email-ingest', raw: goodRaw },
  }, goodRes);
  assert.equal(goodRes.statusCode, 200);
  assert.equal(goodRes.body.status, 'completed');
  assert.equal(goodRes.body.action, 'email-ingest');
  assert.equal(goodRes.body.report.listingsAccepted, 1);
  assert.equal(goodRes.body.report.reviewsRouted, 0);
  assert.equal(upserted.length, 1);

  // Missing APN -> routed to document_reviews, not auto-accepted
  const missingApnRaw = [
    'From: alerts@publicnoticesohio.com',
    'Subject: Cuyahoga County Sheriff Sale',
    '',
    'IN THE COURT OF COMMON PLEAS, CUYAHOGA COUNTY, OHIO.',
    'Bank of America vs. John Smith',
    'Case No. CV-24-998812',
    'Sale Date: December 15, 2026',
    '500 Euclid Ave, Cleveland, OH 44114',
    'Opening bid: $150,000.00',
    'Judgment: $180,000.00',
  ].join('\r\n');

  const lowRes = createMockRes();
  await handler({
    method: 'POST',
    url: '/api/scrapers/run',
    headers: { 'x-scraper-admin-token': 'secret-admin-token' },
    body: { action: 'email-ingest', raw: missingApnRaw },
  }, lowRes);
  assert.equal(lowRes.statusCode, 200);
  assert.equal(lowRes.body.report.listingsAccepted, 0);
  assert.equal(lowRes.body.report.reviewsRouted, 1);
  assert.equal(reviewMap.size, 1);
});

test('TrusteeSaleScraper supports deadlineAt + checkpoint cursoring and is in SLICE_PRIORITY', async () => {
  const scrapersSrc = fs.readFileSync(path.resolve(__dirname, '../server/routes/scrapers.js'), 'utf8');
  assert.match(scrapersSrc, /SLICE_PRIORITY\s*=\s*\[[^\]]*'trustee'[^\]]*\]/);

  const visited = [];
  const scraper = new TrusteeSaleScraper();
  scraper.setCheckpoint('1'); // Start at index 1 ('harris' if ['maricopa', 'harris', 'cook'])
  scraper.fetchJurisdictionText = async (url, jurKey) => {
    visited.push(jurKey);
    // Simulate time passing so deadlineAt triggers after 1st jurisdiction
    return '';
  };

  // Use a deadline already within the 1800ms guard after 0ms? No, if deadlineAt is Date.now() + 1900,
  // it should run at least 1 if we advance, or we can test deadlineAt = Date.now() + 500 -> aborts immediately before 1st!
  const immediateAbort = await scraper.scrapeFeed({
    jurisdictions: ['maricopa', 'harris', 'cook'],
    deadlineAt: Date.now() + 500,
    cursor: '1',
  });
  assert.equal(immediateAbort.partialSweep, true);
  assert.equal(immediateAbort.nextCursor, '1');
  assert.equal(immediateAbort.nextContinuationToken, '1');
  assert.equal(visited.length, 0);
});
