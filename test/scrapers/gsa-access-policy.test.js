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