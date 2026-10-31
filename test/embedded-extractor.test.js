'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  extractJsonLd,
  extractNextData,
  extractInlineScriptData,
  extractEmbeddedState,
  normalizePostalAddress,
} = require('../server/scrapers/embedded-extractor');
const fannie = require('../server/scrapers/fannie');
const freddie = require('../server/scrapers/freddie');
const va = require('../server/scrapers/va');

test('normalizePostalAddress handles strings and structured PostalAddress objects', () => {
  assert.equal(normalizePostalAddress('123 Main St, Austin, TX 78701'), '123 Main St, Austin, TX 78701');
  assert.equal(
    normalizePostalAddress({
      streetAddress: '456 Oak Ave',
      addressLocality: 'Columbus',
      addressRegion: 'OH',
      postalCode: '43215',
    }),
    '456 Oak Ave, Columbus, OH 43215'
  );
  assert.equal(normalizePostalAddress(null), null);
});

test('extractJsonLd extracts Schema.org RealEstateListing and SingleFamilyResidence items', () => {
  const html = `<!DOCTYPE html>
<html>
<head>
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "SingleFamilyResidence",
    "name": "Charming 3BR Foreclosure",
    "address": {
      "@type": "PostalAddress",
      "streetAddress": "789 Elm Street",
      "addressLocality": "Tampa",
      "addressRegion": "FL",
      "postalCode": "33602"
    },
    "geo": {
      "@type": "GeoCoordinates",
      "latitude": 27.9506,
      "longitude": -82.4572
    },
    "numberOfBedrooms": 3,
    "numberOfBathroomsTotal": 2,
    "floorSize": {
      "@type": "QuantitativeValue",
      "value": 1650
    },
    "offers": {
      "@type": "Offer",
      "price": 185000,
      "priceCurrency": "USD",
      "url": "https://www.homepath.fanniemae.com/property/123456"
    }
  }
  </script>
</head>
<body>
  <div id="root">Client app</div>
</body>
</html>`;

  const items = extractJsonLd(html);
  assert.equal(items.length, 1);
  assert.equal(items[0].address, '789 Elm Street, Tampa, FL 33602');
  assert.equal(items[0].price, 185000);
  assert.equal(items[0].beds, 3);
  assert.equal(items[0].baths, 2);
  assert.equal(items[0].sqft, 1650);
  assert.equal(items[0].lat, 27.9506);
  assert.equal(items[0].lng, -82.4572);
  assert.equal(items[0].url, 'https://www.homepath.fanniemae.com/property/123456');

  // Verify Fannie Mae mapper parses this seamlessly
  const parsed = fannie.parseJsonLdProperties(items, 'FL');
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].id, 'FNMA-123456');
  assert.equal(parsed[0].openingBid, 185000);
  assert.equal(parsed[0].state, 'FL');
  assert.equal(parsed[0].zip, '33602');
});

test('extractNextData and extractInlineScriptData parse embedded property arrays', () => {
  const nextHtml = `<html>
<body>
  <div id="__next"></div>
  <script id="__NEXT_DATA__" type="application/json">
  {
    "props": {
      "pageProps": {
        "results": [
          {
            "propertyId": "FRE-998877",
            "address": "100 Innovation Way, Cleveland, OH 44115",
            "price": 140000,
            "bedrooms": 4,
            "bathrooms": 2.5
          }
        ]
      }
    }
  }
  </script>
</body>
</html>`;

  const state = extractEmbeddedState(nextHtml);
  assert.equal(state.hasEmbeddedData, true);
  assert.equal(state.inlineProperties.length, 1);
  assert.equal(state.inlineProperties[0].propertyId, 'FRE-998877');

  const freddieListings = state.inlineProperties.map((p) => freddie.mapJsonItem(p, 'OH')).filter(Boolean);
  assert.equal(freddieListings.length, 1);
  assert.equal(freddieListings[0].id, 'FRE-FRE-998877');
  assert.equal(freddieListings[0].openingBid, 140000);
});
