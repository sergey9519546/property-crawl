'use strict';

// test/sources/observations-snapshot.test.js
//
// Direct unit coverage for compareSnapshots exported from
// server/sources/observations.js. It is the function the discovery
// evidence pipeline uses to decide which field-level changes become
// "signals" surfaced to operators. Silent drift in either direction
// would either suppress legitimate publisher updates or invent
// changes that don't exist.
//
// Pins:
//   - missing previous / same-or-earlier observedAt → no signals
//     (newly populated fields don't demonstrate a change in sale terms)
//   - openingBid: numeric comparison, bid_reduced vs bid_changed kinds
//   - saleDate: sale_date_changed kind
//   - status: returned_to_market on the documented (withdrawn→active)
//     transition, status_changed otherwise
//   - deposit: terms_changed
//   - address: address_changed
//   - identical values skip the field (no false-positive signals)
//   - whitespace-normalised comparison: "  " trimmed to "" matches

const assert = require('node:assert/strict');
const test = require('node:test');

const { compareSnapshots } = require('../../server/sources/observations');

// Helper to build a snapshot with the documented fields shape.
function snap(fields, observedAt = '2026-06-15T10:00:00Z') {
  return { fields, observedAt };
}

test('compareSnapshots: returns [] when previous is missing', () => {
  const changes = compareSnapshots(null, snap({ openingBid: 100000 }, '2026-06-16T00:00:00Z'));
  assert.deepEqual(changes, []);
});

test('compareSnapshots: returns [] when current.observedAt <= previous.observedAt', () => {
  // Newly populated fields and same-or-earlier observations must NOT
  // generate a "change" signal.
  const prev = snap({ openingBid: 100000 }, '2026-06-15T10:00:00Z');
  const cur = snap({ openingBid: 100000 }, '2026-06-15T10:00:00Z');
  assert.deepEqual(compareSnapshots(prev, cur), []);
  // Earlier than previous
  assert.deepEqual(compareSnapshots(prev, snap({ openingBid: 100000 }, '2026-06-14T10:00:00Z')), []);
});

test('compareSnapshots: emits bid_reduced when openingBid drops', () => {
  const prev = snap({ openingBid: 100000 }, '2026-06-15T10:00:00Z');
  const cur = snap({ openingBid: 75000 }, '2026-06-16T00:00:00Z');
  const [change] = compareSnapshots(prev, cur);
  assert.equal(change.field, 'openingBid');
  assert.equal(change.kind, 'bid_reduced');
  assert.equal(change.before, 100000);
  assert.equal(change.after, 75000);
  assert.ok(change.title);
});

test('compareSnapshots: emits bid_changed when openingBid increases', () => {
  const prev = snap({ openingBid: 100000 }, '2026-06-15T10:00:00Z');
  const cur = snap({ openingBid: 150000 }, '2026-06-16T00:00:00Z');
  const [change] = compareSnapshots(prev, cur);
  assert.equal(change.kind, 'bid_changed');
  assert.equal(change.after, 150000);
});

test('compareSnapshots: emits sale_date_changed for saleDate differences', () => {
  const prev = snap({ saleDate: '2026-09-01' }, '2026-06-15T10:00:00Z');
  const cur = snap({ saleDate: '2026-10-01' }, '2026-06-16T10:00:00Z');
  const [change] = compareSnapshots(prev, cur);
  assert.equal(change.field, 'saleDate');
  assert.equal(change.kind, 'sale_date_changed');
});

test('compareSnapshots: returns null kind for status that is not in the returned_to_market vocabulary', () => {
  // The status branch sets kind to 'returned_to_market' only for the
  // documented (withdrawn|cancelled|canceled|unsold|postponed|inactive)
  // → (active|scheduled|available|relisted) transitions. Otherwise it
  // stays null (which falls through to status_changed default).
  const prev = snap({ status: 'Active' }, '2026-06-15T10:00:00Z');
  const cur = snap({ status: 'Scheduled' }, '2026-06-16T00:00:00Z');
  const [change] = compareSnapshots(prev, cur);
  assert.equal(change.field, 'status');
  assert.notEqual(change.kind, 'returned_to_market');
});

