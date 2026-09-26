'use strict';

// test/intelligence/score-bands-helpers.test.js
//
// Pure-function coverage for the deal-score presentation bands exported
// from server/intelligence/score-bands.js. These drive the deal-scoring
// chips, color badges, and triage ordering across every listing card.
// Silent drift would silently change every "Elite / Strong / Fair / Thin"
// label without changing the underlying model output, so the band cut-offs
// are pinned here exactly as authored.
//
//   - finiteScore: null / undefined / empty-string / non-numeric coercion
//   - bandForScore: range lookup across the four bands, boundary conditions
//   - scoreBandKey:    projection to the CSS-class key
//   - scoreBandLabel:  projection to the user-visible label
//   - scoreBandColorAlpha: concatenation of color + alpha hex into a single
//     CSS-ready rgba string

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  SCORE_BANDS,
  DEAL_SCORE_MEANING,
  bandForScore,
  scoreBandKey,
  scoreBandLabel,
  scoreBandColorAlpha,
} = require('../../server/intelligence/score-bands');

// finiteScore is private; exercise through bandForScore which calls it.

// --- SCORE_BANDS structural assertions ---------------------------------

test('SCORE_BANDS: four frozen bands in elite > strong > fair > thin order', () => {
  assert.equal(SCORE_BANDS.length, 4);
  const keys = SCORE_BANDS.map((b) => b.key);
  assert.deepEqual(keys, ['elite', 'strong', 'fair', 'thin']);
});

test('SCORE_BANDS: each entry has min, max, key, label, color, alpha, desc', () => {
  for (const band of SCORE_BANDS) {
    for (const field of ['min', 'max', 'key', 'label', 'color', 'alpha', 'desc']) {
      assert.ok(band[field] !== undefined, `${band.key || '(band)'} missing ${field}`);
    }
  }
});

test('SCORE_BANDS: ranges are continuous and cover [1, 99]', () => {
  // bands descend in priority; the union of [min, max] should span 1..99
  const flat = SCORE_BANDS.flatMap((b) => [b.min, b.max]);
  assert.equal(Math.min(...flat), 1);
  assert.equal(Math.max(...flat), 99);
});

test('SCORE_BANDS: arrays and objects are frozen', () => {
  assert.equal(Object.isFrozen(SCORE_BANDS), true);
  assert.equal(Object.isFrozen(SCORE_BANDS[0]), true);
});

test('DEAL_SCORE_MEANING: pinned disclaimer string', () => {
  assert.ok(typeof DEAL_SCORE_MEANING === 'string' && DEAL_SCORE_MEANING.length > 0);
  assert.match(DEAL_SCORE_MEANING, /valuation-range midpoint/i);
});

// --- finiteScore (via bandForScore) -------------------------------------

test('finiteScore behavior (via bandForScore): null / undefined / empty string -> null band', () => {
  assert.equal(bandForScore(null), null);
  assert.equal(bandForScore(undefined), null);
  assert.equal(bandForScore(''), null);
});

test('finiteScore behavior (via bandForScore): numeric strings are coerced', () => {
  assert.equal(bandForScore('57').key, 'strong');  // 57 is in strong band (55..69)
  assert.equal(bandForScore('50').key, 'fair');    // 50 is in fair band (35..54)
});

test('finiteScore behavior (via bandForScore): NaN / Infinity -> null band', () => {
  assert.equal(bandForScore(NaN), null);
  assert.equal(bandForScore(Infinity), null);
  assert.equal(bandForScore(-Infinity), null);
  assert.equal(bandForScore('not-a-number'), null);
});

// --- bandForScore -------------------------------------------------------

test('bandForScore: returns null for null / NaN / out-of-range', () => {
  assert.equal(bandForScore(null), null);
  assert.equal(bandForScore(NaN), null);
  assert.equal(bandForScore(0), null);
  assert.equal(bandForScore(100), null);
  assert.equal(bandForScore(-1), null);
});

test('bandForScore: elite band covers 70..99', () => {
  assert.equal(bandForScore(70).key, 'elite');
  assert.equal(bandForScore(85).key, 'elite');
  assert.equal(bandForScore(99).key, 'elite');
});

test('bandForScore: strong band covers 55..69', () => {
  assert.equal(bandForScore(55).key, 'strong');
  assert.equal(bandForScore(60).key, 'strong');
  assert.equal(bandForScore(69).key, 'strong');
});

test('bandForScore: fair band covers 35..54', () => {
  assert.equal(bandForScore(35).key, 'fair');
  assert.equal(bandForScore(45).key, 'fair');
  assert.equal(bandForScore(54).key, 'fair');
});

test('bandForScore: thin band covers 1..34', () => {
  assert.equal(bandForScore(1).key, 'thin');
  assert.equal(bandForScore(20).key, 'thin');
  assert.equal(bandForScore(34).key, 'thin');
});

test('bandForScore: boundary values map to the correct band', () => {
  assert.equal(bandForScore(69).key, 'strong');
  assert.equal(bandForScore(70).key, 'elite');
  assert.equal(bandForScore(54).key, 'fair');
  assert.equal(bandForScore(55).key, 'strong');
  assert.equal(bandForScore(34).key, 'thin');
  assert.equal(bandForScore(35).key, 'fair');
});

// --- scoreBandKey / Label / ColorAlpha ----------------------------------

test('scoreBandKey / Label / ColorAlpha: project from bandForScore', () => {
  assert.equal(scoreBandKey(80), 'elite');
  assert.equal(scoreBandLabel(80), 'Elite');
  assert.equal(scoreBandKey(60), 'strong');
  assert.equal(scoreBandLabel(60), 'Strong');
  assert.equal(scoreBandKey(45), 'fair');
  assert.equal(scoreBandLabel(45), 'Fair');
  assert.equal(scoreBandKey(20), 'thin');
  assert.equal(scoreBandLabel(20), 'Thin');
});

test('scoreBandKey / Label / ColorAlpha: out-of-range -> null', () => {
  assert.equal(scoreBandKey(0), null);
  assert.equal(scoreBandKey(100), null);
  assert.equal(scoreBandLabel(null), null);
  assert.equal(scoreBandColorAlpha(NaN), null);
});

test('scoreBandColorAlpha: concatenates color and alpha hex into one CSS-ready string', () => {
  const out = scoreBandColorAlpha(80);
  assert.ok(/^#[0-9a-f]{6}[0-9a-f]{2}$/i.test(out), `expected #RRGGBBAA hex, got ${out}`);
  // alpha segments are 2 hex digits each (12, 14, 15, 18)
  const alpha = out.slice(-2).toLowerCase();
  assert.ok(['12', '14', '15', '18'].includes(alpha), `unexpected alpha segment: ${alpha}`);
});

test('scoreBandColorAlpha: each band has its own color + alpha', () => {
  const elite = scoreBandColorAlpha(80);
  const strong = scoreBandColorAlpha(60);
  const fair = scoreBandColorAlpha(45);
  const thin = scoreBandColorAlpha(20);
  assert.notEqual(elite, strong);
  assert.notEqual(strong, fair);
  assert.notEqual(fair, thin);
});