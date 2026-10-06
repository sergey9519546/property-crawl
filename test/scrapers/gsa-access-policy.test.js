'use strict';

// test/scrapers/gsa-access-policy.test.js
//
// Verifies that the GSA scraper enforces the catalog's accessPolicy in its
// fetchText guard. The catalog declares which publisher paths the scraper
// is allowed to fetch; the scraper must consult that policy on every request
// rather than relying on whichever robots.txt field happened to be set up.

const assert = require('node:assert/strict');
const test = require('node:test');

const { GsaSurplusScraper } = require('../../server/scrapers/gsa');

// We need a base URL whose host matches the catalog's SOURCE_HOSTS for 'gsa'
// so the host check passes; the test URLs themselves drive the policy decision.
function makeScraper() {
  return new GsaSurplusScraper({
    baseUrl: 'https://realestatesales.gov',
    useScrapling: false,
    timeoutMs: 1000,
    maxRetries: 0,
    random: () => 0.5,
    sleepImpl: () => Promise.resolve(),
  });
}

test('GSA fetchText: /asset-details/?property_id=27 is allowed by accessPolicy', async () => {
  const s = makeScraper();
  // Override the underlying network layer (requestText) so a real HTTP
  // request is never issued. The wrapper's policy guard runs before
  // requestText, so reaching it proves the guard accepted the URL.
  let receivedUrl = null;
  s.requestText = async function (url) {
    receivedUrl = url;
    return '<html></html>';
  };
  await s.fetchDetail(27, null).catch(() => {});
  assert.equal(receivedUrl, 'https://realestatesales.gov/asset-details/?property_id=27');
});

test('GSA fetchText: /about is refused by accessPolicy before any HTTP call', async () => {
  const s = makeScraper();
  let parentCalled = false;
  s.requestText = async function () {
    parentCalled = true;
    return '<html></html>';
  };
  await assert.rejects(
    () => s.fetchText('https://realestatesales.gov/about'),
    (err) => {
      assert.equal(err.accessPolicyViolation, true);
      assert.equal(err.accessDecision.reason, 'path_disallowed');
      assert.equal(err.accessDecision.matchedPolicy, '/about');
      return true;
    }
  );
  assert.equal(parentCalled, false, 'parent fetchText must not be called when policy refuses');
});

test('GSA fetchText: /our-listing is refused when SCRAPER_RESPECT_ROBOTS is not "0"', async () => {
  const prev = process.env.SCRAPER_RESPECT_ROBOTS;
  delete process.env.SCRAPER_RESPECT_ROBOTS;
  try {
    const s = makeScraper();
    await assert.rejects(
      () => s.fetchText('https://realestatesales.gov/our-listing'),
      (err) => err.accessPolicyViolation === true && err.accessDecision.reason === 'path_disallowed'
    );
  } finally {
    if (prev !== undefined) process.env.SCRAPER_RESPECT_ROBOTS = prev;
  }
});

test('GSA fetchText: /our-listing is permitted when SCRAPER_RESPECT_ROBOTS=0 (operator override)', async () => {
  const prev = process.env.SCRAPER_RESPECT_ROBOTS;
  process.env.SCRAPER_RESPECT_ROBOTS = '0';
  try {
    const s = makeScraper();
    let networkCalled = false;
    s.requestText = async function () {
      networkCalled = true;
      return '<html></html>';
    };
    await s.fetchText('https://realestatesales.gov/our-listing');
    assert.equal(networkCalled, true);
  } finally {
    if (prev !== undefined) process.env.SCRAPER_RESPECT_ROBOTS = prev;
    else delete process.env.SCRAPER_RESPECT_ROBOTS;
  }
});

test('GSA fetchText: foreign host is refused even with a valid path', async () => {
  const s = makeScraper();
  await assert.rejects(
    () => s.fetchText('https://attacker.example/asset-details/?property_id=27'),
    (err) => err.accessPolicyViolation === true && err.accessDecision.reason === 'host_not_allowed'
  );
});

// --- by-identifier path ---------------------------------------------------
//
// The catalog forbids /our-listing, so the index cannot be used to discover
// property ids. These tests pin the replacement: known ids are refreshed
// through /asset-details only, which is the one path accessPolicy allows.

const DETAIL_HTML = `<input name="tour_property_address" value="149 West Broad Street">
<input name="tour_property_city" value="Bridgeton">
<input name="tour_property_state" value="New Jersey">
<input name="tour_property_zipcode" value="08302">
<p>Sale Number: 27LA000001.</p>`;

function makeSeededScraper(propertyIds) {
  // maxRetries is left at the BaseScraper default on purpose: the by-id path
  // runs inside executeWithRetry, and maxRetries=0 would make that helper
  // throw before the first attempt.
  return new GsaSurplusScraper({
    baseUrl: 'https://realestatesales.gov',
    useScrapling: false,
    timeoutMs: 1000,
    random: () => 0.5,
    sleep: () => Promise.resolve(),
    propertyIds
  });
}

test('GSA by-id path refreshes known ids without requesting the forbidden index', async () => {
  const prev = process.env.SCRAPER_RESPECT_ROBOTS;
  delete process.env.SCRAPER_RESPECT_ROBOTS;
  try {
    const s = makeSeededScraper([27, 43]);
    s.crawlJitter = async () => {};
    const requested = [];
    s.requestText = async url => {
      requested.push(url);
      return DETAIL_HTML;
    };

    const listings = await s.scrapeFeed();

    assert.ok(requested.length > 0, 'the by-id path must fetch the known ids');
    for (const url of requested) {
      assert.match(url, /^https:\/\/realestatesales\.gov\/asset-details\/\?property_id=\d+$/);
    }
    assert.equal(
      requested.some(url => url.includes('/our-listing')),
      false,
      'the by-id path must never request /our-listing'
    );
    assert.equal(listings.length, 2);
    const report = s.lastRunReport;
    assert.equal(report.recordsDiscovered, 2);
    assert.equal(report.scope.endpoint, '/asset-details');
    assert.equal(report.scope.filters.recordSelection, 'known_property_ids');
    assert.equal(report.complete, true);
  } finally {
    if (prev !== undefined) process.env.SCRAPER_RESPECT_ROBOTS = prev;
    else delete process.env.SCRAPER_RESPECT_ROBOTS;
  }
});

test('GSA by-id path drops non-numeric identifiers before any HTTP call', async () => {
  const prev = process.env.SCRAPER_RESPECT_ROBOTS;
  delete process.env.SCRAPER_RESPECT_ROBOTS;
  try {
    const s = makeSeededScraper([]);
    s.crawlJitter = async () => {};
    const requested = [];
    s.requestText = async url => {
      requested.push(url);
      return DETAIL_HTML;
    };

    await s.scrapeByIds(['27', 'our-listing', '../about', '43;drop', '', null, '43']);

    assert.deepEqual(requested, [
      'https://realestatesales.gov/asset-details/?property_id=27',
      'https://realestatesales.gov/asset-details/?property_id=43'
    ]);
  } finally {
    if (prev !== undefined) process.env.SCRAPER_RESPECT_ROBOTS = prev;
    else delete process.env.SCRAPER_RESPECT_ROBOTS;
  }
});

test('GSA by-id path refuses to run with no usable identifier', async () => {
  const s = makeSeededScraper([]);
  s.requestText = async () => {
    throw new Error('no HTTP call may be issued without a property id');
  };
  const listings = await s.scrapeByIds([]);
  assert.deepEqual(listings, []);
  assert.equal(s.lastRunReport.recordsDiscovered, 0);
  assert.equal(s.lastRunReport.outcome, 'empty');
});
