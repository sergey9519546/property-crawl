import assert from "node:assert/strict";
import test from "node:test";
import { summarizeInventoryHonesty } from "../src/lib/inventory-honesty.ts";

test("opening-bid coverage counts only positive published amounts", () => {
  const summary = summarizeInventoryHonesty([
    { openingBid: 12000, saleDate: "2026-10-01" },
    { openingBid: 0, saleDate: null },
    { openingBid: null, saleDate: "unknown" },
    { saleDate: "" },
  ]);
  assert.deepEqual(summary, {
    shown: 4,
    openingBidPublished: 1,
    saleDateMissing: 3,
    dealScorePresent: 0,
  });
});

test("empty page does not invent a volume", () => {
  assert.deepEqual(summarizeInventoryHonesty([]), {
    shown: 0,
    openingBidPublished: 0,
    saleDateMissing: 0,
    dealScorePresent: 0,
  });
});

// Deal score is derived, not published: the API withholds it unless a record
// has both an opening amount and an estimated range. "Modeled score" is the
// DEFAULT sort on the workbench, and while no record carries one every row
// ties - so the page reads as ranked by deal quality while ranking nothing.
// This count is what lets the page say so instead of implying an order it is
// not applying.
test("deal-score presence counts computable scores and treats absent as not-zero", () => {
  const summary = summarizeInventoryHonesty([
    { dealScore: 91 },
    { dealScore: 0 },
    { dealScore: null },
    { dealScore: undefined },
    { dealScore: "not a number" },
    { openingBid: 50000 },
  ]);
  assert.equal(summary.dealScorePresent, 2,
    "a computed 0 is a score; an absent one is not a zero score");
  assert.equal(summary.shown, 6);
});

test("a page with no scores reports none, without claiming a catalog total", () => {
  const summary = summarizeInventoryHonesty([
    { openingBid: 50000, dealScore: null },
    { openingBid: null, dealScore: null },
  ]);
  assert.equal(summary.dealScorePresent, 0);
  assert.equal(summary.openingBidPublished, 1,
    "the counts stay independent - a record can publish an amount and still have no score");
});