/**
 * Deal Score presentation bands for the Next.js surface.
 * Keep in sync with `server/intelligence/score-bands.js` and
 * `.agents/skills/deal-scoring/SKILL.md`.
 */

export type ScoreBandKey = "elite" | "strong" | "fair" | "thin";

export type ScoreBand = {
  min: number;
  max: number;
  key: ScoreBandKey;
  label: string;
  color: string;
  alpha: string;
  desc: string;
};

export const SCORE_BANDS: readonly ScoreBand[] = Object.freeze([
  Object.freeze({
    min: 70,
    max: 99,
    key: "elite" as const,
    label: "Elite",
    color: "#059669",
    alpha: "18",
    desc: "Modeled bid is well under the valuation midpoint; deep modeled spread.",
  }),
  Object.freeze({
    min: 55,
    max: 69,
    key: "strong" as const,
    label: "Strong",
    color: "#16a34a",
    alpha: "15",
    desc: "Modeled bid is well under half of value; large modeled spread.",
  }),
  Object.freeze({
    min: 35,
    max: 54,
    key: "fair" as const,
    label: "Fair",
    color: "#d97706",
    alpha: "14",
    desc: "Real modeled discount, but fees and repairs can compress margin.",
  }),
  Object.freeze({
    min: 1,
    max: 34,
    key: "thin" as const,
    label: "Thin",
    color: "#dc2626",
    alpha: "12",
    desc: "Modeled bid is close to full value; little room for error.",
  }),
]);

export const DEAL_SCORE_MEANING =
  "Opening amount versus supported valuation-range midpoint; triage only, not an appraisal.";

function finiteScore(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

export function bandForScore(value: unknown): ScoreBand | null {
  const numeric = finiteScore(value);
  if (numeric === null || numeric < 1 || numeric > 99) return null;
  return SCORE_BANDS.find((band) => numeric >= band.min && numeric <= band.max) ?? null;
}

export function scoreBandKey(value: unknown): ScoreBandKey | null {
  return bandForScore(value)?.key ?? null;
}

export function scoreBandLabel(value: unknown): string | null {
  return bandForScore(value)?.label ?? null;
}

export function scoreBandColorAlpha(value: unknown): string | null {
  const band = bandForScore(value);
  return band ? `${band.color}${band.alpha}` : null;
}
