'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { exactAddress, sameAddress, propertyPage, extractSecondaryMedia, inspectSecondaryMedia } = require('../server/scrapers/secondary-property-media');
const { SecondaryMediaCollector } = require('../server/scrapers/secondary-media-collector');
const { saveMedia, readMediaStore, attachMedia } = require('../server/db/property-media-store');
const listing = { id: 'sample', address: '43 East 2nd Street', city: 'Boyertown', state: 'PA', zip: '19512' };
const sourceUrl = 'https://www.compass.com/homedetails/43-E-2nd-St-Boyertown-PA-19512/1LBJN8_pid/';
const photo = 'https://www.compass.com/m/' + 'a'.repeat(64) + '/origin.jpg';
const node = overrides => ({ '@type': ['SingleFamilyResidence', 'RealEstateListing'], url: sourceUrl, address: { streetAddress: '43 E 2nd St', addressLocality: 'Boyertown', addressRegion: 'PA', postalCode: '19512' }, image: [{ '@type': 'ImageObject', url: photo }], ...overrides });
const html = nodes => '<script type="application/ld+json">' + JSON.stringify({ '@graph': nodes }) + '</script>';
const extract = nodes => extractSecondaryMedia({ listing, sourceUrl, html: html(nodes) });

test('full identity accepts only safe spelling variations and exact components', () => {
  assert.ok(sameAddress(listing, node().address));
  assert.ok(sameAddress({ ...listing, address: '43 E 2nd St, Boyertown, PA 19512' }, listing));
  for (const altered of [{ address: '44 E 2nd St' }, { address: '43 W 2nd St' }, { city: 'Reading' }, { state: 'NJ' }, { zip: '19513' }, { zip: '19512-0001' }, { unit: '2' }]) assert.equal(sameAddress(listing, { ...listing, ...altered }), false);
  assert.equal(exactAddress({ ...listing, city: 'Unknown' }), null);
  assert.equal(exactAddress({ ...listing, zip: '' }), null);
  assert.ok(sameAddress({ ...listing, address: '43 E 2nd St Apt 2' }, { ...listing, unit: '2' }));
  assert.equal(sameAddress({ ...listing, unit: '2' }, { ...listing, unit: '3' }), false);
});

test('only the exact main entity gallery qualifies, not nearby properties or OG images', () => {
  const result = extract([node()]);
  assert.equal(result.accepted, true);
  assert.deepEqual(result.media.images, [photo]);
  assert.equal(result.media.captureDate, null);
  assert.equal(extract([node({ url: sourceUrl.replace('1LBJN8', 'OTHER') })]).accepted, false);
  assert.equal(extract([node({ address: { ...node().address, postalCode: '19513' } })]).accepted, false);
  assert.equal(extract([node(), node()]).reason, 'ambiguous_property_entities');
  assert.equal(extractSecondaryMedia({ listing, sourceUrl, html: `<meta property="og:image" content="${photo}">` }).accepted, false);
});

test('rejects street view, logos, untrusted galleries and non-property source URLs', () => {
  for (const image of ['https://maps.googleapis.com/maps/api/streetview?size=640x640', 'https://www.compass.com/logo.png', 'https://example.org/house.jpg', 'http://127.0.0.1/house.jpg']) assert.equal(extract([node({ image })]).accepted, false);
  for (const url of ['https://www.compass.com/', 'https://www.compass.com@evil.test/homedetails/a/b/', 'http://www.compass.com/homedetails/a/b/', 'https://www.compass.com:444/homedetails/a/b/']) assert.equal(propertyPage(url), null);
});

test('revalidates saved identity on read and retains independent auction records', () => {
  const media = extract([node()]).media;
  const record = { ...listing, provenance: { origin: 'publisher_record', media: { secondary: media } } };
  assert.equal(inspectSecondaryMedia(record).accepted, true);
  assert.equal(inspectSecondaryMedia({ ...record, zip: '19513' }).accepted, false);
  assert.equal(inspectSecondaryMedia({ ...record, provenance: { media: { secondary: { ...media, observedAt: 'invalid' } } } }).accepted, false);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'property-media-test-'));
  const file = path.join(dir, 'media.json');
  try {
    saveMedia(listing, media, file);
    saveMedia(listing, media, file);
    const entries = readMediaStore(file);
    assert.equal(entries.length, 1);
    assert.equal(attachMedia({ ...listing, id: 'second-auction' }, entries).id, 'second-auction');
    const changed = { ...listing, zip: '19513' };
    assert.equal(attachMedia(changed, entries), changed);
    const before = fs.readFileSync(file, 'utf8');
    assert.throws(() => saveMedia(changed, media, file), /evidence gate/);
    assert.equal(fs.readFileSync(file, 'utf8'), before);
  } finally { fs.rmSync(dir, { recursive: true }); }
});

test('collector follows only one same-property canonical slash redirect', async () => {
  const calls = [];
  const collector = new SecondaryMediaCollector({ sleep: async () => {}, fetchImpl: async url => { calls.push(url); return calls.length === 1 ? new Response(null, { status: 301, headers: { location: sourceUrl } }) : new Response(html([node()])); } });
  assert.equal((await collector.collect(listing, [sourceUrl])).accepted, true);
  assert.equal(calls.length, 2);
  const rejected = new SecondaryMediaCollector({ sleep: async () => {}, fetchImpl: async () => new Response(null, { status: 302, headers: { location: 'https://www.compass.com/homedetails/another/other_pid/' } }) });
  assert.equal((await rejected.collect(listing, [sourceUrl])).accepted, false);
});

test('403 and challenge stop later requests to that provider; no gallery is accepted', async () => {
  for (const response of [() => new Response('Forbidden', { status: 403 }), () => new Response('Please verify you are human')]) {
    let calls = 0;
    const collector = new SecondaryMediaCollector({ sleep: async () => {}, fetchImpl: async () => { calls++; return response(); } });
    const result = await collector.collect(listing, [sourceUrl, sourceUrl.replace('1LBJN8', 'second')]);
    assert.equal(result.accepted, false);
    assert.equal(calls, 1);
    assert.match(result.attempts[1].reason, /circuit open/);
  }
});

test('discovery rejects unsupported search results and never treats RSS images as photos', async () => {
  const collector = new SecondaryMediaCollector({ sleep: async () => {}, fetchImpl: async url => new Response(url.includes('bing.com') ? `<rss><link>https://example.org/house</link><link>${sourceUrl}</link></rss>` : html([node()])) });
  assert.equal((await collector.collect(listing)).accepted, true);
  assert.equal((await collector.collect({ ...listing, zip: '' })).reason, 'incomplete_canonical_address');
});
