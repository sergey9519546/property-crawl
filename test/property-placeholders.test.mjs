import assert from "node:assert/strict";
import test from "node:test";
import { getPropertyPlaceholder } from "../src/lib/property-placeholders.ts";

test("getPropertyPlaceholder divides property types into distinct categories and image assets", () => {
  const samples = [
    ["Single Family", "single-family", "/placeholders/single-family.jpg"],
    ["Single Family Home", "single-family", "/placeholders/single-family.jpg"],
    ["Modular", "single-family", "/placeholders/single-family.jpg"],
    ["Manufactured", "manufactured-home", "/placeholders/manufactured-home.jpg"],
    ["Mobile", "manufactured-home", "/placeholders/manufactured-home.jpg"],
    ["Condo", "condo-townhome", "/placeholders/condo-townhome.jpg"],
    ["Town House", "condo-townhome", "/placeholders/condo-townhome.jpg"],
    ["PUD", "condo-townhome", "/placeholders/condo-townhome.jpg"],
    ["Coop", "condo-townhome", "/placeholders/condo-townhome.jpg"],
    ["Duplex", "multi-family", "/placeholders/multi-family.jpg"],
    ["Triplex", "multi-family", "/placeholders/multi-family.jpg"],
    ["Multi-Family", "multi-family", "/placeholders/multi-family.jpg"],
    ["Land", "vacant-land", "/placeholders/vacant-land.jpg"],
    ["Commercial", "commercial-industrial", "/placeholders/commercial-industrial.jpg"],
    ["Office", "commercial-industrial", "/placeholders/commercial-industrial.jpg"],
    ["Warehouse", "commercial-industrial", "/placeholders/commercial-industrial.jpg"],
    ["Courthouse", "commercial-industrial", "/placeholders/commercial-industrial.jpg"],
    ["Unknown", "unclassified-parcel", "/placeholders/unclassified-parcel.jpg"],
    ["", "unclassified-parcel", "/placeholders/unclassified-parcel.jpg"],
    [null, "unclassified-parcel", "/placeholders/unclassified-parcel.jpg"],
  ];

  const distinctImages = new Set();
  for (const [propType, expectedCategory, expectedSrc] of samples) {
    const info = getPropertyPlaceholder(propType);
    assert.equal(info.category, expectedCategory, `propType ${String(propType)}`);
    assert.equal(info.imageSrc, expectedSrc, `imageSrc for ${String(propType)}`);
    assert.match(info.alt, /placeholder/i);
    distinctImages.add(info.imageSrc);
  }
  assert.equal(distinctImages.size, 7);
});

test("getPropertyPlaceholder uses factual context hints only when propType is unknown", () => {
  assert.equal(
    getPropertyPlaceholder(null, { address: "1401 Pine St Unit 4B, Miami, FL" }).category,
    "condo-townhome",
  );
  assert.equal(
    getPropertyPlaceholder("Unknown", { address: "Lot 12 Oak Ridge Rd", source: "civilview" }).category,
    "vacant-land",
  );
  assert.equal(
    getPropertyPlaceholder("", { address: "210 Main St, Newark, NJ", source: "hud" }).category,
    "single-family",
  );
  assert.equal(
    getPropertyPlaceholder(null, { address: "Louisa Swain Federal Office Building", source: "gsa" }).category,
    "commercial-industrial",
  );
  assert.equal(
    getPropertyPlaceholder(null, { address: "459 SHUNPIKE Road Cape May Court, House, NJ 08210", source: "civilview" }).category,
    "unclassified-parcel",
  );
  // Explicit propType always wins over address hints
  assert.equal(
    getPropertyPlaceholder("Single Family", { address: "100 Main St Unit 2" }).category,
    "single-family",
  );
});
