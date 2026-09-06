import assert from "node:assert/strict";
import test from "node:test";

import { normalizedFullAddressKey, sourceRecordCountsAtAddress } from "../src/lib/listing-record-groups.ts";

const observed = (record) => record.observed === true && typeof record.publisher === "string" && typeof record.recordId === "string";
const westPark = (id, overrides = {}) => ({
  id,
  observed: true,
  publisher: "CivilView Sheriff",
  recordId: id,
  address: "19 WEST PARK AVENUE, PARK RIDGE, NJ 07656",
  city: "Park Ridge",
  state: "NJ",
  zip: "07656",
  ...overrides,
});

test("groups separately published observed records at the same normalized full address without removing either record", () => {
  const first = westPark("civilview-F-24003314");
  const second = westPark("civilview-F-25001111", {
    address: "19 West Park Avenue; Park Ridge, NJ 07656",
    recordId: "F-25001111",
  });
  const records = [first, second];

  const counts = sourceRecordCountsAtAddress(records, observed);

  assert.equal(records.length, 2);
  assert.equal(counts.get(first.id), 2);
  assert.equal(counts.get(second.id), 2);
});

test("does not group different state, ZIP, unit, missing, or non-observed records", () => {
  const base = westPark("base");
  const records = [
    base,
    westPark("other-state", { state: "NY" }),
    westPark("other-zip", { zip: "07657" }),
    westPark("other-unit", { address: "19 WEST PARK AVENUE APT 2, PARK RIDGE, NJ 07656" }),
    westPark("missing-city", { city: null }),
    westPark("unobserved", { observed: false }),
  ];

  const counts = sourceRecordCountsAtAddress(records, observed);

  assert.equal(counts.size, 0);
  assert.equal(normalizedFullAddressKey(records[4]), null);
});
