---
name: deal-scoring
description: |
  Deal Score formula, SCORE_BANDS taxonomy, and worked examples for the
  property-crawl triage indicator. Use this when explaining, verifying,
  or debugging the Deal Score calculation.
license: MIT
metadata:
  version: v1
  domain: property-data
---

# Deal Scoring Skill

Use this skill when working with the Deal Score calculation or its UI presentation.

## Formula

```
mid = (estLow + estHigh) / 2
ratio = openingBid / mid
dealScore = Math.max(1, Math.min(99, Math.round((1 - ratio) * 130)))
```

- Multiplier `130` maps a 50% discount (ratio=0.50) to score `65` (Strong).
- Clamping to `1–99` prevents division anomalies and NaN.
- Score is a **triage indicator** of opening price spread, not an appraisal.

## SCORE_BANDS (single source of truth)

| Range | Label | Color | Alpha |
|---|---|---|---|
| 1–34 | Thin | `#dc2626` (red) | 0.12 |
| 35–54 | Fair | `#f59e0b` (amber) | 0.14 |
| 55–69 | Strong | `#16a34a` (green) | 0.15 |
| 70–99 | Elite | `#059669` (dark green) | 0.18 |

`SCORE_BANDS` in `app.js:96-103` is the **only** source of truth for colors, labels,
and alpha transparency. Never hardcode band values elsewhere.

## Worked Example (Columbus OH)

- Opening bid: $52,000
- Value midpoint: $128,500
- ratio = 52000 / 128500 = 0.4047
- dealScore = Math.round((1 - 0.4047) * 130) = Math.round(77.4) = **77** (Strong)

This example appears in the help modal (`app.js` `SCORE_EXAMPLE_PLACEHOLDER`) and
the listing drawer (`scoreExampleFromListing`). Both must show score `77` for the
same numbers — `test/suite.test.js` [Suite 2] verifies this.

## Invariants

- The formula and bands must stay consistent across `app.js` (v0 PWA) and
  `src/components/` (v2 Next.js). `test/sync.test.js` guards cross-surface drift.
- The worked example score must match the formula output. `test/suite.test.js`
  [Suite 2] verifies: `app.js SCORE_EXAMPLE_PLACEHOLDER score matches formula (77)`.
