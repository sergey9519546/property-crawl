'use strict';

// test/discovery/query-helpers.test.js
//
// Direct unit coverage for the query-param parsers exported from
// server/discovery/query.js. parseBbox is the geo filter guard on every
// discovery query — silent drift would either accept malformed input
// or reject legitimate queries on the wrong shape. (parseBool and
// parseDate are private to the module — only parseBbox is exported.)

const assert = require('node:assert/strict');
const test = require('node:test');

const { parseBbox } = require('../../server/discovery/query');

// --- parseBbox -------------------------------------------------------

test('parseBbox: returns null for null / undefined / empty', () => {
  assert.equal(parseBbox(null), null);
  assert.equal(parseBbox(undefined), null);
  assert.equal(parseBbox(''), null);
});

test('parseBbox: parses a valid west,south,east,north bbox', () => {
  const out = parseBbox('-81.7,41.4,-81.6,41.5');
  assert.deepEqual(out, [-81.7, 41.4, -81.6, 41.5]);
});

test('parseBbox: rejects bboxes with the wrong number of values', () => {
  assert.throws(() => parseBbox('-81.7,41.4,-81.6'), (err) => err.status === 400);
  assert.throws(() => parseBbox('-81.7,41.4,-81.6,41.5,0'), (err) => err.status === 400);
});

test('parseBbox: rejects bboxes containing non-finite numbers', () => {
  assert.throws(() => parseBbox('not,41.4,-81.6,41.5'), (err) => err.status === 400);
  assert.throws(() => parseBbox('NaN,41.4,-81.6,41.5'), (err) => err.status === 400);
});

test('parseBbox: rejects lat outside [-90, 90]', () => {
  // south lat > 90
  assert.throws(() => parseBbox('-81.7,91,-81.6,41.5'), (err) => err.status === 400);
  // south lat < -90
  assert.throws(() => parseBbox('-81.7,-91,-81.6,41.5'), (err) => err.status === 400);
  // north lat > 90
  assert.throws(() => parseBbox('-81.7,41.4,-81.6,91'), (err) => err.status === 400);
});

test('parseBbox: rejects lng outside [-180, 180]', () => {
  assert.throws(() => parseBbox('181,41.4,-81.6,41.5'), (err) => err.status === 400);
  assert.throws(() => parseBbox('-181,41.4,-81.6,41.5'), (err) => err.status === 400);
  assert.throws(() => parseBbox('-81.7,41.4,181,41.5'), (err) => err.status === 400);
});

test('parseBbox: rejects south >= north (inverted latitude range)', () => {
  // south (41.5) is not less than north (41.4).
  assert.throws(() => parseBbox('-81.7,41.5,-81.6,41.4'), (err) => err.status === 400);
  // Equal latitudes also rejected (south === north).
  assert.throws(() => parseBbox('-81.7,41.5,-81.6,41.5'), (err) => err.status === 400);
});

test('parseBbox: rejects west === east (zero-width longitude range)', () => {
  // west and east must differ so the bbox is a 2D area.
  assert.throws(() => parseBbox('-81.7,41.4,-81.7,41.5'), (err) => err.status === 400);
});

test('parseBbox: accepts boundary values (lng=-180, lat=90, lat=-90)', () => {
  // -180 / 90 / -90 are valid bounds; the parser should accept them.
  const out = parseBbox('-180,-90,180,90');
  assert.deepEqual(out, [-180, -90, 180, 90]);
});
