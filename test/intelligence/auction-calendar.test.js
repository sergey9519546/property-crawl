'use strict';

// test/intelligence/auction-calendar.test.js
//
// Tests for server/intelligence/auction-calendar.js — the analytics
// layer that buckets listings by ISO-week of sale_date. Pure-function
// tests; no DB, no Postgres.

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildAuctionCalendar,
  isoWeekStart
} = require('../../server/intelligence/auction-calendar');

const NOW_MS = Date.parse('2026-09-16T12:00:00.000Z');

function listing(overrides = {}) {
  return {
    id: 'L1',
    source: 'treasury',
    state: 'TX',
    city: 'Bruni',
    address: '112 N Ave E',
    saleDate: '2026-09-23T15:00:00.000Z',
    openingBid: 50000,
    mid: 100000,
    dealScore: 70,
    propType: 'Single Family',
    ...overrides
  };
}

// --- isoWeekStart ---------------------------------------------------------

test('isoWeekStart: Wednesday returns the Monday of the same week (UTC)', () => {
  // Wed Sep 16, 2026 → Mon Sep 14, 2026
  const wed = Date.parse('2026-09-16T15:00:00.000Z');
  const monday = Date.parse('2026-09-14T00:00:00.000Z');
  assert.equal(isoWeekStart(wed), monday);
});

test('isoWeekStart: Sunday returns the previous Monday', () => {
  // Sun Sep 20, 2026 → Mon Sep 14, 2026
  const sun = Date.parse('2026-09-20T23:59:59.000Z');
  const monday = Date.parse('2026-09-14T00:00:00.000Z');
  assert.equal(isoWeekStart(sun), monday);
});

test('isoWeekStart: Monday returns itself', () => {
  const mon = Date.parse('2026-09-14T00:00:00.000Z');
  assert.equal(isoWeekStart(mon), mon);
});

// --- buildAuctionCalendar -------------------------------------------------

test('buildAuctionCalendar: groups listings by ISO week', () => {
  const pool = [
    listing({ id: 'A', saleDate: '2026-09-22T10:00:00.000Z' }),  // Tue — week of Sep 14
    listing({ id: 'B', saleDate: '2026-09-23T15:00:00.000Z' }),  // Wed — same week
    listing({ id: 'C', saleDate: '2026-09-30T10:00:00.000Z' })   // Wed — week of Sep 28
  ];
  const { weeks } = buildAuctionCalendar(pool, { nowMs: NOW_MS });
  assert.equal(weeks.length, 2);
  assert.equal(weeks[0].count, 2);
  assert.equal(weeks[1].count, 1);
});

test('buildAuctionCalendar: weeks are sorted ascending by start date', () => {
  const pool = [
    listing({ id: 'A', saleDate: '2026-09-30T10:00:00.000Z' }),
    listing({ id: 'B', saleDate: '2026-09-22T10:00:00.000Z' })
  ];
  const { weeks } = buildAuctionCalendar(pool, { nowMs: NOW_MS });
  assert.ok(Date.parse(weeks[0].weekStart) < Date.parse(weeks[1].weekStart));
});

test('buildAuctionCalendar: listings outside the window are dropped', () => {
  const pool = [
    listing({ id: 'A', saleDate: '2026-09-23T10:00:00.000Z' }),
    listing({ id: 'B', saleDate: '2026-12-25T10:00:00.000Z' }),  // way outside
    listing({ id: 'C', saleDate: '2025-01-01T10:00:00.000Z' })   // in the past
  ];
  const { weeks, droppedOutside, droppedNoDate } = buildAuctionCalendar(pool, {
    nowMs: NOW_MS,
    windowDays: 60
  });
  assert.equal(weeks.length, 1);
  assert.equal(weeks[0].count, 1);
  assert.equal(droppedOutside, 2);
  assert.equal(droppedNoDate, 0);
});

