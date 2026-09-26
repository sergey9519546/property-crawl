'use strict';

// test/intelligence/auction-calendar-helpers.test.js
//
// Direct unit coverage for server/intelligence/auction-calendar.js.
// The auction-calendar view groups listings by ISO-week of sale_date
// and reports median opening bid / deal score per week. Silent drift
// in the ISO-week bucketing or the median math would silently regroup
// the calendar without surfacing the change.
//
//   - isoWeekStart: Monday-start bucketing, UTC consistency
//   - isWithinWindow: sale date within [start, end]
//   - buildAuctionCalendar: week buckets sorted ascending
//   - sample: per-week sample cap, lightweight projection
//   - dropped counters: droppedNoDate / droppedOutside / droppedState
//   - states filter: only matching state codes kept

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildAuctionCalendar,
  isoWeekStart,
  _internals: { median, parseDate, formatWeekLabel },
} = require('../../server/intelligence/auction-calendar');

const NOW = Date.UTC(2026, 4, 7, 12, 0, 0);  // Thursday May 7, 2026

// --- isoWeekStart -----------------------------------------------------

test('isoWeekStart: a Monday returns itself at 00:00 UTC', () => {
  // 2026-05-04 is a Monday
  const mon = Date.UTC(2026, 4, 4, 12, 0, 0);
  assert.equal(isoWeekStart(mon), Date.UTC(2026, 4, 4));
});

test('isoWeekStart: a Wednesday returns the previous Monday', () => {
  // 2026-05-06 is a Wednesday
  const wed = Date.UTC(2026, 4, 6, 12, 0, 0);
  assert.equal(isoWeekStart(wed), Date.UTC(2026, 4, 4));
});

test('isoWeekStart: a Sunday returns the previous Monday', () => {
  // 2026-05-03 is a Sunday -> previous Monday is 2026-04-27
  const sun = Date.UTC(2026, 4, 3, 12, 0, 0);
  assert.equal(isoWeekStart(sun), Date.UTC(2026, 3, 27));
});

// --- parseDate / median -----------------------------------------------

test('parseDate: ISO string parses', () => {
  const t = parseDate('2026-05-15T00:00:00Z');
  assert.ok(Number.isFinite(t));
  assert.equal(new Date(t).toISOString(), '2026-05-15T00:00:00.000Z');
});

test('parseDate: null / empty / invalid -> null', () => {
  assert.equal(parseDate(null), null);
  assert.equal(parseDate(''), null);
  assert.equal(parseDate('not a date'), null);
});

test('median: empty -> null; single -> that value', () => {
  assert.equal(median([]), null);
  assert.equal(median([42]), 42);
});

// --- formatWeekLabel --------------------------------------------------

test('formatWeekLabel: same-month range -> single month name', () => {
  // Monday 2026-05-04 -> Sunday 2026-05-10
  const label = formatWeekLabel(Date.UTC(2026, 4, 4));
  assert.match(label, /^May \d+–\d+$/);
});

test('formatWeekLabel: cross-month range -> "Mon start – Mon end"', () => {
  // Monday 2026-04-27 -> Sunday 2026-05-03
  const label = formatWeekLabel(Date.UTC(2026, 3, 27));
  assert.match(label, /^Apr \d+ – May \d+$/);
});

// --- buildAuctionCalendar --------------------------------------------

test('buildAuctionCalendar: empty pool -> empty weeks + zero counters', () => {
  const result = buildAuctionCalendar([], { nowMs: NOW });
  assert.deepEqual(result.weeks, []);
  assert.equal(result.droppedNoDate, 0);
  assert.equal(result.droppedOutside, 0);
  assert.equal(result.droppedState, 0);
});

test('buildAuctionCalendar: non-array pool -> empty result', () => {
  const result = buildAuctionCalendar(null, { nowMs: NOW });
  assert.deepEqual(result.weeks, []);
});

test('buildAuctionCalendar: weeks sorted ascending by date', () => {
  const listings = [
    { id: 'L1', saleDate: '2026-05-25T12:00:00Z' },  // week of May 25 (Mon)
    { id: 'L2', saleDate: '2026-05-12T12:00:00Z' },  // week of May 11 (Mon)
    { id: 'L3', saleDate: '2026-05-14T12:00:00Z' },  // same week as L2 (May 11 week)
  ];
  const result = buildAuctionCalendar(listings, { nowMs: NOW, windowDays: 60 });
  assert.equal(result.weeks.length, 2);
  assert.equal(result.weeks[0].count, 2);  // May 11 week
  assert.equal(result.weeks[1].count, 1);  // May 25 week
  // ISO string of weekStart should be ascending
  assert.ok(Date.parse(result.weeks[0].weekStart) < Date.parse(result.weeks[1].weekStart));
});

