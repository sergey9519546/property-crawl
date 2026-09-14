import assert from "node:assert/strict";
import test from "node:test";
import {
  formatSourceScope,
  formatSourceScopeSummary,
} from "../src/lib/source-scope-label.ts";

test("formats recorded county scope without broadening CivilView coverage", () => {
  assert.equal(
    formatSourceScope({ endpoint: "/Sales/SalesSearch", filters: { state: "NJ", countyId: "20" } }),
    "NJ · county ID 20",
  );
  assert.equal(
    formatSourceScope({ state: "NJ", countyId: 20, countyName: "Morris" }),
    "NJ · Morris County",
  );
});

test("formats HUD state arrays and never renders unknown scope objects", () => {
  assert.equal(formatSourceScope({ filters: { states: ["OH", "PA"] } }), "States: OH, PA");
  assert.equal(formatSourceScope({ state: "OH" }), "State: OH");
  assert.equal(formatSourceScope({ checkpoint: { page: 2 } }), "Scope details not recorded");
  assert.equal(formatSourceScope(null), "Scope not recorded");
});

test("summarizes large recorded jurisdiction lists without broadening the scope", () => {
  const scope = { filters: { states: ["OH", "PA", "NJ"] } };
  assert.equal(formatSourceScopeSummary(scope), "Scope: 3 recorded jurisdictions");
  assert.equal(formatSourceScope(scope), "States: OH, PA, NJ");
  assert.equal(
    formatSourceScopeSummary({ filters: { state: "NJ", countyId: "20" } }),
    "NJ · county ID 20",
  );
});
