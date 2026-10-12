import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  combineStatusTones,
  listingOfferAvailability,
  listingStatusClass,
  listingStatusTone,
} from "../src/lib/listing-status.ts";

test("recorded sales are sold, not open inventory", () => {
  for (const label of ["sold", "Sold to 3rd Party", "Auctioned - Sold to 3rd Party"]) {
    assert.equal(listingStatusTone(label), "sold");
    assert.equal(listingOfferAvailability("sold"), "https://schema.org/SoldOut");
    assert.match(listingStatusClass("sold"), /rose/);
    assert.doesNotMatch(listingStatusClass("sold"), /emerald/);
  }
});

test("a finished auction is not a sale and is not in stock", () => {
  for (const label of [
    "closed",
    "Auction is closed",
    "Auctioned - Pending Results",
    "Auctioned - Reverted to Beneficiary",
    "post-auction",
    "post auction",
    "postauction",
    "cancelled",
    "canceled",
    "withdrawn",
  ]) {
    const tone = listingStatusTone(label);
    assert.equal(tone, "finished", label);
    assert.equal(listingOfferAvailability(tone), undefined);
    assert.doesNotMatch(listingStatusClass(tone), /emerald|rose/);
  }
});

test("held auctions stay amber and unrecognized words stay neutral", () => {
  for (const label of ["postponed", "Active - Postponed", "adjourned", "stayed"]) {
    assert.equal(listingStatusTone(label), "held", label);
    assert.match(listingStatusClass("held"), /amber/);
    assert.equal(listingOfferAvailability("held"), undefined);
  }
  for (const label of ["foreclosed", "unsold", "Verify at source", ""]) {
    assert.equal(listingStatusTone(label), "neutral", label);
    assert.equal(listingOfferAvailability("neutral"), undefined);
    assert.doesNotMatch(listingStatusClass("neutral"), /emerald/);
  }
});

test("only an open auction phrase is in stock", () => {
  for (const label of ["active", "scheduled", "pending", "coming soon", "pre-auction", "preauction", "publicly listed"]) {
    assert.equal(listingStatusTone(label), "open", label);
  }
  assert.equal(listingOfferAvailability("open"), "https://schema.org/InStock");
  assert.match(listingStatusClass("open"), /emerald/);
});

test("a stored sale wins over a lifecycle phrase that still says active", () => {
  assert.equal(combineStatusTones(["open", "sold"]), "sold");
  assert.equal(combineStatusTones(["open", "finished"]), "finished");
  assert.equal(combineStatusTones(["open", "held"]), "held");
  assert.equal(combineStatusTones(["neutral"]), "neutral");
  assert.equal(combineStatusTones(["open"]), "open");
});

test("the listing page does not paint every status as in stock", () => {
  const page = fs.readFileSync(new URL("../src/app/listings/[id]/page.tsx", import.meta.url), "utf8");
  assert.match(page, /listingOfferAvailability\(statusTone\)/);
  assert.match(page, /data-status-tone=\{statusTone\}/);
  assert.doesNotMatch(page, /schema\.org\/InStock/);
  assert.doesNotMatch(page, /postponed\/i\.test\(statusLabel\)/);
  assert.doesNotMatch(page, /titleActionAdvice/);
});
