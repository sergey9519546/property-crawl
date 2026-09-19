import test from "node:test";
import assert from "node:assert/strict";
import {
  DEAL_SCORE_MEANING,
  SCORE_BANDS,
  bandForScore,
  scoreBandLabel,
} from "../src/lib/score-bands.ts";

test("Next score bands mirror the deal-scoring taxonomy", () => {
  assert.deepEqual(
    SCORE_BANDS.map((band) => band.label),
    ["Elite", "Strong", "Fair", "Thin"],
  );
  assert.equal(scoreBandLabel(77), "Elite");
  assert.equal(scoreBandLabel(60), "Strong");
  assert.equal(bandForScore(0), null);
  assert.match(DEAL_SCORE_MEANING, /triage only/i);
});
