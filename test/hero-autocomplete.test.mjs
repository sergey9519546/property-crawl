import test from "node:test";
import assert from "node:assert/strict";
import {
  buildMarketSuggestions,
  mergeMarketListings,
} from "../src/lib/hero-market-suggestions.ts";

test("buildMarketSuggestions matches US states immediately even before listings load", () => {
  const nj = buildMarketSuggestions("New Jer", []);
  assert.ok(nj.length > 0, "typing 'New Jer' must match New Jersey");
  assert.deepEqual(nj[0], {
    id: "state:NJ",
    label: "New Jersey",
    query: "NJ",
    kind: "state",
    description: "State",
  });

  const byCode = buildMarketSuggestions("NJ", []);
  assert.ok(
    byCode.some((item) => item.id === "state:NJ" && item.label === "New Jersey"),
    "typing 2-letter state code 'NJ' must suggest New Jersey",
  );

  const us = buildMarketSuggestions("United St", []);
  assert.equal(us[0]?.id, "country:US");
});

test("buildMarketSuggestions handles sparse or null listing fields safely and surfaces exact address matches", () => {
  const suggestions = buildMarketSuggestions("Christopher Street", [
    { id: "bad-1", address: null, city: null, county: null, state: "NJ", zip: null },
    {
      id: "CIV-NJ-9-2242143630",
      address: "11 Christopher Street, Dover, NJ 07801",
      city: "Dover",
      county: "Morris County",
      state: "NJ",
      zip: "07801",
    },
  ]);

  assert.equal(suggestions.length, 1);
  assert.deepEqual(suggestions[0], {
    id: "address:CIV-NJ-9-2242143630",
    label: "11 Christopher Street, Dover, NJ 07801",
    query: "Dover",
    kind: "address",
    description: "Address nearby Dover",
  });
});

test("buildMarketSuggestions deduplicates mixed-case cities, normalizes County suffixes, and ranks prefix matches first", () => {
  const listings = [
    {
      id: "1",
      address: "100 Main St, Andover, MN 55304",
      city: "Andover",
      county: "Anoka",
      state: "MN",
      zip: "55304",
    },
    {
      id: "2",
      address: "11 Christopher Street, Dover, NJ 07801",
      city: "Dover",
      county: "Morris County",
      state: "NJ",
      zip: "07801",
    },
    {
      id: "3",
      address: "10 Oak Ave, HADDON TOWNSHIP, NJ 08108",
      city: "HADDON TOWNSHIP",
      county: "Camden County",
      state: "NJ",
      zip: "08108",
    },
    {
      id: "4",
      address: "12 Oak Ave, Haddon Township, NJ 08108",
      city: "Haddon Township",
      county: "Camden",
      state: "NJ",
      zip: "08108",
    },
  ];

  const doverMatches = buildMarketSuggestions("Dover", listings);
  assert.equal(doverMatches[0]?.label, "Dover, NJ");
  assert.ok(doverMatches.some((item) => item.label === "Andover, MN"));

  const morrisMatches = buildMarketSuggestions("Morris", listings);
  assert.ok(morrisMatches.some((item) => item.label === "Morris County, NJ"));
  assert.ok(!morrisMatches.some((item) => /County County/i.test(item.label)));

  const haddonMatches = buildMarketSuggestions("Haddon", listings);
  assert.equal(
    haddonMatches.filter((item) => item.kind === "city").length,
    1,
    "mixed-case duplicate cities must collapse cleanly",
  );
});

test("mergeMarketListings appends only unseen valid ids", () => {
  const merged = mergeMarketListings(
    [{ id: "a", address: "1 A", city: "X", county: "Y", state: "NJ", zip: "07001" }],
    [
      { id: "a", address: "1 A dup", city: "X", county: "Y", state: "NJ", zip: "07001" },
      { id: "b", address: "2 B", city: "Z", county: "W", state: "NJ", zip: "07002" },
    ],
  );
  assert.equal(merged.length, 2);
  assert.equal(merged[0].address, "1 A");
  assert.equal(merged[1].id, "b");
});
