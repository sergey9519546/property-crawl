'use strict';

/**
 * Deal Score presentation bands.
 * Formula stays in normalization / app.js:
 *   mid = (estLow + estHigh) / 2
 *   ratio = openingBid / mid
 *   dealScore = clamp(round((1 - ratio) * 130), 1, 99)
 *
 * These bands are presentation + triage ranking only. They never invent bids
 * or valuations. Keep in sync with `src/lib/score-bands.ts` and
 * `.agents/skills/deal-scoring/SKILL.md`.
 */

const SCORE_BANDS = Object.freeze([
  Object.freeze({
    min: 70, max: 99, key: 'elite', label: 'Elite',
    color: '#059669', alpha: '18',
    desc: 'Modeled bid is well under the valuation midpoint; deep modeled spread.',
  }),
  Object.freeze({
    min: 55, max: 69, key: 'strong', label: 'Strong',
    color: '#16a34a', alpha: '15',
    desc: 'Modeled bid is well under half of value; large modeled spread.',
  }),
  Object.freeze({
    min: 35, max: 54, key: 'fair', label: 'Fair',
    color: '#d97706', alpha: '14',
    desc: 'Real modeled discount, but fees and repairs can compress margin.',
  }),
  Object.freeze({
    min: 1, max: 34, key: 'thin', label: 'Thin',
    color: '#dc2626', alpha: '12',
    desc: 'Modeled bid is close to full value; little room for error.',
  }),
]);

const DEAL_SCORE_MEANING = 'Opening amount versus supported valuation-range midpoint; triage only, not an appraisal.';

function finiteScore(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function bandForScore(score) {
  const numeric = finiteScore(score);
  if (numeric === null || numeric < 1 || numeric > 99) return null;
  return SCORE_BANDS.find((band) => numeric >= band.min && numeric <= band.max) || null;
}

function scoreBandKey(score) {
  return bandForScore(score)?.key ?? null;
}

function scoreBandLabel(score) {
  return bandForScore(score)?.label ?? null;
}

function scoreBandColorAlpha(score) {
  const band = bandForScore(score);
  return band ? `${band.color}${band.alpha}` : null;
}

module.exports = {
  SCORE_BANDS,
  DEAL_SCORE_MEANING,
  bandForScore,
  scoreBandColorAlpha,
  scoreBandKey,
  scoreBandLabel,
};
