import assert from "node:assert/strict";
import test from "node:test";

import { computeTriageChips, chipToneClasses } from "../src/lib/triage-chips.ts";

const NOW = Date.UTC(2026, 8, 14, 12, 0, 0); // 2026-09-14T12:00:00Z

const within24h = new Date(NOW - 6 * 60 * 60 * 1000).toISOString();   // 6h ago
const within24hEdge = new Date(NOW - 24 * 60 * 60 * 1000).toISOString(); // exactly 24h ago
const olderThan24h = new Date(NOW - 25 * 60 * 60 * 1000).toISOString(); // 25h ago
const veryOld = new Date(NOW - 7 * 24 * 60 * 60 * 1000).toISOString(); // 7d ago

const allFlags = (overrides = {}) => ({
  triage: {
    isNew: true,
    priceDropped: true,
    staleDays: 0,
    hasDocs: true,
    occupancyKnown: true,
    distressStage: "unknown",
  },
  sourceObservedAt: within24h,
  ...overrides,
});

const noFlags = {
  triage: {
    isNew: false,
    priceDropped: false,
    staleDays: -1,
    hasDocs: false,
    occupancyKnown: false,
    distressStage: "unknown",
  },
  sourceObservedAt: veryOld,
};

test("listing with all four triage flags renders four chips with the expected tones", () => {
  const chips = computeTriageChips(allFlags(), { now: NOW });
  const keys = chips.map((chip) => chip.key);
  assert.deepEqual(keys, ["isNew", "priceDropped", "hasDocs", "occupancyKnown"]);

  const tones = Object.fromEntries(chips.map((chip) => [chip.key, chip.tone]));
  assert.equal(tones.isNew, "green");
  assert.equal(tones.priceDropped, "amber");
  assert.equal(tones.hasDocs, "blue");
  assert.equal(tones.occupancyKnown, "slate");

  // Each tone resolves to a non-empty Tailwind class string.
  for (const chip of chips) {
    assert.ok(chipToneClasses(chip.tone).length > 0, `${chip.key} should have tone classes`);
  }
});

test("listing with no triage flags renders no chips", () => {
  const chips = computeTriageChips(noFlags, { now: NOW });
  assert.deepEqual(chips, []);
});

test("isNew chip is driven by the observed timestamp, not by triage.isNew", () => {
  // triage.isNew is true but the observed timestamp is outside the 24h window
  // → no isNew chip should appear.
  const staleObserved = computeTriageChips(
    allFlags({ sourceObservedAt: olderThan24h }),
    { now: NOW },
  );
  assert.equal(
    staleObserved.find((chip) => chip.key === "isNew"),
    undefined,
    "isNew chip should not appear when observedAt is older than 24h",
  );

  // triage.isNew is false but the observed timestamp is within the 24h window
  // → isNew chip SHOULD appear (chip is timestamp-driven, not flag-driven).
  const freshObserved = computeTriageChips(
    {
      triage: {
        isNew: false,
        priceDropped: false,
        staleDays: -1,
        hasDocs: false,
        occupancyKnown: false,
        distressStage: "unknown",
      },
      sourceObservedAt: within24h,
    },
    { now: NOW },
  );
  const isNewChip = freshObserved.find((chip) => chip.key === "isNew");
  assert.ok(isNewChip, "isNew chip should appear when observedAt is within 24h");
  assert.equal(isNewChip.tone, "green");

  // Boundary: exactly 24h ago should still count as within the window.
  const edge = computeTriageChips(
    { triage: noFlags.triage, sourceObservedAt: within24hEdge },
    { now: NOW },
  );
  assert.ok(edge.find((chip) => chip.key === "isNew"), "isNew chip should appear at the 24h boundary");
});

test("missing or unparseable sourceObservedAt suppresses the isNew chip", () => {
  const noTimestamp = computeTriageChips(
    { triage: noFlags.triage, sourceObservedAt: null },
    { now: NOW },
  );
  assert.equal(noTimestamp.find((chip) => chip.key === "isNew"), undefined);

  const garbage = computeTriageChips(
    { triage: noFlags.triage, sourceObservedAt: "not-a-date" },
    { now: NOW },
  );
  assert.equal(garbage.find((chip) => chip.key === "isNew"), undefined);
});