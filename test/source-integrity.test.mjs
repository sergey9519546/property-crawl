import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import test from "node:test";
import { createRequire } from "node:module";

import { serializeJsonLd } from "../src/lib/json-ld.ts";
import { getExactSourceListingUrl } from "../src/lib/listing-links.ts";

const require = createRequire(import.meta.url);
const { inspectSourceRecordUrl } = require("../server/scrapers/source-policy.js");

test("source CTAs reject collection pages that are not listing evidence", () => {
  assert.equal(
    getExactSourceListingUrl(
      {
        source: "civilview",
        sourceUrl: "https://salesweb.civilview.com/Sales/SalesSearch?countyId=7",
      },
      "https://salesweb.civilview.com",
    ),
    null,
  );
  assert.equal(
    getExactSourceListingUrl({
      source: "fdic",
      sourceUrl: "https://www.fdic.gov/asset-sales/real-estate-and-property-sales",
    }),
    null,
  );
  assert.equal(
    getExactSourceListingUrl({
      source: "fdic",
      sourceUrl: "https://sales.fdic.gov/closedrealestate/",
    }),
    null,
  );
  assert.equal(
    getExactSourceListingUrl({
      source: "treasury",
      sourceUrl: "https://www.treasury.gov/auctions/treasury/rp/realprop.shtml",
    }),
    null,
  );
});

test("source CTAs preserve stable exact property identities across all source shapes", () => {
  assert.equal(
    getExactSourceListingUrl({
      source: "civilview",
      sourceUrl: "https://salesweb.civilview.com/Sales/SaleDetails?PropertyId=2128964683",
    }),
    "https://salesweb.civilview.com/Sales/SaleDetails?PropertyId=2128964683",
  );
  assert.equal(
    getExactSourceListingUrl({
      source: "servicelink",
      sourceUrl:
        "https://www.servicelinkauction.com/property-details/19940-honey-hill-dr-hidden-valley-lake-95467-ca-united-states-trd",
    }),
    "https://www.servicelinkauction.com/property-details/19940-honey-hill-dr-hidden-valley-lake-95467-ca-united-states-trd",
  );
  assert.equal(
    getExactSourceListingUrl({
      source: "irs",
      sourceUrl: "https://www.irsauctions.gov/ad/2731-chestnut-street-new-orleans-la",
    }),
    "https://www.irsauctions.gov/ad/2731-chestnut-street-new-orleans-la",
  );
  assert.equal(
    getExactSourceListingUrl(
      {
        source: "gsa",
        sourceUrl:
          "https://www.gsa.gov/real-estate/real-property-disposition/assets-identified-for-accelerated-disposition",
      },
      "https://realestatesales.gov",
    ),
    "https://www.gsa.gov/real-estate/real-property-disposition/assets-identified-for-accelerated-disposition",
  );
  assert.equal(
    getExactSourceListingUrl(
      {
        source: "gsa",
        sourceUrl: "https://realestatesales.gov/asset-details?property_id=27",
      },
      "https://realestatesales.gov",
    ),
    "https://realestatesales.gov/asset-details?property_id=27",
  );
  assert.equal(
    getExactSourceListingUrl(
      {
        source: "treasury",
        sourceUrl: "https://www.treasury.gov/auctions/treasury/rp/69foresthills.shtml",
      },
      "https://www.treasury.gov/auctions/treasury/rp/realprop.shtml",
    ),
    "https://www.treasury.gov/auctions/treasury/rp/69foresthills.shtml",
  );
  assert.equal(
    getExactSourceListingUrl(
      {
        source: "treasury",
        sourceUrl: "https://www.treasury.gov/auctions/treasury/rp/merryhill.shtml",
      },
      "https://www.treasury.gov/auctions/treasury/rp/realprop.shtml",
    ),
    "https://www.treasury.gov/auctions/treasury/rp/merryhill.shtml",
  );
  assert.equal(
    getExactSourceListingUrl(
      {
        source: "landbank",
        sourceUrl: "https://www.landbanksearch.com/p/61da5791-3e3f-4484-aa68-334a0878a53d",
      },
      "https://www.landbanksearch.com",
    ),
    "https://www.landbanksearch.com/p/61da5791-3e3f-4484-aa68-334a0878a53d",
  );
  assert.equal(
    getExactSourceListingUrl(
      {
        source: "marshals",
        sourceUrl: "https://www.usmarshals.gov/usms-inventory/12345",
      },
      "https://www.usmarshals.gov",
    ),
    "https://www.usmarshals.gov/usms-inventory/12345",
  );
  assert.equal(
    getExactSourceListingUrl({
      source: "courtlistener",
      sourceUrl:
        "https://www.courtlistener.com/docket/72531438/united-states-v-real-property-located-at-9061-state-route-83/",
    }),
    "https://www.courtlistener.com/docket/72531438/united-states-v-real-property-located-at-9061-state-route-83",
  );
  assert.equal(
    getExactSourceListingUrl({
      source: "fl-dor-cadastral",
      sourceUrl:
        "https://services9.arcgis.com/Gh9awoU677aKree0/arcgis/rest/services/Florida_Statewide_Cadastral/FeatureServer/0/query?where=OBJECTID%3D1&outFields=*&returnGeometry=true&outSR=4326&f=json",
    }),
    "https://services9.arcgis.com/Gh9awoU677aKree0/arcgis/rest/services/Florida_Statewide_Cadastral/FeatureServer/0/query?where=OBJECTID%3D1&outFields=*&returnGeometry=true&outSR=4326&f=json",
  );
});

