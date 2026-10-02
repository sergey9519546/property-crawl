// test/secondary-media-budget-honesty.test.js
//
// A capped search must say it was capped.
//
// The media collector caps candidate pages at maxPages (default 4) and a listing
// can easily have a dozen. It used to report a flat 'no_qualified_gallery'
// after examining 4 of them -- indistinguishable from reporting it after
// examining all 4. A reader concludes the listing has no gallery when a 5th
// candidate might have had one.
//
// That is dropped coverage presenting itself as a finding, which is the same
// shape as the sheriff fallback reporting a dead county as a successful
// collection. The report now carries candidatesTotal / examined / truncated and
// uses a distinct reason when the budget cut the list short.

const test = require('node:test');
const assert = require('node:assert/strict');

const { SecondaryMediaCollector } = require('../server/scrapers/secondary-media-collector');

function listing() {
  return { id: 'L-1', address: '43 East 2nd Street', city: 'Boyertown', state: 'PA', zip: '19512' };
}

/** The publisher page shape extractSecondaryMedia actually accepts. */
const PHOTO = 'https://www.compass.com/m/' + 'a'.repeat(64) + '/origin.jpg';
const SOURCE_URL = 'https://www.compass.com/homedetails/43-E-2nd-St-Boyertown-PA-19512/1LBJN8_pid/';
const GOOD_HTML = '<script type="application/ld+json">' + JSON.stringify({
  '@graph': [{
    '@type': ['SingleFamilyResidence', 'RealEstateListing'],
    url: SOURCE_URL,
    address: { streetAddress: '43 East 2nd Street', addressLocality: 'Boyertown', addressRegion: 'PA', postalCode: '19512' },
    image: [PHOTO],
  }],
}) + '</script>';

/** Build N distinct candidate detail URLs on the accepted publisher. */
function candidates(n) {
  return Array.from({ length: n }, (_, i) =>
    `https://www.compass.com/homedetails/43-E-2nd-St-Boyertown-PA-19512/${i + 1}X_pid/`);
}

/** A collector that never accepts anything, so every attempt records a miss. */
function collector(overrides = {}) {
  return new SecondaryMediaCollector({
    sleep: async () => {},
    maxPages: 4,
    fetchImpl: async () => new Response('<html><body>no gallery here</body></html>'),
    ...overrides,
  });
}

test('a truncated candidate list is reported as truncated, not as "no gallery"', async () => {
  const result = await collector().collect(listing(), candidates(12));

  assert.equal(result.accepted, false);
  assert.equal(result.candidatesTotal, 12, 'the full candidate count must survive');
  assert.equal(result.examined, 4, 'only maxPages should have been fetched');
  assert.equal(result.truncated, true, 'dropping 8 of 12 candidates is truncation');
  assert.equal(result.reason, 'no_qualified_gallery_within_budget',
    'a budget-capped miss must not read the same as an exhaustive miss');
});

test('an exhaustive miss is NOT reported as truncated', async () => {
  // The distinction that would be lost without the three fields: 3 candidates
  // examined out of 3 is a real answer, and must not claim the budget cut it.
  const result = await collector().collect(listing(), candidates(3));

  assert.equal(result.candidatesTotal, 3);
  assert.equal(result.examined, 3);
  assert.equal(result.truncated, false);
  assert.equal(result.reason, 'no_qualified_gallery',
    'an exhaustive search with no gallery is a finding, not a coverage gap');
});

test('no candidates at all is still its own case', async () => {
  const result = await collector().collect(listing(), []);
  assert.equal(result.reason, 'no_supported_candidates');
  assert.equal(result.truncated, false);
  assert.equal(result.candidatesTotal, 0);
});

test('an accepted gallery reports the counts too', async () => {
  const c = collector({ fetchImpl: async () => new Response(GOOD_HTML) });
  // The declared page url must match the fetched one, so this uses the single
  // accepted URL rather than the numbered candidates above.
  const result = await c.collect(listing(), [SOURCE_URL]);

  assert.equal(result.accepted, true, 'fixture must be a page the extractor really accepts');
  assert.equal(result.truncated, false);
  assert.equal(result.examined, 1, 'it stops as soon as a gallery is accepted');
  assert.equal(result.candidatesTotal, 1, 'and still says how many were on the table');
});