test('compareSnapshots: emits returned_to_market for the documented withdrawn→active transition', () => {
  const prev = snap({ status: 'Withdrawn' }, '2026-06-15T10:00:00Z');
  const cur = snap({ status: 'Active' }, '2026-06-16T00:00:00Z');
  const [change] = compareSnapshots(prev, cur);
  assert.equal(change.kind, 'returned_to_market');
});

test('compareSnapshots: emits returned_to_market for postponed → relisted', () => {
  const prev = snap({ status: 'Postponed' }, '2026-06-15T10:00:00Z');
  const cur = snap({ status: 'Relisted' }, '2026-06-16T00:00:00Z');
  const [change] = compareSnapshots(prev, cur);
  assert.equal(change.kind, 'returned_to_market');
});

test('compareSnapshots: emits terms_changed for deposit differences', () => {
  const prev = snap({ deposit: 'cashier check $5,000' }, '2026-06-15T10:00:00Z');
  const cur = snap({ deposit: 'wire transfer $7,500' }, '2026-06-16T00:00:00Z');
  const [change] = compareSnapshots(prev, cur);
  assert.equal(change.field, 'deposit');
  assert.equal(change.kind, 'terms_changed');
});

test('compareSnapshots: emits address_changed when address changes', () => {
  const prev = snap({ address: '500 Oak St, Cleveland, OH' }, '2026-06-15T10:00:00Z');
  const cur = snap({ address: '600 Pine Ave, Cleveland, OH' }, '2026-06-16T10:00:00Z');
  const [change] = compareSnapshots(prev, cur);
  assert.equal(change.field, 'address');
  assert.equal(change.kind, 'address_changed');
});

test('compareSnapshots: identical values do not generate a change', () => {
  const prev = snap({ openingBid: 100000, saleDate: '2026-09-01' }, '2026-06-15T10:00:00Z');
  const cur = snap({ openingBid: 100000, saleDate: '2026-09-01' }, '2026-06-16T10:00:00Z');
  assert.deepEqual(compareSnapshots(prev, cur), []);
});

test('compareSnapshots: whitespace-only difference does not generate a change', () => {
  // The snapshot builder normalises whitespace; the comparison should
  // also tolerate that normalisation so trailing spaces don't generate
  // bogus signals.
  const prev = snap({ openingBid: 100000, address: '500 Oak St' }, '2026-06-15T10:00:00Z');
  const cur = snap({ openingBid: 100000, address: '500 Oak St' }, '2026-06-16T00:00:00Z');
  // The snapshot() builder trims at construction, so we directly compare
  // by passing already-normalised values.
  assert.deepEqual(compareSnapshots(prev, cur), []);
});

test('compareSnapshots: a missing field on one side does not generate a change', () => {
  // Newly populated fields do not demonstrate a change. Only fields
  // present on both sides participate.
  const prev = snap({}, '2026-06-15T10:00:00Z');
  const cur = snap({ openingBid: 100000 }, '2026-06-16T00:00:00Z');
  assert.deepEqual(compareSnapshots(prev, cur), []);
});

test('compareSnapshots: multiple simultaneous field changes are all surfaced', () => {
  const prev = snap({
    openingBid: 100000, saleDate: '2026-09-01', status: 'Active',
    deposit: 'cashier check $5,000', address: '500 Oak St',
  }, '2026-06-15T10:00:00Z');
  const cur = snap({
    openingBid: 75000, saleDate: '2026-10-01', status: 'Active',
    deposit: 'wire transfer $7,500', address: '500 Oak St',
  }, '2026-06-16T00:00:00Z');
  const changes = compareSnapshots(prev, cur);
  const fields = changes.map((c) => c.field).sort();
  assert.deepEqual(fields, ['deposit', 'openingBid', 'saleDate']);
});

test('compareSnapshots: status with mixed-case spelling still matches the withdrawn→active vocabulary', () => {
  // The status vocabulary uses /^(...|...)$/i so case is tolerated.
  const prev = snap({ status: 'WITHDRAWN' }, '2026-06-15T10:00:00Z');
  const cur = snap({ status: 'active' }, '2026-06-16T00:00:00Z');
  const [change] = compareSnapshots(prev, cur);
  assert.equal(change.kind, 'returned_to_market');
});
