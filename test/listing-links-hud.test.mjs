import assert from "node:assert/strict";
import test from "node:test";
import { getExactSourceListingUrl } from "../src/lib/listing-links.ts";

const base = "https://egis.hud.gov/arcgis/rest/services/cpdmaps/HudSfReo/MapServer/1/query";
const listing = {
  id: "HUD-011-516864",
  source: "hud",
  provenance: { recordId: "011-516864" },
};

test("HUD eGIS exact case query is accepted for the same listing identity", () => {
  const sourceUrl = base + "?where=CASE_NUM+%3D+%27011-516864%27&outFields=*&f=pjson";
  assert.equal(getExactSourceListingUrl({ ...listing, sourceUrl }), sourceUrl);
});

test("HUD eGIS queries reject another case, a general filter, and an untrusted host", () => {
  const candidates = [
    base + "?where=CASE_NUM+%3D+%27012-000001%27&outFields=*&f=pjson",
    base + "?where=STATE_CODE+%3D+%27AL%27&outFields=*&f=pjson",
    base.replace("egis.hud.gov", "egis.hud.gov.attacker.example") + "?where=CASE_NUM+%3D+%27011-516864%27&outFields=*&f=pjson",
  ];
  for (const sourceUrl of candidates) assert.equal(getExactSourceListingUrl({ ...listing, sourceUrl }), null, sourceUrl);
});
