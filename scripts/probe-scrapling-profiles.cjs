'use strict';
// Probe: call real Scrapling for hud-cards / treasury-detail / irs-detail
// and report whether the JS bridge accepts the protocol response.
const path = require('node:path');
const { extractWithScrapling } = require('../server/scrapers/scrapling-bridge');

const python = process.env.SCRAPLING_PYTHON
  || path.resolve(__dirname, '..', '.cache', 'crawler-tools', 'venv', 'Scripts', 'python.exe');

const cases = [
  {
    profile: 'hud-cards',
    url: 'https://www.hudhomestore.gov/Home/Index?state=CA',
    html: `<table>
      <tr class="property-row">
        <td>Case# 123-456789</td>
        <td class="prop-address">100 Main Street</td>
        <td>$250,000</td>
      </tr>
      <tr class="property-row">
        <td>Case# 222-333444</td>
        <td class="prop-address">200 Oak Ave</td>
        <td>$180,000</td>
      </tr>
    </table>`,
  },
  {
    profile: 'treasury-detail',
    url: 'https://www.treasury.gov/auctions/treasury/rp/1234.shtml',
    html: `<html><body>
      Starting Bid: $175,000 Living Area: 2,200 sq ft Year Built: 1985
      Site Area: 0.6 acres Deposit: $17,500
      Auction Date and Time: 2026-12-01 10:00 AM Inspection
      Parcel No: 555-PQR Sale Number: TRSY-DELTA
      4 bedrooms 3 baths
    </body></html>`,
  },
  {
    profile: 'irs-detail',
    url: 'https://www.irsauctions.gov/auction/item/99',
    html: `<html><body>
      <address>424 Override Avenue<br>Overrideville, 19111 PA</address>
      <div content="222000.00" class="field__item">222,000.00</div>
      <time datetime="2027-03-01T10:00:00Z">Mar 1</time>
      <div class="field--name-field-asset-description">3 bedrooms 2 bathrooms 2500 sq ft built in 1990</div>
    </body></html>`,
  },
  {
    profile: 'page-links',
    url: 'https://example.test/list',
    html: `<a href="https://example.test/a">A</a>
           <a href="http://example.test/insecure">HTTP</a>
           <a href="mailto:x@y.test">Mail</a>`,
  },
];

(async () => {
  for (const c of cases) {
    try {
      const result = await extractWithScrapling(c.profile, {
        html: c.html,
        url: c.url,
        python,
      });
      console.log(`OK   ${c.profile}:`, JSON.stringify(result).slice(0, 220));
    } catch (error) {
      console.log(`FAIL ${c.profile}: code=${error.code} message=${error.message}`);
    }
  }
})();
