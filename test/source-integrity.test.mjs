import assert from "node:assert/strict";
import test from "node:test";

import { serializeJsonLd } from "../src/lib/json-ld.ts";
import { getExactSourceListingUrl } from "../src/lib/listing-links.ts";

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
});

test("source CTAs preserve stable exact property identities", () => {
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
});

test("source CTAs reject record-shaped URLs on an unrelated host", () => {
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
