const test = require('node:test');
const assert = require('node:assert/strict');
const gsa = require('../server/scrapers/gsa');
const usda = require('../server/scrapers/usda');
const { inspectPublisherPhoto } = require('../server/scrapers/media-policy');

test('GSA carries only the exact-detail slide gallery through publisher-media normalization', async () => {
  const originalFetch = gsa.fetchText;
  gsa.fetchText = async () => `
    <input name="tour_property_address" value="2731 Chestnut Street">
    <input name="tour_property_city" value="New Orleans">
    <input name="tour_property_state" value="Louisiana">
    <input name="tour_property_zipcode" value="70130">
    <span>Sale Number: 726LA058501</span>
    <img class="site-logo" src="https://realestatesales.gov/logo.png" width="600">
    <img class="slide-img" src="https://d2m3yrz4x1yefr.cloudfront.net/property_image/front.jpg" width="700" height="460">
    <img class="slide-img" data-src="https://d2m3yrz4x1yefr.cloudfront.net/property_image/back.jpg" width="700" height="460">
    <img class="slide-img" src="https://d2m3yrz4x1yefr.cloudfront.net/property_image/No_Image.jpg" width="700" height="460">`;
  try {
    const listing = gsa.standardizeListing(await gsa.fetchDetail('41', null));
    assert.equal(listing.photo, 'https://d2m3yrz4x1yefr.cloudfront.net/property_image/front.jpg');
    assert.equal(listing.provenance.media.gallery.length, 2);
    assert.equal(listing.provenance.media.gallery[0].sourceRecordUrl, 'https://realestatesales.gov/asset-details/?property_id=41');
    assert.equal(inspectPublisherPhoto(listing).accepted, true);
  } finally {
    gsa.fetchText = originalFetch;
  }
});

test('USDA binds the summary image to its exact detail record and excludes No_Image', () => {
  const cells = [
    '<img src="/SFH_INTRANET/1684875633011-1.jpg"><a href="/resales/public/SFHPropertyDetail?id=6278&amp;listingType=Foreclosure">Details</a>',
    'Foreclosure', '1687 Arnold Drive', 'Starkville,', 'Mississippi', 'Oktibbeha', '39759', '$125,000', '3', '2', '1,200'
  ];
  const listing = usda.standardizeListing(usda.rowToListing(cells));
  assert.equal(listing.photo, 'https://www.resales.usda.gov/SFH_INTRANET/1684875633011-1.jpg');
  assert.equal(listing.provenance.media.gallery.length, 1);
  assert.equal(listing.provenance.media.gallery[0].sourceRecordUrl, listing.sourceUrl);
  assert.equal(listing.provenance.media.photo.origin, 'publisher_record');
  assert.equal(inspectPublisherPhoto(listing).accepted, true);

  const noImageCells = [...cells];
  noImageCells[0] = '<img src="/SFH_INTRANET/No_Image.jpg"><a href="/resales/public/SFHPropertyDetail?id=6278&amp;listingType=Foreclosure">Details</a>';
  const withoutPhoto = usda.standardizeListing(usda.rowToListing(noImageCells));
  assert.equal(withoutPhoto.photo, null);
  assert.equal(withoutPhoto.provenance.media.photo, null);
  assert.equal(withoutPhoto.provenance.media.gallery, undefined);
});