test('buildAuctionCalendar: listings without a saleDate are dropped', () => {
  const pool = [
    listing({ id: 'A', saleDate: null }),
    listing({ id: 'B', saleDate: '' }),
    listing({ id: 'C', saleDate: '2026-09-23T10:00:00.000Z' })
  ];
  const { weeks, droppedNoDate } = buildAuctionCalendar(pool, { nowMs: NOW_MS });
  assert.equal(weeks.length, 1);
  assert.equal(weeks[0].count, 1);
  assert.equal(droppedNoDate, 2);
});

test('buildAuctionCalendar: states filter restricts by listing state', () => {
  const pool = [
    listing({ id: 'A', state: 'TX', saleDate: '2026-09-23T10:00:00.000Z' }),
    listing({ id: 'B', state: 'CA', saleDate: '2026-09-23T10:00:00.000Z' })
  ];
  const { weeks, droppedState } = buildAuctionCalendar(pool, {
    nowMs: NOW_MS,
    states: ['TX']
  });
  assert.equal(weeks.length, 1);
  assert.equal(weeks[0].count, 1);
  assert.equal(droppedState, 1);
});

test('buildAuctionCalendar: per-week source + propType counts', () => {
  const pool = [
    listing({ id: 'A', source: 'hud', propType: 'Single Family', saleDate: '2026-09-23T10:00:00.000Z' }),
    listing({ id: 'B', source: 'hud', propType: 'Single Family', saleDate: '2026-09-23T10:00:00.000Z' }),
    listing({ id: 'C', source: 'irs', propType: 'Land', saleDate: '2026-09-23T10:00:00.000Z' })
  ];
  const { weeks } = buildAuctionCalendar(pool, { nowMs: NOW_MS });
  assert.deepEqual(weeks[0].sources, { hud: 2, irs: 1 });
  assert.deepEqual(weeks[0].propTypes, { 'Single Family': 2, Land: 1 });
});

test('buildAuctionCalendar: medianOpeningBid + medianDealScore computed per bucket', () => {
  const pool = [
    listing({ id: 'A', openingBid: 50000, dealScore: 60, saleDate: '2026-09-23T10:00:00.000Z' }),
    listing({ id: 'B', openingBid: 80000, dealScore: 80, saleDate: '2026-09-23T10:00:00.000Z' }),
    listing({ id: 'C', openingBid: null, dealScore: null, saleDate: '2026-09-23T10:00:00.000Z' })
  ];
  const { weeks } = buildAuctionCalendar(pool, { nowMs: NOW_MS });
  assert.equal(weeks[0].medianOpeningBid, 65000);
  assert.equal(weeks[0].medianDealScore, 70);
});

test('buildAuctionCalendar: sample gives up to N listings per week sorted by saleDate', () => {
  const pool = [
    listing({ id: 'A', saleDate: '2026-09-25T10:00:00.000Z' }),
    listing({ id: 'B', saleDate: '2026-09-23T10:00:00.000Z' }),
    listing({ id: 'C', saleDate: '2026-09-24T10:00:00.000Z' }),
    listing({ id: 'D', saleDate: '2026-09-26T10:00:00.000Z' })
  ];
  const { weeks } = buildAuctionCalendar(pool, { nowMs: NOW_MS, sampleSize: 2 });
  assert.equal(weeks[0].sample.length, 2);
  assert.equal(weeks[0].sample[0].id, 'B'); // earliest sale date first
  assert.equal(weeks[0].sample[1].id, 'C');
});

test('buildAuctionCalendar: empty pool returns empty weeks', () => {
  const result = buildAuctionCalendar([], { nowMs: NOW_MS });
  assert.deepEqual(result.weeks, []);
});

test('buildAuctionCalendar: a non-array pool is treated as empty', () => {
  const result = buildAuctionCalendar(null, { nowMs: NOW_MS });
  assert.deepEqual(result.weeks, []);
});

test('buildAuctionCalendar: weekLabel contains the date range', () => {
  const pool = [listing({ id: 'A', saleDate: '2026-09-23T10:00:00.000Z' })];
  const { weeks } = buildAuctionCalendar(pool, { nowMs: NOW_MS });
  assert.match(weeks[0].weekLabel, /\d+–\d+/);
});