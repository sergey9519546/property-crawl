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
  });
});

test("empty page does not invent a volume", () => {
  assert.deepEqual(summarizeInventoryHonesty([]), {
    shown: 0,
    openingBidPublished: 0,
    saleDateMissing: 0,
  });
});
