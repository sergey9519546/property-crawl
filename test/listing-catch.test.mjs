import assert from "node:assert/strict";
import test from "node:test";
import { listingCatch } from "../src/lib/listing-catch.ts";

test("catch never invents a discount without a published value range", () => {
  const out = listingCatch({ openingBid: 54352, estLow: null, estHigh: null, occupancy: null, deposit: null, saleDate: null });
  const all = out.flags.join(" ");
  assert.match(all, /no value range was published/);
  assert.match(all, /Occupancy is not published/);
  assert.match(all, /Deposit terms are not published/);
  assert.match(all, /No sale date/);
  assert.doesNotMatch(all, /%/);
});

test("catch reports bid-to-range, redemption, occupied and stale source from fields", () => {
  const out = listingCatch({
    state: "TN", openingBid: 50000, estLow: 90000, estHigh: 110000, occupancy: "Occupied",
    deposit: "10% certified funds", saleDate: "2026-11-01", redemptionDays: 730, seniorLienRisk: "high",
    sourceFreshness: { ageHours: 96, status: "stale" },
  }, ["IRS lien may survive"]);
  assert.match(out.notes[0], /50% of the stored \$90,000–\$110,000/);
  assert.ok(out.notes.some((n) => /Deposit: 10% certified funds/.test(n)));
  const all = out.flags.join(" ");
  assert.match(all, /up to 730 days/);
  assert.match(all, /occupied/);
  assert.match(all, /Senior-lien signal is high/);
  assert.match(all, /IRS lien may survive/);
  assert.match(all, /4 days ago/);
});

test("clean record yields no flags", () => {
  const out = listingCatch({ openingBid: 1, estLow: 10, estHigh: 20, occupancy: "Vacant", deposit: "$500", saleDate: "2026-11-01", seniorLienRisk: "low" });
  assert.deepEqual(out.flags, []);
});
