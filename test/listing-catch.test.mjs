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

test("title warnings lose their shouted label and never repeat redemption", () => {
  const out = listingCatch({ state: "NM", redemptionDays: 270 }, [
    "UNCONFIRMED LIEN PRIORITY: Title search required.",
    "STATUTORY REDEMPTION ACTIVE: 9-Month statutory redemption",
  ]);
  const all = out.flags.join(" ");
  assert.match(all, /up to 270 days/);
  assert.ok(out.flags.includes("Title search required."));
  assert.doesNotMatch(all, /STATUTORY|9-Month/);
  // Without a redemption field, the title engine's redemption line is the only source, so it stays.
  const bare = listingCatch({ state: "NM" }, ["STATUTORY REDEMPTION ACTIVE: 9-Month statutory redemption"]);
  assert.ok(bare.flags.includes("9-Month statutory redemption"));
});

test("clean record yields no flags", () => {
  const out = listingCatch({ openingBid: 1, estLow: 10, estHigh: 20, occupancy: "Vacant", deposit: "$500", saleDate: "2026-11-01", seniorLienRisk: "low" });
  assert.deepEqual(out.flags, []);
});


test("flags nominal <= $500 starting bids when valuation range is absent", () => {
  const out = listingCatch({ openingBid: 100, estLow: null, estHigh: null });
  assert.match(out.flags[0], /nominal \$100 starting bid/i);
  assert.match(out.flags[0], /no value range was published/i);
});

test("uses federal disposition copy and suppresses state redemption on federal REO listings", () => {
  const out = listingCatch({ source: "hud", state: "MI", redemptionDays: 180, openingBid: null });
  const all = out.flags.join(" ");
  assert.match(all, /federal disposition feed/i);
  assert.doesNotMatch(all, /until the sale|redemption rule/i);
});

test("filters informational SENIOR FORECLOSURE / TAX SALE PRIORITY notes from flags into notes", () => {
  const out = listingCatch(
    { openingBid: 100000, estLow: 150000, estHigh: 180000, occupancy: "Vacant", deposit: "$5,000", saleDate: "2027-01-15", seniorLienRisk: "low" },
    [
      "SENIOR FORECLOSURE: 1st mortgage foreclosing wipes out junior deeds.",
      "TAX SALE PRIORITY: Property tax foreclosures generally prime all private mortgages.",
    ],
  );
  assert.deepEqual(out.flags, []);
  assert.ok(out.notes.some((n) => /1st mortgage foreclosing wipes out junior deeds/i.test(n)));
  assert.ok(out.notes.some((n) => /Property tax foreclosures generally prime/i.test(n)));
});

test("retains all critical/high warnings sorted by severity instead of dropping a 3rd critical catch", () => {
  const out = listingCatch(
    { openingBid: 100000, estLow: 150000, estHigh: 180000, occupancy: "Vacant", deposit: "$5,000", saleDate: "2027-01-15", seniorLienRisk: "low" },
    [
      "HOA SUPER-PRIORITY PAYOFF (N.J.S.A. 46:8B-21): Senior mortgage does not extinguish 6 months of dues.",
      "PACE ASSESSMENT SUPER-PRIORITY: Clean energy assessment survives foreclosure.",
      "BANKRUPTCY AUTOMATIC STAY ACTIVE (11 U.S.C. § 362(a)): Sale is stayed by federal bankruptcy court.",
      "CRITICAL TITLE DEFECT: Mechanic's lien foreclosure — senior 1st mortgage survives.",
    ],
  );
  assert.equal(out.flags.length, 4);
  assert.match(out.flags[0], /Sale is stayed|senior 1st mortgage survives/i);
  assert.ok(out.flags.some((f) => /Clean energy assessment survives/i.test(f)));
  assert.ok(out.flags.some((f) => /6 months of dues/i.test(f)));
});