test('buildAuctionCalendar: droppedNoDate counts listings without saleDate', () => {
  const listings = [
    { id: 'L1', saleDate: '2026-05-08T12:00:00Z' },
    { id: 'L2' },  // no saleDate
    { id: 'L3', saleDate: 'not a date' },
  ];
  const result = buildAuctionCalendar(listings, { nowMs: NOW, windowDays: 60 });
  assert.equal(result.droppedNoDate, 2);
  assert.equal(result.weeks.length, 1);
});

test('buildAuctionCalendar: droppedOutside counts listings outside window', () => {
  const listings = [
    { id: 'in', saleDate: '2026-05-08T12:00:00Z' },
    { id: 'past', saleDate: '2026-04-01T12:00:00Z' },
    { id: 'future', saleDate: '2027-01-01T12:00:00Z' },
  ];
  const result = buildAuctionCalendar(listings, { nowMs: NOW, windowDays: 60 });
  assert.equal(result.droppedOutside, 2);
  assert.equal(result.weeks.length, 1);
});

test('buildAuctionCalendar: states filter restricts to listed states', () => {
  const listings = [
    { id: 'L1', state: 'OH', saleDate: '2026-05-08T12:00:00Z' },
    { id: 'L2', state: 'FL', saleDate: '2026-05-08T12:00:00Z' },
    { id: 'L3', state: 'TX', saleDate: '2026-05-08T12:00:00Z' },
  ];
  const result = buildAuctionCalendar(listings, { nowMs: NOW, windowDays: 60, states: ['OH', 'FL'] });
  assert.equal(result.droppedState, 1);  // TX dropped
  const bucket = result.weeks[0];
  assert.equal(bucket.count, 2);
});

test('buildAuctionCalendar: per-week sample is capped at sampleSize', () => {
  const listings = Array.from({ length: 10 }, (_, i) => ({
    id: `L${i}`,
    saleDate: '2026-05-08T12:00:00Z',
  }));
  const result = buildAuctionCalendar(listings, { nowMs: NOW, windowDays: 60, sampleSize: 3 });
  assert.equal(result.weeks[0].sample.length, 3);
});

test('buildAuctionCalendar: per-week sources / propTypes tallies', () => {
  const listings = [
    { id: 'L1', state: 'OH', saleDate: '2026-05-08T12:00:00Z', source: 'sheriff', propType: 'single-family' },
    { id: 'L2', state: 'OH', saleDate: '2026-05-08T12:00:00Z', source: 'sheriff', propType: 'condo' },
    { id: 'L3', state: 'OH', saleDate: '2026-05-08T12:00:00Z', source: 'treasury', propType: 'single-family' },
  ];
  const result = buildAuctionCalendar(listings, { nowMs: NOW, windowDays: 60 });
  const bucket = result.weeks[0];
  assert.deepEqual(bucket.sources, { sheriff: 2, treasury: 1 });
  assert.deepEqual(bucket.propTypes, { 'single-family': 2, condo: 1 });
});

test('buildAuctionCalendar: medianOpeningBid and medianDealScore computed per bucket', () => {
  const listings = [
    { id: 'L1', saleDate: '2026-05-08T12:00:00Z', openingBid: 100000, dealScore: 80 },
    { id: 'L2', saleDate: '2026-05-08T12:00:00Z', openingBid: 200000, dealScore: 60 },
    { id: 'L3', saleDate: '2026-05-08T12:00:00Z', openingBid: 150000, dealScore: 70 },
  ];
  const result = buildAuctionCalendar(listings, { nowMs: NOW, windowDays: 60 });
  assert.equal(result.weeks[0].medianOpeningBid, 150000);
  assert.equal(result.weeks[0].medianDealScore, 70);
});

test('buildAuctionCalendar: windowDays=1 with explicit startMs / endMs', () => {
  const startMs = Date.UTC(2026, 4, 8);
  const endMs = Date.UTC(2026, 4, 8, 23, 59, 59);
  const listings = [
    { id: 'in', saleDate: '2026-05-08T12:00:00Z' },
    { id: 'before', saleDate: '2026-05-07T12:00:00Z' },
    { id: 'after', saleDate: '2026-05-09T12:00:00Z' },
  ];
  const result = buildAuctionCalendar(listings, { startMs, endMs });
  assert.equal(result.weeks.length, 1);
  assert.equal(result.droppedOutside, 2);
});