test("source CTAs reject record-shaped URLs on an unrelated or disallowed host", () => {
  assert.equal(
    getExactSourceListingUrl(
      {
        source: "civilview",
        sourceUrl: "https://attacker.example/Sales/SaleDetails?PropertyId=2128964683",
      },
      "https://salesweb.civilview.com",
    ),
    null,
  );
  assert.equal(
    getExactSourceListingUrl(
      {
        source: "gsa",
        sourceUrl: "https://disposal.gsa.gov/asset-details?property_id=27",
      },
      "https://realestatesales.gov",
    ),
    null,
  );
  assert.equal(
    getExactSourceListingUrl(
      {
        source: "servicelink",
        sourceUrl:
          "https://api.servicelinkauction.com/property-details/19940-honey-hill-dr-hidden-valley-lake-95467-ca-united-states-trd",
      },
      "https://www.servicelinkauction.com",
    ),
    null,
  );
});

test("getExactSourceListingUrl and inspectSourceRecordUrl agree on all seed listings in data.js", () => {
  const dataPath = path.resolve(import.meta.dirname, "..", "data.js");
  const sandbox = { window: {}, Math };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(dataPath, "utf8"), sandbox);
  const sources = sandbox.window.SOURCES;
  const listings = sandbox.window.LISTINGS;
  assert.ok(Array.isArray(listings) && listings.length >= 2000);
  for (const listing of listings) {
    const policy = inspectSourceRecordUrl(listing.source, listing.sourceUrl);
    const uiUrl = getExactSourceListingUrl(listing, sources[listing.source]?.websiteUrl);
    assert.equal(
      Boolean(uiUrl),
      policy.isValid,
      `Source link validator drift on ${listing.id} (${listing.source}): ${listing.sourceUrl}`,
    );
  }
});

test("JSON-LD serialization cannot terminate its script element", () => {
  const serialized = serializeJsonLd({
    name: "</script><script>globalThis.pwned=true</script>",
    note: "A&B < C > D\u2028next",
  });

  assert.doesNotMatch(serialized, /<\/script/i);
  assert.doesNotMatch(serialized, /<script/i);
  assert.match(serialized, /\\u003c\/script\\u003e/);
  assert.match(serialized, /\\u0026/);
  assert.match(serialized, /\\u2028/);
});
