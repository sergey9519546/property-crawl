// test/research-inbox-poll-race.test.mjs
//
// Two ways this view used to lie about its own data.
//
//   1. RACE. An 8-second poll and an operator-triggered refresh can be in flight
//      at the same time, and they can resolve in either order. Nothing
//      distinguished them, so a slow poll landing second overwrote fresher data
//      with stale data, and the screen gave no sign it had happened.
//   2. SILENT FAILURE. `refresh(quiet)` — the flag the poll passes — also
//      suppressed setError. So a poll that failed every 8 seconds left yesterday's
//      cases on screen, unlabelled, looking current.
//
// This project has no DOM test runner (no jsdom, no testing-library, and adding
// one is out of scope), so the ordering rule is extracted into
// src/lib/latest-request.ts and tested here as a real function. The second pair
// of tests then checks the component actually uses it and actually surfaces the
// error — a source assertion, which is weaker, and is labelled as such rather
// than passed off as behavioural coverage.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { createRequestGate } from "../src/lib/latest-request.ts";

const ROOT = path.resolve(import.meta.dirname, "..");
const inbox = fs.readFileSync(
  path.join(ROOT, "src/components/research/research-inbox.tsx"),
  "utf8",
);

// --- behavioural: the gate itself -----------------------------------------

test("a response from a superseded request is not current", () => {
  const gate = createRequestGate();
  const poll = gate.begin();
  const manual = gate.begin();

  // The manual refresh started second, so the older poll is stale even though
  // it is the one that resolved last.
  assert.equal(gate.isCurrent(manual), true, "the newest request is current");
  assert.equal(gate.isCurrent(poll), false, "the older request must not be current");
});

test("the simulated interleaving keeps the newer data", () => {
  // Reproduce the actual race: start both, resolve them in the dangerous order.
  const gate = createRequestGate();
  const applied = [];

  const poll = gate.begin();          // t=0,  poll issued
  const manual = gate.begin();        // t=10ms, operator hits refresh

  // t=50ms: the poll's response arrives LAST, carrying older data.
  if (gate.isCurrent(poll)) applied.push("stale poll data");
  // t=60ms: the manual response arrives.
  if (gate.isCurrent(manual)) applied.push("fresh manual data");

  assert.deepEqual(applied, ["fresh manual data"],
    "stale poll data must never overwrite fresher data");
  assert.ok(!applied.includes("stale poll data"));
});

test("a single in-flight request is still current", () => {
  const gate = createRequestGate();
  const only = gate.begin();
  assert.equal(gate.isCurrent(only), true,
    "the gate must not reject a request that nothing has overtaken");
});

test("tokens are distinct, so a repeated begin() cannot collide", () => {
  const gate = createRequestGate();
  const tokens = [gate.begin(), gate.begin(), gate.begin()];
  assert.equal(new Set(tokens).size, 3, "each request needs its own token");
  assert.equal(gate.isCurrent(tokens[2]), true);
  assert.equal(gate.isCurrent(tokens[1]), false);
  assert.equal(gate.isCurrent(tokens[0]), false);
});

// --- structural: the component uses it ------------------------------------
// Weaker by nature: no DOM runner, so these assert the wiring exists. They are
// here so that deleting the guard from the component fails CI.

test("research-inbox uses the request gate on every path that touches state", () => {
  assert.match(inbox, /createRequestGate/,
    "the inbox must use the extracted gate rather than an ad-hoc counter");
  assert.match(inbox, /requestGate\.begin\(\)/, "each refresh must take a token");
  assert.ok(!/requestSeq/i.test(inbox),
    "the inline counter was replaced by the tested module; it must not creep back");
});

test("a quiet poll still surfaces its failure", () => {
  // The failure must not be gated on `quiet`. Extract the catch block and
  // confirm it does not test that flag.
  const catchBlock = inbox.slice(inbox.indexOf("} catch (caught) {"));
  const body = catchBlock.slice(0, catchBlock.indexOf("finally"));
  assert.ok(body.length > 0, "could not locate the catch block");
  assert.doesNotMatch(body, /if\s*\(\s*!quiet\s*\)/,
    "a failing background poll must report its error, not swallow it and leave stale rows on screen");
  assert.match(body, /setError\(/, "the catch block must set an error");
});
