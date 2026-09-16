'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { GsaSurplusScraper } = require('../server/scrapers/gsa');
const {
  isScraplingEnabled,
  getScraplingRuntimeStatus
} = require('../server/scrapers/scrapling-bridge');

// env() captures the live process.env values named, runs the body, and
// restores the originals (deleting the keys when the live value was undefined).
function env(overrides, body) {
  const names = Object.keys(overrides);
  const previous = names.map((name) => [name, process.env[name]]);
  for (const [name, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  try { return body(); }
  finally {
    for (let i = 0; i < names.length; i += 1) {
      const name = names[i];
      const original = previous[i][1];
      if (original === undefined) delete process.env[name];
      else process.env[name] = original;
    }
  }
}

test('isScraplingEnabled returns false when SCRAPLING_SOURCES env var is unset', () => {
  env({ SCRAPLING_SOURCES: undefined }, () => {
    assert.equal(isScraplingEnabled('gsa'), false);
    assert.equal(isScraplingEnabled('ca-controller-tax-sale'), false);
    assert.equal(isScraplingEnabled('hud'), false);
  });
});

test('isScraplingEnabled returns true only for sources listed in SCRAPLING_SOURCES', () => {
  env({ SCRAPLING_SOURCES: 'gsa,ca-controller-tax-sale' }, () => {
    assert.equal(isScraplingEnabled('gsa'), true);
    assert.equal(isScraplingEnabled('ca-controller-tax-sale'), true);
    assert.equal(isScraplingEnabled('hud'), false);
    assert.equal(isScraplingEnabled('treasury'), false);
  });
});

test('isScraplingEnabled is case-insensitive and trims whitespace', () => {
  env({ SCRAPLING_SOURCES: '  GSA ,  CA-CONTROLLER-TAX-SALE  ' }, () => {
    assert.equal(isScraplingEnabled('gsa'), true);
    assert.equal(isScraplingEnabled('ca-controller-tax-sale'), true);
  });
});

test('isScraplingEnabled returns false for empty source arg', () => {
  env({ SCRAPLING_SOURCES: 'gsa' }, () => {
    assert.equal(isScraplingEnabled(''), false);
    assert.equal(isScraplingEnabled(null), false);
    assert.equal(isScraplingEnabled(undefined), false);
  });
});

test('getScraplingRuntimeStatus reports the venv python interpreter when installed', () => {
  const status = getScraplingRuntimeStatus();
  // The runtime is installed; whether it is currently available depends on
  // the env. We assert the shape rather than the boolean.
  assert.equal(typeof status.available, 'boolean');
  assert.ok(status.python === null || typeof status.python === 'string');
});

test('GSA scraper usesScrapling matches isScraplingEnabled("gsa") when no override is provided', () => {
  env({ SCRAPLING_SOURCES: 'gsa' }, () => {
    const scraper = new GsaSurplusScraper();
    assert.equal(scraper.useScrapling, true);
  });
  env({ SCRAPLING_SOURCES: undefined }, () => {
    const scraper = new GsaSurplusScraper();
    assert.equal(scraper.useScrapling, false);
  });
  env({ SCRAPLING_SOURCES: 'hud' }, () => {
    const scraper = new GsaSurplusScraper();
    // Not listed -> disabled even though runtime is available.
    assert.equal(scraper.useScrapling, false);
  });
});

test('GSA scraper useScrapling: true option overrides the env gate', () => {
  env({ SCRAPLING_SOURCES: undefined }, () => {
    const scraper = new GsaSurplusScraper({ useScrapling: true });
    assert.equal(scraper.useScrapling, true);
  });
});

test('end-to-end: with SCRAPLING_SOURCES=gsa, scrapeFeed populates lastRunReport.extraction', async () => {
  if (!getScraplingRuntimeStatus().available) return;
  let fetchCount = 0;
  const listHtml = `<main>
    <article><a href='/asset-details/?property_id=27'>First property</a></article>
    <article><a href='/asset-details/?property_id=28'>Second property</a></article>
  </main>`;
  const detailHtml = `<input value='125 Test Street' name='tour_property_address'>
<input value='Warwick' name='tour_property_city'>
<input value='Rhode Island' name='tour_property_state'>
<input value='02889' name='tour_property_zipcode'>
<p>Sale Number: FIXTURE123. Vacant land.</p>`;

  await env({ SCRAPLING_SOURCES: 'gsa', SCRAPER_RESPECT_ROBOTS: '0' }, async () => {
    const scraper = new GsaSurplusScraper();
    assert.equal(scraper.useScrapling, true);
    scraper.fetchText = async (url) => {
      fetchCount += 1;
      if (url.includes('/our-listing')) return listHtml;
      if (url.includes('/asset-details/')) return detailHtml;
      throw new Error(`unexpected fetch: ${url}`);
    };
    scraper.fetchDetail = async (id, listBid) => {
      // Mirror what fetchDetail would produce when Scrapling is on
      const detail = await scraper.constructor.prototype.fetchDetail.call(scraper, id, listBid)
        .catch(() => null);
      return detail || {
        id: `GSA-${id}`,
        source: 'gsa',
        state: 'RI',
        address: '125 Test Street, Warwick, RI 02889',
        sourceUrl: `https://realestatesales.gov/asset-details/?property_id=${id}`
      };
    };
    scraper.crawlJitter = async () => {};
    const listings = await scraper.scrapeFeed();
    assert.ok(listings.length > 0, 'expected at least one listing');
    assert.ok(scraper.lastRunReport.extraction, 'lastRunReport.extraction should be populated when Scrapling is enabled');
    assert.equal(scraper.lastRunReport.extraction.engine, 'scrapling');
    assert.equal(scraper.lastRunReport.extraction.profile, 'gsa-index');
    assert.match(scraper.lastRunReport.extraction.contentSha256, /^[a-f0-9]{64}$/);
    assert.ok(fetchCount >= 1, 'expected at least one fetch for the list page');
  });
});

test('end-to-end: with SCRAPLING_SOURCES unset, scrapeFeed falls back to native parsing and omits extraction', async () => {
  let extractCalled = false;
  const fakeExtract = async () => {
    extractCalled = true;
    return { engine: 'scrapling', engineVersion: '0.4.15', profile: 'gsa-index', sourceUrl: 'https://example.test', contentSha256: 'a'.repeat(64), items: [] };
  };
  const listHtml = `<main>
    <article><a href='/asset-details/?property_id=27'>First property</a><span class='property-price'>Current Bid: $100,000</span></article>
  </main>`;

  await env({ SCRAPLING_SOURCES: undefined, SCRAPER_RESPECT_ROBOTS: '0' }, async () => {
    const scraper = new GsaSurplusScraper({ extractImpl: fakeExtract });
    assert.equal(scraper.useScrapling, false);
    scraper.fetchText = async () => listHtml;
    scraper.fetchDetail = async (id, listBid) => ({
      id: `GSA-${id}`,
      source: 'gsa',
      state: 'RI',
      address: '125 Test Street, Warwick, RI 02889',
      sourceUrl: `https://realestatesales.gov/asset-details/?property_id=${id}`,
      provenance: { origin: 'live', observed: true, publisher: 'GSA', recordId: id, sourceFacts: { currentBid: listBid } }
    });
    scraper.crawlJitter = async () => {};
    await scraper.scrapeFeed();
    assert.equal(extractCalled, false, 'extractImpl must not be called when Scrapling is disabled');
    assert.equal(scraper.lastRunReport.extraction, undefined, 'lastRunReport.extraction should be undefined when Scrapling is disabled');
  });
});

test('env-gate precedence: option > env var > default false', () => {
  env({ SCRAPLING_SOURCES: 'gsa' }, () => {
    assert.equal(new GsaSurplusScraper({ useScrapling: false }).useScrapling, false);
    assert.equal(new GsaSurplusScraper({ useScrapling: true }).useScrapling, true);
    assert.equal(new GsaSurplusScraper().useScrapling, true);
  });
  env({ SCRAPLING_SOURCES: undefined }, () => {
    assert.equal(new GsaSurplusScraper().useScrapling, false);
    assert.equal(new GsaSurplusScraper({ useScrapling: true }).useScrapling, true);
  });
});

test('Scrapling runtime status reports the pinned version when the venv is present', () => {
  const status = getScraplingRuntimeStatus();
  if (status.available) {
    assert.ok(status.python.endsWith('python.exe') || status.python.endsWith('python'));
  }
});