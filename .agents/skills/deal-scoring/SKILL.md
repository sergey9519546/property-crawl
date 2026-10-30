---
name: deal-scoring
description: |
  Deal Score formula, SCORE_BANDS taxonomy, Opportunity Signal triagePriority,
  adjournment trajectory, Value-of-Information (VoI) gap ranking, and Second-Look
  reconsideration triggers for property-crawl.
license: MIT
metadata:
  version: v2
  domain: property-data
---

# Deal Scoring & Opportunity Triage Skill

Use this skill when working with the Deal Score calculation, `SCORE_BANDS`, Opportunity Signal `triagePriority`, adjournment trajectory, Value-of-Information (VoI) dossier gap ranking, or Second-Look reconsideration triggers.

## Formula

```
mid = (estLow + estHigh) / 2
ratio = openingBid / mid
dealScore = Math.max(1, Math.min(99, Math.round((1 - ratio) * 130)))
```

- Multiplier `130` maps a 50% discount (ratio=0.50) to score `65` (Strong).
- Clamping to `1–99` prevents division anomalies and NaN.
- Score is a **triage indicator** of opening price spread, not an appraisal.
- When either `openingBid` or `mid` is missing/zero, `dealScore` is `null` (never fabricated).

## SCORE_BANDS (presentation taxonomy)

| Range | Label | Color | Alpha |
|---|---|---|---|
| 70–99 | Elite | `#181529` (ink) | 0x18 |
| 55–69 | Strong | `#3d3a4f` (ink-2) | 0x15 |
| 35–54 | Fair | `#5f5c6e` (ink-3) | 0x14 |
| 1–34 | Thin | `#5f5c6e` (ink-3) | 0x12 |

Canonical band objects live in:

- `server/intelligence/score-bands.js` (API / hunt ranking)
- `src/lib/score-bands.ts` (Next.js terminal cards + score distribution)
- `.agents/skills/deal-scoring/SKILL.md` (this doc)

`app.js` remains the v0 PWA help-modal bands (legacy Strong/Moderate/Thin split).
The formula and worked example (77) are unchanged. Never hardcode band labels in
new components — import `bandForScore` / `SCORE_BANDS` instead.

Hunt match **triage rank** (`server/intelligence/hunt-ranking.js`) uses these bands
as one factor among evidence quality, criterion closeness, and sale urgency. Rank
is presentation-only and is never the same metric as `dealScore` or `triagePriority`.

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
- Auction calendar summaries in `src/components/listings/discovery-workbench.tsx` must use `calendarDatedTotal(calendarRollup)` from `src/lib/property-api.ts` (which sums dated `byDate` buckets or subtracts `undatedCount`) rather than raw `calendarRollup.total`, so undated listings are never mislabeled as "dated auctions".

## Relationship to Opportunity-Signal `triagePriority`

Deal Score is a **single-factor, price-only** triage: it measures only the spread
between the opening bid and the valuation midpoint (`ratio = openingBid / mid`).

The Opportunity Signal Engine (`server/intelligence/signals.js`) produces a separate
`triagePriority` (clamped **0–99**) that evaluates **eight** signals — six weighted
scoring components (the bid-to-value ratio among them, weighted 30%) plus two
unweighted ledger signals (`municipal_code_enforcement`, `publisher_documents`).
The presentation bands (moderate >= 30, high >= 50) live in `src/lib/triage-bands.ts`
and are calibrated to the measured live distribution. The two numbers are intentionally
different metrics and must never be presented as the same score:

- `dealScore` = "how deep is the discount" (pure price triage).
- `triagePriority` = "how actionable/verified is this listing" (multi-signal triage).

Do not re-tune the `×130` multiplier to match `triagePriority`'s linear ratio mapping
and do not collapse the two into one number; the `×130` calibration and `SCORE_BANDS`
are a documented, test-guarded decision (`test/sync.test.js`, `test/suite.test.js`).

## Multi-Signal Extensions (2026-10-22)

1. **Adjournment-Exhaustion Trajectory (`server/intelligence/signals.js`)**:
   - `evaluateOpportunitySignals(listing, observations)` emits a deterministic `trajectory` object (`priorPostponements`, `statutoryStayExhausted`, `cumulativeBidDropPct`, `summary`) derived from chronological `saleDate` and `openingBid` transitions across publisher observations.
   - When `priorPostponements >= 2`, `statutoryStayExhausted` is `true` (reflecting statutory borrower adjournment caps such as N.J.S.A. 2A:17-36, signaling higher probability of actual auction execution).
2. **Value-of-Information (VoI) Dossier Gap Ranking (`server/intelligence/dossier.js`)**:
   - Dossier `gaps` are annotated with `potentialPointsGain` (exact `triagePriority` points unlocked by resolving that field, e.g. `+30 pts` for `openingBid`, `+20 pts` for `saleDate`) and `priorityTier` (`critical` $\ge 20$, `high` $\ge 8$, `standard` $< 8$), sorted descending by `potentialPointsGain`.
3. **Relative/Delta Second-Look Reconsideration Triggers (`server/intelligence/research-cases.js`)**:
   - In addition to absolute comparisons (`lte`, `gte`, `changed`, `becomes_present`), `evaluateTrigger` supports scale-invariant underwriting operators:
     - `openingBid` `dropped_by_pct`: fires when `openingBid` drops by at least $X\%$ from the baseline snapshot (`((baseline - current) / baseline) * 100 >= targetPct`).
     - `openingBid` `bid_to_assessed_lte`: fires when `openingBid / assessed <= ratio` (normalized whether passed as `0.65` or `65`).
     - `saleDate` `within_days`: fires when `saleDate` is in the future and within $N$ calendar days of `options.now`.
