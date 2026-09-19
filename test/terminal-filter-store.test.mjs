import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_TERMINAL_FILTERS,
  countActiveFilters,
  parseTerminalQuery,
  selectFilteredListings,
  terminalFilterReducer,
  terminalQuery,
} from "../src/lib/terminal-filter-store.ts";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

test("terminal filter store: pure reducer, query round-trip, and shared selectors", () => {
  let state = DEFAULT_TERMINAL_FILTERS;
  state = terminalFilterReducer(state, { type: "set", key: "selectedState", value: "TX" });
  state = terminalFilterReducer(state, { type: "set", key: "minDealScore", value: 55 });
  state = terminalFilterReducer(state, { type: "toggleObservedOnly" });
  state = terminalFilterReducer(state, { type: "setView", view: "map" });
  assert.equal(state.selectedState, "TX");
  assert.equal(state.minDealScore, 55);
  assert.equal(state.observedOnly, true);
  assert.equal(state.activeView, "map");
  assert.equal(countActiveFilters(state), 3);

  const query = terminalQuery(state);
  assert.match(query, /state=TX/);
  assert.match(query, /minScore=55/);
  assert.match(query, /observed=1/);
  assert.match(query, /view=map/);

  const hydrated = parseTerminalQuery(`?${query}`);
  assert.deepEqual(hydrated, state);

  state = terminalFilterReducer(state, { type: "resetFilters" });
  assert.equal(state.selectedState, "all");
  assert.equal(state.minDealScore, 0);
  assert.equal(state.observedOnly, false);
  assert.equal(state.activeView, "map", "reset preserves the active view");
  assert.equal(countActiveFilters(state), 0);

  const inventory = [
    {
      id: "a",
      source: "hud",
      state: "TX",
      address: "1 Main St",
      city: "Austin",
      county: "Travis",
      zip: "78701",
      dealScore: 80,
      equity: 120000,
      openingBid: 40000,
      saleDate: "2099-01-01",
      propType: "Single Family",
      occupancy: null,
      images: ["1", "2"],
    },
    {
      id: "b",
      source: "irs",
      state: "TX",
      address: "2 Oak Ave",
      city: "Dallas",
      county: "Dallas",
      zip: "75201",
      dealScore: 40,
      equity: 10000,
      openingBid: 90000,
      saleDate: "2001-01-01",
      propType: "Condo",
      occupancy: null,
      images: [],
    },
    {
      id: "c",
      source: "hud",
      state: "FL",
      address: "3 Palm Rd",
      city: "Miami",
      county: "Miami-Dade",
      zip: "33101",
      dealScore: 90,
      equity: 200000,
      openingBid: 50000,
      saleDate: "2099-02-01",
      propType: "Single Family",
      occupancy: null,
      images: ["1"],
    },
  ];

  const filtered = selectFilteredListings(inventory, {
    ...DEFAULT_TERMINAL_FILTERS,
    selectedState: "TX",
    minDealScore: 55,
  });
  assert.deepEqual(
    filtered.map((item) => item.id),
    ["a"],
  );

  const byScore = selectFilteredListings(inventory, {
    ...DEFAULT_TERMINAL_FILTERS,
    sortBy: "score",
  });
  assert.deepEqual(
    byScore.map((item) => item.id),
    ["c", "a", "b"],
  );

  const byCityExact = selectFilteredListings(inventory, {
    ...DEFAULT_TERMINAL_FILTERS,
    searchQuery: "austin",
  });
  assert.deepEqual(
    byCityExact.map((item) => item.id),
    ["a"],
  );

  const observedOnly = selectFilteredListings(
    inventory,
    { ...DEFAULT_TERMINAL_FILTERS, observedOnly: true },
    { isObserved: (listing) => listing.id === "c" },
  );
  assert.deepEqual(
    observedOnly.map((item) => item.id),
    ["c"],
  );

  const toggledOn = terminalFilterReducer(DEFAULT_TERMINAL_FILTERS, {
    type: "toggleMinDealScore",
    score: 70,
  });
  assert.equal(toggledOn.minDealScore, 70);
  const toggledOff = terminalFilterReducer(toggledOn, {
    type: "toggleMinDealScore",
    score: 70,
  });
  assert.equal(toggledOff.minDealScore, 0);
});

test("interactive terminal uses the shared filter store", () => {
  const terminalPath = path.join(root, "src", "components", "terminal", "interactive-terminal.tsx");
  const content = fs.readFileSync(terminalPath, "utf8");
  assert.ok(content.includes("terminalFilterReducer"), "terminal must use the shared reducer");
  assert.ok(content.includes("selectFilteredListings"), "terminal must use shared listing selector");
  assert.ok(content.includes("dispatchFilters"), "terminal must dispatch store actions");
  assert.ok(content.includes("AlertsModal"), "AlertsModal missing from interactive-terminal.tsx");
  assert.ok(content.includes("handleDeepCheckAddress"), "handleDeepCheckAddress missing from interactive-terminal.tsx");
  assert.ok(content.includes("Address research workspace"), "Address research banner missing from interactive-terminal.tsx");
  assert.ok(content.includes("Legal and title status remains unverified"), "Fail-closed legal disclaimer missing from interactive-terminal.tsx");
});
