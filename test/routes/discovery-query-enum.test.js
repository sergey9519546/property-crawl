"use strict";
// Client-side mirror of the enum vocabulary accepted by the server.
//
// The server is the authority: server/discovery/query.js throws a 400 for an
// unrecognised freshness / hasDocuments / sort value, and both the in-memory
// matcher and the SQL builder only branch on a fixed set of seniorLien and
// redemption values. discovery-query.ts must therefore re-emit only values the
// server will accept, so a bookmarked or hand-edited URL degrades to "no
// filter" instead of becoming an error.
const test = require("node:test");
const assert = require("node:assert/strict");

// src/lib/discovery-query.ts is TypeScript; Node strips the types on import.
const load = () => import("../../src/lib/discovery-query.ts");

test("a valid freshness value round-trips through read and write", async () => {
  const { readDiscoveryFilters, discoverySearchParams } = await load();
  const filters = readDiscoveryFilters(new URLSearchParams("freshness=observed&state=FL"));
  assert.equal(filters.freshness, "observed");
  assert.equal(discoverySearchParams(filters).get("freshness"), "observed");
  assert.equal(discoverySearchParams(filters).get("state"), "FL");
});

test("freshness=fresh is dropped on the read path so a stale bookmark degrades", async () => {
  const { readDiscoveryFilters } = await load();
  const filters = readDiscoveryFilters(new URLSearchParams("freshness=fresh&state=FL"));
  assert.equal("freshness" in filters, false, "stale bucket must not reach the caller");
  assert.equal(filters.state, "FL", "unrelated filters survive the drop");
});

test("freshness=fresh is dropped on the write path", async () => {
  const { discoverySearchParams } = await load();
  const params = discoverySearchParams({ freshness: "fresh", county: "Orange" });
  assert.equal(params.has("freshness"), false);
  assert.equal(params.get("county"), "Orange");
});

test("an invalid hasDocuments value is dropped on both paths", async () => {
  const { readDiscoveryFilters, discoverySearchParams } = await load();
  const filters = readDiscoveryFilters(new URLSearchParams("hasDocuments=maybe"));
  assert.equal("hasDocuments" in filters, false);
  assert.equal(discoverySearchParams({ hasDocuments: "maybe" }).has("hasDocuments"), false);
});

test("valid values are not dropped", async () => {
  const { readDiscoveryFilters, discoverySearchParams } = await load();
  const filters = readDiscoveryFilters(
    new URLSearchParams(
      "freshness=unverified&hasDocuments=unknown&sort=bid-asc&seniorLien=risk&redemption=immediate",
    ),
  );
  assert.equal(filters.freshness, "unverified");
  assert.equal(filters.hasDocuments, "unknown");
  assert.equal(filters.sort, "bid-asc");
  assert.equal(filters.seniorLien, "risk");
  assert.equal(filters.redemption, "immediate");
  const params = discoverySearchParams(filters);
  for (const [key, value] of Object.entries(filters)) {
    assert.equal(params.get(key), value, `${key} must survive the round-trip`);
  }
});

test("an invalid sort is dropped rather than sent to a 400", async () => {
  const { discoverySearchParams } = await load();
  assert.equal(discoverySearchParams({ sort: "relevance" }).has("sort"), false);
});

test("facet-valued and numeric filters keep arbitrary values", async () => {
  const { readDiscoveryFilters, discoverySearchParams } = await load();
  const filters = readDiscoveryFilters(
    new URLSearchParams("lifecycle=scheduled&occupancy=tenant_occupied&minQuality=75"),
  );
  assert.equal(filters.lifecycle, "scheduled");
  assert.equal(filters.occupancy, "tenant_occupied");
  assert.equal(filters.minQuality, "75");
  const params = discoverySearchParams(filters);
  assert.equal(params.get("lifecycle"), "scheduled");
  assert.equal(params.get("occupancy"), "tenant_occupied");
  assert.equal(params.get("minQuality"), "75");
});

test("view is client-only UI state and is not filtered as an enum", async () => {
  const { readDiscoveryFilters, discoverySearchParams } = await load();
  assert.equal(readDiscoveryFilters(new URLSearchParams("view=map")).view, "map");
  assert.equal(discoverySearchParams({ view: "map" }).get("view"), "map");
  assert.equal(discoverySearchParams({ view: "grid" }).has("view"), false, "grid stays implicit");
});

test("the exported vocabulary mirrors the server's accepted values", async () => {
  const { DISCOVERY_FILTER_VALUES } = await load();
  assert.deepEqual([...DISCOVERY_FILTER_VALUES.freshness], ["all", "observed", "unverified"]);
  assert.deepEqual([...DISCOVERY_FILTER_VALUES.hasDocuments], ["true", "false", "unknown"]);
  assert.ok(DISCOVERY_FILTER_VALUES.sort.includes("quality"), "route-layer intelligence sort");
  assert.ok(DISCOVERY_FILTER_VALUES.sort.includes("opportunity"), "route-layer intelligence sort");
  assert.ok(DISCOVERY_FILTER_VALUES.sort.includes("equity"), "discovery sort allowlist");
  assert.ok(!DISCOVERY_FILTER_VALUES.sort.includes("relevance"));
});
